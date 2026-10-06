"""Async client for the internal LiteLLM proxy.

Enforces the timeout budget at this layer because LiteLLM's YAML only accepts
a scalar total timeout (no connect/read split):
    connect=3s, read=20s, write=25s, pool=3s  +  hard total deadline of 25s.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any

import anyio
import httpx

from .config import get_settings

logger = logging.getLogger(__name__)

_TIMEOUT = httpx.Timeout(connect=3.0, read=20.0, write=25.0, pool=3.0)
_MAX_TOTAL_SECONDS = 25.0

# Logical model groups (the ONLY names customers may ever influence).
PLAN_MODEL: dict[str, str] = {
    "pro": "agent-pro",
    "basic": "agent-basic",
}


class LiteLLMUnavailableError(Exception):
    """Raised when LiteLLM (or every upstream provider) is unavailable."""


class LiteLLMResponseError(Exception):
    """Raised when LiteLLM returned a malformed/unexpected payload."""


@dataclass(slots=True)
class LLMResult:
    """Normalized completion result with internal-only telemetry."""

    reply: str
    model_used: str          # INTERNAL: never shown to customers
    in_tokens: int
    out_tokens: int
    real_cost: float | None  # USD, from the X-Real-Cost header
    latency_ms: int


_client: httpx.AsyncClient | None = None


def get_client() -> httpx.AsyncClient:
    """Return the shared httpx client, creating it on first use."""
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            timeout=_TIMEOUT,
            limits=httpx.Limits(max_connections=100, max_keepalive_connections=20),
        )
    return _client


async def close_client() -> None:
    """Close the shared httpx client (app shutdown)."""
    global _client
    if _client is not None and not _client.is_closed:
        await _client.aclose()
    _client = None


async def chat_completion(
    messages: list[dict[str, str]], *, user_id: str, plan: str
) -> LLMResult:
    """Send a chat completion to LiteLLM and normalize the result.

    Args:
        messages: OpenAI-format chat messages.
        user_id: Authenticated customer id (sent as `user`, required by
            LiteLLM's enforce_user_param and used for cache partitioning).
        plan: Customer plan ("pro" or "basic") selecting the logical model.

    Raises:
        LiteLLMUnavailableError: connect/timeout/5xx — customer gets a
            generic 503 with no provider details.
        LiteLLMResponseError: malformed payload or integration misrouting.
    """
    settings = get_settings()
    url = f"{settings.LITELLM_BASE_URL.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.LITELLM_MASTER_KEY}",
        "Content-Type": "application/json",
    }
    model = PLAN_MODEL.get(plan, "agent-pro")
    payload = {
        "model": model,
        "messages": messages,
        "user": user_id,
    }

    started = asyncio.get_running_loop().time()
    try:
        # Hard total deadline regardless of httpx per-phase timeouts.
        with anyio.fail_after(_MAX_TOTAL_SECONDS):
            response = await get_client().post(url, json=payload, headers=headers)
    except TimeoutError as exc:
        logger.warning("litellm total deadline exceeded (%ss)", _MAX_TOTAL_SECONDS)
        raise LiteLLMUnavailableError("upstream unavailable") from exc
    except (httpx.TimeoutException, httpx.TransportError) as exc:
        logger.warning("litellm unavailable: %s: %s", type(exc).__name__, exc)
        raise LiteLLMUnavailableError("upstream unavailable") from exc

    latency_ms = int((asyncio.get_running_loop().time() - started) * 1000)

    if response.status_code >= 500:
        logger.warning("litellm 5xx: status=%s", response.status_code)
        raise LiteLLMUnavailableError("upstream unavailable")
    if response.status_code != 200:
        # 4xx means OUR integration is wrong (bad key, bad payload). Log loudly,
        # never surface details to the customer.
        logger.error(
            "litellm unexpected status=%s body=%s",
            response.status_code,
            response.text[:500],
        )
        raise LiteLLMResponseError(f"unexpected status {response.status_code}")

    try:
        body: dict[str, Any] = response.json()
        content = body["choices"][0]["message"]["content"]
        usage = body.get("usage") or {}
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        raise LiteLLMResponseError("malformed response from upstream") from exc

    return LLMResult(
        reply=content if isinstance(content, str) else str(content),
        model_used=(
            response.headers.get("x-model-used")
            or _resolve_model_used(body)
        ),
        in_tokens=int(usage.get("prompt_tokens") or 0),
        out_tokens=int(usage.get("completion_tokens") or 0),
        real_cost=_parse_cost(response.headers.get("x-real-cost")),
        latency_ms=latency_ms,
    )


def _resolve_model_used(body: dict[str, Any]) -> str:
    """Best-effort extraction of the actual model that served the request.

    Preference: X-Model-Used arrives via HTTP headers (read by the caller);
    here we fall back to the body's `model` field / hidden params.
    """
    hidden = body.get("_hidden_params")
    if isinstance(hidden, dict):
        value = hidden.get("model_id") or hidden.get("model")
        if value:
            return str(value)
    return str(body.get("model") or "unknown")


def _parse_cost(raw: str | None) -> float | None:
    """Parse the X-Real-Cost header into a float (None on any failure)."""
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None
