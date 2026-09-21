"""Audit and notification side effects of scheduling commands."""

import uuid
from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from oncall.audit import record_audit
from oncall.domain.roster import Slot
from oncall.domain.scheduling.models import PendingSwapNotice, Schedule, SchedulingPolicy
from oncall.domain.scheduling.ports import NewDraft, StoredSchedule
from oncall.domain.vocabulary import AssignmentRole
from oncall.infrastructure.sqlalchemy.access_models import User
from oncall.notifications import triggers


class SqlAlchemySchedulingJournal:
    def __init__(self, session: AsyncSession, actor: User | None) -> None:
        self._session = session
        self._actor = actor

    def _schedule_event(
        self,
        action: str,
        schedule_id: uuid.UUID | None,
        summary: str,
        details: dict | None = None,
    ) -> None:
        record_audit(
            self._session,
            actor=self._actor,
            action=action,
            entity_type="schedule",
            entity_id=schedule_id,
            summary=summary,
            details=details,
        )

    async def policy_updated(self, policy: SchedulingPolicy) -> None:
        record_audit(
            self._session,
            actor=self._actor,
            action="policy.updated",
            entity_type="scheduling_policy",
            entity_id=policy.id,
            summary=(
                f"Polityka generatora: tryb {policy.rotation_mode.value}, wagi "
                f"sprawiedliwość {policy.fairness_weight:g}, ciągłość "
                f"{policy.continuity_weight:g}, preferencje {policy.preference_weight:g}, "
                f"11–19: {policy.late_shift_anchor.value}, budżet {policy.solve_seconds:g} s"
            ),
            details={
                "rotation_mode": policy.rotation_mode.value,
                "fairness_weight": policy.fairness_weight,
                "continuity_weight": policy.continuity_weight,
                "preference_weight": policy.preference_weight,
                "late_shift_anchor": policy.late_shift_anchor.value,
                "solve_seconds": policy.solve_seconds,
            },
        )

    async def draft_generated(self, stored: StoredSchedule, draft: NewDraft) -> None:
        result = draft.result
        # The id is assigned when the unit of work is written, after this event.
        self._schedule_event(
            "schedule.generated",
            stored.id,
            (
                f"Wygenerowano szkic {draft.starts_on} – {draft.ends_on} "
                f"({draft.rotation_mode.value}, CP-SAT: {result.status}, "
                f"wyjątki 11–19: {len(result.anchor_exceptions)}, "
                f"ostrzeżenia: {len(result.warnings)})"
            ),
            {
                "rotation_mode": draft.rotation_mode.value,
                "solver_status": result.status,
                "anchor_exceptions": list(result.anchor_exceptions),
                "warnings": list(result.warnings),
            },
        )

    async def draft_corrected(
        self, schedule_id: uuid.UUID, slot: Slot, previous_name: str, new_name: str
    ) -> None:
        service_date, role = slot
        self._schedule_event(
            "schedule.draft_override",
            schedule_id,
            f"Korekta szkicu {service_date} · {role.value}: {previous_name} → {new_name}",
            {
                "service_date": service_date.isoformat(),
                "role": role.value,
                "moves": [
                    {
                        "service_date": service_date.isoformat(),
                        "role": role.value,
                        "previous_assignee_name": previous_name,
                    }
                ],
            },
        )

    async def schedule_deleted(self, schedule: Schedule, kind: str) -> None:
        self._schedule_event(
            "schedule.deleted",
            schedule.id,
            f"Usunięto {kind} „{schedule.name}” ({schedule.starts_on} - {schedule.ends_on})",
        )

    async def schedule_proposed(self, schedule_id: uuid.UUID) -> None:
        self._schedule_event(
            "schedule.proposed", schedule_id, f"Przekazano szkic {schedule_id} do akceptacji"
        )

    async def proposal_withdrawn(self, schedule_id: uuid.UUID) -> None:
        self._schedule_event(
            "schedule.withdrawn", schedule_id, f"Cofnięto propozycję {schedule_id} do szkicu"
        )

    async def change_carried(
        self,
        schedule_id: uuid.UUID,
        slot: Slot,
        *,
        original_name: str | None,
        carried_name: str,
        source: str,
    ) -> None:
        service_date, role = slot
        self._schedule_event(
            "schedule.override_carried",
            schedule_id,
            (
                f"Przeniesiono zmianę {service_date} · {role.value}: "
                f"{original_name} → {carried_name}"
            ),
            {"service_date": service_date.isoformat(), "role": role.value, "source": source},
        )

    async def swap_cancelled_by_publication(
        self, notice: PendingSwapNotice, swap_id: uuid.UUID
    ) -> None:
        await triggers.notify_swap_cancelled_by_publication(
            self._session,
            service_date=notice.service_date,
            role=notice.role,
            requester_name=notice.requester_name,
            replacement_name=notice.replacement_name,
            swap_id=swap_id,
        )

    async def assignments_changed_by_publication(
        self, schedule_id: uuid.UUID, changes: list[tuple[date, AssignmentRole, str, str]]
    ) -> None:
        await triggers.notify_assignments_changed_by_publication(
            self._session, changes=changes, schedule_id=schedule_id
        )

    async def schedule_published(self, schedule: Schedule, name: str) -> None:
        await triggers.notify_schedule_published(
            self._session, name=name, starts_on=schedule.starts_on, ends_on=schedule.ends_on
        )
        self._schedule_event(
            "schedule.published",
            schedule.id,
            f"Opublikowano grafik „{name}” ({schedule.starts_on} – {schedule.ends_on})",
        )


__all__ = ["SqlAlchemySchedulingJournal"]
