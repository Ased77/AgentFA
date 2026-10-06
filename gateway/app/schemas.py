"""Pydantic schemas.

SECURITY INVARIANT: every schema here is customer-facing. None of them may
contain model names, provider names, token counts or real dollar costs.
Internal telemetry lives exclusively in the usage_logs table.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


# ------------------------------------------------------------------------------
# Auth
# ------------------------------------------------------------------------------
class RegisterRequest(BaseModel):
    """Customer signup payload."""

    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class TokenResponse(BaseModel):
    """JWT issued on register/login."""

    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    """Public representation of a user (no password hash)."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: EmailStr
    plan: str
    created_at: datetime


# ------------------------------------------------------------------------------
# Chat
# ------------------------------------------------------------------------------
class ChatMessage(BaseModel):
    """A single conversation message."""

    role: str = Field(pattern="^(system|user|assistant)$")
    content: str = Field(min_length=1, max_length=32_000)


class ChatRequest(BaseModel):
    """POST /chat request body."""

    messages: list[ChatMessage] = Field(min_length=1, max_length=100)


class ChatResponse(BaseModel):
    """POST /chat response body — reply + usage percentage ONLY.

    Deliberately excludes: model, provider, tokens, real cost, charged amount.
    """

    reply: str
    credit_remaining_percent: float


class CreditOut(BaseModel):
    """GET /me/credit response."""

    credit: float
    credit_initial: float
    credit_remaining_percent: float
    plan: str


class BuyCreditRequest(BaseModel):
    """POST /buy-credit request body (payment integration is a stub)."""

    amount: float = Field(gt=0, le=10_000)


class BuyCreditResponse(BaseModel):
    """POST /buy-credit response."""

    purchase_id: uuid.UUID
    credit: float
    credit_added: float


class UsageEntry(BaseModel):
    """One row of the customer's usage history.

    Shows only what customers are allowed to see: charged amount and time.
    `model_used` / `real_cost` / token counts stay internal.
    """

    model_config = ConfigDict(from_attributes=True)

    charged: float
    created_at: datetime


class UsageOut(BaseModel):
    """GET /me/usage response."""

    items: list[UsageEntry]
    total_spent: float
