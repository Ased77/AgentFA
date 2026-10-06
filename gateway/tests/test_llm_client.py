"""LiteLLM client tests.

A mock transport stands in for the proxy, so no network or container is needed:
what matters here is the contract (logical model names, header parsing, error
mapping) rather than LiteLLM itself.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from app import llm_client


def _mock_client(handler: Any) -> httpx.AsyncClient:
    """Build an AsyncClient whose transport is the given handler."""
    return httpx.AsyncClient(
        transport=httpx.MockTransport(handler), timeout=llm_client._TIMEOUT
    )


def _ok_handler(payload: dict[str, Any], headers: dict[str, str]) -> Any:
    """Handler returning a fixed 200 response."""
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        captured["authorization"] = request.headers.get("authorization", "")
        captured["url"] = str(request.url)
        return httpx.Response(200, json=payload, headers=headers)

    handler.captured = captured  # type: ignore[attr-defined]
    return handler


async def test_chat_completion_parses_reply_and_telemetry(monkeypatch) -> None:
    handler = _ok_handler(
        {
            "model": "agent-pro",
            "choices": [{"message": {"content": "hello"}}],
            "usage": {"prompt_tokens": 11, "completion_tokens": 7},
        },
        {"x-model-used": "gpt-4o", "x-real-cost": "0.00123000"},
    )
    mock = _mock_client(handler)
    monkeypatch.setattr(llm_client, "get_client", lambda: mock)

    result = await llm_client.chat_completion(
        [{"role": "user", "content": "hi"}], user_id="user-1", plan="pro"
    )
    await mock.aclose()

    assert result.reply == "hello"
    assert result.model_used == "gpt-4o"
    assert result.in_tokens == 11
    assert result.out_tokens == 7
    assert result.real_cost == pytest.approx(0.00123)
    assert result.latency_ms >= 0


async def test_plan_maps_to_logical_model_name_and_sends_user(monkeypatch) -> None:
    """The provider-facing request must carry the logical group + customer id."""
    handler = _ok_handler(
        {"choices": [{"message": {"content": "ok"}}], "usage": {}},
        {"x-model-used": "gpt-4o-mini"},
    )
    mock = _mock_client(handler)
    monkeypatch.setattr(llm_client, "get_client", lambda: mock)

    await llm_client.chat_completion(
        [{"role": "user", "content": "hi"}], user_id="user-42", plan="basic"
    )
    await mock.aclose()

    captured = handler.captured  # type: ignore[attr-defined]
    assert captured["body"]["model"] == "agent-basic"
    assert captured["body"]["user"] == "user-42"
    assert captured["authorization"].startswith("Bearer ")
    assert captured["url"].endswith("/chat/completions")


async def test_unknown_plan_defaults_to_pro(monkeypatch) -> None:
    handler = _ok_handler(
        {"choices": [{"message": {"content": "ok"}}], "usage": {}}, {}
    )
    mock = _mock_client(handler)
    monkeypatch.setattr(llm_client, "get_client", lambda: mock)

    await llm_client.chat_completion([{"role": "user", "content": "hi"}], user_id="u", plan="enterprise")
    await mock.aclose()

    assert handler.captured["body"]["model"] == "agent-pro"  # type: ignore[attr-defined]


async def test_model_used_falls_back_to_body_when_header_missing(monkeypatch) -> None:
    handler = _ok_handler(
        {
            "model": "agent-pro",
            "_hidden_params": {"model_id": "claude-3-5-sonnet-20241022"},
            "choices": [{"message": {"content": "ok"}}],
            "usage": {},
        },
        {},
    )
    mock = _mock_client(handler)
    monkeypatch.setattr(llm_client, "get_client", lambda: mock)

    result = await llm_client.chat_completion(
        [{"role": "user", "content": "hi"}], user_id="u", plan="pro"
    )
    await mock.aclose()

    assert result.model_used == "claude-3-5-sonnet-20241022"
    assert result.real_cost is None
    assert result.in_tokens == 0


async def test_server_error_raises_unavailable(monkeypatch) -> None:
    mock = _mock_client(lambda request: httpx.Response(503, json={"error": "down"}))
    monkeypatch.setattr(llm_client, "get_client", lambda: mock)

    with pytest.raises(llm_client.LiteLLMUnavailableError):
        await llm_client.chat_completion(
            [{"role": "user", "content": "hi"}], user_id="u", plan="pro"
        )
    await mock.aclose()


async def test_transport_error_raises_unavailable(monkeypatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    mock = _mock_client(handler)
    monkeypatch.setattr(llm_client, "get_client", lambda: mock)

    with pytest.raises(llm_client.LiteLLMUnavailableError):
        await llm_client.chat_completion(
            [{"role": "user", "content": "hi"}], user_id="u", plan="pro"
        )
    await mock.aclose()


async def test_read_timeout_raises_unavailable(monkeypatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("too slow", request=request)

    mock = _mock_client(handler)
    monkeypatch.setattr(llm_client, "get_client", lambda: mock)

    with pytest.raises(llm_client.LiteLLMUnavailableError):
        await llm_client.chat_completion(
            [{"role": "user", "content": "hi"}], user_id="u", plan="pro"
        )
    await mock.aclose()


async def test_total_deadline_maps_to_unavailable(monkeypatch) -> None:
    """The hard 25s deadline must surface as a generic 503, not a 500."""

    class _Expired:
        def __enter__(self) -> None:
            raise TimeoutError("deadline exceeded")

        def __exit__(self, *exc: object) -> bool:
            return False

    monkeypatch.setattr(llm_client.anyio, "fail_after", lambda *a, **k: _Expired())

    with pytest.raises(llm_client.LiteLLMUnavailableError):
        await llm_client.chat_completion(
            [{"role": "user", "content": "hi"}], user_id="u", plan="pro"
        )


async def test_client_error_raises_response_error(monkeypatch) -> None:
    """4xx means OUR integration is broken: log loudly, tell the customer nothing."""
    mock = _mock_client(
        lambda request: httpx.Response(400, json={"error": {"message": "bad model"}})
    )
    monkeypatch.setattr(llm_client, "get_client", lambda: mock)

    with pytest.raises(llm_client.LiteLLMResponseError) as excinfo:
        await llm_client.chat_completion(
            [{"role": "user", "content": "hi"}], user_id="u", plan="pro"
        )
    assert "bad model" not in str(excinfo.value)
    await mock.aclose()


async def test_malformed_body_raises_response_error(monkeypatch) -> None:
    mock = _mock_client(lambda request: httpx.Response(200, json={"unexpected": True}))
    monkeypatch.setattr(llm_client, "get_client", lambda: mock)

    with pytest.raises(llm_client.LiteLLMResponseError):
        await llm_client.chat_completion(
            [{"role": "user", "content": "hi"}], user_id="u", plan="pro"
        )
    await mock.aclose()


def test_parse_cost_tolerates_garbage() -> None:
    assert llm_client._parse_cost(None) is None
    assert llm_client._parse_cost("not-a-number") is None
    assert llm_client._parse_cost("0.5") == pytest.approx(0.5)
