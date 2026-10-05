"""A request nobody decided on before its day is closed by the worker.

Once the earliest day of a request has passed it can be neither accepted nor
approved, so left alone it would stay open for ever. The worker's maintenance
loop cancels it with a fixed note, writes the audit entry as the system and
sends nothing: the duty is over, there is nothing left to tell anyone.

The roster is the one of `tests/test_swap_exchange.py`: Anna gives Tuesday the
6th of October to Bartosz and takes his Wednesday the 7th in return.
"""

import uuid
from datetime import UTC, date, datetime

import pytest
from sqlalchemy import func, select

from oncall.domain.vocabulary import AssignmentRole, SwapStatus
from oncall.infrastructure.sqlalchemy.audit_model import AuditEvent
from oncall.infrastructure.sqlalchemy.notification_models import NotificationOutbox
from oncall.infrastructure.sqlalchemy.swap_models import SwapRequest
from oncall.worker import swap_expiry_cycle
from tests.conftest import login
from tests.test_swap_exchange import (
    GIVEN,
    IN_RETURN,
    REASON,
    WEDNESDAY,
    _ask,
    _decide,
    _exchange,
    _team,
)

#: Tuesday the 6th is still the duty's own day everywhere.
ON_THE_DAY = datetime(2026, 10, 6, 12, 0, tzinfo=UTC)
#: Half past midnight in Warsaw on Wednesday the 7th; in UTC it is still the 6th.
THE_NIGHT_AFTER = datetime(2026, 10, 6, 22, 30, tzinfo=UTC)


@pytest.fixture
async def team(db) -> dict:
    return await _team(db)


async def _stored(db_factory, swap_id: str) -> SwapRequest:
    """The request as another unit of work reads it: what the cycle committed."""
    async with db_factory() as session:
        row = await session.get(SwapRequest, uuid.UUID(swap_id))
        assert row is not None
        return row


async def _expiries(db_factory) -> list[AuditEvent]:
    async with db_factory() as session:
        rows = await session.scalars(select(AuditEvent).where(AuditEvent.action == "swap.expired"))
        return list(rows)


async def _mail_count(db_factory) -> int:
    async with db_factory() as session:
        return await session.scalar(select(func.count()).select_from(NotificationOutbox))


@pytest.mark.parametrize("accepted", [False, True], ids=["unanswered", "awaiting approval"])
async def test_an_open_request_is_closed_once_its_day_has_passed(
    client, db_factory, team, frozen_clock, accepted: bool
) -> None:
    swap_id = await _ask(client, team)
    if accepted:
        assert (await _decide(client, "bartek", swap_id, "accept")).status_code == 200
    mails = await _mail_count(db_factory)

    frozen_clock.instant = ON_THE_DAY
    assert await swap_expiry_cycle(db_factory) == 0
    assert (await _stored(db_factory, swap_id)).status in (
        SwapStatus.pending_replacement,
        SwapStatus.pending_coordinator,
    )

    frozen_clock.instant = THE_NIGHT_AFTER
    assert await swap_expiry_cycle(db_factory) == 1

    closed = await _stored(db_factory, swap_id)
    assert (closed.status, closed.decision_note) == (SwapStatus.cancelled, "Termin dyżuru minął")
    [entry] = await _expiries(db_factory)
    assert (entry.actor_label, entry.actor_user_id) == ("system", None)
    assert (entry.entity_type, entry.entity_id) == ("swap", swap_id)
    assert entry.summary == (
        "Zamknięto zamianę 2026-10-06 · SECONDARY po terminie: Anna Kowalska → Bartosz Nowak"
        + IN_RETURN
    )
    assert entry.details is None
    assert await _mail_count(db_factory) == mails, "nobody is written to about a duty that is over"

    # The next pass finds nothing left to close.
    assert await swap_expiry_cycle(db_factory) == 0
    assert len(await _expiries(db_factory)) == 1


async def test_the_people_of_a_closed_request_read_why_it_ended(
    client, db_factory, team, frozen_clock
) -> None:
    swap_id = await _ask(client, team)
    frozen_clock.instant = THE_NIGHT_AFTER
    await swap_expiry_cycle(db_factory)

    await login(client, "bartek")
    [listed] = (await client.get("/api/v1/swaps")).json()

    assert (listed["id"], listed["status"]) == (swap_id, "cancelled")
    assert listed["decision_note"] == "Termin dyżuru minął"


async def test_the_day_taken_in_return_counts_when_it_is_the_earlier_one(
    client, db_factory, team, frozen_clock
) -> None:
    """Bartosz gives his Wednesday and takes Anna's Tuesday: the duty he gives
    is still today, but the exchange is one decision and its Tuesday is gone."""
    await login(client, "bartek")
    created = await client.post(
        "/api/v1/swaps",
        json=_exchange(
            team,
            **WEDNESDAY,
            replacement_member_id=str(team["Anna Kowalska"].id),
            in_return=GIVEN,
        ),
    )
    assert created.status_code == 201, created.text

    frozen_clock.instant = THE_NIGHT_AFTER
    assert await swap_expiry_cycle(db_factory) == 1

    closed = await _stored(db_factory, created.json()["id"])
    assert (closed.service_date, closed.status) == (date(2026, 10, 7), SwapStatus.cancelled)


async def test_a_request_stored_without_slots_expires_by_its_own_day(
    db, db_factory, team, frozen_clock
) -> None:
    db.add(
        SwapRequest(
            schedule_id=team["schedules"][0].id,
            service_date=date(2026, 10, 6),
            role=AssignmentRole.primary,
            requester_member_id=team["Ewa Lewandowska"].id,
            replacement_member_id=team["Filip Kamiński"].id,
            status=SwapStatus.pending_replacement,
            schedule_version=1,
        )
    )
    await db.commit()

    frozen_clock.instant = THE_NIGHT_AFTER
    assert await swap_expiry_cycle(db_factory) == 1

    [entry] = await _expiries(db_factory)
    assert entry.summary == (
        "Zamknięto zamianę 2026-10-06 · PRIMARY po terminie: Ewa Lewandowska → Filip Kamiński"
    )


async def test_a_request_already_decided_keeps_its_own_ending(
    client, db_factory, team, frozen_clock
) -> None:
    swap_id = await _ask(client, team)
    await login(client, "bartek")
    declined = await client.post(f"/api/v1/swaps/{swap_id}/reject", json={"reason": REASON})
    assert declined.status_code == 200, declined.text

    frozen_clock.instant = THE_NIGHT_AFTER
    assert await swap_expiry_cycle(db_factory) == 0

    kept = await _stored(db_factory, swap_id)
    assert (kept.status, kept.decision_note) == (SwapStatus.rejected, REASON)
    assert await _expiries(db_factory) == []
