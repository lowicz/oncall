"""Correcting drafts and moving editable schedules through their lifecycle."""

import uuid

from oncall.domain.ports import TeamDirectory
from oncall.domain.scheduling import errors
from oncall.domain.scheduling.models import (
    DraftCorrection,
    Schedule,
    Transition,
    UnavailabilityConflict,
)
from oncall.domain.scheduling.planning import member_rest_warnings
from oncall.domain.scheduling.ports import DraftPorts
from oncall.domain.vocabulary import AssignmentRole, ScheduleStatus
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


async def correct_draft(correction: DraftCorrection, ports: DraftPorts) -> list[str]:
    """Give one draft slot to another eligible and available member."""
    schedule = await ports.schedules.schedule_to_correct(correction.schedule_id)
    if schedule is None or schedule.status != ScheduleStatus.draft:
        raise errors.EditableDraftNotFound()
    if schedule.version != correction.expected_version:
        raise errors.DraftChanged()
    day, role = correction.service_date, correction.role
    if not schedule.starts_on <= day <= schedule.ends_on:
        raise errors.DateOutsideDraft()
    if role == AssignmentRole.late_shift and not is_working_day(day, polish_holidays(day, day)):
        raise errors.LateShiftOnlyOnWorkingDays()
    replacement = await ports.team.member(correction.replacement_member_id)
    if replacement is None:
        raise errors.ReplacementNotFound()
    if not replacement.is_eligible(role, day):
        raise errors.ReplacementNotEligible()
    if replacement.is_unavailable(day):
        raise errors.ReplacementUnavailable()
    assignment = next((item for item in schedule.assignments if item.slot == (day, role)), None)
    if assignment is None:
        raise errors.DraftSlotNotFound()
    if role in (AssignmentRole.primary, AssignmentRole.secondary):
        opposite = (
            AssignmentRole.secondary if role == AssignmentRole.primary else AssignmentRole.primary
        )
        if any(
            item.slot == (day, opposite) and item.member_id == replacement.id
            for item in schedule.assignments
        ):
            raise errors.SecondOnCallSameDay()
    corrected = schedule.with_holder((day, role), replacement.display_name, replacement.id)
    warnings = member_rest_warnings(corrected, replacement.id)
    await ports.schedules.correct(schedule.id, (day, role), replacement)
    await ports.journal.draft_corrected(
        schedule.id, (day, role), assignment.assignee_name, replacement.display_name
    )
    return warnings


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
