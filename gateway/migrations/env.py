"""Alembic environment for the AI Gateway.

`DATABASE_URL` is read from the environment (see the comment in alembic.ini) so
the exact same migrations run in Docker, in CI and on a developer laptop. Async
drivers (asyncpg / aiosqlite) are driven through an async engine; anything else
falls back to the plain synchronous engine.
"""

from __future__ import annotations

import asyncio
import os
import sys
from logging.config import fileConfig
from pathlib import Path
from typing import Any

from alembic import context
from sqlalchemy import engine_from_config, pool
from sqlalchemy.ext.asyncio import async_engine_from_config

# Make the `app` package importable regardless of the invocation directory.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.models import Base  # noqa: E402  (import after sys.path tweak)

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

_ASYNC_DRIVER_PREFIXES = ("postgresql+asyncpg", "sqlite+aiosqlite")


def _database_url() -> str:
    """Resolve the database URL from the environment, else alembic.ini."""
    url = os.environ.get("DATABASE_URL") or config.get_main_option("sqlalchemy.url")
    if not url:
        raise RuntimeError(
            "DATABASE_URL is not set - export it or fill in sqlalchemy.url in alembic.ini"
        )
    return url


def run_migrations_offline() -> None:
    """Emit the migration SQL to stdout without connecting to a database."""
    context.configure(
        url=_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def _do_run_migrations(connection: Any) -> None:
    """Run the migrations against an established connection."""
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def _run_async_migrations(url: str) -> None:
    """Run the migrations using an async engine (asyncpg / aiosqlite)."""
    engine = async_engine_from_config(
        {"sqlalchemy.url": url},
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with engine.connect() as connection:
        await connection.run_sync(_do_run_migrations)
    await engine.dispose()


def run_migrations_online() -> None:
    """Run the migrations against a live database connection."""
    url = _database_url()
    if url.startswith(_ASYNC_DRIVER_PREFIXES):
        asyncio.run(_run_async_migrations(url))
        return

    engine = engine_from_config(
        {"sqlalchemy.url": url}, prefix="sqlalchemy.", poolclass=pool.NullPool
    )
    with engine.connect() as connection:
        _do_run_migrations(connection)
    engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
