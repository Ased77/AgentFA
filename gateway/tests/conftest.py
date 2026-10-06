"""Shared pytest fixtures.

The test suite is fully self-contained: it uses an in-process SQLite database
(via aiosqlite) and never talks to Redis, LiteLLM or any LLM provider. Secrets
are placeholders, permitted by ``GATEWAY_ALLOW_MISSING_SECRETS=1``
(see app/config.py).

The FastAPI lifespan is intentionally NOT run (httpx's ASGITransport skips it),
so Redis is never contacted and the rate limiter fails open. Tests that need a
rate-limit response patch the limiter explicitly.
"""

from __future__ import annotations

import os
import uuid

# Must be set before app.config builds its (cached) Settings instance.
os.environ.setdefault("GATEWAY_ALLOW_MISSING_SECRETS", "1")
os.environ.setdefault("LITELLM_MASTER_KEY", "sk-test-placeholder")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret")

from collections.abc import AsyncIterator  # noqa: E402
from pathlib import Path  # noqa: E402

import pytest_asyncio  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession  # noqa: E402

from app import db as db_module  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Base, Plan, User  # noqa: E402

DEFAULT_PASSWORD = "password123"


@pytest_asyncio.fixture
async def engine(tmp_path: Path) -> AsyncIterator[AsyncEngine]:
    """A file-backed SQLite database with the full schema created."""
    url = f"sqlite+aiosqlite:///{tmp_path / 'gateway-test.db'}"
    eng = db_module.init_engine(url)
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    try:
        yield eng
    finally:
        await db_module.dispose_engine()


@pytest_asyncio.fixture
async def session(engine: AsyncEngine) -> AsyncIterator[AsyncSession]:
    """A database session bound to the test engine."""
    factory = db_module.get_session_factory()
    async with factory() as db:
        yield db


@pytest_asyncio.fixture
async def client(engine: AsyncEngine) -> AsyncIterator[AsyncClient]:
    """An HTTP client speaking to the ASGI app in-process."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://gateway.test") as c:
        yield c


async def register_user(
    client: AsyncClient,
    email: str | None = None,
    password: str = DEFAULT_PASSWORD,
) -> str:
    """Register a user and return their bearer token."""
    email = email or f"user-{uuid.uuid4()}@example.com"
    response = await client.post(
        "/register", json={"email": email, "password": password}
    )
    assert response.status_code == 201, response.text
    return response.json()["access_token"]


def auth_header(token: str) -> dict[str, str]:
    """Build an Authorization header for the given token."""
    return {"Authorization": f"Bearer {token}"}


async def make_user(
    session: AsyncSession,
    *,
    credit: str = "5.0",
    plan: Plan = Plan.pro,
) -> User:
    """Insert a user directly (bypassing the API) for billing tests."""
    user = User(
        email=f"direct-{uuid.uuid4()}@example.com",
        password_hash="not-a-real-hash",
        plan=plan,
        credit=credit,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user
