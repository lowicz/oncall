"""SQLAlchemy persistence for account, rotation, eligibility and audit administration."""

import uuid
from collections.abc import Mapping
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from oncall.account_tokens import issue_account_token
from oncall.audit import record_audit
from oncall.domain.admin import errors
from oncall.domain.admin.models import (
    Account,
    AccountRecord,
    AuditEntry,
    AuditFilter,
    EligibilityPeriod,
    IssuedToken,
    NewEligibilityPeriod,
    RotationMember,
)
from oncall.domain.roster import Slot
from oncall.domain.vocabulary import AccountTokenKind, AssignmentRole, ScheduleStatus, UserRole
from oncall.infrastructure.sqlalchemy.access_models import User
from oncall.infrastructure.sqlalchemy.audit_model import AuditEvent
from oncall.infrastructure.sqlalchemy.scheduling_models import Assignment, Schedule
from oncall.infrastructure.sqlalchemy.team_models import Eligibility, TeamMember


def _to_account(row: User, member_id: uuid.UUID | None) -> Account:
    return Account(
        id=row.id,
        username=row.username,
        personnel_number=row.personnel_number,
        first_name=row.first_name,
        last_name=row.last_name,
        auth_source=row.auth_source,
        role=row.role,
        email=row.email,
        phone=row.phone,
        is_active=row.is_active,
        created_at=row.created_at,
        member_id=member_id,
    )


def _to_period(row: Eligibility) -> EligibilityPeriod:
    return EligibilityPeriod(
        id=row.id,
        member_id=row.member_id,
        role=row.role,
        starts_on=row.starts_on,
        ends_on=row.ends_on,
    )


def _to_member(row: TeamMember, eligibility: list[Eligibility]) -> RotationMember:
    return RotationMember(
        id=row.id,
        user_id=row.user_id,
        display_name=row.display_name,
        active_from=row.active_from,
        active_until=row.active_until,
        eligibility=tuple(_to_period(item) for item in eligibility),
    )


class SqlAlchemyAccounts:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def accounts(self) -> list[Account]:
        rows = await self._session.execute(
            select(User, TeamMember.id)
            .outerjoin(TeamMember, TeamMember.user_id == User.id)
            .order_by(User.last_name, User.first_name)
        )
        return [_to_account(user, member_id) for user, member_id in rows.tuples()]

    async def account(self, account_id: uuid.UUID) -> Account | None:
        row = (
            await self._session.execute(
                select(User, TeamMember.id)
                .outerjoin(TeamMember, TeamMember.user_id == User.id)
                .where(User.id == account_id)
                .execution_options(populate_existing=True)
            )
        ).first()
        return _to_account(*row) if row is not None else None

    async def username_taken(self, username: str) -> bool:
        return bool(
            await self._session.scalar(
                select(User.id).where(func.lower(User.username) == username.lower())
            )
        )

    async def email_taken(self, email: str, *, other_than: uuid.UUID | None = None) -> bool:
        query = select(User.id).where(func.lower(User.email) == email.lower())
        if other_than is not None:
            query = query.where(User.id != other_than)
        return bool(await self._session.scalar(query))

    async def personnel_number_taken(
        self, personnel_number: str, *, other_than: uuid.UUID | None = None
    ) -> bool:
        query = select(User.id).where(User.personnel_number == personnel_number)
        if other_than is not None:
            query = query.where(User.id != other_than)
        return bool(await self._session.scalar(query))

    async def active_admin_count(self) -> int:
        # Every active administrator row stays locked until the unit of work
        # ends, taken in id order so two requests never wait on each other in
        # a cycle. A request that waited re-reads the rows, so an admin demoted
        # meanwhile no longer counts. NO KEY UPDATE still lets sessions and
        # audit rows reference these accounts.
        ids = await self._session.scalars(
            select(User.id)
            .where(User.role == UserRole.admin, User.is_active.is_(True))
            .order_by(User.id)
            .with_for_update(key_share=True)
        )
        return len(ids.all())

    async def open_account(self, record: AccountRecord) -> Account:
        row = User(
            username=record.username,
            personnel_number=record.personnel_number,
            first_name=record.first_name,
            last_name=record.last_name,
            auth_source=record.auth_source,
            password_hash=None,
            role=record.role,
            email=record.email,
            phone=record.phone,
            is_active=True,
        )
        self._session.add(row)
        try:
            await self._session.flush()
        except IntegrityError as error:
            # The checks passed, then a concurrent request stored the same
            # login or number: answer as the check would have.
            message = str(error.orig)
            if "personnel_number" in message and record.personnel_number is not None:
                raise errors.PersonnelNumberTaken(record.personnel_number) from None
            if "username" in message:
                raise errors.UsernameTaken(record.username) from None
            raise
        return _to_account(row, None)

    async def change_account(self, account_id: uuid.UUID, changes: Mapping[str, Any]) -> Account:
        member_id = await self._session.scalar(
            select(TeamMember.id).where(TeamMember.user_id == account_id)
        )
        row = await self._session.get(User, account_id)
        for key, value in changes.items():
            setattr(row, key, value)
        return _to_account(row, member_id)

    async def close_account(self, account_id: uuid.UUID) -> None:
        row = await self._session.get(User, account_id)
        # The audit entry goes in first; the deletion then fails on its own if
        # anything still points at the account.
        await self._session.flush()
        await self._session.delete(row)
        try:
            await self._session.flush()
        except IntegrityError:
            raise errors.AccountStillReferenced(account_id) from None

    async def issue_token(
        self, account_id: uuid.UUID, kind: AccountTokenKind, lifetime: timedelta
    ) -> IssuedToken:
        row = await self._session.get(User, account_id)
        raw, expires_at = await issue_account_token(self._session, row, kind, lifetime=lifetime)
        return IssuedToken(raw=raw, kind=kind, expires_at=expires_at)


class SqlAlchemyRotation:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def members(self) -> list[RotationMember]:
        rows = await self._session.scalars(
            select(TeamMember)
            .options(selectinload(TeamMember.eligibility))
            .order_by(TeamMember.display_name)
        )
        return [_to_member(row, row.eligibility) for row in rows.unique()]

    async def member(self, member_id: uuid.UUID) -> RotationMember | None:
        row = await self._session.scalar(
            select(TeamMember)
            .options(selectinload(TeamMember.eligibility))
            .where(TeamMember.id == member_id)
        )
        return _to_member(row, row.eligibility) if row is not None else None

    async def member_for_change(self, member_id: uuid.UUID) -> RotationMember | None:
        await self._session.execute(
            select(TeamMember.id).where(TeamMember.id == member_id).with_for_update(key_share=True)
        )
        row = await self._session.scalar(
            select(TeamMember)
            .options(selectinload(TeamMember.eligibility))
            .where(TeamMember.id == member_id)
            .execution_options(populate_existing=True)
        )
        return _to_member(row, row.eligibility) if row is not None else None

    async def account_is_enrolled(self, account_id: uuid.UUID) -> bool:
        return bool(
            await self._session.scalar(
                select(TeamMember.id).where(TeamMember.user_id == account_id)
            )
        )

    async def enrol(self, account: Account, active_from: date) -> RotationMember:
        row = TeamMember(
            user_id=account.id, display_name=account.display_name, active_from=active_from
        )
        self._session.add(row)
        try:
            await self._session.flush()
        except IntegrityError:
            raise errors.AccountAlreadyInRotation(account.id) from None
        return _to_member(row, [])

    async def change_membership(
        self, member_id: uuid.UUID, changes: Mapping[str, Any]
    ) -> RotationMember:
        row = await self._loaded_member(member_id)
        for key, value in changes.items():
            setattr(row, key, value)
        return _to_member(row, row.eligibility)

    async def rename_member(self, member_id: uuid.UUID, display_name: str) -> None:
        row = await self._session.get(TeamMember, member_id)
        row.display_name = display_name
        await self._session.execute(
            update(Assignment)
            .where(Assignment.member_id == member_id)
            .values(assignee_name=display_name)
        )

    async def period(self, eligibility_id: uuid.UUID) -> EligibilityPeriod | None:
        row = await self._session.scalar(
            select(Eligibility)
            .where(Eligibility.id == eligibility_id)
            .execution_options(populate_existing=True)
        )
        return _to_period(row) if row is not None else None

    async def periods(self, member_id: uuid.UUID, role: AssignmentRole) -> list[EligibilityPeriod]:
        rows = await self._session.scalars(
            select(Eligibility).where(Eligibility.member_id == member_id, Eligibility.role == role)
        )
        return [_to_period(row) for row in rows]

    async def overlapping_period_exists(
        self,
        member_id: uuid.UUID,
        role: AssignmentRole,
        starts_on: date,
        ends_on: date | None,
        *,
        other_than: uuid.UUID | None = None,
    ) -> bool:
        query = select(Eligibility.id).where(
            Eligibility.member_id == member_id,
            Eligibility.role == role,
            or_(Eligibility.ends_on.is_(None), Eligibility.ends_on >= starts_on),
        )
        if ends_on is not None:
            query = query.where(Eligibility.starts_on <= ends_on)
        if other_than is not None:
            query = query.where(Eligibility.id != other_than)
        return await self._session.scalar(query) is not None

    async def grant(self, period: NewEligibilityPeriod) -> EligibilityPeriod:
        row = Eligibility(
            member_id=period.member_id,
            role=period.role,
            starts_on=period.starts_on,
            ends_on=period.ends_on,
        )
        self._session.add(row)
        await self._session.flush()
        return _to_period(row)

    async def change_period(
        self, eligibility_id: uuid.UUID, changes: Mapping[str, Any]
    ) -> EligibilityPeriod:
        row = await self._session.get(Eligibility, eligibility_id)
        for key, value in changes.items():
            setattr(row, key, value)
        return _to_period(row)

    async def revoke(self, eligibility_id: uuid.UUID) -> None:
        await self._session.execute(delete(Eligibility).where(Eligibility.id == eligibility_id))

    async def published_duties(
        self,
        member_id: uuid.UUID,
        *,
        role: AssignmentRole | None = None,
        before: date | None = None,
        after: date | None = None,
        limit: int | None = None,
    ) -> list[Slot]:
        outside = []
        if before is not None:
            outside.append(Assignment.service_date < before)
        if after is not None:
            outside.append(Assignment.service_date > after)
        if not outside:
            return []
        query = (
            select(Assignment.service_date, Assignment.role)
            .join(Schedule, Assignment.schedule_id == Schedule.id)
            .where(
                Assignment.member_id == member_id,
                Schedule.status == ScheduleStatus.published,
                or_(*outside),
            )
            .order_by(Assignment.service_date)
        )
        if role is not None:
            query = query.where(Assignment.role == role)
        if limit is not None:
            query = query.limit(limit)
        return list((await self._session.execute(query)).tuples().all())

    async def _loaded_member(self, member_id: uuid.UUID) -> TeamMember:
        return await self._session.scalar(
            select(TeamMember)
            .options(selectinload(TeamMember.eligibility))
            .where(TeamMember.id == member_id)
        )


class SqlAlchemyAuditTrail:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def entries(self, query: AuditFilter) -> list[AuditEntry]:
        statement = select(AuditEvent).order_by(AuditEvent.occurred_at.desc())
        if query.action:
            statement = statement.where(AuditEvent.action == query.action)
        if query.entity_type:
            statement = statement.where(AuditEvent.entity_type == query.entity_type)
        if query.actor:
            statement = statement.where(AuditEvent.actor_label.ilike(f"%{query.actor}%"))
        if query.text:
            pattern = f"%{query.text}%"
            statement = statement.where(
                or_(
                    AuditEvent.summary.ilike(pattern),
                    AuditEvent.actor_label.ilike(pattern),
                    AuditEvent.action.ilike(pattern),
                )
            )
        if query.starts_on:
            statement = statement.where(
                AuditEvent.occurred_at >= datetime.combine(query.starts_on, time.min, UTC)
            )
        if query.ends_on:
            statement = statement.where(
                AuditEvent.occurred_at <= datetime.combine(query.ends_on, time.max, UTC)
            )
        if query.excluded_action is not None:
            statement = statement.where(AuditEvent.action != query.excluded_action)
        rows = await self._session.scalars(statement.limit(query.limit).offset(query.offset))
        return [
            AuditEntry(
                id=row.id,
                occurred_at=row.occurred_at,
                actor_label=row.actor_label,
                action=row.action,
                entity_type=row.entity_type,
                entity_id=row.entity_id,
                summary=row.summary,
                details=row.details,
            )
            for row in rows
        ]


class SqlAlchemyAdminJournal:
    def __init__(self, session: AsyncSession, actor: User) -> None:
        self._session = session
        self._actor = actor

    def _record(self, **entry: Any) -> None:
        record_audit(self._session, actor=self._actor, **entry)

    async def account_created(self, account: Account) -> None:
        self._record(
            action="admin.user_created",
            entity_type="user",
            entity_id=account.id,
            summary=f"Utworzono lokalne konto {account.username}",
            details={"role": account.role.value},
        )

    async def account_updated(
        self, account: Account, *, fields: list[str], before: dict[str, str | None]
    ) -> None:
        self._record(
            action="admin.user_updated",
            entity_type="user",
            entity_id=account.id,
            summary=f"Zaktualizowano konto {account.username}",
            details={"fields": fields, "before": before},
        )

    async def reset_link_issued(self, account: Account) -> None:
        self._record(
            action="admin.password_reset_issued",
            entity_type="user",
            entity_id=account.id,
            summary=f"Wygenerowano link resetu hasła dla {account.username}",
        )

    async def account_deleted(self, account: Account) -> None:
        self._record(
            action="admin.user_deleted",
            entity_type="user",
            entity_id=account.id,
            summary=f"Usunięto konto i dane osobowe: {account.username}",
            details={"display_name": account.display_name},
        )

    async def member_enrolled(self, member: RotationMember) -> None:
        self._record(
            action="admin.team_member_created",
            entity_type="team_member",
            entity_id=member.id,
            summary=f"Dodano {member.display_name} do rotacji od {member.active_from}",
        )

    async def membership_changed(self, member: RotationMember, *, fields: list[str]) -> None:
        self._record(
            action="admin.team_member_updated",
            entity_type="team_member",
            entity_id=member.id,
            summary=f"Zaktualizowano okres rotacji: {member.display_name}",
            details={"fields": fields},
        )

    async def eligibility_granted(self, member: RotationMember, period: EligibilityPeriod) -> None:
        self._record(
            action="admin.eligibility_created",
            entity_type="eligibility",
            entity_id=period.id,
            summary=(
                f"Nadano {member.display_name} eligibility {period.role.value} "
                f"od {period.starts_on}"
            ),
        )

    async def eligibility_changed(
        self, member: RotationMember, period: EligibilityPeriod, *, fields: list[str]
    ) -> None:
        self._record(
            action="admin.eligibility_updated",
            entity_type="eligibility",
            entity_id=period.id,
            summary=f"Zaktualizowano eligibility {period.role.value}: {member.display_name}",
            details={"fields": fields},
        )

    async def eligibility_revoked(self, member: RotationMember, period: EligibilityPeriod) -> None:
        self._record(
            action="admin.eligibility_deleted",
            entity_type="eligibility",
            entity_id=period.id,
            summary=f"Usunięto eligibility {period.role.value}: {member.display_name}",
            details={"starts_on": period.starts_on.isoformat(), "ends_on": str(period.ends_on)},
        )
