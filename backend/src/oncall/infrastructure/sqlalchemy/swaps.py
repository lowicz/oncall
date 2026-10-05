import uuid
from collections.abc import Iterable
from datetime import date
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from oncall.audit import record_audit
from oncall.domain.roster import Slot
from oncall.domain.swaps.models import (
    ACTIVE_SWAP_STATUSES,
    AcknowledgedViolation,
    NewSwapRequest,
    SwapRequest,
    SwapReturn,
)
from oncall.domain.vocabulary import AssignmentRole, SwapSlotDirection, SwapStatus
from oncall.infrastructure.sqlalchemy.access_models import User
from oncall.infrastructure.sqlalchemy.overrides import acknowledged_suffix, violations_detail
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


def _stored_violations(
    violations: tuple[AcknowledgedViolation, ...],
) -> list[dict[str, Any]] | None:
    """The column's shape; null rather than an empty list for the ordinary
    swap that breaks nothing."""
    return [
        {"rule": item.rule, "party": item.party, "days": [day.isoformat() for day in item.days]}
        for item in violations
    ] or None


def slots_by_direction(
    rows: Iterable[SwapRequestSlot],
) -> tuple[list[SwapRequestSlot], list[SwapRequestSlot]]:
    """A request's slot rows as the ones the requester gives and the ones
    taken in return, each with the on-call role that names the duty before
    the 11-19 that travels with it, however the rows were read."""
    ordered = sorted(rows, key=lambda row: row.role == AssignmentRole.late_shift)
    return (
        [row for row in ordered if row.direction == SwapSlotDirection.given],
        [row for row in ordered if row.direction == SwapSlotDirection.returned],
    )


def _slot_rows(request: NewSwapRequest) -> list[SwapRequestSlot]:
    """One row per slot the request moves, each with its direction and the
    schedule that holds it."""
    directions = [(SwapSlotDirection.given, request.schedule_id, request.slots)]
    if request.in_return is not None:
        directions.append(
            (SwapSlotDirection.returned, request.in_return.schedule_id, request.in_return.slots)
        )
    return [
        SwapRequestSlot(
            service_date=service_date, role=role, direction=direction, schedule_id=schedule_id
        )
        for direction, schedule_id, slots in directions
        for service_date, role in slots
    ]


def _to_request(row: SwapRequestRow, slots: Iterable[SwapRequestSlot]) -> SwapRequest:
    given, returned = slots_by_direction(slots)
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
        slots=tuple((slot.service_date, slot.role) for slot in given),
        in_return=(
            SwapReturn(
                returned[0].schedule_id, tuple((slot.service_date, slot.role) for slot in returned)
            )
            if returned
            else None
        ),
        rule_violations=tuple(
            AcknowledgedViolation(
                item["rule"], item["party"], tuple(date.fromisoformat(day) for day in item["days"])
            )
            for item in row.rule_violations or ()
        ),
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

    async def active_slots(self, first: date, last: date) -> set[Slot]:
        rows = await self._session.execute(
            select(SwapRequestSlot.service_date, SwapRequestSlot.role)
            .join(SwapRequestRow, SwapRequestSlot.swap_request_id == SwapRequestRow.id)
            .where(
                SwapRequestRow.status.in_(ACTIVE_SWAP_STATUSES),
                SwapRequestSlot.service_date.between(first, last),
            )
        )
        return {(service_date, role) for service_date, role in rows}

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
            rule_violations=_stored_violations(request.rule_violations),
            slots=_slot_rows(request),
        )
        self._session.add(row)
        await self._session.flush()
        # As stored, so `created_at` reads the same as on any later load.
        await self._session.refresh(row, attribute_names=["created_at"])
        return _to_request(row, row.slots)

    async def _slots(self, swap_id: uuid.UUID) -> list[SwapRequestSlot]:
        rows = await self._session.scalars(
            select(SwapRequestSlot).where(SwapRequestSlot.swap_request_id == swap_id)
        )
        return list(rows)

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
        row.rule_violations = _stored_violations(request.rule_violations)

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
        return [_to_request(row, row.slots) for row in rows]


def _slot_list(slots: list[Slot]) -> str:
    return ", ".join(f"{day} · {ROLE_AUDIT_LABELS[role]}" for day, role in slots)


def _headline(request: SwapRequest) -> str:
    return _slot_list([(request.service_date, request.role)])


def _in_return(request: SwapRequest, requester_name: str) -> str:
    """What an exchange adds to a summary: the duty that goes the other way.
    Nothing for a one-way hand-over."""
    if request.in_return is None:
        return ""
    return f" · w zamian {requester_name} przejmuje [{_slot_list(request.return_moves)}]"


def _rule_details(violations: list[RuleViolation], details: dict[str, Any]) -> dict | None:
    """An audit entry's details, with the hard rules acknowledged at that step
    when there were any; an entry with nothing to say keeps none."""
    if violations:
        details = {**details, "rule_violations": violations_detail(violations)}
    return details or None


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
        violations: list[RuleViolation],
    ) -> None:
        await triggers.notify_swap_requested(
            self._session,
            service_date=request.service_date,
            role=request.role,
            slots=request.moves,
            return_slots=request.return_moves,
            requester_name=requester_name,
            replacement_name=replacement_name,
            violations=violations,
        )
        record_audit(
            self._session,
            actor=self._actor,
            action="swap.created",
            entity_type="swap",
            entity_id=request.id,
            summary=(
                f"Prośba o zamianę [{_slot_list(request.moves)}]: "
                f"{requester_name} → {replacement_name}"
                + _in_return(request, requester_name)
                + acknowledged_suffix(violations)
            ),
            details=_rule_details(
                violations, {"warnings": [item.rule for item in warnings]} if warnings else {}
            ),
        )

    async def accepted(
        self,
        request: SwapRequest,
        *,
        requester_name: str,
        replacement_name: str,
        violations: list[RuleViolation],
    ) -> None:
        await triggers.notify_swap_accepted(
            self._session,
            service_date=request.service_date,
            role=request.role,
            slots=request.moves,
            return_slots=request.return_moves,
            requester_name=requester_name,
            replacement_name=replacement_name,
            violations=violations,
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
                + _in_return(request, requester_name)
                + acknowledged_suffix(violations)
            ),
            details=_rule_details(violations, {}),
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
            slots=request.moves,
            return_slots=request.return_moves,
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
                + _in_return(request, requester_name)
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
            slots=request.moves,
            return_slots=request.return_moves,
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
                + _in_return(request, requester_name)
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
        violations: list[RuleViolation],
    ) -> None:
        if by_coordinator:
            await triggers.notify_swap_approved(
                self._session,
                service_date=request.service_date,
                role=request.role,
                slots=request.moves,
                return_slots=request.return_moves,
                requester_name=requester_name,
                replacement_name=replacement_name,
                violations=violations,
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
                slots=request.moves,
                return_slots=request.return_moves,
                requester_name=requester_name,
                replacement_name=replacement_name,
                swap_id=request.id,
                violations=violations,
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
            summary=(
                summary + _in_return(request, requester_name) + acknowledged_suffix(violations)
            ),
            details=_rule_details(
                violations, {"self_approved": self_approved, "by_coordinator": by_coordinator}
            ),
        )
