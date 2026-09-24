import uuid
from datetime import date

from oncall.domain.clock import business_today
from oncall.domain.hard_rules import batch_substitution_check, substitution_check
from oncall.domain.overrides.errors import (
    BatchCorrectionNeedsReason,
    EmptyBatch,
    HistoricalCorrectionNeedsReason,
    LateShiftOnlyOnWorkingDays,
    PersonAlreadyHoldsRole,
    PersonAlreadyOnCall,
    PersonNotEligible,
    PersonNotFound,
    PersonUnavailable,
    PublishedScheduleNotFound,
    RepeatedSlotInBatch,
    RosterChangedMeanwhile,
    RuleViolationsNotAcknowledged,
    ScheduleSlotNotFound,
)
from oncall.domain.overrides.models import (
    MIN_REASON_LENGTH,
    UNSTAFFED,
    AssignmentChange,
    BatchOverrideInput,
    DutyOverridden,
    OverrideCheck,
    OverrideInput,
    OverrideMove,
)
from oncall.domain.overrides.ports import OverridePorts
from oncall.domain.ports import PublishedRoster
from oncall.domain.roster import OPPOSITE_ONCALL, Duty, ScheduleRef, anchor_role
from oncall.domain.team import Member
from oncall.domain.vocabulary import AssignmentRole, LateShiftAnchor
from oncall.rules import RuleViolation
from oncall.workdays import is_working_day, polish_holidays


def _same_holder(assignment: Duty | None, partner: Duty | None) -> bool:
    """Whether one person holds the anchor role and 11-19 in the schedule."""
    return (
        assignment is not None
        and partner is not None
        and (
            partner.member_id == assignment.member_id
            or (partner.member_id is None and partner.assignee_name == assignment.assignee_name)
        )
    )


def _couples_late_shift(
    role: AssignmentRole,
    service_date: date,
    replacement: Member,
    anchor: LateShiftAnchor,
    holidays: set[date],
) -> bool:
    """Whether an override of `role` may carry 11-19 along (decision D1)."""
    return (
        role == anchor_role(anchor)
        and is_working_day(service_date, holidays)
        and replacement.is_eligible(AssignmentRole.late_shift, service_date)
    )


async def _schedule_for(
    roster: PublishedRoster, schedule_id: uuid.UUID | None, service_date: date
) -> ScheduleRef | None:
    if schedule_id is not None:
        return await roster.schedule(schedule_id)
    return await roster.latest_publication_covering(service_date)


async def check_override(check: OverrideCheck, ports: OverridePorts) -> list[RuleViolation]:
    """The hard rules an override would break, computed before the fact so the
    confirmation can show them and ask the coordinator to acknowledge them."""
    holidays = polish_holidays(check.service_date, check.service_date)
    if check.role == AssignmentRole.late_shift and not is_working_day(check.service_date, holidays):
        # The override itself refuses this; there is nothing to check.
        return []
    replacement = await ports.team.member(check.replacement_member_id)
    if replacement is None:
        raise PersonNotFound(check.replacement_member_id)
    in_force = await ports.roster.duties_in_force(check.service_date, check.service_date)
    current = in_force.get((check.service_date, check.role))
    from_name = current.assignee_name if current is not None else replacement.display_name
    schedule = await _schedule_for(ports.roster, check.schedule_id, check.service_date)
    anchor = await ports.policy.late_shift_anchor()
    roles_to_move = [check.role]
    # Mirrors `override_duty`'s own coupling, so the confirmation checks the
    # same move the write will make.
    if schedule is not None and _couples_late_shift(
        check.role, check.service_date, replacement, anchor, holidays
    ):
        assignment = await ports.roster.duty(schedule.id, (check.service_date, check.role))
        partner = await ports.roster.duty(
            schedule.id, (check.service_date, AssignmentRole.late_shift)
        )
        if _same_holder(assignment, partner):
            roles_to_move.append(AssignmentRole.late_shift)
    return await substitution_check(
        ports.roster,
        ports.policy,
        [(check.service_date, role) for role in roles_to_move],
        from_name,
        replacement.display_name,
    )


async def override_duty(
    override: OverrideInput, ports: OverridePorts, *, today: date | None = None
) -> DutyOverridden:
    """Put a person on one slot of the published roster."""
    today = today or business_today()
    if override.service_date < today and len((override.reason or "").strip()) < MIN_REASON_LENGTH:
        raise HistoricalCorrectionNeedsReason(override.service_date)
    holidays = polish_holidays(override.service_date, override.service_date)
    if override.role == AssignmentRole.late_shift and not is_working_day(
        override.service_date, holidays
    ):
        raise LateShiftOnlyOnWorkingDays(override.service_date)
    schedule = await _schedule_for(ports.roster, override.schedule_id, override.service_date)
    if schedule is None or not schedule.published:
        raise PublishedScheduleNotFound(override.schedule_id)
    replacement = await ports.team.member(override.replacement_member_id)
    if replacement is None or not replacement.is_eligible(override.role, override.service_date):
        raise PersonNotEligible(
            override.replacement_member_id, override.role, override.service_date
        )
    if replacement.is_unavailable(override.service_date):
        raise PersonUnavailable(replacement.id, override.service_date)
    slot = (override.service_date, override.role)
    assignment = await ports.roster.duty(schedule.id, slot)
    if assignment is not None and (
        assignment.member_id == replacement.id
        or (assignment.member_id is None and assignment.assignee_name == replacement.display_name)
    ):
        raise PersonAlreadyHoldsRole(replacement.id, override.service_date)
    anchor = await ports.policy.late_shift_anchor()
    coupled_partner: Duty | None = None
    if _couples_late_shift(override.role, override.service_date, replacement, anchor, holidays):
        partner = await ports.roster.duty(
            schedule.id, (override.service_date, AssignmentRole.late_shift)
        )
        if _same_holder(assignment, partner):
            coupled_partner = partner
    opposite = OPPOSITE_ONCALL.get(override.role)
    if opposite is not None:
        collision = await ports.roster.duty(schedule.id, (override.service_date, opposite))
        if collision is not None and collision.member_id == replacement.id:
            raise PersonAlreadyOnCall(replacement.id, override.service_date)
    roles_to_move = [override.role] + (
        [AssignmentRole.late_shift] if coupled_partner is not None else []
    )
    # A correction may break a hard rule only knowingly: the violations are
    # computed on the same resolved roster the matrix shows, the write is
    # refused until the coordinator acknowledges them, and they go to the
    # audit log with their rule ids.
    from_name = assignment.assignee_name if assignment is not None else replacement.display_name
    violations = await substitution_check(
        ports.roster,
        ports.policy,
        [(override.service_date, role) for role in roles_to_move],
        from_name,
        replacement.display_name,
    )
    if violations and not override.acknowledge_rule_violations:
        raise RuleViolationsNotAcknowledged(violations)
    if not await ports.roster.advance_version(
        schedule.id, expected_version=override.expected_version, only_if_published=True
    ):
        raise RosterChangedMeanwhile(schedule.id, override.expected_version)
    previous_name = assignment.assignee_name if assignment is not None else UNSTAFFED
    # Who each moved slot is taken from, recorded before the hand-over: the
    # clicked slot plus, when the anchor couples it, 11-19.
    moves = [OverrideMove(override.service_date, override.role, previous_name)]
    if coupled_partner is not None:
        moves.append(
            OverrideMove(
                override.service_date, AssignmentRole.late_shift, coupled_partner.assignee_name
            )
        )
    await ports.roster.hand_over(
        schedule.id, [(override.service_date, role) for role in roles_to_move], replacement
    )
    await ports.journal.duty_overridden(
        schedule_id=schedule.id,
        service_date=override.service_date,
        role=override.role,
        previous_name=previous_name,
        new_name=replacement.display_name,
        reason=override.reason,
        historical=override.service_date < today,
        moves=moves,
        violations=violations,
    )
    return DutyOverridden(
        service_date=override.service_date,
        role=override.role,
        assignee_name=replacement.display_name,
        violations=tuple(violations),
    )


async def override_duties_in_batch(
    batch: BatchOverrideInput, ports: OverridePorts
) -> list[DutyOverridden]:
    """Rewrite several slots of one schedule as one decision (e.g. offboarding)."""
    if not batch.lines:
        raise EmptyBatch()
    if len(batch.reason) < MIN_REASON_LENGTH:
        raise BatchCorrectionNeedsReason()
    schedule = await ports.roster.schedule(batch.schedule_id)
    if schedule is None or not schedule.published:
        raise PublishedScheduleNotFound(batch.schedule_id)
    slots = [(line.service_date, line.role) for line in batch.lines]
    if len(slots) != len(set(slots)):
        raise RepeatedSlotInBatch()
    replacements = await ports.team.members(line.replacement_member_id for line in batch.lines)
    moves: list[OverrideMove] = []
    changes: list[AssignmentChange] = []
    projected_moves: list[tuple[date, AssignmentRole, str]] = []
    for line in batch.lines:
        replacement = replacements.get(line.replacement_member_id)
        if replacement is None or not replacement.is_eligible(line.role, line.service_date):
            raise PersonNotEligible(line.replacement_member_id, line.role, line.service_date)
        if replacement.is_unavailable(line.service_date):
            raise PersonUnavailable(replacement.id, line.service_date)
        assignment = await ports.roster.duty(schedule.id, (line.service_date, line.role))
        if assignment is None:
            raise ScheduleSlotNotFound(line.service_date, line.role)
        moves.append(OverrideMove(line.service_date, line.role, assignment.assignee_name))
        changes.append(
            (line.service_date, line.role, assignment.assignee_name, replacement.display_name)
        )
        projected_moves.append((line.service_date, line.role, replacement.display_name))
    violations = await batch_substitution_check(ports.roster, ports.policy, projected_moves)
    unique_violations = list(
        {(item.rule, item.member_name, item.days): item for item in violations}.values()
    )
    if unique_violations and not batch.acknowledge_rule_violations:
        raise RuleViolationsNotAcknowledged(unique_violations)
    if not await ports.roster.advance_version(
        schedule.id, expected_version=batch.expected_version, only_if_published=False
    ):
        raise RosterChangedMeanwhile(schedule.id, batch.expected_version)
    for line in batch.lines:
        await ports.roster.hand_over(
            schedule.id,
            [(line.service_date, line.role)],
            replacements[line.replacement_member_id],
        )
    await ports.journal.duties_overridden_in_batch(
        schedule_id=schedule.id,
        slots=slots,
        moves=moves,
        changes=changes,
        violations=unique_violations,
        reason=batch.reason,
    )
    return [
        DutyOverridden(
            service_date=line.service_date,
            role=line.role,
            assignee_name=replacements[line.replacement_member_id].display_name,
            violations=tuple(unique_violations),
        )
        for line in batch.lines
    ]
