import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from oncall.audit import record_audit
from oncall.domain.overrides.models import AssignmentChange, BatchOverrideKind, OverrideMove
from oncall.domain.vocabulary import ROLE_LABELS
from oncall.i18n import translate
from oncall.infrastructure.sqlalchemy.access_models import User
from oncall.notifications import triggers
from oncall.notifications.templates import format_date, swapped_holders
from oncall.rules import RuleViolation


def _moves_detail(moves: list[OverrideMove]) -> list[dict]:
    return [
        {
            "service_date": move.service_date.isoformat(),
            "role": move.role.value,
            "previous_assignee_name": move.previous_assignee_name,
        }
        for move in moves
    ]


def _rule_name(rule: str) -> str:
    """The rule's sentence from the Polish catalog as a list item: no
    capital, no full stop."""
    sentence = translate(f"rules.{rule}", "pl").rstrip(".")
    return sentence[:1].lower() + sentence[1:]


def acknowledged_suffix(violations: list[RuleViolation]) -> str:
    """The audit summary names the hard rules a correction or a swap broke;
    the use cases let one through only with an acknowledgement."""
    rules = sorted({violation.rule for violation in violations})
    names = "; ".join(_rule_name(rule) for rule in rules)
    return f" · świadome naruszenie reguł: {names}" if rules else ""


def violations_detail(violations: list[RuleViolation]) -> list[dict]:
    return [
        {
            "rule": violation.rule,
            "member_name": violation.member_name,
            "days": [day.isoformat() for day in violation.days],
        }
        for violation in violations
    ]


class SqlAlchemyOverrideJournal:
    def __init__(self, session: AsyncSession, actor: User) -> None:
        self._session = session
        self._actor = actor

    async def duty_overridden(
        self,
        *,
        schedule_id: uuid.UUID,
        changes: list[AssignmentChange],
        reason: str | None,
        historical: bool,
        moves: list[OverrideMove],
        violations: list[RuleViolation],
    ) -> None:
        await triggers.notify_assignment_overridden(self._session, changes=changes)
        service_date, role = changes[0][:2]
        handed = ", ".join(
            f"{ROLE_LABELS[changed]}: {previous_name} → {new_name}"
            for _, changed, previous_name, new_name in changes
        )
        record_audit(
            self._session,
            actor=self._actor,
            action="schedule.override",
            entity_type="schedule",
            entity_id=schedule_id,
            summary=f"Korekta {service_date} · {handed}" + acknowledged_suffix(violations),
            details={
                "service_date": service_date.isoformat(),
                "role": role.value,
                "reason": reason,
                "historical": historical,
                "moves": _moves_detail(moves),
                "rule_violations": violations_detail(violations),
            },
        )

    async def duties_overridden_in_batch(
        self,
        *,
        schedule_id: uuid.UUID,
        kind: BatchOverrideKind,
        moves: list[OverrideMove],
        changes: list[AssignmentChange],
        violations: list[RuleViolation],
        reason: str | None,
    ) -> None:
        role_swap = kind is BatchOverrideKind.role_swap
        await triggers.notify_assignments_overridden_in_batch(
            self._session, changes=changes, reason=reason, role_swap=role_swap
        )
        if role_swap:
            action = "schedule.role_swap"
            summary = (
                f"Zamieniono role dnia {format_date(moves[0].service_date)}: "
                + swapped_holders(changes)
            )
        else:
            action = "schedule.override_batch"
            summary = f"Przepisano wsadowo {len(moves)} dyżurów"
        record_audit(
            self._session,
            actor=self._actor,
            action=action,
            entity_type="schedule",
            entity_id=schedule_id,
            summary=summary + acknowledged_suffix(violations),
            details={
                "reason": reason,
                "slots": [f"{move.service_date}:{move.role.value}" for move in moves],
                "moves": _moves_detail(moves),
                "rule_violations": violations_detail(violations),
            },
        )
