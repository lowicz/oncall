from datetime import timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.domain.clock import business_today
from oncall.domain.vocabulary import (
    AssignmentRole,
    AvailabilityKind,
    ScheduleStatus,
    SwapStatus,
    UserRole,
)
from oncall.infrastructure.sqlalchemy.access_models import User
from oncall.infrastructure.sqlalchemy.audit_model import AuditEvent
from oncall.infrastructure.sqlalchemy.availability_model import Availability
from oncall.infrastructure.sqlalchemy.notification_models import NotificationOutbox
from oncall.infrastructure.sqlalchemy.scheduling import publication_ports, schedule_query_ports
from oncall.infrastructure.sqlalchemy.scheduling_models import Assignment, Schedule
from oncall.infrastructure.sqlalchemy.swap_models import SwapRequest, SwapRequestSlot
from oncall.presentation.scheduling import ScheduleTransitionRequest
from oncall.routes.scheduling import publication_preview, publish_schedule
from oncall.workdays import is_working_day, polish_holidays
from tests.conftest import create_member, create_published_schedule


@pytest.mark.anyio
async def test_publish_requires_acknowledgement_and_cancels_pending_swap(
    db: AsyncSession,
) -> None:
    start = business_today() + timedelta(days=(7 - business_today().weekday()) % 7 or 7)
    members = {}
    for username, name in (
        ("anna", "Anna Kowalska"),
        ("marek", "Marek Nowak"),
        ("ola", "Ola Wiśniewska"),
    ):
        user = User(
            username=username,
            display_name=name,
            password_hash="unused-in-this-test",
            role=UserRole.member,
            email=f"{username}@example.com",
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        members[name] = await create_member(db, user, display_name=name)
    coordinator = User(
        username="koord",
        display_name="Koordynator",
        password_hash="unused-in-this-test",
        role=UserRole.coordinator,
    )
    db.add(coordinator)
    await db.commit()
    old = await create_published_schedule(
        db,
        starts_on=start,
        days=7,
        primary=["Anna Kowalska"],
        secondary=["Marek Nowak"],
        late_shift=["Ola Wiśniewska"],
        name="Stary grafik",
    )
    proposed_schedule = Schedule(
        name="Szkic zastępczy",
        starts_on=start,
        ends_on=start + timedelta(days=6),
        status=ScheduleStatus.proposed,
        solver_status="OPTIMAL",
    )
    holidays = polish_holidays(proposed_schedule.starts_on, proposed_schedule.ends_on)
    names = list(members)
    for offset in range(7):
        service_date = start + timedelta(days=offset)
        primary_name = names[0] if offset < 4 else names[(offset + 1) % 3]
        secondary_name = next(name for name in names if name != primary_name)
        for role, name in (
            (AssignmentRole.primary, primary_name),
            (AssignmentRole.secondary, secondary_name),
        ):
            proposed_schedule.assignments.append(
                Assignment(
                    service_date=service_date,
                    role=role,
                    assignee_name=name,
                    member_id=members[name].id,
                )
            )
        if is_working_day(service_date, holidays):
            name = secondary_name
            proposed_schedule.assignments.append(
                Assignment(
                    service_date=service_date,
                    role=AssignmentRole.late_shift,
                    assignee_name=name,
                    member_id=members[name].id,
                )
            )
    db.add(proposed_schedule)
    await db.commit()
    proposed = {"version": proposed_schedule.version}

    new_primary = next(
        item
        for item in proposed_schedule.assignments
        if item.service_date == start and item.role == AssignmentRole.primary
    )
    previous_name = next(name for name in members if name != new_primary.assignee_name)
    old_assignment = await db.scalar(
        select(Assignment).where(
            Assignment.schedule_id == old.id,
            Assignment.service_date == start,
            Assignment.role == AssignmentRole.primary,
        )
    )
    assert old_assignment is not None
    old_assignment.assignee_name = previous_name
    old_assignment.member_id = members[previous_name].id
    old_assignment.is_override = True
    replacement_name = next(name for name in members if name != previous_name)
    swap = SwapRequest(
        schedule_id=old.id,
        service_date=start,
        role=AssignmentRole.primary,
        requester_member_id=members[previous_name].id,
        replacement_member_id=members[replacement_name].id,
        status=SwapStatus.pending_coordinator,
        schedule_version=old.version,
        slots=[SwapRequestSlot(service_date=start, role=AssignmentRole.primary)],
    )
    db.add(swap)
    carried_swap = SwapRequest(
        schedule_id=old.id,
        service_date=start,
        role=AssignmentRole.secondary,
        requester_member_id=members["Marek Nowak"].id,
        replacement_member_id=members["Ola Wiśniewska"].id,
        status=SwapStatus.approved,
        schedule_version=old.version,
        slots=[
            SwapRequestSlot(service_date=start, role=AssignmentRole.secondary),
            SwapRequestSlot(service_date=start, role=AssignmentRole.late_shift),
        ],
    )
    for role in (AssignmentRole.secondary, AssignmentRole.late_shift):
        carried_assignment = await db.scalar(
            select(Assignment).where(
                Assignment.schedule_id == old.id,
                Assignment.service_date == start,
                Assignment.role == role,
            )
        )
        assert carried_assignment is not None
        carried_assignment.assignee_name = "Ola Wiśniewska"
        carried_assignment.member_id = members["Ola Wiśniewska"].id
        carried_assignment.is_override = True
    db.add(carried_swap)
    # A real availability row inside the draft's own horizon, not just a bare
    # audit row: `stale_changes_count` now checks what an event actually
    # changed, not only that some matching action fired (QA7 par. 8, B2
    # review), so the fixture has to be something that really is stale.
    # `prefer_not`, not `unavailable`: a hard conflict would trip an earlier
    # gate (UNAVAILABLE) than the one this test means to exercise.
    new_availability = Availability(
        member_id=members["Anna Kowalska"].id,
        kind=AvailabilityKind.prefer_not,
        starts_on=start,
        ends_on=start,
    )
    db.add(new_availability)
    await db.flush()
    db.add(
        AuditEvent(
            actor_label="Anna Kowalska",
            action="availability.created",
            entity_type="availability",
            entity_id=str(new_availability.id),
            summary="Zmieniono dostępność po wygenerowaniu szkicu",
        )
    )
    await db.commit()

    preview = await publication_preview(proposed_schedule.id, coordinator, publication_ports(db))
    assert [item.model_dump(mode="json") for item in preview.lost_changes] == [
        {
            "service_date": start.isoformat(),
            "role": "primary",
            "previous_assignee_name": previous_name,
            "new_assignee_name": new_primary.assignee_name,
            "source": "override",
            "original_assignee_name": None,
            "reason": "Nie można ustalić pierwotnego wykonawcy zmiany",
        }
    ]
    assert [item.id for item in preview.pending_swaps] == [swap.id]
    assert {(item.service_date, item.role) for item in preview.carried_changes} == {
        (start, AssignmentRole.secondary),
        (start, AssignmentRole.late_shift),
    }
    assert preview.uncovered_before
    assert preview.stale_changes_count == 1
    assert {item.rule for item in preview.rest_violations} >= {
        "max_consecutive",
        "three_in_seven",
    }

    with pytest.raises(HTTPException) as blocked:
        await publish_schedule(
            proposed_schedule.id,
            ScheduleTransitionRequest(expected_version=proposed["version"]),
            coordinator,
            publication_ports(db, coordinator),
            schedule_query_ports(db),
            None,
        )
    assert blocked.value.status_code == 409
    assert blocked.value.detail["reason"] == "LOST_CHANGES"

    with pytest.raises(HTTPException) as gap_blocked:
        await publish_schedule(
            proposed_schedule.id,
            ScheduleTransitionRequest(
                expected_version=proposed["version"],
                acknowledge_lost_changes=True,
                change_resolutions={f"{start.isoformat()}:primary": "draft"},
            ),
            coordinator,
            publication_ports(db, coordinator),
            schedule_query_ports(db),
            None,
        )
    assert gap_blocked.value.detail["reason"] == "UNCOVERED_BEFORE"

    with pytest.raises(HTTPException) as rest_blocked:
        await publish_schedule(
            proposed_schedule.id,
            ScheduleTransitionRequest(
                expected_version=proposed["version"],
                acknowledge_lost_changes=True,
                acknowledge_gap=True,
                change_resolutions={f"{start.isoformat()}:primary": "draft"},
            ),
            coordinator,
            publication_ports(db, coordinator),
            schedule_query_ports(db),
            None,
        )
    assert rest_blocked.value.detail["reason"] == "REST_VIOLATIONS"

    published = await publish_schedule(
        proposed_schedule.id,
        ScheduleTransitionRequest(
            expected_version=proposed["version"],
            acknowledge_lost_changes=True,
            acknowledge_gap=True,
            acknowledge_rest_violations=True,
            change_resolutions={f"{start.isoformat()}:primary": "draft"},
        ),
        coordinator,
        publication_ports(db, coordinator),
        schedule_query_ports(db),
        None,
    )
    assert published.status == ScheduleStatus.published.value
    await db.refresh(swap)
    assert swap.status == SwapStatus.cancelled
    assert swap.decision_note == "Grafik zastąpiony nową publikacją"
    old_status = await db.scalar(select(Schedule.status).where(Schedule.id == old.id))
    assert old_status == ScheduleStatus.superseded
    published_assignments = {
        (item.service_date, item.role): item
        for item in await db.scalars(
            select(Assignment).where(Assignment.schedule_id == proposed_schedule.id)
        )
    }
    for role in (AssignmentRole.secondary, AssignmentRole.late_shift):
        assert published_assignments[(start, role)].assignee_name == "Ola Wiśniewska"
        assert published_assignments[(start, role)].is_override is True

    carried_audits = await db.scalar(
        select(AuditEvent).where(AuditEvent.action == "schedule.override_carried").limit(1)
    )
    assert carried_audits is not None

    events = list(await db.scalars(select(NotificationOutbox.context)))
    event_names = [item["event"] for item in events if item]
    assert event_names.count("swap_cancelled_by_publication") == 2
    assignment_change_events = [
        item for item in events if item and item["event"] == "assignment_changed_by_publication"
    ]
    assert len(assignment_change_events) == len(
        {item["member"] for item in assignment_change_events}
    )
    assert len(assignment_change_events) >= 2
    carried_notifications = [
        item
        for item in events
        if item
        and item["event"] == "assignment_changed_by_publication"
        and any(
            change["service_date"] == start.isoformat()
            and change["role"] in ("secondary", "late_shift")
            for change in item["changes"]
        )
    ]
    assert carried_notifications == []
    published_mails = {
        row.recipient: row.body
        for row in await db.scalars(select(NotificationOutbox))
        if row.context and row.context["event"] == "schedule_published"
    }
    # Each mail lists the slots as published: the carried SECONDARY is Ola's.
    assert f"- {start} · SECONDARY" in published_mails["ola@example.com"]
    assert f"- {start} · SECONDARY" not in published_mails["marek@example.com"]
