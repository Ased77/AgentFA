"""SQLAlchemy models: users, usage_logs, purchases."""

from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Numeric,
    String,
    Uuid,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    """Declarative base for all gateway models."""


class Plan(str, enum.Enum):
    """Customer plan; determines which logical model the agent may call."""

    pro = "pro"
    basic = "basic"


class User(Base):
    """A customer. Never exposed: model names, providers, real costs."""

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    # Stored as a VARCHAR + CHECK constraint (portable across Postgres and the
    # SQLite used by tests) instead of a native Postgres enum type.
    plan: Mapped[Plan] = mapped_column(
        Enum(Plan, name="plan_enum", native_enum=False, create_constraint=True),
        default=Plan.pro,
        nullable=False,
    )
    # Current credit in USD. Numeric avoids float drift for money.
    credit: Mapped[float] = mapped_column(Numeric(12, 6), default=0, nullable=False)
    total_bought: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    usage_logs: Mapped[list["UsageLog"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    purchases: Mapped[list["Purchase"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class UsageLog(Base):
    """One row per /chat request with full internal telemetry.

    `model_used` records the actual provider model (e.g. gpt-4o); it is stored
    for operator analytics but NEVER returned to customers.
    """

    __tablename__ = "usage_logs"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    model_used: Mapped[str] = mapped_column(String(255), nullable=False)
    in_tokens: Mapped[int] = mapped_column(default=0, nullable=False)
    out_tokens: Mapped[int] = mapped_column(default=0, nullable=False)
    real_cost: Mapped[float] = mapped_column(Numeric(12, 8), default=0, nullable=False)
    charged: Mapped[float] = mapped_column(Numeric(12, 6), default=0, nullable=False)
    latency_ms: Mapped[int] = mapped_column(default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user: Mapped[User] = relationship(back_populates="usage_logs")

    __table_args__ = (
        Index("ix_usage_logs_user_created", "user_id", "created_at"),
    )


class Purchase(Base):
    """A credit purchase. `buy-credit` is a stub — rows are created on 'payment'."""

    __tablename__ = "purchases"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    credit_added: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user: Mapped[User] = relationship(back_populates="purchases")
