"""Credit billing tests: markup, atomic deduction, purchases."""

from __future__ import annotations

from decimal import Decimal

import pytest
from sqlalchemy import select

from app import credit
from app.config import get_settings
from app.models import Purchase
from conftest import make_user

_QUANT = Decimal("0.000001")


def _expected_charge(real_cost: str) -> Decimal:
    """charge = real_cost * MARKUP, quantized to 6dp (mirrors the implementation)."""
    markup = Decimal(str(get_settings().MARKUP))
    return (Decimal(real_cost) * markup).quantize(_QUANT)


def test_compute_charge_applies_markup() -> None:
    assert credit.compute_charge(Decimal("0.01")) == _expected_charge("0.01")


def test_compute_charge_accepts_float() -> None:
    assert credit.compute_charge(0.004) == _expected_charge("0.004")


def test_compute_charge_floors_at_minimum() -> None:
    """Cache hits and unknown pricing must still bill the minimum."""
    assert credit.compute_charge(None) == credit.MIN_CHARGE
    assert credit.compute_charge(Decimal("0")) == credit.MIN_CHARGE


def test_percent_remaining_is_clamped() -> None:
    assert credit.percent_remaining(Decimal("5"), Decimal("5")) == pytest.approx(100.0)
    assert credit.percent_remaining(Decimal("2.5"), Decimal("5")) == pytest.approx(50.0)
    assert credit.percent_remaining(Decimal("0"), Decimal("5")) == pytest.approx(0.0)
    # Over-credited (e.g. after a top-up) never exceeds 100%.
    assert credit.percent_remaining(Decimal("7"), Decimal("5")) == pytest.approx(100.0)
    # No baseline: 100% while credit remains, 0% when exhausted.
    assert credit.percent_remaining(Decimal("1"), Decimal("0")) == pytest.approx(100.0)
    assert credit.percent_remaining(Decimal("0"), Decimal("0")) == pytest.approx(0.0)


async def test_deduct_decrements_credit(session) -> None:
    user = await make_user(session, credit="1.0")
    remaining = await credit.deduct(
        session, user, Decimal("0.25"), credit_initial=Decimal("1.0")
    )
    assert remaining == Decimal("0.750000")

    await session.commit()
    await session.refresh(user)
    assert Decimal(str(user.credit)) == Decimal("0.750000")


async def test_deduct_leaves_the_transaction_to_the_caller(session) -> None:
    """deduct() must not commit on its own.

    /chat commits once, after the usage log is written too, so a crash can
    never charge a customer without a record of why.
    """
    user = await make_user(session, credit="1.0")
    await credit.deduct(session, user, Decimal("0.25"), credit_initial=Decimal("1.0"))

    await session.rollback()
    await session.refresh(user)
    assert Decimal(str(user.credit)) == Decimal("1.000000")


async def test_deduct_refuses_when_credit_is_insufficient(session) -> None:
    """The conditional UPDATE must never drive credit negative."""
    user = await make_user(session, credit="0.1")
    with pytest.raises(RuntimeError):
        await credit.deduct(
            session, user, Decimal("5.0"), credit_initial=Decimal("0.1")
        )


async def test_buy_credit_records_purchase_and_increases_balance(session) -> None:
    user = await make_user(session, credit="0")
    purchase = await credit.buy_credit(session, user, Decimal("10.00"))
    assert purchase.id is not None

    rows = (
        (
            await session.execute(
                select(Purchase).where(Purchase.user_id == user.id)
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1
    assert Decimal(str(rows[0].credit_added)) == Decimal("10.00")

    await session.refresh(user)
    assert Decimal(str(user.credit)) == Decimal("10.000000")
    assert Decimal(str(user.total_bought)) == Decimal("10.00")


async def test_get_credit_initial_falls_back_to_signup_bonus(session) -> None:
    user = await make_user(session, credit="5.0")
    initial = await credit.get_credit_initial(session, user)
    assert initial == Decimal(str(get_settings().SIGNUP_BONUS_CREDIT))


async def test_get_credit_initial_prefers_total_bought(session) -> None:
    user = await make_user(session, credit="0")
    await credit.buy_credit(session, user, Decimal("20.00"))
    assert await credit.get_credit_initial(session, user) == Decimal("20.00")
