"""Correcting drafts and moving editable schedules through their lifecycle."""

import uuid

from oncall.domain.overrides.models import UNSTAFFED
from oncall.domain.ports import TeamDirectory
from oncall.domain.roster import Slot
from oncall.domain.scheduling import errors
from oncall.domain.scheduling.models import (
    DraftCorrection,
    Schedule,
    Transition,
    UnavailabilityConflict,
)
from oncall.domain.scheduling.ports import DraftPorts
from oncall.domain.team import Member
from oncall.domain.vocabulary import ONCALL_ROLES, AssignmentRole, ScheduleStatus
from oncall.workdays import is_working_day, polish_holidays


async def unavailability_conflicts(
    schedule: Schedule, team: TeamDirectory
) -> tuple[UnavailabilityConflict, ...]:
    member_ids = {item.member_id for item in schedule.assignments if item.member_id is not None}
    if not member_ids:
        return ()
    members = await team.members(member_ids)
    conflicts = [
        UnavailabilityConflict(item.service_date, item.role, item.assignee_name)
        for item in schedule.assignments
        if item.member_id is not None
        and (member := members.get(item.member_id)) is not None
        and member.is_unavailable(item.service_date)
    ]
    conflicts.sort(key=lambda item: (item.service_date, item.role.value))
    return tuple(conflicts)


async def correct_draft(correction: DraftCorrection, ports: DraftPorts) -> None:
    """Give roles of one draft day to other eligible and available members in
    one version: one person taking one or more roles, or two people trading
    places. The day is judged as it stands once every role is handed over."""
    schedule = await ports.schedules.schedule_to_correct(correction.schedule_id)
    if schedule is None or schedule.status != ScheduleStatus.draft:
        raise errors.EditableDraftNotFound()
    if schedule.version != correction.expected_version:
        raise errors.DraftChanged()
    day = correction.service_date
    if not schedule.starts_on <= day <= schedule.ends_on:
        raise errors.DateOutsideDraft()
    holders: list[tuple[Slot, Member]] = []
    corrected = schedule
    for role, member_id in correction.holders:
        if role == AssignmentRole.late_shift and not is_working_day(day, polish_holidays(day, day)):
            raise errors.LateShiftOnlyOnWorkingDays()
        replacement = await ports.team.member(member_id)
        if replacement is None:
            raise errors.ReplacementNotFound()
        if not replacement.is_eligible(role, day):
            raise errors.ReplacementNotEligible()
        if replacement.is_unavailable(day):
            raise errors.ReplacementUnavailable()
        # A role the solver left empty is filled the same way as a held one.
        holders.append(((day, role), replacement))
        corrected = corrected.with_holder((day, role), replacement.display_name, replacement.id)
    on_call = [
        item.member_id
        for item in corrected.assignments
        if item.service_date == day and item.role in ONCALL_ROLES
    ]
    if len(on_call) == 2 and on_call[0] is not None and on_call[0] == on_call[1]:
        raise errors.SecondOnCallSameDay()
    previous = {item.slot: item.assignee_name for item in schedule.assignments}
    await ports.schedules.correct(schedule.id, holders)
    await ports.journal.draft_corrected(
        schedule.id,
        [(slot, previous.get(slot, UNSTAFFED), member.display_name) for slot, member in holders],
    )


async def delete_schedule(schedule_id: uuid.UUID, ports: DraftPorts) -> None:
    schedule = await ports.schedules.schedule(schedule_id)
    if schedule is None:
        raise errors.ScheduleNotFound()
    imported_history = schedule.is_imported_history
    if (
        schedule.status not in (ScheduleStatus.draft, ScheduleStatus.proposed)
        and not imported_history
    ):
        raise errors.ScheduleNotDeletable()
    if imported_history:
        kind = "zaimportowaną historię"
    elif schedule.status == ScheduleStatus.proposed:
        kind = "propozycję"
    else:
        kind = "szkic"
    await ports.journal.schedule_deleted(schedule, kind)
    await ports.schedules.delete(schedule.id)


async def propose(transition: Transition, ports: DraftPorts) -> None:
    schedule = await ports.schedules.schedule(transition.schedule_id)
    if schedule is None:
        raise errors.ScheduleNotFound()
    conflicts = await unavailability_conflicts(schedule, ports.team)
    if conflicts:
        raise errors.ProposalHasUnavailablePeople(conflicts)
    if not await ports.schedules.change_status(
        schedule.id,
        from_status=ScheduleStatus.draft,
        to_status=ScheduleStatus.proposed,
        expected_version=transition.expected_version,
    ):
        raise errors.DraftStateChanged()
    await ports.journal.schedule_proposed(schedule.id)


async def withdraw(transition: Transition, ports: DraftPorts) -> None:
    if not await ports.schedules.change_status(
        transition.schedule_id,
        from_status=ScheduleStatus.proposed,
        to_status=ScheduleStatus.draft,
        expected_version=transition.expected_version,
    ):
        raise errors.ProposalStateChanged()
    await ports.journal.proposal_withdrawn(transition.schedule_id)
