"""Auth tests: registration, login, JWT validation."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import jwt as pyjwt
import pytest

from app import auth as auth_module
from app.config import get_settings
from conftest import auth_header, register_user


def test_password_hash_roundtrip() -> None:
    """Hashing is one-way and verifies only the correct password."""
    hashed = auth_module.hash_password("s3cret-password")
    assert hashed != "s3cret-password"
    assert auth_module.verify_password("s3cret-password", hashed)
    assert not auth_module.verify_password("wrong-password", hashed)


async def test_register_returns_bearer_token(client) -> None:
    response = await client.post(
        "/register", json={"email": "new@example.com", "password": "password123"}
    )
    assert response.status_code == 201
    body = response.json()
    assert body["token_type"] == "bearer"
    # header.payload.signature
    assert body["access_token"].count(".") == 2


async def test_register_grants_signup_credit_on_pro_plan(client) -> None:
    token = await register_user(client, email="credit@example.com")
    response = await client.get("/me/credit", headers=auth_header(token))
    assert response.status_code == 200
    body = response.json()
    assert body["plan"] == "pro"
    assert body["credit"] == pytest.approx(5.0)
    assert body["credit_initial"] == pytest.approx(5.0)
    assert body["credit_remaining_percent"] == pytest.approx(100.0)


async def test_register_duplicate_email_conflicts(client) -> None:
    await register_user(client, email="dupe@example.com")
    response = await client.post(
        "/register", json={"email": "dupe@example.com", "password": "password123"}
    )
    assert response.status_code == 409
    assert "already registered" in response.json()["detail"]


async def test_register_rejects_short_password(client) -> None:
    response = await client.post(
        "/register", json={"email": "short@example.com", "password": "short"}
    )
    assert response.status_code == 422


async def test_login_accepts_correct_credentials(client) -> None:
    await register_user(client, email="login@example.com")
    response = await client.post(
        "/login", json={"email": "login@example.com", "password": "password123"}
    )
    assert response.status_code == 200
    assert response.json()["access_token"]


async def test_login_rejects_wrong_password(client) -> None:
    await register_user(client, email="wrongpw@example.com")
    response = await client.post(
        "/login", json={"email": "wrongpw@example.com", "password": "not-the-password"}
    )
    assert response.status_code == 401


async def test_login_rejects_unknown_email(client) -> None:
    response = await client.post(
        "/login", json={"email": "ghost@example.com", "password": "password123"}
    )
    assert response.status_code == 401


async def test_protected_endpoint_requires_token(client) -> None:
    assert (await client.get("/me/credit")).status_code == 401


async def test_protected_endpoint_rejects_garbage_token(client) -> None:
    response = await client.get("/me/credit", headers=auth_header("not-a-jwt"))
    assert response.status_code == 401


async def test_expired_token_is_rejected(client) -> None:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    expired = pyjwt.encode(
        {
            "sub": str(uuid.uuid4()),
            "plan": "pro",
            "iat": now - timedelta(minutes=10),
            "exp": now - timedelta(minutes=5),
        },
        settings.JWT_SECRET,
        algorithm=settings.JWT_ALGORITHM,
    )
    response = await client.get("/me/credit", headers=auth_header(expired))
    assert response.status_code == 401
    assert response.json()["detail"] == "Token expired"


async def test_valid_token_for_unknown_user_is_rejected(client) -> None:
    token = auth_module.create_access_token(uuid.uuid4(), "pro")
    response = await client.get("/me/credit", headers=auth_header(token))
    assert response.status_code == 401
