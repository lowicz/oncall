import uuid
from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from oncall.audit import record_audit
from oncall.domain.overrides.models import OverrideMove
from oncall.domain.overrides.ports import OverrideJournal
from oncall.domain.roster import Slot
from oncall.domain.vocabulary import AssignmentRole
from oncall.infrastructure.sqlalchemy.access_models import User
from oncall.notifications import triggers
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


def _violations_detail(violations: list[RuleViolation]) -> list[dict]:
    return [
        {
            "rule": violation.rule,
            "member_name": violation.member_name,
            "days": [day.isoformat() for day in violation.days],
        }
        for violation in violations
    ]


class SqlAlchemyOverrideJournal(OverrideJournal):
    def __init__(self, session: AsyncSession, actor: User) -> None:
        self._session = session
        self._actor = actor

    async def duty_overridden(
        self,
        *,
        schedule_id: uuid.UUID,
        service_date: date,
        role: AssignmentRole,
        previous_name: str,
        new_name: str,
        reason: str | None,
        historical: bool,
        moves: list[OverrideMove],
        violations: list[RuleViolation],
    ) -> None:
        await triggers.notify_assignment_overridden(
            self._session,
            service_date=service_date,
            role=role,
            previous_name=previous_name,
            new_name=new_name,
        )
        rule_ids = sorted({violation.rule for violation in violations})
        record_audit(
            self._session,
            actor=self._actor,
            action="schedule.override",
            entity_type="schedule",
            entity_id=schedule_id,
            summary=(
                f"Override {service_date} · {role.value}: {previous_name} → {new_name}"
                + (f" · świadome naruszenie reguł: {', '.join(rule_ids)}" if rule_ids else "")
            ),
            details={
                "service_date": service_date.isoformat(),
                "role": role.value,
                "reason": reason,
                "historical": historical,
                "moves": _moves_detail(moves),
                "rule_violations": _violations_detail(violations),
            },
        )

    async def duties_overridden_in_batch(
        self,
        *,
        schedule_id: uuid.UUID,
        slots: list[Slot],
        moves: list[OverrideMove],
        violations: list[RuleViolation],
        reason: str,
    ) -> None:
        record_audit(
            self._session,
            actor=self._actor,
            action="schedule.override_batch",
            entity_type="schedule",
            entity_id=schedule_id,
            summary=f"Przepisano wsadowo {len(slots)} dyżurów",
            details={
                "reason": reason,
                "slots": [f"{day}:{role.value}" for day, role in slots],
                "moves": _moves_detail(moves),
                "rule_violations": _violations_detail(violations),
            },
        )
