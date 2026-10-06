"""AI Gateway public API.

SECURITY CONTRACT (enforced throughout this module):
  * Customers see ONLY: reply + credit_remaining_percent (+ their own credit).
  * Model names, providers, token counts and real costs NEVER appear in any
    response body, header or error message.
"""

from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from decimal import Decimal
from typing import Annotated, AsyncIterator

import redis.asyncio as aioredis
from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.responses import JSONResponse
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from . import auth, credit, llm_client
from .config import configure_logging, get_settings
from .db import dispose_engine, get_db, init_engine
from .models import Plan, Purchase, UsageLog, User
from .rate_limit import RateLimiter
from .schemas import (
    BuyCreditRequest,
    BuyCreditResponse,
    ChatMessage,
    ChatRequest,
    ChatResponse,
    CreditOut,
    RegisterRequest,
    TokenResponse,
    UsageEntry,
    UsageOut,
)

configure_logging()
logger = logging.getLogger(__name__)

_rate_limiter = RateLimiter()

SessionDep = Annotated[AsyncSession, Depends(get_db)]


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Initialize engine + Redis on startup; release them on shutdown."""
    settings = get_settings()
    init_engine(settings.DATABASE_URL)
    try:
        await _rate_limiter.connect(settings.REDIS_URL)
    except Exception as exc:  # noqa: BLE001
        logger.warning("redis unavailable at startup (%s) - limits fail open", exc)
    yield
    await _rate_limiter.close()
    await llm_client.close_client()
    await dispose_engine()


app = FastAPI(
    title="AI Gateway API",
    version="1.0.0",
    # Docs are internal-only; not exposed in production.
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)


# ------------------------------------------------------------------------------
# Error handling: generic, never leaking internals
# ------------------------------------------------------------------------------
@app.exception_handler(llm_client.LiteLLMUnavailableError)
async def _litellm_down_handler(request: Request, exc: llm_client.LiteLLMUnavailableError) -> JSONResponse:
    """All-provider outage maps to a generic 503."""
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={"error": "Service temporarily unavailable"},
    )


@app.exception_handler(llm_client.LiteLLMResponseError)
async def _litellm_bad_response_handler(request: Request, exc: llm_client.LiteLLMResponseError) -> JSONResponse:
    """Unexpected LiteLLM payload: customer sees a generic 502."""
    return JSONResponse(
        status_code=status.HTTP_502_BAD_GATEWAY,
        content={"error": "Service temporarily unavailable"},
    )


@app.exception_handler(Exception)
async def _unhandled_handler(request: Request, exc: Exception) -> JSONResponse:
    """Catch-all 500: log internally, return a sanitized message."""
    logger.exception("unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error"},
    )


# ------------------------------------------------------------------------------
# Auth endpoints
# ------------------------------------------------------------------------------
@app.post("/register", response_model=TokenResponse, status_code=201)
async def register(payload: RegisterRequest, db: SessionDep) -> TokenResponse:
    """Create an account (pro plan, signup bonus credit) and return a JWT."""
    existing = (
        await db.execute(select(User).where(User.email == payload.email))
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")

    settings = get_settings()
    user = User(
        email=payload.email,
        password_hash=auth.hash_password(payload.password),
        plan=Plan.pro,
        credit=Decimal(str(settings.SIGNUP_BONUS_CREDIT)),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return TokenResponse(access_token=auth.create_access_token(user.id, user.plan.value))


@app.post("/login", response_model=TokenResponse)
async def login(payload: RegisterRequest, db: SessionDep) -> TokenResponse:
    """Authenticate and return a JWT."""
    user = (
        await db.execute(select(User).where(User.email == payload.email))
    ).scalar_one_or_none()
    if user is None or not auth.verify_password(payload.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    return TokenResponse(access_token=auth.create_access_token(user.id, user.plan.value))


# ------------------------------------------------------------------------------
# Chat endpoint (the billing pipeline)
# ------------------------------------------------------------------------------
@app.post("/chat", response_model=ChatResponse)
async def chat(
    payload: ChatRequest,
    user: auth.CurrentUser,
    db: SessionDep,
) -> ChatResponse:
    """Chat with the agent.

    Pipeline: rate limit -> credit gate -> LiteLLM call -> markup charge ->
    atomic deduction -> usage log -> sanitized response.
    """
    await _rate_limiter.check(user.id)

    credit_initial = await credit.get_credit_initial(db, user)
    credit_now = Decimal(str(user.credit))
    if credit_now <= 0:
        raise HTTPException(
            status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "error": "Credit exhausted",
                "action": "buy_credit",
                "link": "/buy-credit",
            },
        )

    messages = [m.model_dump() for m in payload.messages]
    result = await llm_client.chat_completion(
        messages, user_id=str(user.id), plan=user.plan.value
    )

    charge = credit.compute_charge(result.real_cost)
    remaining = await credit.deduct(
        db, user, charge, credit_initial=credit_initial
    )

    db.add(
        UsageLog(
            user_id=user.id,
            model_used=result.model_used,
            in_tokens=result.in_tokens,
            out_tokens=result.out_tokens,
            real_cost=Decimal(str(result.real_cost or 0)),
            charged=charge,
            latency_ms=result.latency_ms,
        )
    )
    await db.commit()

    return ChatResponse(
        reply=result.reply,
        credit_remaining_percent=credit.percent_remaining(remaining, credit_initial),
    )


# ------------------------------------------------------------------------------
# Credit / usage endpoints
# ------------------------------------------------------------------------------
@app.get("/me/credit", response_model=CreditOut)
async def my_credit(user: auth.CurrentUser, db: SessionDep) -> CreditOut:
    """Current credit balance and remaining percentage."""
    credit_initial = await credit.get_credit_initial(db, user)
    credit_now = Decimal(str(user.credit))
    return CreditOut(
        credit=float(credit_now),
        credit_initial=float(credit_initial),
        credit_remaining_percent=credit.percent_remaining(credit_now, credit_initial),
        plan=user.plan.value,
    )


@app.post("/buy-credit", response_model=BuyCreditResponse, status_code=201)
async def buy_credit(
    payload: BuyCreditRequest,
    user: auth.CurrentUser,
    db: SessionDep,
) -> BuyCreditResponse:
    """Buy credit (STUB: no real payment processor; records and credits 1:1)."""
    purchase = await credit.buy_credit(db, user, Decimal(str(payload.amount)))
    await db.refresh(user)
    return BuyCreditResponse(
        purchase_id=purchase.id,
        credit=float(Decimal(str(user.credit))),
        credit_added=float(purchase.credit_added),
    )


@app.get("/me/usage", response_model=UsageOut)
async def my_usage(
    user: auth.CurrentUser,
    db: SessionDep,
    limit: int = 50,
    offset: int = 0,
) -> UsageOut:
    """Paginated usage history (charged amounts only — no model/cost data)."""
    limit = max(1, min(limit, 200))
    offset = max(0, offset)
    rows = (
        await db.execute(
            select(UsageLog)
            .where(UsageLog.user_id == user.id)
            .order_by(desc(UsageLog.created_at))
            .offset(offset)
            .limit(limit)
        )
    ).scalars().all()
    total = (
        await db.execute(
            select(func.coalesce(func.sum(UsageLog.charged), 0)).where(
                UsageLog.user_id == user.id
            )
        )
    ).scalar_one()
    return UsageOut(
        items=[UsageEntry.model_validate(r) for r in rows],
        total_spent=float(Decimal(str(total))),
    )


# ------------------------------------------------------------------------------
# Health
# ------------------------------------------------------------------------------
@app.get("/health")
async def health() -> dict[str, str]:
    """Liveness probe for orchestration."""
    return {"status": "ok"}
