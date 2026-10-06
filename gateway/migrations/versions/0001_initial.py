"""Initial schema: users, usage_logs, purchases.

Revision ID: 0001_initial
Revises:
Create Date: 2026-10-06

Mirrors app/models.py exactly. UUID columns use the dialect-agnostic
``sa.Uuid`` type (native UUID on Postgres, CHAR(32) on SQLite for tests).
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Stored as VARCHAR + a named CHECK constraint instead of a native Postgres
# enum: portable and identical on SQLite. create_constraint defaults to False in
# SQLAlchemy 2.0, so it must be requested explicitly - it is also set on the
# model in app/models.py (tests/test_migrations.py asserts the two agree).
_PLAN_ENUM = sa.Enum(
    "pro", "basic", name="plan_enum", native_enum=False, create_constraint=True
)


def upgrade() -> None:
    """Create the users, usage_logs and purchases tables."""
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("plan", _PLAN_ENUM, nullable=False),
        sa.Column("credit", sa.Numeric(precision=12, scale=6), nullable=False),
        sa.Column("total_bought", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "usage_logs",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "user_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("model_used", sa.String(length=255), nullable=False),
        sa.Column("in_tokens", sa.Integer(), nullable=False),
        sa.Column("out_tokens", sa.Integer(), nullable=False),
        sa.Column("real_cost", sa.Numeric(precision=12, scale=8), nullable=False),
        sa.Column("charged", sa.Numeric(precision=12, scale=6), nullable=False),
        sa.Column("latency_ms", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_usage_logs_user_created", "usage_logs", ["user_id", "created_at"]
    )

    op.create_table(
        "purchases",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "user_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("amount", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("credit_added", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    """Drop everything created by upgrade()."""
    op.drop_table("purchases")
    op.drop_index("ix_usage_logs_user_created", table_name="usage_logs")
    op.drop_table("usage_logs")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
