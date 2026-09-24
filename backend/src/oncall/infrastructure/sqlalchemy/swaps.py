import uuid
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from oncall.audit import record_audit
from oncall.domain.roster import Slot
from oncall.domain.swaps.models import ACTIVE_SWAP_STATUSES, NewSwapRequest, SwapRequest
from oncall.domain.vocabulary import AssignmentRole, SwapStatus
from oncall.infrastructure.sqlalchemy.access_models import User
from oncall.infrastructure.sqlalchemy.swap_models import SwapRequest as SwapRequestRow
from oncall.infrastructure.sqlalchemy.swap_models import SwapRequestSlot
from oncall.notifications import triggers
from oncall.rules import RuleViolation

#: First key of the two-integer advisory lock taken per service day while a
#: swap request is being created; the second key is the day's ordinal.
SWAP_DAY_LOCK_NAMESPACE = 20260913

ROLE_AUDIT_LABELS = {
    AssignmentRole.primary: "PRIMARY",
    AssignmentRole.secondary: "SECONDARY",
    AssignmentRole.late_shift: "11–19",
}


def _to_request(row: SwapRequestRow, slots: list[Slot]) -> SwapRequest:
    return SwapRequest(
        id=row.id,
        schedule_id=row.schedule_id,
        service_date=row.service_date,
        role=row.role,
        requester_member_id=row.requester_member_id,
        replacement_member_id=row.replacement_member_id,
        status=row.status,
        schedule_version=row.schedule_version,
        note=row.note,
        decision_note=row.decision_note,
        created_at=row.created_at,
        slots=tuple(slots),
    )


class SqlAlchemySwapRequests:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._held_days: set[date] = set()

    async def _hold_day(self, day: date) -> None:
        """Atomic reservation of the slot check: one request per service day is
        created at a time, until its unit of work ends. There is no row to lock
        before the request exists, so this is an advisory transaction lock
        (PostgreSQL); SQLite serialises writers on its own."""
        if day in self._held_days:
            return
        bind = self._session.bind
        if bind is not None and bind.dialect.name == "postgresql":
            await self._session.execute(
                select(func.pg_advisory_xact_lock(SWAP_DAY_LOCK_NAMESPACE, day.toordinal()))
            )
        self._held_days.add(day)

    async def has_active_request_for(self, slot: Slot) -> bool:
        service_date, role = slot
        await self._hold_day(service_date)
        clash = await self._session.scalar(
            select(SwapRequestSlot.id)
            .join(SwapRequestRow, SwapRequestSlot.swap_request_id == SwapRequestRow.id)
            .where(
                SwapRequestRow.status.in_(ACTIVE_SWAP_STATUSES),
                SwapRequestSlot.service_date == service_date,
                SwapRequestSlot.role == role,
            )
        )
        return clash is not None

    async def add(self, request: NewSwapRequest) -> SwapRequest:
        row = SwapRequestRow(
            schedule_id=request.schedule_id,
            service_date=request.service_date,
            role=request.role,
            requester_member_id=request.requester_member_id,
            replacement_member_id=request.replacement_member_id,
            status=request.status,
            schedule_version=request.schedule_version,
            note=request.note,
            slots=[
                SwapRequestSlot(service_date=service_date, role=role)
                for service_date, role in request.slots
            ],
        )
        self._session.add(row)
        await self._session.flush()
        # As stored, so `created_at` reads the same as on any later load.
        await self._session.refresh(row, attribute_names=["created_at"])
        return _to_request(row, list(request.slots))

    async def _slots(self, swap_id: uuid.UUID) -> list[Slot]:
        rows = await self._session.scalars(
            select(SwapRequestSlot).where(SwapRequestSlot.swap_request_id == swap_id)
        )
        return [(row.service_date, row.role) for row in rows]

    async def take_for_decision(self, swap_id: uuid.UUID) -> SwapRequest | None:
        # The row lock is the atomic part of every decision: a second decision
        # on the same request waits here and then reads the first one's outcome.
        row = await self._session.scalar(
            select(SwapRequestRow)
            .where(SwapRequestRow.id == swap_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if row is None:
            return None
        return _to_request(row, await self._slots(row.id))

    async def record_decision(self, request: SwapRequest) -> None:
        row = await self._session.get(SwapRequestRow, request.id)
        if row is None:
            raise LookupError(f"swap request {request.id} is not loaded")
        row.status = request.status
        row.decision_note = request.decision_note

    async def requests(
        self,
        *,
        involving: uuid.UUID | None,
        statuses: tuple[SwapStatus, ...],
        limit: int,
        offset: int,
    ) -> list[SwapRequest]:
        query = (
            select(SwapRequestRow)
            .options(selectinload(SwapRequestRow.slots))
            .order_by(SwapRequestRow.created_at.desc())
        )
        if involving is not None:
            query = query.where(
                (SwapRequestRow.requester_member_id == involving)
                | (SwapRequestRow.replacement_member_id == involving)
            )
        if statuses:
            query = query.where(SwapRequestRow.status.in_(statuses))
        rows = (await self._session.scalars(query.limit(limit).offset(offset))).all()
        return [
            _to_request(row, [(slot.service_date, slot.role) for slot in row.slots]) for row in rows
        ]


def _headline(request: SwapRequest) -> str:
    return f"{request.service_date} · {ROLE_AUDIT_LABELS[request.role]}"


class SqlAlchemySwapJournal:
    """Queues the e-mails and writes the audit entries in the acting account's
    name, inside the caller's unit of work."""

    def __init__(self, session: AsyncSession, actor: User) -> None:
        self._session = session
        self._actor = actor

    async def requested(
        self,
        request: SwapRequest,
        *,
        requester_name: str,
        replacement_name: str,
        warnings: list[RuleViolation],
    ) -> None:
        await triggers.notify_swap_requested(
            self._session,
            service_date=request.service_date,
            role=request.role,
            requester_name=requester_name,
            replacement_name=replacement_name,
        )
        slot_summary = ", ".join(
            f"{move_date} · {ROLE_AUDIT_LABELS[move_role]}"
            for move_date, move_role in request.moves
        )
        record_audit(
            self._session,
            actor=self._actor,
            action="swap.created",
            entity_type="swap",
            entity_id=request.id,
            summary=f"Prośba o zamianę [{slot_summary}]: {requester_name} → {replacement_name}",
            details={"warnings": [item.rule for item in warnings]} if warnings else None,
        )

    async def accepted(
        self, request: SwapRequest, *, requester_name: str, replacement_name: str
    ) -> None:
        await triggers.notify_swap_accepted(
            self._session,
            service_date=request.service_date,
            role=request.role,
            requester_name=requester_name,
            replacement_name=replacement_name,
        )
        record_audit(
            self._session,
            actor=self._actor,
            action="swap.accepted",
            entity_type="swap",
            entity_id=request.id,
            summary=(
                f"Zastępca zaakceptował zamianę {_headline(request)}: "
                f"{requester_name} → {replacement_name}"
            ),
        )

    async def rejected(
        self,
        request: SwapRequest,
        *,
        requester_name: str,
        replacement_name: str,
        reason: str | None,
        by_coordinator: bool,
    ) -> None:
        await triggers.notify_swap_rejected(
            self._session,
            service_date=request.service_date,
            role=request.role,
            requester_name=requester_name,
            replacement_name=replacement_name,
            reason=reason,
            by_coordinator=by_coordinator,
        )
        record_audit(
            self._session,
            actor=self._actor,
            action="swap.rejected",
            entity_type="swap",
            entity_id=request.id,
            summary=(
                f"Odrzucono zamianę {_headline(request)}: {requester_name} → {replacement_name}"
            ),
            details={"reason": reason, "by_coordinator": by_coordinator},
        )

    async def cancelled(
        self,
        request: SwapRequest,
        *,
        requester_name: str,
        replacement_name: str,
        reason: str | None,
    ) -> None:
        await triggers.notify_swap_cancelled(
            self._session,
            service_date=request.service_date,
            role=request.role,
            requester_name=requester_name,
            replacement_name=replacement_name,
            reason=reason,
        )
        record_audit(
            self._session,
            actor=self._actor,
            action="swap.cancelled",
            entity_type="swap",
            entity_id=request.id,
            summary=(
                f"Wycofano zamianę {_headline(request)}: {requester_name} → {replacement_name}"
            ),
            details={"reason": reason},
        )

    async def approved(
        self,
        request: SwapRequest,
        *,
        requester_name: str,
        replacement_name: str,
        by_coordinator: bool,
        self_approved: bool,
    ) -> None:
        if by_coordinator:
            await triggers.notify_swap_approved(
                self._session,
                service_date=request.service_date,
                role=request.role,
                requester_name=requester_name,
                replacement_name=replacement_name,
            )
            summary = (
                f"Zatwierdzono zamianę {_headline(request)}: "
                f"dyżuruje {replacement_name} (zamiast {requester_name})"
            )
        else:
            await triggers.notify_swap_recorded(
                self._session,
                service_date=request.service_date,
                role=request.role,
                requester_name=requester_name,
                replacement_name=replacement_name,
                swap_id=request.id,
            )
            summary = (
                f"Zastępca przyjął zamianę {_headline(request)}, wpisana do grafiku "
                f"bez zatwierdzenia koordynatora: dyżuruje {replacement_name} "
                f"(zamiast {requester_name})"
            )
        # One action for both roads into the schedule: whoever reads the audit
        # trail for swaps in force must not have to know the policy of the day.
        record_audit(
            self._session,
            actor=self._actor,
            action="swap.approved",
            entity_type="swap",
            entity_id=request.id,
            summary=summary,
            details={"self_approved": self_approved, "by_coordinator": by_coordinator},
        )
