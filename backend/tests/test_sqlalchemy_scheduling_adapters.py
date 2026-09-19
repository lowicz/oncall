"""The scheduling adapters on their own."""

from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select

from oncall.domain.scheduling.ports import NewDraft
from oncall.domain.scheduling.solver import GeneratedAssignment, SolverResult
from oncall.infrastructure.sqlalchemy.scheduling_changes import SqlAlchemyChangeLog
from oncall.infrastructure.sqlalchemy.scheduling_generation import SqlAlchemyGenerationQueue
from oncall.infrastructure.sqlalchemy.scheduling_plans import SqlAlchemyPlans
from oncall.infrastructure.sqlalchemy.scheduling_publication import SqlAlchemyPublicationSwaps
from oncall.models import (
    AssignmentRole,
    AuditEvent,
    RotationMode,
    Schedule,
    ScheduleStatus,
    SwapRequest,
    SwapStatus,
    UserRole,
)
from tests.conftest import create_member, create_published_schedule, create_user

DAY = date.today() + timedelta(days=30)


async def test_a_plan_read_again_shows_a_status_written_by_statement(db) -> None:
    schedule = await create_published_schedule(db, starts_on=DAY, days=1, primary=["Anna"])
    plans = SqlAlchemyPlans(db)
    assert (await plans.plan(schedule.id)).version == 1

    moved = await plans.change_status(
        schedule.id,
        from_status=ScheduleStatus.published,
        to_status=ScheduleStatus.superseded,
        expected_version=1,
    )
    stale = await plans.change_status(
        schedule.id,
        from_status=ScheduleStatus.published,
        to_status=ScheduleStatus.superseded,
        expected_version=1,
    )
    await db.commit()

    reread = await plans.plan(schedule.id)
    assert (moved, stale) == (True, False)
    assert (reread.status, reread.version) == (ScheduleStatus.superseded, 2)


async def test_a_stored_draft_has_no_id_until_its_unit_of_work_is_written(db) -> None:
    user = await create_user(db, "anna", display_name="Anna")
    anna = await create_member(db, user, display_name="Anna")
    plans = SqlAlchemyPlans(db)

    stored = await plans.store_draft(
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

    plan = await plans.plan(stored.id)
    assert (plan.status, plan.solver_warnings) == (ScheduleStatus.draft, ("uwaga",))
    assert [(item.assignee_name, item.member_id) for item in plan.assignments] == [
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


async def test_schedule_changes_are_read_oldest_first_for_the_asked_actions(db) -> None:
    schedule = await create_published_schedule(db, starts_on=DAY, days=1, primary=["Anna"])
    now = datetime.now(UTC)
    for action, minutes in (
        ("schedule.override", 2),
        ("schedule.override_carried", 1),
        ("schedule.draft_override", 0),
    ):
        db.add(
            AuditEvent(
                actor_label="Koordynator",
                action=action,
                entity_type="schedule",
                entity_id=str(schedule.id),
                summary=action,
                occurred_at=now - timedelta(minutes=minutes),
            )
        )
    await db.commit()

    records = await SqlAlchemyChangeLog(db).schedule_changes(
        {schedule.id}, ("schedule.override", "schedule.draft_override")
    )

    assert [item.action for item in records] == ["schedule.override", "schedule.draft_override"]
    assert {item.entity_id for item in records} == {str(schedule.id)}
    assert await db.scalar(select(Schedule.status).where(Schedule.id == schedule.id)) == (
        ScheduleStatus.published
    )
