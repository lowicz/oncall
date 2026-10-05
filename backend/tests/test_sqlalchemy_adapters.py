"""The SQLAlchemy adapters on their own: what they read, what they stage, and
that they leave the commit to the caller."""

import uuid
from dataclasses import replace
from datetime import date, timedelta

import pytest
from sqlalchemy import func, select

from oncall.domain.access import errors as AccessErrors
from oncall.domain.availability.models import NewAvailabilityEntry
from oncall.domain.overrides.models import OverrideMove
from oncall.domain.swaps.models import AcknowledgedViolation, NewSwapRequest, SwapReturn
from oncall.domain.vocabulary import (
    AssignmentRole,
    AvailabilityKind,
    LateShiftAnchor,
    ScheduleStatus,
    SwapSlotDirection,
    SwapStatus,
    UserRole,
)
from oncall.infrastructure.sqlalchemy.access import SqlAlchemyAccessAccounts
from oncall.infrastructure.sqlalchemy.audit_model import AuditEvent
from oncall.infrastructure.sqlalchemy.availability import SqlAlchemyAvailability
from oncall.infrastructure.sqlalchemy.availability_model import Availability
from oncall.infrastructure.sqlalchemy.overrides import SqlAlchemyOverrideJournal
from oncall.infrastructure.sqlalchemy.roster import (
    SqlAlchemyPublishedRoster,
    SqlAlchemyRosterPolicy,
)
from oncall.infrastructure.sqlalchemy.scheduling_models import Assignment, Schedule
from oncall.infrastructure.sqlalchemy.swap_models import SwapRequest, SwapRequestSlot
from oncall.infrastructure.sqlalchemy.swaps import SqlAlchemySwapJournal, SqlAlchemySwapRequests
from oncall.infrastructure.sqlalchemy.team import SqlAlchemyTeamDirectory
from oncall.rules import RuleViolation
from tests.conftest import create_member, create_published_schedule, create_user

DAY = date.today() + timedelta(days=14)


@pytest.fixture
async def people(db) -> dict:
    anna_user = await create_user(db, "anna", display_name="Anna")
    bartek_user = await create_user(db, "bartek", display_name="Bartek")
    coordinator = await create_user(db, "koord", role=UserRole.coordinator)
    anna = await create_member(db, anna_user, display_name="Anna")
    bartek = await create_member(db, bartek_user, display_name="Bartek")
    db.add(
        Availability(
            member_id=anna.id,
            kind=AvailabilityKind.unavailable,
            starts_on=DAY,
            ends_on=DAY,
        )
    )
    await db.commit()
    schedule = await create_published_schedule(
        db, starts_on=DAY, days=3, primary=["Anna", "Bartek"], secondary=["Bartek", "Anna"]
    )
    return {
        "anna": anna,
        "bartek": bartek,
        "anna_user": anna_user,
        "coordinator": coordinator,
        "schedule": schedule,
    }


async def _count(db, model, *criteria) -> int:
    return await db.scalar(select(func.count()).select_from(model).where(*criteria))


async def test_team_directory_maps_members_with_their_periods(db, people) -> None:
    team = SqlAlchemyTeamDirectory(db)

    anna = await team.member_for_account(people["anna_user"].id)
    assert anna is not None and anna.id == people["anna"].id
    assert anna.is_eligible(AssignmentRole.late_shift, DAY)
    assert anna.is_unavailable(DAY) and not anna.is_unavailable(DAY + timedelta(days=1))
    assert [item.display_name for item in await team.colleagues_of(anna.id)] == ["Bartek"]
    assert await team.display_names([anna.id]) == {anna.id: "Anna"}
    assert (await team.member_named("Bartek")).id == people["bartek"].id
    assert await team.member(uuid.uuid4()) is None


async def test_approver_lookup_ignores_the_asking_account(db, people) -> None:
    team = SqlAlchemyTeamDirectory(db)
    assert await team.another_active_approver_exists(people["anna_user"].id) is True
    assert await team.another_active_approver_exists(people["coordinator"].id) is False


async def test_roster_reads_the_duties_in_force_and_one_schedule(db, people) -> None:
    roster = SqlAlchemyPublishedRoster(db)
    schedule = people["schedule"]

    duties = await roster.duties_in_force(DAY, DAY)
    assert duties[(DAY, AssignmentRole.primary)].assignee_name == "Anna"
    assert (await roster.latest_publication_covering(DAY)).id == schedule.id
    assert await roster.latest_publication_covering(DAY + timedelta(days=30)) is None
    duty = await roster.duty(schedule.id, (DAY, AssignmentRole.secondary))
    assert (duty.assignee_name, duty.schedule_id) == ("Bartek", schedule.id)
    assert await roster.duty_for_handover(schedule.id, (DAY, AssignmentRole.primary)) == (
        await roster.duty(schedule.id, (DAY, AssignmentRole.primary))
    )


async def test_version_advances_only_from_the_expected_state(db, people) -> None:
    roster = SqlAlchemyPublishedRoster(db)
    schedule_id = people["schedule"].id

    assert await roster.advance_version(schedule_id, expected_version=1, only_if_published=True)
    assert not await roster.advance_version(schedule_id, expected_version=1, only_if_published=True)
    await db.commit()
    assert await db.scalar(select(Schedule.version).where(Schedule.id == schedule_id)) == 2

    people["schedule"].status = ScheduleStatus.superseded
    await db.commit()
    assert not await roster.advance_version(
        schedule_id, expected_version=None, only_if_published=True
    )
    assert await roster.advance_version(schedule_id, expected_version=2, only_if_published=False)


async def test_hand_over_updates_existing_slots_and_creates_missing_ones(db, people) -> None:
    roster = SqlAlchemyPublishedRoster(db)
    team = SqlAlchemyTeamDirectory(db)
    bartek = await team.member(people["bartek"].id)
    schedule_id = people["schedule"].id
    missing_day = DAY + timedelta(days=20)

    await roster.hand_over(
        schedule_id, [(DAY, AssignmentRole.primary), (missing_day, AssignmentRole.primary)], bartek
    )
    await db.commit()

    rows = (
        await db.execute(
            select(Assignment.service_date, Assignment.member_id, Assignment.is_override).where(
                Assignment.schedule_id == schedule_id,
                Assignment.role == AssignmentRole.primary,
                Assignment.service_date.in_((DAY, missing_day)),
            )
        )
    ).all()
    assert sorted(rows) == [(DAY, bartek.id, True), (missing_day, bartek.id, True)]


async def test_policy_reads_the_late_shift_anchor(db) -> None:
    assert await SqlAlchemyRosterPolicy(db).late_shift_anchor() == LateShiftAnchor.secondary


def _new_request(people, **changes) -> NewSwapRequest:
    values = {
        "schedule_id": people["schedule"].id,
        "service_date": DAY,
        "role": AssignmentRole.secondary,
        "requester_member_id": people["bartek"].id,
        "replacement_member_id": people["anna"].id,
        "schedule_version": 1,
        "note": "proszę",
        "slots": ((DAY, AssignmentRole.secondary), (DAY, AssignmentRole.late_shift)),
    }
    return NewSwapRequest(**(values | changes))


async def test_swap_store_round_trip_without_committing(db, people) -> None:
    store = SqlAlchemySwapRequests(db)

    stored = await store.add(_new_request(people))
    assert stored.status == SwapStatus.pending_replacement
    assert stored.created_at is not None
    assert await store.has_active_request_for((DAY, AssignmentRole.late_shift))
    assert not await store.has_active_request_for((DAY, AssignmentRole.primary))

    taken = await store.take_for_decision(stored.id)
    assert set(taken.slots) == set(stored.slots)
    await store.record_decision(replace(taken, status=SwapStatus.cancelled, decision_note="nie"))
    listed = await store.requests(
        involving=people["anna"].id, statuses=(SwapStatus.cancelled,), limit=10, offset=0
    )
    assert [item.id for item in listed] == [stored.id]

    await db.rollback()
    assert await _count(db, SwapRequest) == 0


async def test_swap_store_keeps_each_direction_of_an_exchange_with_its_schedule(db, people) -> None:
    """The duty taken in return lies in another publication: every slot row
    says which way it travels and which schedule holds it, and the request
    reads back the same whichever way it is loaded."""
    later = await create_published_schedule(
        db, starts_on=DAY + timedelta(days=3), days=1, primary=["Anna"], secondary=["Bartek"]
    )
    back = DAY + timedelta(days=3)
    in_return = SwapReturn(
        later.id, ((back, AssignmentRole.late_shift), (back, AssignmentRole.primary))
    )
    store = SqlAlchemySwapRequests(db)

    stored = await store.add(_new_request(people, in_return=in_return))

    # The on-call role names each duty; its 11-19 follows.
    assert stored.slots == ((DAY, AssignmentRole.secondary), (DAY, AssignmentRole.late_shift))
    assert stored.in_return == SwapReturn(
        later.id, ((back, AssignmentRole.primary), (back, AssignmentRole.late_shift))
    )
    rows = (await db.scalars(select(SwapRequestSlot))).all()
    assert {(row.service_date, row.direction, row.schedule_id) for row in rows} == {
        (DAY, SwapSlotDirection.given, people["schedule"].id),
        (back, SwapSlotDirection.returned, later.id),
    }
    assert await store.has_active_request_for((back, AssignmentRole.primary))
    assert (await store.take_for_decision(stored.id)).in_return == stored.in_return
    (listed,) = await store.requests(involving=None, statuses=(), limit=10, offset=0)
    assert (listed.slots, listed.in_return) == (stored.slots, stored.in_return)

    await db.rollback()


async def test_swap_store_keeps_the_acknowledged_violations_by_side(db, people) -> None:
    """The record names each person by their side of the request, never by
    name, and an ordinary swap keeps none at all."""
    store = SqlAlchemySwapRequests(db)
    broken = (
        AcknowledgedViolation("three_in_seven", "replacement", (DAY, DAY + timedelta(days=1))),
    )

    stored = await store.add(_new_request(people, rule_violations=broken))
    assert stored.rule_violations == broken
    row = await db.get(SwapRequest, stored.id)
    assert row.rule_violations == [
        {
            "rule": "three_in_seven",
            "party": "replacement",
            "days": [DAY.isoformat(), (DAY + timedelta(days=1)).isoformat()],
        }
    ]
    assert (await store.take_for_decision(stored.id)).rule_violations == broken

    # The next step's acknowledgement replaces the list; an empty one is null.
    later = (AcknowledgedViolation("rest_after_run", "requester", (DAY,)),)
    await store.record_decision(replace(stored, rule_violations=later))
    (listed,) = await store.requests(involving=None, statuses=(), limit=10, offset=0)
    assert listed.rule_violations == later
    await store.record_decision(replace(stored, rule_violations=()))
    assert row.rule_violations is None

    await db.rollback()


async def test_swap_journal_writes_the_audit_entry_in_the_actors_name(db, people) -> None:
    store = SqlAlchemySwapRequests(db)
    stored = await store.add(_new_request(people))
    journal = SqlAlchemySwapJournal(db, people["anna_user"])

    await journal.requested(
        stored,
        requester_name="Bartek",
        replacement_name="Anna",
        warnings=[RuleViolation("day_off_block", "Anna", (DAY,))],
        violations=[],
    )
    await db.commit()

    event = await db.scalar(select(AuditEvent).where(AuditEvent.action == "swap.created"))
    assert event.actor_user_id == people["anna_user"].id
    assert event.entity_id == str(stored.id)
    assert event.summary == (f"Prośba o zamianę [{DAY} · SECONDARY, {DAY} · 11–19]: Bartek → Anna")
    assert event.details == {"warnings": ["day_off_block"]}


async def test_swap_journal_records_the_rules_acknowledged_at_each_step(db, people) -> None:
    """Request, acceptance and hand-over each name the hard rules the person
    acting there acknowledged, in the summary and in the details, the way a
    coordinator's correction does; without any the entries read as before."""
    store = SqlAlchemySwapRequests(db)
    stored = await store.add(_new_request(people))
    journal = SqlAlchemySwapJournal(db, people["anna_user"])
    names = {"requester_name": "Bartek", "replacement_name": "Anna"}
    broken = [RuleViolation("three_in_seven", "Anna", (DAY,))]
    detail = [{"rule": "three_in_seven", "member_name": "Anna", "days": [DAY.isoformat()]}]
    suffix = " · świadome naruszenie reguł: three_in_seven"

    await journal.requested(stored, **names, warnings=[], violations=broken)
    await journal.accepted(stored, **names, violations=broken)
    await journal.approved(
        stored, **names, by_coordinator=True, self_approved=False, violations=broken
    )
    await journal.accepted(stored, **names, violations=[])
    await journal.approved(
        stored, **names, by_coordinator=False, self_approved=False, violations=[]
    )
    await db.commit()

    events = (await db.scalars(select(AuditEvent).order_by(AuditEvent.occurred_at))).all()
    by_action: dict[str, list[AuditEvent]] = {}
    for event in events:
        by_action.setdefault(event.action, []).append(event)
    (created,) = by_action["swap.created"]
    assert created.summary.endswith(f"Bartek → Anna{suffix}")
    assert created.details == {"rule_violations": detail}
    breaking, ordinary = sorted(by_action["swap.accepted"], key=lambda item: item.details is None)
    assert breaking.summary.endswith(suffix)
    assert breaking.details == {"rule_violations": detail}
    assert "naruszenie" not in ordinary.summary
    assert ordinary.details is None
    breaking, ordinary = sorted(
        by_action["swap.approved"], key=lambda item: "rule_violations" not in item.details
    )
    assert breaking.summary.endswith(suffix)
    assert breaking.details == {
        "self_approved": False,
        "by_coordinator": True,
        "rule_violations": detail,
    }
    assert "naruszenie" not in ordinary.summary
    assert ordinary.details == {"self_approved": False, "by_coordinator": False}


async def test_availability_ledger_records_and_lists_entries(db, people) -> None:
    ledger = SqlAlchemyAvailability(db, people["coordinator"])
    later = DAY + timedelta(days=5)

    assert (await ledger.overlapping_entry(people["anna"].id, DAY, DAY)).kind == (
        AvailabilityKind.unavailable
    )
    assert await ledger.overlapping_entry(people["anna"].id, later, later) is None
    await ledger.record(
        NewAvailabilityEntry(
            people["anna"].id, people["coordinator"].id, AvailabilityKind.prefer, later, later, None
        )
    )
    recorded = await ledger.recorded_entry()
    await db.commit()

    entries = await ledger.entries(people["anna"].id, later, None)
    assert [item.id for item in entries] == [recorded.id]
    assert entries[0].created_by_name == people["coordinator"].display_name
    withdrawn = await ledger.entry_to_withdraw(people["anna"].id, recorded.id)
    await ledger.remove(withdrawn.id)
    await db.commit()
    assert await _count(db, Availability, Availability.id == recorded.id) == 0


async def test_availability_audit_names_the_entry_before_the_session_flushes(db, people) -> None:
    """A soft preference is audited before anything flushes the session; its
    event still names the entry, which the draft staleness count reads."""
    anna = await SqlAlchemyTeamDirectory(db).member(people["anna"].id)
    ledger = SqlAlchemyAvailability(db, people["anna_user"])
    entry = NewAvailabilityEntry(
        anna.id,
        people["anna_user"].id,
        AvailabilityKind.prefer,
        DAY + timedelta(days=9),
        DAY + timedelta(days=9),
        None,
    )
    await ledger.record(entry)
    await ledger.declared(member=anna, entry=entry, on_behalf=False, duty_conflicts=[])
    recorded = await ledger.recorded_entry()
    await db.commit()

    event = await db.scalar(select(AuditEvent).where(AuditEvent.action == "availability.created"))
    assert event.entity_id == str(recorded.id)
    assert event.summary == f"Anna: chętnie wezmę {entry.starts_on} – {entry.ends_on}"


async def test_override_journal_records_moves_and_rule_ids(db, people) -> None:
    journal = SqlAlchemyOverrideJournal(db, people["coordinator"])
    violations = [
        RuleViolation("three_in_seven", "Anna", (DAY,)),
        RuleViolation("max_consecutive", "Anna", (DAY,)),
    ]
    await journal.duty_overridden(
        schedule_id=people["schedule"].id,
        service_date=DAY,
        role=AssignmentRole.primary,
        previous_name="Bartek",
        new_name="Anna",
        reason=None,
        historical=False,
        moves=[OverrideMove(DAY, AssignmentRole.primary, "Bartek")],
        violations=violations,
    )
    await db.commit()

    event = await db.scalar(select(AuditEvent).where(AuditEvent.action == "schedule.override"))
    assert event.summary.endswith("świadome naruszenie reguł: max_consecutive, three_in_seven")
    assert event.details["moves"] == [
        {"service_date": DAY.isoformat(), "role": "primary", "previous_assignee_name": "Bartek"}
    ]


async def test_changing_the_phone_of_a_deleted_account_refuses(db) -> None:
    """An administrator can delete an account while its owner holds a session,
    so this adapter must answer a missing row rather than fail on it."""
    accounts = SqlAlchemyAccessAccounts(db)
    with pytest.raises(AccessErrors.AccountGone):
        await accounts.change_phone(uuid.uuid4(), "600100200")
