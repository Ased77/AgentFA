"""Tests for litellm/custom_callbacks.py.

The callback is what hands the API its real model id and real cost, so a silent
regression here would mis-bill every request and blind the operator. It runs
inside the LiteLLM proxy container, which is why these tests skip when
`litellm` is not installed (it lives in requirements-dev.txt).

NOTE: the callback logs through its own StreamHandler with ``propagate=False``
so the proxy's logging reconfiguration cannot swallow it (see the comment in
custom_callbacks.py). Assertions therefore read process output via ``capfd``,
not via ``caplog`` (which only sees the root logger).
"""

from __future__ import annotations

import importlib.util
import json
import logging
from datetime import datetime, timedelta
from pathlib import Path
from types import ModuleType

import pytest

CALLBACKS_PATH = Path(__file__).resolve().parents[1] / "litellm" / "custom_callbacks.py"


def _litellm_installed() -> bool:
    """True only if the REAL litellm package is importable.

    `import litellm` alone is not enough: ``pythonpath = .`` puts gateway/ on
    sys.path, where our own ``litellm/`` config directory shadows the installed
    package as a namespace package.
    """
    try:
        return (
            importlib.util.find_spec("litellm.integrations.custom_logger") is not None
        )
    except (ImportError, ModuleNotFoundError, ValueError):
        return False


if not _litellm_installed():
    pytest.skip(
        "litellm is not installed - see the note in requirements-dev.txt",
        allow_module_level=True,
    )


@pytest.fixture(scope="module")
def callbacks() -> ModuleType:
    """Load the callback module straight from the proxy's config directory."""
    spec = importlib.util.spec_from_file_location("gateway_custom_callbacks", CALLBACKS_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class _Usage:
    def __init__(self, prompt_tokens: int = 5, completion_tokens: int = 7) -> None:
        self.prompt_tokens = prompt_tokens
        self.completion_tokens = completion_tokens


class _FakeResponse:
    """Minimal stand-in for a LiteLLM ModelResponse."""

    def __init__(self, **kwargs) -> None:
        self.model = kwargs.pop("model", "gpt-4o")
        self.usage = kwargs.pop("usage", None)
        self._hidden_params = kwargs.pop("_hidden_params", {})


SERVED_MODEL = "claude-3-5-sonnet-20241022"
DEPLOYMENT_HASH = "6f2a246aeaf080b3662b4b69a3bf71d44c3e5769bbdcc603a737563a661bd341"


def _telemetry_lines(output: str) -> list[dict]:
    lines = []
    for line in output.splitlines():
        if "llm_request_success" in line:
            lines.append(json.loads(line[line.index("{") :]))
    return lines


async def test_headers_expose_the_served_model_and_cost(callbacks) -> None:
    """`response.model` is the model that actually answered, after fallbacks."""
    response = _FakeResponse(
        model=SERVED_MODEL,
        usage=_Usage(),
        _hidden_params={"model_id": DEPLOYMENT_HASH, "response_cost": 0.0042},
    )
    headers = await callbacks.GatewayHeaderCallback().async_post_call_response_headers_hook(
        {}, None, response
    )
    assert headers == {"x-model-used": SERVED_MODEL, "x-real-cost": "0.00420000"}


async def test_header_falls_back_to_the_deployment_id(callbacks) -> None:
    """Without a model on the response we still record *something* traceable."""
    response = _FakeResponse(model="", _hidden_params={"model_id": DEPLOYMENT_HASH})
    headers = await callbacks.GatewayHeaderCallback().async_post_call_response_headers_hook(
        {}, None, response
    )
    assert headers == {"x-model-used": DEPLOYMENT_HASH}


async def test_cost_is_omitted_when_unknown(callbacks) -> None:
    response = _FakeResponse(model="gpt-4o-mini", _hidden_params={"model_id": DEPLOYMENT_HASH})
    headers = await callbacks.GatewayHeaderCallback().async_post_call_response_headers_hook(
        {}, None, response
    )
    assert headers == {"x-model-used": "gpt-4o-mini"}
    assert "x-real-cost" not in headers


async def test_hook_never_raises_on_unexpected_response(callbacks) -> None:
    headers = await callbacks.GatewayHeaderCallback().async_post_call_response_headers_hook(
        {}, None, object()
    )
    assert headers is None


def test_as_float_tolerates_bad_input(callbacks) -> None:
    assert callbacks._as_float(None) is None
    assert callbacks._as_float("nope") is None
    assert callbacks._as_float("0.5") == pytest.approx(0.5)


async def test_success_event_logs_structured_telemetry(callbacks, capfd) -> None:
    response = _FakeResponse(
        model=SERVED_MODEL,
        usage=_Usage(prompt_tokens=5, completion_tokens=7),
        _hidden_params={"model_id": DEPLOYMENT_HASH, "response_cost": 0.0042},
    )
    start = datetime(2026, 1, 1, 12, 0, 0)

    await callbacks.GatewayHeaderCallback().async_log_success_event(
        {"litellm_params": {"user_id": "customer-9"}},
        response,
        start,
        start + timedelta(milliseconds=250),
    )

    records = _telemetry_lines(capfd.readouterr().err)
    assert len(records) == 1
    record = records[0]
    assert record["event"] == "llm_request_success"
    assert record["model_used"] == SERVED_MODEL
    assert record["deployment_id"] == DEPLOYMENT_HASH
    assert record["input_tokens"] == 5
    assert record["output_tokens"] == 7
    assert record["latency_ms"] == 250
    assert record["cost_usd"] == pytest.approx(0.0042)
    assert record["user_id"] == "customer-9"


async def test_telemetry_survives_a_disabled_logger(callbacks, capfd) -> None:
    """Regression: the proxy calls logging.config.dictConfig on boot, which
    disables every logger that already exists. Our module is imported while the
    config loads, so a logging-based implementation emitted *nothing* in the
    real container - telemetry must not depend on the logging module."""
    target = logging.getLogger("gateway.litellm_callbacks")
    previous = target.disabled
    target.disabled = True
    try:
        await callbacks.GatewayHeaderCallback().async_log_success_event(
            {"litellm_params": {"user_id": "customer-10"}}, _FakeResponse(), None, None
        )
    finally:
        target.disabled = previous

    records = _telemetry_lines(capfd.readouterr().err)
    assert len(records) == 1, "telemetry was swallowed by the disabled logger"
    assert records[0]["user_id"] == "customer-10"


async def test_each_event_produces_exactly_one_line(callbacks, capfd) -> None:
    """One line per event - no duplication through the root logger."""
    for _ in range(2):
        await callbacks.proxy_handler_instance.async_log_success_event(
            {"litellm_params": {"user_id": "customer-11"}}, _FakeResponse(), None, None
        )

    records = _telemetry_lines(capfd.readouterr().err)
    assert len(records) == 2


def test_config_module_exposes_a_single_instance(callbacks) -> None:
    """config.yaml references this exact object by dotted path."""
    assert isinstance(
        callbacks.proxy_handler_instance, callbacks.GatewayHeaderCallback
    )
