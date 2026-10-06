"""Migration tests.

Runs the real Alembic revision against a throwaway SQLite database and asserts
it produces exactly the schema declared in app/models.py. Without this, a model
change could ship with a stale migration and only fail in production.
"""

from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

from app.models import Base

GATEWAY_DIR = Path(__file__).resolve().parents[1]
TABLES = {"users", "usage_logs", "purchases"}


def _alembic_config(url: str) -> Config:
    config = Config(str(GATEWAY_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(GATEWAY_DIR / "migrations"))
    config.set_main_option("sqlalchemy.url", url)
    return config


def test_migration_matches_the_models(tmp_path, monkeypatch) -> None:
    db_path = tmp_path / "migration.db"
    async_url = f"sqlite+aiosqlite:///{db_path}"
    sync_url = f"sqlite:///{db_path}"
    monkeypatch.setenv("DATABASE_URL", async_url)
    config = _alembic_config(async_url)

    command.upgrade(config, "head")

    engine = create_engine(sync_url)
    try:
        inspector = inspect(engine)
        assert TABLES <= set(inspector.get_table_names())

        # Column parity, table by table.
        for table_name, table in Base.metadata.tables.items():
            actual = {column["name"] for column in inspector.get_columns(table_name)}
            assert actual == set(table.columns.keys()), f"drift in {table_name}"

        # The composite index backing the usage-history query.
        indexes = {index["name"] for index in inspector.get_indexes("usage_logs")}
        assert "ix_usage_logs_user_created" in indexes

        # Email must be unique.
        uniques = {index["name"] for index in inspector.get_indexes("users")
                   if index.get("unique")}
        assert "ix_users_email" in uniques
    finally:
        engine.dispose()

    # The migration must be reversible.
    command.downgrade(config, "base")
    engine = create_engine(sync_url)
    try:
        assert not TABLES & set(inspect(engine).get_table_names())
    finally:
        engine.dispose()


def test_migrations_run_offline_against_postgres_sql() -> None:
    """`alembic upgrade` must compile for Postgres without a live database.

    Offline mode renders the SQL with the Postgres dialect, which is how the
    production image exercises the migration before it touches real data.
    """
    config = _alembic_config("postgresql+asyncpg://gateway:gateway@localhost:5432/gateway")
    from io import StringIO

    buffer = StringIO()
    config.output_buffer = buffer
    config.print_stdout = lambda *args, **kwargs: None
    command.upgrade(config, "head", sql=True)

    sql = buffer.getvalue()
    assert "CREATE TABLE users" in sql
    assert "CREATE TABLE usage_logs" in sql
    assert "CREATE TABLE purchases" in sql
    assert "plan_enum" in sql  # CHECK constraint name
