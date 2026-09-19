"""`stale_changes_count` scoping (QA7 par. 8, B2 review).

A plain count of matching audit *actions* fired anywhere used to raise the
draft's "Szkic nieaktualny" number for changes with no bearing on it at all -
an availability entry a year outside the window counted exactly like one the
solver actually read. Each action group is now checked against what it
touched: dates against the schedule's own history-plus-horizon window, team
membership against the schedule's own roster.
"""

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from oncall.domain.scheduling.publication import stale_changes_count
from oncall.infrastructure.sqlalchemy.scheduling_changes import SqlAlchemyChangeLog
from oncall.models import (
    Assignment,
    AssignmentRole,
    AuditEvent,
    Availability,
    AvailabilityKind,
    Schedule,
    ScheduleStatus,
    User,
    UserRole,
)
from tests.conftest import create_member

START = date.today() + timedelta(days=7)


async def _draft(db: AsyncSession) -> Schedule:
    schedule = Schedule(
        name="Szkic",
        starts_on=START,
        ends_on=START + timedelta(days=6),
        status=ScheduleStatus.draft,
        created_at=datetime.now(UTC) - timedelta(minutes=5),
    )
    db.add(schedule)
    await db.commit()
    await db.refresh(schedule)
    return schedule


async def _member(db: AsyncSession, name: str) -> str:
    user = User(
        username=name.lower().replace(" ", "."),
        display_name=name,
        password_hash="unused-in-this-test",
        role=UserRole.member,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    member = await create_member(db, user, display_name=name)
    return member.id


@pytest.mark.anyio
async def test_an_availability_change_far_outside_the_window_does_not_count(
    db: AsyncSession,
) -> None:
    schedule = await _draft(db)
    member_id = await _member(db, "Anna Kowalska")
    far_future = schedule.ends_on + timedelta(days=365)
    entry = Availability(
        member_id=member_id,
        kind=AvailabilityKind.unavailable,
        starts_on=far_future,
        ends_on=far_future,
    )
    db.add(entry)
    await db.flush()
    db.add(
        AuditEvent(
            actor_label="Anna Kowalska",
            action="availability.created",
            entity_type="availability",
            entity_id=str(entry.id),
            summary="Zmieniono dostępność daleko poza oknem",
        )
    )
    await db.commit()

    assert await stale_changes_count(schedule, SqlAlchemyChangeLog(db)) == 0


@pytest.mark.anyio
async def test_an_availability_change_inside_the_window_counts(db: AsyncSession) -> None:
    schedule = await _draft(db)
    member_id = await _member(db, "Anna Kowalska")
    entry = Availability(
        member_id=member_id,
        kind=AvailabilityKind.unavailable,
        starts_on=schedule.starts_on,
        ends_on=schedule.starts_on,
    )
    db.add(entry)
    await db.flush()
    db.add(
        AuditEvent(
            actor_label="Anna Kowalska",
            action="availability.created",
            entity_type="availability",
            entity_id=str(entry.id),
            summary="Zmieniono dostępność w oknie szkicu",
        )
    )
    await db.commit()

    assert await stale_changes_count(schedule, SqlAlchemyChangeLog(db)) == 1


@pytest.mark.anyio
async def test_a_deleted_availability_entry_counts_unconditionally(db: AsyncSession) -> None:
    """The row is gone, so its own dates cannot be checked any more; erring
    towards counting it is the safe direction (QA7 par. 8, B2 review)."""
    schedule = await _draft(db)
    db.add(
        AuditEvent(
            actor_label="Anna Kowalska",
            action="availability.deleted",
            entity_type="availability",
            entity_id="00000000-0000-0000-0000-000000000000",
            summary="Usunięto wpis dostępności",
        )
    )
    await db.commit()

    assert await stale_changes_count(schedule, SqlAlchemyChangeLog(db)) == 1


@pytest.mark.anyio
async def test_a_membership_change_only_counts_for_someone_on_this_schedule(
    db: AsyncSession,
) -> None:
    schedule = await _draft(db)
    on_roster = await _member(db, "Anna Kowalska")
    off_roster = await _member(db, "Marek Nowak")
    db.add(
        Assignment(
            schedule_id=schedule.id,
            service_date=schedule.starts_on,
            role=AssignmentRole.primary,
            assignee_name="Anna Kowalska",
            member_id=on_roster,
        )
    )
    await db.commit()
    schedule = await db.scalar(
        select(Schedule)
        .options(selectinload(Schedule.assignments))
        .where(Schedule.id == schedule.id)
    )
    db.add_all(
        [
            AuditEvent(
                actor_label="Admin",
                action="admin.team_member_updated",
                entity_type="team_member",
                entity_id=str(on_roster),
                summary="Zaktualizowano okres rotacji: Anna Kowalska",
            ),
            AuditEvent(
                actor_label="Admin",
                action="admin.team_member_updated",
                entity_type="team_member",
                entity_id=str(off_roster),
                summary="Zaktualizowano okres rotacji: Marek Nowak",
            ),
        ]
    )
    await db.commit()

    assert await stale_changes_count(schedule, SqlAlchemyChangeLog(db)) == 1


@pytest.mark.anyio
async def test_a_batch_override_slot_inside_the_window_counts(db: AsyncSession) -> None:
    schedule = await _draft(db)
    far_future = (schedule.ends_on + timedelta(days=365)).isoformat()
    db.add(
        AuditEvent(
            actor_label="Koordynator",
            action="schedule.override_batch",
            entity_type="schedule",
            entity_id=str(schedule.id),
            summary="Przepisano wsadowo 2 dyżury",
            details={
                "reason": "offboarding",
                "slots": [f"{schedule.starts_on.isoformat()}:primary", f"{far_future}:primary"],
            },
        )
    )
    await db.commit()

    assert await stale_changes_count(schedule, SqlAlchemyChangeLog(db)) == 1
