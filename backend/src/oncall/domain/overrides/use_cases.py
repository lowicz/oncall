import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date

from oncall.domain.clock import business_today
from oncall.domain.hard_rules import batch_substitution_check, substitution_check
from oncall.domain.overrides.errors import (
    BatchCorrectionNeedsReason,
    EmptyBatch,
    HistoricalCorrectionNeedsReason,
    LateShiftNotCoupled,
    LateShiftOnlyOnWorkingDays,
    NotARoleSwap,
    OnCallPairInOneCorrection,
    PersonAlreadyHoldsRole,
    PersonAlreadyOnCall,
    PersonNotEligible,
    PersonNotFound,
    PersonUnavailable,
    PublishedScheduleNotFound,
    RepeatedSlotInBatch,
    RolesOfSeveralDays,
    RosterChangedMeanwhile,
    RuleViolationsNotAcknowledged,
    ScheduleSlotNotFound,
)
from oncall.domain.overrides.models import (
    MIN_REASON_LENGTH,
    UNSTAFFED,
    AssignmentChange,
    BalanceChange,
    BatchOverrideCheck,
    BatchOverrideInput,
    BatchOverrideKind,
    BatchOverrideLine,
    CorrectionImpact,
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
from oncall.fairness import FairnessDuty, compute_fairness, day_weight, reassign, window
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
        raise PersonNotFound()
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
        raise HistoricalCorrectionNeedsReason()
    holidays = polish_holidays(override.service_date, override.service_date)
    if override.role == AssignmentRole.late_shift and not is_working_day(
        override.service_date, holidays
    ):
        raise LateShiftOnlyOnWorkingDays()
    schedule = await _schedule_for(ports.roster, override.schedule_id, override.service_date)
    if schedule is None or not schedule.published:
        raise PublishedScheduleNotFound()
    replacement = await ports.team.member(override.replacement_member_id)
    if replacement is None or not replacement.is_eligible(override.role, override.service_date):
        raise PersonNotEligible()
    if replacement.is_unavailable(override.service_date):
        raise PersonUnavailable()
    slot = (override.service_date, override.role)
    assignment = await ports.roster.duty(schedule.id, slot)
    if assignment is not None and (
        assignment.member_id == replacement.id
        or (assignment.member_id is None and assignment.assignee_name == replacement.display_name)
    ):
        raise PersonAlreadyHoldsRole()
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
            raise PersonAlreadyOnCall()
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
        raise RosterChangedMeanwhile()
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
        changes=[
            (move.service_date, move.role, move.previous_assignee_name, replacement.display_name)
            for move in moves
        ],
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


Move = tuple[date, AssignmentRole, str]


@dataclass(frozen=True)
class _BatchPlan:
    schedule: ScheduleRef
    replacements: dict[uuid.UUID, Member]
    #: The batch's lines and, after them, the 11-19 lines they carry along.
    lines: list[BatchOverrideLine]
    #: Who holds each of `lines` now, in the same order; None for an
    #: unstaffed slot.
    assignments: list[Duty | None]
    projected_moves: list[Move]


async def _with_late_shifts(
    lines: Sequence[BatchOverrideLine],
    schedule: ScheduleRef,
    replacements: dict[uuid.UUID, Member],
    ports: OverridePorts,
) -> list[BatchOverrideLine]:
    """The lines plus the 11-19 each one takes along by the coordinator's
    choice. The choice is honoured only where `override_duty` would make the
    same move by itself, so the two corrections never disagree on coupling."""
    expanded = list(lines)
    anchor = await ports.policy.late_shift_anchor()
    for line in lines:
        if not line.with_late_shift:
            continue
        replacement = replacements.get(line.replacement_member_id)
        holidays = polish_holidays(line.service_date, line.service_date)
        assignment = await ports.roster.duty(schedule.id, (line.service_date, line.role))
        partner = await ports.roster.duty(
            schedule.id, (line.service_date, AssignmentRole.late_shift)
        )
        if (
            replacement is None
            or not _couples_late_shift(line.role, line.service_date, replacement, anchor, holidays)
            or not _same_holder(assignment, partner)
        ):
            raise LateShiftNotCoupled()
        expanded.append(
            BatchOverrideLine(line.service_date, AssignmentRole.late_shift, replacement.id)
        )
    return expanded


async def _covers(roster: PublishedRoster, schedule: ScheduleRef, day: date) -> bool:
    """Whether `day` is one of the schedule's own: an unstaffed slot of it
    may be filled, a day of another publication may not."""
    covering = await roster.latest_publication_covering(day)
    return covering is not None and covering.id == schedule.id


async def _batch_plan(check: BatchOverrideCheck, ports: OverridePorts) -> _BatchPlan:
    """Resolve and validate a batch without changing the roster."""
    if not check.lines:
        raise EmptyBatch()
    schedule = await ports.roster.schedule(check.schedule_id)
    if schedule is None or not schedule.published:
        raise PublishedScheduleNotFound()
    replacements = await ports.team.members(line.replacement_member_id for line in check.lines)
    lines = await _with_late_shifts(check.lines, schedule, replacements, ports)
    slots = [(line.service_date, line.role) for line in lines]
    if len(slots) != len(set(slots)):
        raise RepeatedSlotInBatch()
    assignments: list[Duty | None] = []
    projected_moves: list[Move] = []
    for line in lines:
        if line.role == AssignmentRole.late_shift and not is_working_day(
            line.service_date, polish_holidays(line.service_date, line.service_date)
        ):
            raise LateShiftOnlyOnWorkingDays()
        replacement = replacements.get(line.replacement_member_id)
        if replacement is None or not replacement.is_eligible(line.role, line.service_date):
            raise PersonNotEligible()
        if replacement.is_unavailable(line.service_date):
            raise PersonUnavailable()
        assignment = await ports.roster.duty(schedule.id, (line.service_date, line.role))
        if assignment is None and not await _covers(ports.roster, schedule, line.service_date):
            raise ScheduleSlotNotFound()
        if assignment is not None and assignment.held_by(replacement.id, replacement.display_name):
            raise PersonAlreadyHoldsRole()
        assignments.append(assignment)
        projected_moves.append((line.service_date, line.role, replacement.display_name))
    return _BatchPlan(schedule, replacements, lines, assignments, projected_moves)


def _swaps_roles(plan: _BatchPlan, lines: Sequence[BatchOverrideLine]) -> bool:
    """Whether two lines trade one day's PRIMARY and SECONDARY between the
    two people holding them."""
    if len(lines) != 2:
        return False
    first, second = lines
    held_first, held_second = plan.assignments[:2]
    taker_first = plan.replacements[first.replacement_member_id]
    taker_second = plan.replacements[second.replacement_member_id]
    return (
        held_first is not None
        and held_second is not None
        and first.service_date == second.service_date
        and first.role != second.role
        and AssignmentRole.late_shift not in (first.role, second.role)
        and held_first.held_by(taker_second.id, taker_second.display_name)
        and held_second.held_by(taker_first.id, taker_first.display_name)
    )


async def _check_roles_of_one_day(plan: _BatchPlan, ports: OverridePorts) -> None:
    """A correction of a day's roles refuses what a single correction
    refuses: PRIMARY and SECONDARY change only by a role swap, and nobody is
    put on the on-call role opposite to the one they keep that day."""
    if len({line.service_date for line in plan.lines}) != 1:
        raise RolesOfSeveralDays()
    roles = {line.role for line in plan.lines}
    if AssignmentRole.primary in roles and AssignmentRole.secondary in roles:
        raise OnCallPairInOneCorrection()
    for line in plan.lines:
        opposite = OPPOSITE_ONCALL.get(line.role)
        if opposite is None:
            continue
        taker = plan.replacements[line.replacement_member_id]
        kept = await ports.roster.duty(plan.schedule.id, (line.service_date, opposite))
        if kept is not None and kept.held_by(taker.id, taker.display_name):
            raise PersonAlreadyOnCall()


async def _violations(moves: list[Move], ports: OverridePorts) -> list[RuleViolation]:
    violations = await batch_substitution_check(ports.roster, ports.policy, moves)
    return list({(item.rule, item.member_name, item.days): item for item in violations}.values())


async def check_batch_override(
    checks: Sequence[BatchOverrideCheck], ports: OverridePorts
) -> list[RuleViolation]:
    """Hard-rule violations of batches saved one after another, before the first.

    The moves of every schedule are checked together, so a rule spanning two
    schedules (three duties in seven days across their boundary) is seen too:
    it is what the last batch's own check meets once the others are saved.
    """
    moves: list[Move] = []
    for check in checks:
        moves.extend((await _batch_plan(check, ports)).projected_moves)
    slots = [(day, role) for day, role, _name in moves]
    if len(slots) != len(set(slots)):
        raise RepeatedSlotInBatch()
    return await _violations(moves, ports)


async def preview_batch_impact(check: BatchOverrideCheck, ports: OverridePorts) -> CorrectionImpact:
    """What a batch would do to the balance of everybody it moves a slot from
    or to; nothing is written. Measured in the fairness report's window, like
    a swap's preview. A slot held by a name that is no team member has no
    balance to show."""
    plan = await _batch_plan(check, ports)
    window_start, window_end = window(max(line.service_date for line in plan.lines))
    members, duties = await ports.fairness.balance_inputs(window_start, window_end)
    projected = duties
    takers: list[uuid.UUID] = []
    #: Who gives each slot up: the identity, or only the label on rows that
    #: have none (`Duty.held_by`).
    givers: list[uuid.UUID | str] = []
    for line, assignment in zip(plan.lines, plan.assignments, strict=True):
        taker = plan.replacements[line.replacement_member_id]
        takers.append(taker.id)
        if assignment is None:
            projected = [
                *projected,
                FairnessDuty(line.service_date, line.role, taker.display_name, taker.id),
            ]
            continue
        givers.append(assignment.member_id or assignment.assignee_name)
        projected = reassign(
            projected,
            line.service_date,
            line.role,
            assignment.assignee_name,
            taker.display_name,
            taker.id,
        )
    holidays = polish_holidays(window_start, window_end)
    before, after = (
        {
            balance.member_id: balance
            for balance in compute_fairness(
                members,
                roster,
                holidays=holidays,
                window_start=window_start,
                window_end=window_end,
            ).members
        }
        for roster in (duties, projected)
    )
    by_name = {balance.display_name: member_id for member_id, balance in before.items()}
    giver_ids = [
        member_id
        for giver in givers
        if (member_id := by_name.get(giver) if isinstance(giver, str) else giver) is not None
    ]
    service_date = plan.lines[0].service_date
    return CorrectionImpact(
        service_date=service_date,
        points=day_weight(service_date, holidays),
        window_start=window_start,
        window_end=window_end,
        members=[
            BalanceChange(
                member_id, before[member_id].display_name, before[member_id], after[member_id]
            )
            for member_id in dict.fromkeys([*takers, *giver_ids])
            if member_id in before and member_id in after
        ],
    )


async def override_duties_in_batch(
    batch: BatchOverrideInput, ports: OverridePorts, *, today: date | None = None
) -> list[DutyOverridden]:
    """Rewrite several slots of one schedule as one decision: an offboarding,
    two people trading one day's on-call roles, or the roles of one day the
    coordinator hands over together."""
    today = today or business_today()
    if not batch.lines:
        raise EmptyBatch()
    reason = (batch.reason or "").strip()
    if batch.kind is BatchOverrideKind.correction and len(reason) < MIN_REASON_LENGTH:
        raise BatchCorrectionNeedsReason()
    plan = await _batch_plan(BatchOverrideCheck(batch.schedule_id, batch.lines), ports)
    if batch.kind is BatchOverrideKind.role_swap and not _swaps_roles(plan, batch.lines):
        raise NotARoleSwap()
    if batch.kind is BatchOverrideKind.multi_role:
        await _check_roles_of_one_day(plan, ports)
    historical = batch.lines[0].service_date < today
    # A swap and a change of roles need a reason only for a past day, like a
    # single correction; a `correction` always has one.
    if (
        batch.kind is not BatchOverrideKind.correction
        and historical
        and len(reason) < MIN_REASON_LENGTH
    ):
        raise HistoricalCorrectionNeedsReason()
    unique_violations = await _violations(plan.projected_moves, ports)
    if unique_violations and not batch.acknowledge_rule_violations:
        raise RuleViolationsNotAcknowledged(unique_violations)
    previous_names = [
        assignment.assignee_name if assignment is not None else UNSTAFFED
        for assignment in plan.assignments
    ]
    pairs = list(zip(plan.lines, previous_names, strict=True))
    moves = [OverrideMove(line.service_date, line.role, previous) for line, previous in pairs]
    changes: list[AssignmentChange] = [
        (
            line.service_date,
            line.role,
            previous,
            plan.replacements[line.replacement_member_id].display_name,
        )
        for line, previous in pairs
    ]
    if not await ports.roster.advance_version(
        plan.schedule.id, expected_version=batch.expected_version, only_if_published=False
    ):
        raise RosterChangedMeanwhile()
    for line in plan.lines:
        await ports.roster.hand_over(
            plan.schedule.id,
            [(line.service_date, line.role)],
            plan.replacements[line.replacement_member_id],
        )
    if batch.kind is BatchOverrideKind.multi_role:
        await ports.journal.duty_overridden(
            schedule_id=plan.schedule.id,
            changes=changes,
            reason=reason or None,
            historical=historical,
            moves=moves,
            violations=unique_violations,
        )
    else:
        await ports.journal.duties_overridden_in_batch(
            schedule_id=plan.schedule.id,
            kind=batch.kind,
            moves=moves,
            changes=changes,
            violations=unique_violations,
            reason=reason or None,
        )
    return [
        DutyOverridden(
            service_date=line.service_date,
            role=line.role,
            assignee_name=plan.replacements[line.replacement_member_id].display_name,
            violations=tuple(unique_violations),
        )
        for line in plan.lines
    ]
