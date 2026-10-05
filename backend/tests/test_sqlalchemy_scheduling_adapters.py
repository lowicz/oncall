"""The scheduling adapters on their own."""

import uuid
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from oncall.domain.scheduling.ports import NewDraft
from oncall.domain.scheduling.solver import GeneratedAssignment, SolverResult
from oncall.domain.vocabulary import (
    AssignmentRole,
    RotationMode,
    ScheduleStatus,
    SwapSlotDirection,
    SwapStatus,
    UserRole,
)
from oncall.infrastructure.sqlalchemy.scheduling_changes import SqlAlchemyChangeLog
from oncall.infrastructure.sqlalchemy.scheduling_generation import SqlAlchemyGenerationQueue
from oncall.infrastructure.sqlalchemy.scheduling_models import ScheduleRun
from oncall.infrastructure.sqlalchemy.scheduling_publication import SqlAlchemyPublicationSwaps
from oncall.infrastructure.sqlalchemy.scheduling_schedules import SqlAlchemySchedules
from oncall.infrastructure.sqlalchemy.swap_models import SwapRequest, SwapRequestSlot
from tests.conftest import create_member, create_published_schedule, create_user

DAY = date.today() + timedelta(days=30)


async def test_a_schedule_read_again_shows_a_status_written_by_statement(db) -> None:
    schedule = await create_published_schedule(db, starts_on=DAY, days=1, primary=["Anna"])
    schedules = SqlAlchemySchedules(db)
    assert (await schedules.schedule(schedule.id)).version == 1

    moved = await schedules.change_status(
        schedule.id,
        from_status=ScheduleStatus.published,
        to_status=ScheduleStatus.superseded,
        expected_version=1,
    )
    stale = await schedules.change_status(
        schedule.id,
        from_status=ScheduleStatus.published,
        to_status=ScheduleStatus.superseded,
        expected_version=1,
    )
    await db.commit()

    reread = await schedules.schedule(schedule.id)
    assert (moved, stale) == (True, False)
    assert (reread.status, reread.version) == (ScheduleStatus.superseded, 2)


async def test_a_stored_draft_has_no_id_until_its_unit_of_work_is_written(db) -> None:
    user = await create_user(db, "anna", display_name="Anna")
    anna = await create_member(db, user, display_name="Anna")
    schedules = SqlAlchemySchedules(db)

    stored = await schedules.store_draft(
        NewDraft(
            name="Szkic dzienny",
            starts_on=DAY,
            ends_on=DAY,
            rotation_mode=RotationMode.daily,
            result=SolverResult(
                assignments=(GeneratedAssignment(DAY, AssignmentRole.primary, "Anna"),),
                conflicts=(),
                status="OPTIMAL",
                warnings=("uwaga",),
            ),
            assignments=((GeneratedAssignment(DAY, AssignmentRole.primary, "Anna"), anna.id),),
        )
    )
    assert stored.id is None
    await db.commit()

    schedule = await schedules.schedule(stored.id)
    assert (schedule.status, schedule.solver_warnings) == (ScheduleStatus.draft, ("uwaga",))
    assert [(item.assignee_name, item.member_id) for item in schedule.assignments] == [
        ("Anna", anna.id)
    ]


async def test_a_second_request_for_a_queued_range_gets_the_queued_run(db) -> None:
    user = await create_user(db, "koord", role=UserRole.coordinator)
    queue = SqlAlchemyGenerationQueue(db)

    first = await queue.enqueue(DAY, DAY + timedelta(days=6), user.id)
    await db.commit()

    assert (await queue.active_run_for(DAY, DAY + timedelta(days=6))).id == first.id
    assert await queue.active_runs_before(first.created_at + timedelta(seconds=1)) == 1


async def test_swaps_are_cancelled_for_a_publication_with_the_reason_recorded(db) -> None:
    schedule = await create_published_schedule(db, starts_on=DAY, days=1, primary=["Anna"])
    people = []
    for name in ("Anna", "Bartek"):
        user = await create_user(db, name.lower(), display_name=name)
        people.append(await create_member(db, user, display_name=name))
    swap = SwapRequest(
        schedule_id=schedule.id,
        service_date=DAY,
        role=AssignmentRole.primary,
        requester_member_id=people[0].id,
        replacement_member_id=people[1].id,
        status=SwapStatus.pending_coordinator,
        schedule_version=1,
    )
    db.add(swap)
    await db.commit()
    swaps = SqlAlchemyPublicationSwaps(db)

    pending = await swaps.pending_on([schedule.id])
    cancelled = await swaps.cancel_for_publication([swap.id])
    await db.commit()

    assert [item.status for item in pending] == ["pending_coordinator"]
    assert cancelled == [swap.id]
    stored = await db.scalar(select(SwapRequest).where(SwapRequest.id == swap.id))
    assert (stored.status, stored.decision_note) == (
        SwapStatus.cancelled,
        "Grafik zastąpiony nową publikacją",
    )


async def test_a_run_that_loses_its_insert_to_an_active_one_gets_the_active_run(db) -> None:
    """PostgreSQL's partial unique index turns the second of two racing inserts
    into an IntegrityError. SQLite has no such index, so an unknown requester
    (a foreign-key violation) stands in for the lost race."""
    user = await create_user(db, "koord", role=UserRole.coordinator)
    queue = SqlAlchemyGenerationQueue(db)
    first = await queue.enqueue(DAY, DAY + timedelta(days=6), user.id)
    await db.commit()

    again = await queue.enqueue(DAY, DAY + timedelta(days=6), uuid.uuid4())
    await db.commit()

    assert again.id == first.id
    runs = (await db.scalars(select(ScheduleRun))).all()
    assert [run.id for run in runs] == [first.id]


async def test_an_insert_that_fails_with_no_active_run_raises_and_keeps_the_session(db) -> None:
    user = await create_user(db, "koord", role=UserRole.coordinator)
    queue = SqlAlchemyGenerationQueue(db)
    week_end = DAY + timedelta(days=6)
    nobody = uuid.uuid4()

    with pytest.raises(IntegrityError):
        await queue.enqueue(DAY, week_end, nobody)

    # Only the savepoint was undone: the unit of work goes on.
    kept = await queue.enqueue(DAY, week_end, user.id)
    await db.commit()
    assert (await queue.active_run_for(DAY, week_end)).id == kept.id


class _RecordingSession:
    def __init__(self, dialect: str) -> None:
        self.bind = SimpleNamespace(dialect=SimpleNamespace(name=dialect))
        self.statements: list[str] = []

    async def execute(self, statement: Any) -> None:
        self.statements.append(str(statement))


async def test_publication_is_serialised_by_an_advisory_lock_on_postgresql_only() -> None:
    postgres = _RecordingSession("postgresql")
    sqlite = _RecordingSession("sqlite")

    await SqlAlchemySchedules(postgres).hold_publication()
    await SqlAlchemySchedules(sqlite).hold_publication()

    (statement,) = postgres.statements
    assert statement.startswith("SELECT pg_advisory_xact_lock(")
    assert sqlite.statements == []


async def test_publishing_under_the_same_name_keeps_the_name(db) -> None:
    schedule = await create_published_schedule(db, starts_on=DAY, days=1, primary=["Anna"])
    schedule.status = ScheduleStatus.proposed
    await db.commit()
    schedules = SqlAlchemySchedules(db)
    await schedules.hold_publication()
    await schedules.schedule_to_publish(schedule.id)
    moment = datetime(2030, 1, 1, tzinfo=UTC)

    await schedules.mark_published(schedule.id, name=schedule.name, published_at=moment)
    await db.commit()

    reread = await schedules.schedule(schedule.id)
    assert (reread.status, reread.version, reread.name) == (
        ScheduleStatus.published,
        2,
        "Test schedule",
    )


async def _exchange(db, status: SwapStatus) -> dict:
    """Anna gives Bartek her duty of the first publication and takes his of
    the second one in return."""
    first = await create_published_schedule(db, starts_on=DAY, days=1, primary=["Anna"])
    second = await create_published_schedule(
        db, starts_on=DAY + timedelta(days=1), days=1, primary=["Bartek"]
    )
    people = []
    for name in ("Anna", "Bartek"):
        user = await create_user(db, name.lower(), display_name=name)
        people.append(await create_member(db, user, display_name=name))
    swap = SwapRequest(
        schedule_id=first.id,
        service_date=DAY,
        role=AssignmentRole.primary,
        requester_member_id=people[0].id,
        replacement_member_id=people[1].id,
        status=status,
        schedule_version=1,
        slots=[
            SwapRequestSlot(service_date=DAY, role=AssignmentRole.primary, schedule_id=first.id),
            SwapRequestSlot(
                service_date=DAY + timedelta(days=1),
                role=AssignmentRole.primary,
                schedule_id=second.id,
                direction=SwapSlotDirection.returned,
            ),
        ],
    )
    db.add(swap)
    await db.commit()
    return {"swap": swap, "first": first, "second": second, "anna": people[0], "bartek": people[1]}


async def test_a_pending_exchange_is_found_by_the_schedule_of_either_direction(db) -> None:
    exchange = await _exchange(db, SwapStatus.pending_replacement)
    swaps = SqlAlchemyPublicationSwaps(db)

    (pending,) = await swaps.pending_on([exchange["second"].id])

    assert pending.id == exchange["swap"].id
    assert pending.schedule_ids == {exchange["first"].id, exchange["second"].id}
    assert pending.slots == ((DAY, AssignmentRole.primary),)
    assert pending.return_slots == ((DAY + timedelta(days=1), AssignmentRole.primary),)
    assert await swaps.pending_on([uuid.uuid4()]) == []


async def test_an_approved_exchange_is_two_changes_each_with_its_own_original_holder(db) -> None:
    """The requester held what was given, the replacement what came back: a
    republish compares each slot with the person it was taken from."""
    exchange = await _exchange(db, SwapStatus.approved)

    approved = await SqlAlchemyPublicationSwaps(db).approved_on([exchange["second"].id])

    assert [
        (item.schedule_id, item.original_member_id, item.original_name, item.slots)
        for item in approved
    ] == [
        (exchange["first"].id, exchange["anna"].id, "Anna", ((DAY, AssignmentRole.primary),)),
        (
            exchange["second"].id,
            exchange["bartek"].id,
            "Bartek",
            ((DAY + timedelta(days=1), AssignmentRole.primary),),
        ),
    ]


async def test_the_days_a_swap_touches_are_read_per_request(db) -> None:
    schedule = await create_published_schedule(db, starts_on=DAY, days=2, primary=["Anna"])
    people = []
    for name in ("Anna", "Bartek"):
        user = await create_user(db, name.lower(), display_name=name)
        people.append(await create_member(db, user, display_name=name))
    swap = SwapRequest(
        schedule_id=schedule.id,
        service_date=DAY,
        role=AssignmentRole.primary,
        requester_member_id=people[0].id,
        replacement_member_id=people[1].id,
        status=SwapStatus.pending_coordinator,
        schedule_version=1,
    )
    swap.slots = [
        SwapRequestSlot(service_date=day, role=AssignmentRole.primary, schedule_id=schedule.id)
        for day in (DAY, DAY + timedelta(days=1))
    ]
    db.add(swap)
    await db.commit()

    days = await SqlAlchemyChangeLog(db).swap_slot_days([swap.id, uuid.uuid4()])

    assert {key: sorted(value) for key, value in days.items()} == {
        swap.id: [DAY, DAY + timedelta(days=1)]
    }
