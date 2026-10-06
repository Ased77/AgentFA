"""End-to-end API tests for the billing pipeline.

The LiteLLM call is stubbed at the `app.llm_client` module boundary, so these
tests exercise routing, the credit gate, atomic deduction, usage logging and -
critically - the "customer never sees internals" contract.
"""

from __future__ import annotations

from decimal import Decimal

import pytest
from fastapi import HTTPException, status
from sqlalchemy import select, update

from app import credit as credit_module
from app import llm_client
from app.models import UsageLog, User
from conftest import auth_header, register_user

# A deliberately leaky-looking fake: the model id / token counts / real cost
# below must NEVER appear in any customer-facing response.
FAKE_RESULT = llm_client.LLMResult(
    reply="Hello from the agent",
    model_used="gpt-4o",
    in_tokens=1234,
    out_tokens=567,
    real_cost=0.004,
    latency_ms=321,
)

LEAKY_SUBSTRINGS = (
    "gpt-4o",
    "openai",
    "anthropic",
    "model_used",
    "real_cost",
    "in_tokens",
    "out_tokens",
    "latency",
    "1234",
    "0.004",
)

CHAT_BODY = {"messages": [{"role": "user", "content": "hi"}]}


@pytest.fixture
def stub_llm(monkeypatch) -> dict[str, object]:
    """Replace the LiteLLM call with a deterministic fake; record its arguments."""
    calls: dict[str, object] = {}

    async def fake_chat_completion(messages, *, user_id, plan):
        calls["messages"] = messages
        calls["user_id"] = user_id
        calls["plan"] = plan
        return FAKE_RESULT

    monkeypatch.setattr(llm_client, "chat_completion", fake_chat_completion)
    return calls


async def test_chat_returns_only_reply_and_percentage(client, stub_llm) -> None:
    token = await register_user(client)
    response = await client.post("/chat", json=CHAT_BODY, headers=auth_header(token))

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"reply", "credit_remaining_percent"}
    assert body["reply"] == "Hello from the agent"
    assert 0.0 <= body["credit_remaining_percent"] <= 100.0

    for leaked in LEAKY_SUBSTRINGS:
        assert leaked not in response.text, f"leaked {leaked!r} to the customer"
    assert stub_llm["plan"] == "pro"


async def test_chat_charges_markup_and_logs_internal_usage(client, session, stub_llm) -> None:
    token = await register_user(client)
    await client.post("/chat", json=CHAT_BODY, headers=auth_header(token))

    expected_charge = credit_module.compute_charge(FAKE_RESULT.real_cost)
    assert expected_charge == Decimal("0.010000")

    me = await client.get("/me/credit", headers=auth_header(token))
    assert Decimal(str(me.json()["credit"])) == Decimal("5.0") - expected_charge

    logs = (await session.execute(select(UsageLog))).scalars().all()
    assert len(logs) == 1
    log = logs[0]
    assert log.model_used == "gpt-4o"  # stored internally, never returned
    assert log.in_tokens == 1234
    assert log.out_tokens == 567
    assert Decimal(str(log.real_cost)) == Decimal("0.00400000")
    assert Decimal(str(log.charged)) == expected_charge
    assert log.latency_ms == 321


async def test_chat_rejects_exhausted_credit_before_calling_llm(
    client, session, stub_llm
) -> None:
    token = await register_user(client, email="broke@example.com")
    await session.execute(
        update(User).where(User.email == "broke@example.com").values(credit=0)
    )
    await session.commit()

    response = await client.post("/chat", json=CHAT_BODY, headers=auth_header(token))

    assert response.status_code == 402
    assert response.json()["detail"] == {
        "error": "Credit exhausted",
        "action": "buy_credit",
        "link": "/buy-credit",
    }
    assert stub_llm == {}  # the paid upstream call never happened


async def test_chat_maps_llm_outage_to_generic_503(client, monkeypatch) -> None:
    token = await register_user(client)

    async def boom(*args, **kwargs):
        raise llm_client.LiteLLMUnavailableError("gpt-4o upstream refused: quota")

    monkeypatch.setattr(llm_client, "chat_completion", boom)
    response = await client.post("/chat", json=CHAT_BODY, headers=auth_header(token))

    assert response.status_code == 503
    assert response.json() == {"error": "Service temporarily unavailable"}
    assert "gpt-4o" not in response.text


async def test_chat_maps_bad_upstream_payload_to_generic_502(client, monkeypatch) -> None:
    token = await register_user(client)

    async def boom(*args, **kwargs):
        raise llm_client.LiteLLMResponseError("unexpected status 400")

    monkeypatch.setattr(llm_client, "chat_completion", boom)
    response = await client.post("/chat", json=CHAT_BODY, headers=auth_header(token))

    assert response.status_code == 502
    assert response.json() == {"error": "Service temporarily unavailable"}


async def test_chat_returns_429_when_rate_limited(client, monkeypatch, stub_llm) -> None:
    from app import main as main_module

    class _Deny:
        async def check(self, user_id) -> None:
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS, "Rate limit exceeded. Please slow down."
            )

    monkeypatch.setattr(main_module, "_rate_limiter", _Deny())
    token = await register_user(client)
    response = await client.post("/chat", json=CHAT_BODY, headers=auth_header(token))

    assert response.status_code == 429
    assert stub_llm == {}


async def test_chat_requires_authentication(client) -> None:
    assert (await client.post("/chat", json=CHAT_BODY)).status_code == 401


async def test_chat_validates_message_shape(client) -> None:
    token = await register_user(client)
    response = await client.post(
        "/chat", json={"messages": []}, headers=auth_header(token)
    )
    assert response.status_code == 422


async def test_usage_history_exposes_no_internal_fields(client, stub_llm) -> None:
    token = await register_user(client)
    await client.post("/chat", json=CHAT_BODY, headers=auth_header(token))

    response = await client.get("/me/usage", headers=auth_header(token))
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"items", "total_spent"}
    assert len(body["items"]) == 1
    assert set(body["items"][0]) == {"charged", "created_at"}
    assert body["total_spent"] == pytest.approx(0.01)
    for leaked in LEAKY_SUBSTRINGS:
        assert leaked not in response.text


async def test_usage_history_is_scoped_to_the_user(client, stub_llm) -> None:
    first = await register_user(client, email="first@example.com")
    await client.post("/chat", json=CHAT_BODY, headers=auth_header(first))

    second = await register_user(client, email="second@example.com")
    response = await client.get("/me/usage", headers=auth_header(second))

    assert response.json() == {"items": [], "total_spent": 0}


async def test_buy_credit_increases_balance(client) -> None:
    token = await register_user(client)
    response = await client.post(
        "/buy-credit", json={"amount": 25}, headers=auth_header(token)
    )

    assert response.status_code == 201
    body = response.json()
    assert set(body) == {"purchase_id", "credit", "credit_added"}
    assert body["credit_added"] == pytest.approx(25.0)
    assert body["credit"] == pytest.approx(30.0)  # 5.0 signup bonus + 25.0

    me = await client.get("/me/credit", headers=auth_header(token))
    assert me.json()["credit_initial"] == pytest.approx(25.0)
    assert me.json()["credit_remaining_percent"] == pytest.approx(100.0)


async def test_buy_credit_rejects_non_positive_amount(client) -> None:
    token = await register_user(client)
    response = await client.post(
        "/buy-credit", json={"amount": 0}, headers=auth_header(token)
    )
    assert response.status_code == 422


async def test_health_is_public(client) -> None:
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_api_docs_are_not_exposed(client) -> None:
    """The internal API surface must not be discoverable."""
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert (await client.get(path)).status_code == 404
