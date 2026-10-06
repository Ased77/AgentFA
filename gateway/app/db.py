"""Async SQLAlchemy engine/session management."""

from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def init_engine(database_url: str) -> AsyncEngine:
    """Create (or replace) the global async engine and session factory."""
    global _engine, _session_factory
    _engine = create_async_engine(database_url, pool_pre_ping=True)
    _session_factory = async_sessionmaker(_engine, expire_on_commit=False)
    return _engine


def get_engine() -> AsyncEngine:
    """Return the initialized global engine (raises if not initialized)."""
    if _engine is None:
        raise RuntimeError("Database engine not initialized; call init_engine() first")
    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    """Return the initialized global session factory."""
    if _session_factory is None:
        raise RuntimeError("Database engine not initialized; call init_engine() first")
    return _session_factory


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency yielding a database session."""
    async with get_session_factory()() as session:
        yield session


async def dispose_engine() -> None:
    """Dispose the global engine's connection pool (called on shutdown)."""
    global _engine, _session_factory
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _session_factory = None
