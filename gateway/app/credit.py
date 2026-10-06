"""Credit billing: markup pricing, atomic deduction, purchases.

Money is `Decimal` end-to-end to avoid float drift; the database columns are
NUMERIC and httpx/JSON boundaries convert at the edges.
"""

from __future__ import annotations

import logging
import uuid
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .models import Purchase, User

logger = logging.getLogger(__name__)

# Charge quantum: 6 decimal places keeps micro-charges accurate.
_CHARGE_QUANT = Decimal("0.000001")
# Minimum billable charge per request (prevents zero/negative rounding abuse).
MIN_CHARGE = Decimal("0.000001")


def compute_charge(real_cost: Decimal | float | None) -> Decimal:
    """Compute the customer charge: real_cost * MARKUP, floored at MIN_CHARGE.

    A missing/zero real cost (e.g. cache hit or unknown model pricing) still
    bills the minimum charge so cached traffic cannot be served for free.
    """
    settings = get_settings()
    markup = Decimal(str(settings.MARKUP))
    base = real_cost if real_cost is not None else Decimal("0")
    if not isinstance(base, Decimal):
        base = Decimal(str(base))
    charge = (base * markup).quantize(_CHARGE_QUANT, rounding=ROUND_HALF_UP)
    if charge < MIN_CHARGE:
        charge = MIN_CHARGE
    return charge


def percent_remaining(credit: Decimal | float, credit_initial: Decimal | float) -> float:
    """Percentage of the initial credit remaining, clamped to [0, 100].

    `credit_initial` is the session's starting credit (see deduct()); when no
    purchases exist yet, current credit is treated as the baseline.
    """
    credit_d = _to_decimal(credit)
    initial_d = _to_decimal(credit_initial)
    if initial_d <= 0:
        return 0.0 if credit_d <= 0 else 100.0
    pct = (credit_d / initial_d) * Decimal("100")
    return float(min(max(pct, Decimal("0")), Decimal("100")))


def _to_decimal(value: Decimal | float | str | None) -> Decimal:
    if value is None:
        return Decimal("0")
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


async def deduct(
    db: AsyncSession,
    user: User,
    charge: Decimal,
    *,
    credit_initial: Decimal,
) -> Decimal:
    """Atomically deduct `charge` from the user's credit.

    Uses a single conditional UPDATE (credit >= charge) so concurrent /chat
    requests can never drive credit negative. Returns the remaining credit.

    The caller owns the transaction: /chat commits once, after also writing the
    usage log, so a crash can never charge a customer without recording why.

    Raises:
        RuntimeError: if the balance was insufficient (race) or the row is gone.
    """
    result = await db.execute(
        update(User)
        .where(User.id == user.id, User.credit >= charge)
        .values(credit=User.credit - charge)
        .returning(User.credit)
    )
    row = result.first()
    if row is None:
        raise RuntimeError("atomic credit deduction failed")
    remaining = _to_decimal(row[0])
    logger.info(
        "credit deducted user_id=%s charge=%s remaining=%s",
        user.id,
        charge,
        remaining,
    )
    return remaining


async def buy_credit(db: AsyncSession, user: User, amount: Decimal) -> Purchase:
    """Record a purchase (payment integration stub) and add credit.

    `total_bought` tracks lifetime purchases; 1:1 USD->credit at the stub rate.
    """
    settings = get_settings()
    purchase = Purchase(
        user_id=user.id,
        amount=amount,
        credit_added=amount,  # stub: no bonuses/promos yet
    )
    db.add(purchase)
    await db.execute(
        update(User)
        .where(User.id == user.id)
        .values(
            credit=User.credit + amount,
            total_bought=User.total_bought + amount,
        )
    )
    await db.commit()
    logger.info("credit purchased user_id=%s amount=%s", user.id, amount)
    return purchase


async def get_credit_initial(db: AsyncSession, user: User) -> Decimal:
    """Baseline for the usage percentage: total bought, else signup bonus.

    The first session starts with SIGNUP_BONUS_CREDIT and no purchases, so
    that amount is the 100% baseline until the first purchase arrives.
    """
    settings = get_settings()
    result = await db.execute(
        select(User.total_bought).where(User.id == user.id)
    )
    total_bought = _to_decimal(result.scalar_one_or_none() or 0)
    if total_bought > 0:
        return total_bought
    return Decimal(str(settings.SIGNUP_BONUS_CREDIT))


def user_id_str(user: User) -> str:
    """Stable string form of the user id (used as LiteLLM `user`)."""
    return str(user.id)


def new_purchase_id() -> uuid.UUID:
    """Generate a purchase id (used by tests)."""
    return uuid.uuid4()
