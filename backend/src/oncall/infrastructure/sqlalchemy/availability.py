import uuid
from datetime import date

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from oncall.audit import record_audit
from oncall.domain.availability.models import (
    KIND_LABELS,
    AvailabilityEntry,
    NewAvailabilityEntry,
)
from oncall.domain.roster import Duty
from oncall.domain.team import Member
from oncall.infrastructure.sqlalchemy.access_models import User
from oncall.infrastructure.sqlalchemy.availability_model import Availability
from oncall.infrastructure.sqlalchemy.team_models import TeamMember
from oncall.notifications import triggers


def _to_entry(row: Availability, created_by_name: str | None) -> AvailabilityEntry:
    return AvailabilityEntry(
        id=row.id,
        member_id=row.member_id,
        kind=row.kind,
        starts_on=row.starts_on,
        ends_on=row.ends_on,
        note=row.note,
        created_at=row.created_at,
        created_by_user_id=row.created_by_user_id,
        created_by_name=created_by_name,
    )


def _on_behalf_details(member: Member, actor: User, on_behalf: bool) -> dict:
    if not on_behalf:
        return {}
    return {
        "on_behalf_of": member.display_name,
        "member_id": str(member.id),
        "actor": actor.display_name,
    }


class SqlAlchemyAvailability:
    """The availability ledger and its journal over one session and one actor.

    One object implements both ports because the audit entry names the row the
    ledger has just staged. Its id is whatever the row carries at that moment:
    the session assigns it on flush, which the conflict lookup of a hard
    „nie mogę" triggers and a soft preference does not. That is how entries
    have always been audited, and the draft staleness count reads it.
    """

    def __init__(self, session: AsyncSession, actor: User) -> None:
        self._session = session
        self._actor = actor
        self._recorded: Availability | None = None

    async def overlapping_entry(
        self, member_id: uuid.UUID, starts_on: date, ends_on: date
    ) -> AvailabilityEntry | None:
        # Atomic check-then-insert: declarations for one member are taken one
        # at a time by locking the member's row until the unit of work ends.
        # NO KEY UPDATE still lets unrelated rows reference the member.
        await self._session.execute(
            select(TeamMember.id).where(TeamMember.id == member_id).with_for_update(key_share=True)
        )
        row = await self._session.scalar(
            select(Availability).where(
                Availability.member_id == member_id,
                Availability.starts_on <= ends_on,
                Availability.ends_on >= starts_on,
            )
        )
        return _to_entry(row, None) if row is not None else None

    async def record(self, entry: NewAvailabilityEntry) -> None:
        self._recorded = Availability(
            member_id=entry.member_id,
            created_by_user_id=entry.created_by_user_id,
            kind=entry.kind,
            starts_on=entry.starts_on,
            ends_on=entry.ends_on,
            note=entry.note,
        )
        self._session.add(self._recorded)

    async def recorded_entry(self) -> AvailabilityEntry:
        if self._recorded is None:
            raise LookupError("no availability entry was recorded")
        await self._session.flush()
        await self._session.refresh(self._recorded)
        return _to_entry(self._recorded, self._actor.display_name)

    async def entries(
        self, member_id: uuid.UUID, starts_on: date | None, ends_on: date | None
    ) -> list[AvailabilityEntry]:
        query = (
            select(Availability)
            .where(Availability.member_id == member_id)
            .options(selectinload(Availability.created_by))
        )
        if starts_on:
            query = query.where(Availability.ends_on >= starts_on)
        if ends_on:
            query = query.where(Availability.starts_on <= ends_on)
        rows = await self._session.scalars(query.order_by(Availability.starts_on))
        return [
            _to_entry(row, row.created_by.display_name if row.created_by else None) for row in rows
        ]

    async def entry_to_withdraw(
        self, member_id: uuid.UUID, entry_id: uuid.UUID
    ) -> AvailabilityEntry | None:
        row = await self._session.scalar(
            select(Availability)
            .where(Availability.id == entry_id, Availability.member_id == member_id)
            .with_for_update()
        )
        return _to_entry(row, None) if row is not None else None

    async def remove(self, entry_id: uuid.UUID) -> None:
        await self._session.execute(delete(Availability).where(Availability.id == entry_id))

    async def declared(
        self,
        *,
        member: Member,
        entry: NewAvailabilityEntry,
        on_behalf: bool,
        duty_conflicts: list[Duty],
    ) -> None:
        actor = self._actor
        label = KIND_LABELS[entry.kind]
        record_audit(
            self._session,
            actor=actor,
            action="availability.created_on_behalf" if on_behalf else "availability.created",
            entity_type="availability",
            entity_id=self._recorded.id if self._recorded is not None else None,
            summary=(
                f"{actor.display_name} w imieniu {member.display_name}: "
                f"{label} {entry.starts_on} – {entry.ends_on}"
                if on_behalf
                else f"{member.display_name}: {label} {entry.starts_on} – {entry.ends_on}"
            ),
            details={
                "kind": entry.kind.value,
                **_on_behalf_details(member, actor, on_behalf),
            },
        )
        if duty_conflicts:
            await triggers.notify_availability_duty_conflict(
                self._session,
                member_name=member.display_name,
                duties=[(duty.service_date, duty.role) for duty in duty_conflicts],
            )
        if on_behalf:
            await triggers.notify_availability_created_on_behalf(
                self._session,
                coordinator_name=actor.display_name,
                member_name=member.display_name,
                kind_label=label,
                starts_on=entry.starts_on,
                ends_on=entry.ends_on,
                note=entry.note,
            )

    async def withdrawn(self, *, member: Member, entry: AvailabilityEntry, on_behalf: bool) -> None:
        actor = self._actor
        label = KIND_LABELS[entry.kind]
        record_audit(
            self._session,
            actor=actor,
            action="availability.deleted_on_behalf" if on_behalf else "availability.deleted",
            entity_type="availability",
            entity_id=entry.id,
            summary=(
                f"{actor.display_name} w imieniu {member.display_name}: usunięto "
                f"„{label}” {entry.starts_on} – {entry.ends_on}"
                if on_behalf
                else f"{member.display_name}: usunięto „{label}” "
                f"{entry.starts_on} – {entry.ends_on}"
            ),
            details={
                "kind": entry.kind.value,
                **_on_behalf_details(member, actor, on_behalf),
            },
        )
