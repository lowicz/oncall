"""Previewing and publishing schedules.

The use cases stage their writes through the ports and return; the caller
owns the unit of work and commits once they are done.
"""

import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta

from oncall.domain.ports import PublishedRoster, TeamDirectory
from oncall.domain.roster import Duty, Slot
from oncall.domain.scheduling import drafts, errors
from oncall.domain.scheduling.generation import generate_draft as generate_draft
from oncall.domain.scheduling.generation import generation_status as generation_status
from oncall.domain.scheduling.generation import queue_generation as queue_generation
from oncall.domain.scheduling.generation import runs_in_flight as runs_in_flight
from oncall.domain.scheduling.generation import suggest_range as suggest_range
from oncall.domain.scheduling.generation import uncovered_dates as uncovered_dates
from oncall.domain.scheduling.generation import view_run as view_run
from oncall.domain.scheduling.models import (
    CarriedChange,
    ChangeRecord,
    PendingSwapNotice,
    Plan,
    PlanView,
    ProtectedChange,
    PublicationPreview,
    PublicationRequest,
    ReplacedDuty,
)
from oncall.domain.scheduling.planning import (
    rule_warnings,
    validate_complete,
)
from oncall.domain.scheduling.policy import change_policy as change_policy
from oncall.domain.scheduling.policy import current_policy as current_policy
from oncall.domain.scheduling.ports import (
    ChangeLog,
    SchedulingPorts,
)
from oncall.domain.team import Member
from oncall.domain.vocabulary import (
    AssignmentRole,
    ScheduleStatus,
)
from oncall.fairness import (
    generator_history_window,
)
from oncall.rules import (
    ONCALL_ROLES,
    RuleViolation,
    exempt_days,
    oncall_rest_violations,
    substitution_violations,
)
from oncall.workdays import polish_holidays

# --- what a draft is scored against ----------------------------------------


#: Actions this cannot verify the relevance of - the row a since-deleted
#: entity carried its own dates on is gone - so it counts unconditionally.
#: Erring towards a warning that turns out unnecessary is the safe direction
#: here; erring the other way would hide a draft that really did go stale.
_UNCONDITIONAL_STALE_ACTIONS = (
    "availability.deleted",
    "availability.deleted_on_behalf",
    "admin.eligibility_deleted",
    "schedule.published",
    "policy.updated",
)
_AVAILABILITY_CREATED_ACTIONS = ("availability.created", "availability.created_on_behalf")
_ELIGIBILITY_LIVE_ACTIONS = ("admin.eligibility_created", "admin.eligibility_updated")
_MEMBERSHIP_ACTIONS = ("admin.team_member_created", "admin.team_member_updated")
_SWAP_ACTIONS = (
    "swap.created",
    "swap.accepted",
    "swap.rejected",
    "swap.cancelled",
    "swap.approved",
)
_SINGLE_DAY_OVERRIDE_ACTIONS = (
    "schedule.override",
    "schedule.draft_override",
    "schedule.override_carried",
)

STALE_INPUT_ACTIONS = (
    *_UNCONDITIONAL_STALE_ACTIONS,
    *_AVAILABILITY_CREATED_ACTIONS,
    *_ELIGIBILITY_LIVE_ACTIONS,
    *_MEMBERSHIP_ACTIONS,
    *_SWAP_ACTIONS,
    *_SINGLE_DAY_OVERRIDE_ACTIONS,
    "schedule.override_batch",
)


async def stale_changes_count(plan: Plan, changes: ChangeLog) -> int:
    """How many audit events since generation could have changed this draft's
    inputs.

    A plain count of matching *actions* fired anywhere would raise this number
    for changes with no bearing on the draft at all - an availability entry a
    year outside the window counting exactly like one the solver read. Each
    action group is checked against what it actually touched: the relevant window is the rolling
    history the generator scored against, plus the horizon itself
    (`generator_history_window` already draws the history side of that line);
    membership and eligibility changes are checked against dates too, since
    those rows carry their own `starts_on`/`ends_on`, except team membership,
    which is checked against this schedule's own roster instead - a person
    who never appears in it cannot make this draft stale.
    """
    if plan.created_at is None:
        return 0
    history_start, _ = generator_history_window(plan.starts_on, plan.ends_on)
    window_start, window_end = history_start, plan.ends_on

    def relevant(day: date) -> bool:
        return window_start <= day <= window_end

    events = await changes.changes_since(plan.created_at, STALE_INPUT_ACTIONS)
    by_action: dict[str, list[ChangeRecord]] = defaultdict(list)
    for event in events:
        by_action[event.action].append(event)

    def entity_ids(actions: tuple[str, ...]) -> tuple[list[ChangeRecord], set[uuid.UUID]]:
        matched = [item for action in actions for item in by_action.pop(action, [])]
        ids = {uuid.UUID(item.entity_id) for item in matched if item.entity_id}
        return matched, ids

    count = sum(len(by_action.pop(action, [])) for action in _UNCONDITIONAL_STALE_ACTIONS)

    availability_events, availability_ids = entity_ids(_AVAILABILITY_CREATED_ACTIONS)
    if availability_ids:
        spans = await changes.availability_spans(availability_ids)
        count += sum(
            1
            for event in availability_events
            if (span := spans.get(uuid.UUID(event.entity_id))) is not None
            and span[0] <= window_end
            and span[1] >= window_start
        )

    eligibility_events, eligibility_ids = entity_ids(_ELIGIBILITY_LIVE_ACTIONS)
    if eligibility_ids:
        periods = await changes.eligibility_spans(eligibility_ids)
        count += sum(
            1
            for event in eligibility_events
            if (period := periods.get(uuid.UUID(event.entity_id))) is not None
            and period[0] <= window_end
            and (period[1] is None or period[1] >= window_start)
        )

    membership_events, membership_ids = entity_ids(_MEMBERSHIP_ACTIONS)
    if membership_ids:
        roster = {item.member_id for item in plan.assignments if item.member_id}
        count += sum(1 for event in membership_events if uuid.UUID(event.entity_id) in roster)

    swap_events, swap_ids = entity_ids(_SWAP_ACTIONS)
    if swap_ids:
        slot_days = await changes.swap_slot_days(swap_ids)
        count += sum(
            1
            for event in swap_events
            if any(relevant(day) for day in slot_days.get(uuid.UUID(event.entity_id), []))
        )

    for event in by_action.pop("schedule.override_batch", []):
        slots = (event.details or {}).get("slots", [])
        if any(relevant(date.fromisoformat(slot.split(":", 1)[0])) for slot in slots):
            count += 1

    for action in _SINGLE_DAY_OVERRIDE_ACTIONS:
        for event in by_action.pop(action, []):
            details = event.details or {}
            service_date = details.get("service_date")
            if service_date is not None and relevant(date.fromisoformat(service_date)):
                count += 1

    return count


async def view_plan(
    plan: Plan,
    ports: SchedulingPorts,
    *,
    today: date,
    warnings: list[str] | None = None,
) -> PlanView:
    """The plan with everything the generator screen shows next to it.

    `warnings` replaces the rule warnings computed from the plan, for a
    correction that reports the rules its replacement breaks.
    """
    return PlanView(
        plan=plan,
        rule_warnings=tuple(rule_warnings(plan) if warnings is None else warnings),
        unavailability_conflicts=await drafts.unavailability_conflicts(plan, ports.team),
        uncovered_before=tuple(await uncovered_dates(plan.starts_on, ports.roster, today)),
        stale_changes_count=await stale_changes_count(plan, ports.changes),
    )


async def show_plan(schedule_id: uuid.UUID, ports: SchedulingPorts, *, today: date) -> PlanView:
    plan = await ports.plans.plan(schedule_id)
    if plan is None:
        raise errors.ScheduleNotFound(schedule_id)
    return await view_plan(plan, ports, today=today)


# --- publication ------------------------------------------------------------

#: Actions that can tell a republish who a slot's assignee was replacing.
#: `schedule.override_carried` is deliberately not one of these: it records
#: the *result* of this same recovery, not a fresh input to it.
OVERRIDE_ORIGIN_ACTIONS = (
    "schedule.override",
    "schedule.override_batch",
    "schedule.draft_override",
)


async def override_original_assignees(
    changes: ChangeLog, schedule_ids: set[uuid.UUID]
) -> dict[tuple[uuid.UUID, date, AssignmentRole], str]:
    """Who each overridden slot's assignee replaced, so a republish can tell a
    safe carry from a genuine conflict.

    Reads the structured `details["moves"]` every override and correction
    writes. Parsing the `summary` text of a `schedule.override` instead, as
    this once did, recovers only single-slot moves: a batch correction, a
    draft correction and the 11-19 partner an anchor-role override carries
    along all fall back to "cannot tell" on republish. Events written before
    the field existed still take that path.
    """
    if not schedule_ids:
        return {}
    rows = await changes.schedule_changes(schedule_ids, OVERRIDE_ORIGIN_ACTIONS)
    result: dict[tuple[uuid.UUID, date, AssignmentRole], str] = {}
    ids = {str(item): item for item in schedule_ids}
    for event in rows:
        details = event.details or {}
        schedule_id = ids.get(event.entity_id or "")
        if schedule_id is None:
            continue
        moves = details.get("moves")
        if moves is None:
            try:
                key = (
                    schedule_id,
                    date.fromisoformat(str(details["service_date"])),
                    AssignmentRole(str(details["role"])),
                )
                original = event.summary.split(": ", 1)[1].split(" → ", 1)[0]
            except KeyError, ValueError, IndexError:
                continue
            result.setdefault(key, original)
            continue
        for move in moves:
            try:
                key = (
                    schedule_id,
                    date.fromisoformat(str(move["service_date"])),
                    AssignmentRole(str(move["role"])),
                )
                original = str(move["previous_assignee_name"])
            except KeyError, ValueError:
                continue
            result.setdefault(key, original)
    return result


def _holds_role_period(member: Member, role: AssignmentRole, day: date) -> bool:
    """An eligibility period for the role covers the day; unlike
    `Member.is_eligible`, membership dates are not consulted."""
    return any(
        item.role == role
        and item.starts_on <= day
        and (item.ends_on is None or item.ends_on >= day)
        for item in member.eligibility
    )


async def _carry_conflict_reason(
    plan: Plan,
    old: Duty,
    original_name: str | None,
    moves: list[Slot],
    ports: SchedulingPorts,
) -> str | None:
    if original_name is None:
        return "Nie można ustalić pierwotnego wykonawcy zmiany"
    replacement = (
        await ports.team.member(old.member_id)
        if old.member_id is not None
        else await ports.team.member_named(old.assignee_name)
    )
    if replacement is None:
        return "Zastępca nie jest już członkiem zespołu"
    draft = {item.slot: item for item in plan.assignments}
    if any(draft.get(move) is None or draft[move].assignee_name != original_name for move in moves):
        return "Nowy szkic ma w tym slocie innego pierwotnego wykonawcę"
    for service_date, role in moves:
        if not _holds_role_period(replacement, role, service_date) or (
            replacement.is_unavailable(service_date)
        ):
            return "Zastępca nie ma eligibility albo jest niedostępny"
    window_start = min(day for day, _role in moves) - timedelta(days=10)
    window_end = max(day for day, _role in moves) + timedelta(days=10)
    resolved = await ports.roster.duties_in_force(window_start, window_end)
    slots = {key: item.assignee_name for key, item in resolved.items()}
    for item in plan.assignments:
        slots[item.slot] = item.assignee_name
    policy = await ports.policy.current()
    violations = substitution_violations(
        slots,
        moves,
        original_name,
        old.assignee_name,
        policy.late_shift_anchor,
        polish_holidays(window_start, window_end),
    )
    hard_violations = [
        violation
        for violation in violations
        if violation.rule not in {"day_off_block", "oncall_late_shift_overlap"}
    ]
    if hard_violations:
        return "Przeniesienie narusza reguły grafiku"
    return None


async def _rest_violations(
    plan: Plan,
    current_in_range: dict[Slot, Duty],
    carried_changes: list[ProtectedChange],
    roster: PublishedRoster,
) -> tuple[RuleViolation, ...]:
    history_start = plan.starts_on - timedelta(days=7)
    # `current_in_range` is already loaded for the replacement comparison. The
    # caller supplies it to keep publication preview at one read of the duties
    # in force for the draft range; only the seven-day boundary needs another.
    boundary = await roster.duties_in_force(history_start, plan.starts_on - timedelta(days=1))
    slots = {key: item.assignee_name for key, item in {**boundary, **current_in_range}.items()}
    for assignment in plan.assignments:
        slots[assignment.slot] = assignment.assignee_name
    for change in carried_changes:
        slots[change.slot] = change.previous_assignee_name
    all_days = [
        history_start + timedelta(days=offset)
        for offset in range((plan.ends_on - history_start).days + 1)
    ]
    exemptions = exempt_days(all_days, polish_holidays(history_start, plan.ends_on))
    by_member: dict[str, set[date]] = defaultdict(set)
    for (service_date, role), assignee_name in slots.items():
        if role in ONCALL_ROLES:
            by_member[assignee_name].add(service_date)
    violations = [
        violation
        for name, days in by_member.items()
        for violation in oncall_rest_violations(name, days, exemptions)
        if any(day >= plan.starts_on for day in violation.days)
    ]
    grouped: dict[tuple[str, str], tuple[str, set[date]]] = {}
    for item in violations:
        message, days = grouped.setdefault((item.member_name, item.rule), (item.message, set()))
        days.update(item.days)
    return tuple(
        RuleViolation(rule=rule, message=message, member_name=member_name, days=tuple(sorted(days)))
        for (member_name, rule), (message, days) in sorted(grouped.items())
    )


async def _preview(plan: Plan, ports: SchedulingPorts, today: date) -> PublicationPreview:
    current = await ports.roster.duties_in_force(plan.starts_on, plan.ends_on)
    replacement = {item.slot: item for item in plan.assignments}
    changed = [
        (old, replacement[key])
        for key, old in current.items()
        if key in replacement and replacement[key].assignee_name != old.assignee_name
    ]
    effective_schedule_ids = {item.schedule_id for item in current.values()}
    approved = (
        await ports.swaps.approved_on(effective_schedule_ids) if effective_schedule_ids else []
    )
    approved_slots = {
        (swap.schedule_id, service_date, role): swap
        for swap in approved
        for service_date, role in swap.slots
    }
    override_originals = await override_original_assignees(
        ports.changes, {item.schedule_id for item, _new in changed}
    )
    protected = []
    for old, new in changed:
        slot_key = (old.schedule_id, old.service_date, old.role)
        swap = approved_slots.get(slot_key)
        if not old.is_override and swap is None:
            continue
        source = "approved_swap" if swap is not None else "override"
        original = swap.requester_name if swap is not None else override_originals.get(slot_key)
        moves = list(swap.slots) if swap is not None else [old.slot]
        reason = await _carry_conflict_reason(plan, old, original, moves, ports)
        protected.append(
            ProtectedChange(
                service_date=old.service_date,
                role=old.role,
                previous_assignee_name=old.assignee_name,
                new_assignee_name=new.assignee_name,
                source=source,
                original_assignee_name=original,
                reason=reason,
            )
        )
    carried_changes = [item for item in protected if item.reason is None]
    lost_changes = [item for item in protected if item.reason is not None]

    overlapping = await ports.plans.published_overlapping(plan)
    fully_covered = {
        schedule_id
        for schedule_id, span in overlapping.items()
        if span.starts_on >= plan.starts_on and span.ends_on <= plan.ends_on
    }
    candidates = await ports.swaps.pending_on(set(overlapping)) if overlapping else []
    pending = [
        swap
        for swap in candidates
        if (
            swap.schedule_id in fully_covered
            or any(plan.starts_on <= day <= plan.ends_on for day in swap.slot_dates)
            or (not swap.slot_dates and plan.starts_on <= swap.service_date <= plan.ends_on)
        )
    ]
    member_ids = {
        member_id
        for swap in pending
        for member_id in (swap.requester_member_id, swap.replacement_member_id)
    }
    names = await ports.team.display_names(member_ids) if member_ids else {}
    notices = [
        PendingSwapNotice(
            id=swap.id,
            service_date=swap.service_date,
            role=swap.role,
            requester_name=names.get(swap.requester_member_id, "Nieznana osoba"),
            replacement_name=names.get(swap.replacement_member_id, "Nieznana osoba"),
            status=swap.status,
        )
        for swap in pending
    ]
    return PublicationPreview(
        lost_changes=tuple(
            sorted(lost_changes, key=lambda item: (item.service_date, item.role.value))
        ),
        carried_changes=tuple(
            sorted(carried_changes, key=lambda item: (item.service_date, item.role.value))
        ),
        pending_swaps=tuple(sorted(notices, key=lambda item: (item.service_date, item.role.value))),
        uncovered_before=tuple(await uncovered_dates(plan.starts_on, ports.roster, today)),
        stale_changes_count=await stale_changes_count(plan, ports.changes),
        rest_violations=await _rest_violations(plan, current, carried_changes, ports.roster),
        replaced=tuple(
            ReplacedDuty(
                schedule_id=old.schedule_id,
                service_date=old.service_date,
                role=old.role,
                assignee_name=old.assignee_name,
                member_id=old.member_id,
                is_override=old.is_override,
                new_assignee_name=new.assignee_name,
            )
            for old, new in changed
        ),
    )


async def preview_publication(
    schedule_id: uuid.UUID, ports: SchedulingPorts, *, today: date
) -> PublicationPreview:
    plan = await ports.plans.plan(schedule_id)
    if plan is None:
        raise errors.ScheduleNotFound(schedule_id)
    if plan.status != ScheduleStatus.proposed:
        raise errors.OnlyProposalPublishable(plan.id)
    return await _preview(plan, ports, today)


async def change_resolution_conflicts(
    plan: Plan, selected_carries: list[ProtectedChange], team: TeamDirectory
) -> dict[Slot, str]:
    """Hard checks a "change" resolution is not allowed to skip.

    An automatic carry already runs the carry check before it is ever
    offered; a coordinator choosing "change" for a slot that failed that
    check would otherwise write the previous assignee straight back with no
    check at all, and could double-book them onto both on-call roles on the
    same day. Rest violations keep their own acknowledge gate; these three are
    not negotiable.
    """
    # The state every selected carry writes, so two "change" resolutions for
    # the same day's opposite roles are checked against each other too, not
    # just against the draft as it stood before any resolution was applied.
    final_names = {item.slot: item.previous_assignee_name for item in selected_carries}
    for item in plan.assignments:
        final_names.setdefault((item.service_date, item.role), item.assignee_name)

    conflicts: dict[Slot, str] = {}
    for change in selected_carries:
        key = change.slot
        name = change.previous_assignee_name
        if change.role in ONCALL_ROLES:
            opposite = (
                AssignmentRole.secondary
                if change.role == AssignmentRole.primary
                else AssignmentRole.primary
            )
            if final_names.get((change.service_date, opposite)) == name:
                conflicts[key] = "Ta osoba miałaby już drugi dyżur on-call tego dnia"
                continue
        member = await team.member_named(name)
        if member is None:
            conflicts[key] = "Zastępca nie jest już członkiem zespołu"
            continue
        if not _holds_role_period(member, change.role, change.service_date) or (
            member.is_unavailable(change.service_date)
        ):
            conflicts[key] = "Zastępca nie ma eligibility albo jest niedostępny"
    return conflicts


async def publish(
    request: PublicationRequest, ports: SchedulingPorts, *, today: date, now: datetime
) -> None:
    await ports.plans.hold_publication()
    plan = await ports.plans.plan_to_publish(request.schedule_id)
    if plan is None:
        raise errors.ScheduleNotFound(request.schedule_id)
    if plan.status != ScheduleStatus.proposed or plan.version != request.expected_version:
        raise errors.PublicationStateChanged(plan.id)
    validate_complete(plan)
    conflicts = await drafts.unavailability_conflicts(plan, ports.team)
    if conflicts:
        raise errors.PublicationHasUnavailablePeople(conflicts)
    preview = await _preview(plan, ports, today)
    if preview.lost_changes and not request.acknowledge_lost_changes:
        raise errors.LostChangesNotAcknowledged(preview.lost_changes, preview.pending_swaps)
    conflict_keys = {item.key for item in preview.lost_changes}
    missing_resolutions = sorted(conflict_keys - request.change_resolutions.keys())
    if missing_resolutions:
        raise errors.ChangeResolutionRequired(missing_resolutions)
    if preview.uncovered_before and not request.acknowledge_gap:
        raise errors.GapNotAcknowledged(preview.uncovered_before)
    selected_carries = list(preview.carried_changes) + [
        item for item in preview.lost_changes if request.change_resolutions[item.key] == "change"
    ]
    change_conflicts = await change_resolution_conflicts(plan, selected_carries, ports.team)
    if change_conflicts:
        raise errors.ChangeResolutionInvalid(change_conflicts)
    current = await ports.roster.duties_in_force(plan.starts_on, plan.ends_on)
    rest_violations = await _rest_violations(plan, current, selected_carries, ports.roster)
    if rest_violations and not request.acknowledge_rest_violations:
        raise errors.RestViolationsNotAcknowledged(rest_violations)

    carried_slots = {item.slot for item in selected_carries}
    carried_names = {item.previous_assignee_name for item in selected_carries}
    carried_ids = await ports.members.ids_by_name(carried_names) if carried_names else {}
    await ports.plans.carry(
        plan.id,
        [
            CarriedChange(
                item.slot, item.previous_assignee_name, carried_ids.get(item.previous_assignee_name)
            )
            for item in selected_carries
        ],
    )
    for change in selected_carries:
        await ports.journal.change_carried(
            plan.id,
            change.slot,
            original_name=change.original_assignee_name,
            carried_name=change.previous_assignee_name,
            source=change.source,
        )
    if preview.pending_swaps:
        notices = {item.id: item for item in preview.pending_swaps}
        for swap_id in await ports.swaps.cancel_for_publication(set(notices)):
            await ports.journal.swap_cancelled_by_publication(notices[swap_id], swap_id)
    await ports.journal.assignments_changed_by_publication(
        plan.id,
        [
            (old.service_date, old.role, old.assignee_name, old.new_assignee_name)
            for old in preview.replaced
            if old.slot not in carried_slots
        ],
    )
    # Only a schedule this publication fully covers is retired. Superseding
    # every overlap instead would blank out the days outside the new range: a
    # fortnight published inside a published month would retire the whole
    # month, leaving the days it does not replace with no published schedule
    # at all. Partial overlaps stay published and lose slot by slot in the
    # roster.
    await ports.plans.retire_covered_by(plan)
    name = (
        f"Grafik {plan.name.removeprefix('Szkic ')}"
        if plan.name.startswith("Szkic ")
        else plan.name
    )
    await ports.plans.mark_published(plan.id, name=name, published_at=now)
    await ports.journal.schedule_published(plan, name)
