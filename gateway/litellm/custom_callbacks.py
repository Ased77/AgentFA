"""Custom LiteLLM proxy callbacks.

Responsibilities (registered in config.yaml via
``litellm_settings.callbacks: custom_callbacks.proxy_handler_instance``):

1. Inject the ``X-Model-Used`` and ``X-Real-Cost`` response headers so the
   FastAPI billing layer can read the *actual* deployment that answered and
   its real dollar cost. These headers are consumed internally and stripped
   before anything reaches the customer.
2. Emit one structured log line per successful request containing
   model_used / input_tokens / output_tokens / latency / cost / user_id.

NOTE: the config must point at the module-level *instance*
(``custom_callbacks.proxy_handler_instance``). Pointing at the class name
makes the proxy fail config loading.
"""

from __future__ import annotations

import json
import sys
from typing import Any, Dict, Optional

from litellm.integrations.custom_logger import CustomLogger

def _emit(record: dict[str, Any]) -> None:
    """Write one structured JSON line to stderr.

    Deliberately bypasses the logging module, for two verified reasons:

    1. The proxy reconfigures logging on boot (``logging.config.dictConfig``
       with ``disable_existing_loggers``) and this module is imported *while
       that configuration is loading* - i.e. before it happens. A logger
       created here is therefore disabled, and every telemetry line is dropped
       silently (confirmed against the running container: zero lines emitted).
    2. ``sys.stderr`` is looked up at call time rather than bound at import
       time, so log capture (docker, pytest, systemd) keeps working.
    """
    print(json.dumps(record, default=str), file=sys.stderr, flush=True)


def _as_float(value: Any) -> Optional[float]:
    """Best-effort float conversion for cost values."""
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


class GatewayHeaderCallback(CustomLogger):
    """Injects billing headers and logs structured request telemetry."""

    async def async_post_call_response_headers_hook(  # type: ignore[override]
        self,
        data: dict,
        user_api_key_dict: Any,
        response: Any,
        request_headers: Optional[Dict[str, str]] = None,
    ) -> Optional[Dict[str, str]]:
        """Inject X-Model-Used / X-Real-Cost into the HTTP response.

        Runs for both successful and failed LLM calls. Values are extracted
        defensively: on any miss the header is simply omitted rather than
        breaking the response.
        """
        headers: Dict[str, str] = {}

        # --- actual model that served the request -------------------------
        # `response.model` is the model that really answered, *after* any
        # fallback (e.g. "claude-3-5-sonnet-20241022") - that is what operators
        # need. `_hidden_params["model_id"]` is LiteLLM's hashed deployment id:
        # useful for key-level attribution, useless as a model name, so it is
        # only a last resort here.
        hidden = getattr(response, "_hidden_params", None)
        deployment_id = hidden.get("model_id") if isinstance(hidden, dict) else None
        model_used: Any = getattr(response, "model", None) or deployment_id
        if model_used:
            headers["x-model-used"] = str(model_used)

        # --- real cost in USD ---------------------------------------------
        cost: Optional[float] = None
        if isinstance(hidden, dict):
            cost = _as_float(hidden.get("response_cost"))
        if cost is None:
            cost = _as_float(getattr(response, "response_cost", None))
        if cost is None and isinstance(hidden, dict):
            # Some LiteLLM versions stash cost under additional usage metadata.
            usage = getattr(response, "usage", None)
            cost = _as_float(getattr(usage, "cost", None))
        if cost is not None:
            headers["x-real-cost"] = f"{cost:.8f}"

        return headers or None

    async def async_log_success_event(
        self,
        kwargs: dict,
        response_obj: Any,
        start_time: Any,
        end_time: Any,
    ) -> None:
        """Log full per-request telemetry (model, tokens, latency, cost, user)."""
        try:
            usage = getattr(response_obj, "usage", None)
            latency_ms = int(
                (end_time - start_time).total_seconds() * 1000
            ) if start_time and end_time else None
            hidden = getattr(response_obj, "_hidden_params", None)
            hidden = hidden if isinstance(hidden, dict) else {}
            record = {
                "event": "llm_request_success",
                "model_used": getattr(response_obj, "model", None) or hidden.get("model_id"),
                # Hashed LiteLLM deployment id: shows WHICH key served the call.
                "deployment_id": hidden.get("model_id"),
                "input_tokens": getattr(usage, "prompt_tokens", None) if usage else None,
                "output_tokens": getattr(usage, "completion_tokens", None) if usage else None,
                "latency_ms": latency_ms,
                "cost_usd": _as_float(hidden.get("response_cost")),
                "user_id": (kwargs.get("litellm_params") or {}).get("user_id")
                or kwargs.get("user"),
            }
            # Only emitted when LiteLLM actually reports it - a permanently null
            # field would be worse than no field. In v1.104 the key is absent
            # from litellm_params; the proxy's own log covers the fallback hops.
            fallbacks_attempted = (kwargs.get("litellm_params") or {}).get(
                "attempted_fallbacks"
            ) or (kwargs.get("metadata") or {}).get("attempted_fallbacks")
            if fallbacks_attempted:
                record["fallbacks_attempted"] = fallbacks_attempted
            _emit(record)
        except Exception as exc:  # noqa: BLE001 - telemetry must never break serving
            _emit({"event": "llm_telemetry_failed", "error": str(exc)})


# The proxy requires an *instance* (dotted path), not the class itself.
proxy_handler_instance = GatewayHeaderCallback()
