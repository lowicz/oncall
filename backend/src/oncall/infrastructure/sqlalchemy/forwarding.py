"""Persistence ports for forwarding settings and the worker's attempts."""

import uuid
from dataclasses import replace
from datetime import date, datetime, timedelta
from typing import Any, cast

from sqlalchemy import CursorResult, exists, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from oncall.audit import record_audit
from oncall.domain.clock import BUSINESS_TIMEZONE, as_utc, utc_now
from oncall.domain.forwarding import errors
from oncall.domain.forwarding.job import (
    ForwardingAccount,
    ForwardingAttempt,
    ForwardingClaimLost,
    ForwardingFailure,
    ForwardingTarget,
    RecordedForwarding,
)
from oncall.domain.forwarding.models import (
    FAILING_OUTCOMES,
    ConnectionTest,
    ConnectionTestOutcome,
    ForwardingMode,
    ForwardingOutcome,
    ForwardingSettings,
    ForwardingState,
    HandoverEnd,
    NumberHandover,
    SettingsChange,
)
from oncall.domain.forwarding.passwords import Passwords
from oncall.domain.forwarding.ports import PasswordCipher
from oncall.effective import RESOLVED_STATUSES
from oncall.infrastructure.sqlalchemy.access_models import User
from oncall.infrastructure.sqlalchemy.base import load_singleton
from oncall.infrastructure.sqlalchemy.forwarding_models import (
    CallForwardingSettings,
    CallForwardingState,
    ForwardingHandover,
)
from oncall.infrastructure.sqlalchemy.scheduling_models import Schedule
from oncall.infrastructure.sqlalchemy.team_models import TeamMember
from oncall.notifications.service import retry_delay
from oncall.notifications.templates import FORWARDING_FAILURES
from oncall.notifications.triggers import (
    enqueue_forwarding_alert,
    enqueue_forwarding_recovered,
    notify_handover_ended_by_roster_change,
)

PERMANENT_BACKOFF = timedelta(hours=1)
TRANSIENT_ALERT_AFTER = timedelta(minutes=10)
#: What a connection test learned, as the audit trail says it.
CONNECTION_TEST_WORDS = {
    ConnectionTestOutcome.ok: "połączenie działa",
    ConnectionTestOutcome.password_expired: "hasło WCO wygasło",
    ConnectionTestOutcome.login_refused: "WCO odrzuciło dane logowania",
    ConnectionTestOutcome.connection: "nie udało się połączyć z WCO",
    ConnectionTestOutcome.configuration: "konfiguracja WCO jest niedostępna",
}
#: How a handover ended, as the audit trail says it.
HANDOVER_END_WORDS = {
    HandoverEnd.manual: "zakończone ręcznie",
    HandoverEnd.expired: "minął czas przekazania",
    HandoverEnd.roster_change: "korekta grafiku zmieniła parę dyżurną",
}


async def _require_claim(
    session: AsyncSession, attempt: ForwardingAttempt, *, now: datetime
) -> CallForwardingState:
    """The state row, as long as the attempt still holds its lease. A saved
    settings change revokes the lease, so this also fences a stale account."""
    state = await load_singleton(session, CallForwardingState)
    if (
        state.lease_until is None
        or as_utc(state.lease_until) != as_utc(attempt.lease_until)
        or as_utc(state.lease_until) <= as_utc(now)
    ):
        raise ForwardingClaimLost("the forwarding attempt was superseded")
    return state


def _to_settings(row: CallForwardingSettings) -> ForwardingSettings:
    return ForwardingSettings(
        id=row.id,
        mode=row.mode,
        base_url=row.base_url,
        vpbx_number=row.vpbx_number,
        username=row.username,
        wco_user_id=row.wco_user_id,
        password_set=row.password_ciphertext is not None,
        password_changed_at=row.password_changed_at,
        rotation_pending_since=row.pending_since,
        credentials_invalid_since=row.credentials_invalid_since,
        updated_at=row.updated_at,
    )


class SqlAlchemyForwardingSettings:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def current(self) -> ForwardingSettings:
        return _to_settings(await load_singleton(self._session, CallForwardingSettings))

    async def tokens(self) -> Passwords | None:
        row = await load_singleton(self._session, CallForwardingSettings)
        if row.password_ciphertext is None:
            return None
        return Passwords(row.password_ciphertext, row.pending_password_ciphertext)

    async def change(
        self, change: SettingsChange, password_token: str | None
    ) -> ForwardingSettings:
        row = await load_singleton(self._session, CallForwardingSettings)
        now = utc_now()
        changed = password_token is not None or (
            row.mode is not change.mode
            or row.base_url != change.base_url
            or row.vpbx_number != change.vpbx_number
            or row.username != change.username
            or row.wco_user_id != change.wco_user_id
        )
        row.mode = change.mode
        row.base_url = change.base_url
        row.vpbx_number = change.vpbx_number
        row.username = change.username
        row.wco_user_id = change.wco_user_id
        row.updated_at = now
        row.updated_by_user_id = change.updated_by_user_id
        if password_token is not None:
            # The administrator set the password WCO holds, so a rotation
            # left half done and a refused login no longer apply.
            row.password_ciphertext = password_token
            row.password_changed_at = now
            row.pending_password_ciphertext = None
            row.pending_since = None
            row.credentials_invalid_since = None
        if changed:
            # Invalidate both an old result and an in-flight snapshot. The old
            # worker is fenced by its lease; the next scan reconciles
            # the new account immediately instead of inheriting old backoff.
            state = await load_singleton(self._session, CallForwardingState)
            state.desired_number = None
            state.desired_member_name = None
            state.desired_for_day = None
            state.last_error = None
            state.failing_since = None
            state.attempts = 0
            state.next_attempt_at = None
            state.lease_until = None
        return _to_settings(row)


class SqlAlchemyForwardingState:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def current(self) -> ForwardingState:
        row = await load_singleton(self._session, CallForwardingState)
        return ForwardingState(
            applied_number=row.applied_number,
            applied_member_name=row.applied_member_name,
            applied_at=row.applied_at,
            desired_number=row.desired_number,
            desired_member_name=row.desired_member_name,
            desired_for_day=row.desired_for_day,
            last_attempt_at=row.last_attempt_at,
            last_outcome=row.last_outcome,
            last_error=row.last_error,
            failing_since=row.failing_since,
            attempts=row.attempts,
            next_attempt_at=row.next_attempt_at,
            alert_sent=row.alerted_for is not None,
        )


class SqlAlchemyForwardingJournal:
    def __init__(self, session: AsyncSession, actor: User) -> None:
        self._session = session
        self._actor = actor

    def settings_updated(self, settings: ForwardingSettings, *, password_changed: bool) -> None:
        record_audit(
            self._session,
            actor=self._actor,
            action="forwarding.settings_updated",
            entity_type="call_forwarding_settings",
            entity_id=settings.id,
            summary=(
                f"Przełączanie numeru: tryb {settings.mode.value}"
                + (", nowe hasło WCO" if password_changed else "")
            ),
            details={
                "mode": settings.mode.value,
                "base_url": settings.base_url,
                "vpbx_number": settings.vpbx_number,
                "username": settings.username,
                "wco_user_id": settings.wco_user_id,
                "password_changed": password_changed,
            },
        )

    def connection_tested(self, settings: ForwardingSettings, result: ConnectionTest) -> None:
        record_audit(
            self._session,
            actor=self._actor,
            action="forwarding.test",
            entity_type="call_forwarding_settings",
            entity_id=settings.id,
            summary=f"Sprawdzono połączenie z WCO: {CONNECTION_TEST_WORDS[result.outcome]}",
            details={
                "outcome": result.outcome.value,
                "number": result.number,
                "detail": result.detail,
            },
        )

    def password_revealed(self, settings: ForwardingSettings, *, pending_included: bool) -> None:
        record_audit(
            self._session,
            actor=self._actor,
            action="forwarding.password_revealed",
            entity_type="call_forwarding_settings",
            entity_id=settings.id,
            summary="Odsłonięto hasło WCO",
            details={"pending_included": pending_included},
        )


class SqlAlchemyForwardingConfiguration:
    """The worker's view of the WCO account and its password rotation."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def mode(self) -> ForwardingMode:
        return (await load_singleton(self._session, CallForwardingSettings)).mode

    async def account(self, cipher: PasswordCipher) -> ForwardingAccount:
        row = await load_singleton(self._session, CallForwardingSettings)
        if not all((row.vpbx_number, row.username, row.wco_user_id, row.password_ciphertext)):
            raise ValueError("active WCO settings are incomplete")
        pending = (
            cipher.decrypt(row.pending_password_ciphertext)
            if row.pending_password_ciphertext is not None
            else None
        )
        return ForwardingAccount(
            mode=row.mode,
            base_url=row.base_url,
            vpbx_number=row.vpbx_number or "",
            username=row.username or "",
            wco_user_id=row.wco_user_id or "",
            passwords=Passwords(cipher.decrypt(row.password_ciphertext or ""), pending),
            stored=Passwords(row.password_ciphertext or "", row.pending_password_ciphertext),
            credentials_invalid_since=row.credentials_invalid_since,
        )

    async def roster_published(self) -> bool:
        return bool(
            await self._session.scalar(
                select(exists().where(Schedule.status.in_(RESOLVED_STATUSES)))
            )
        )

    async def phone(self, member_id: uuid.UUID) -> str | None:
        return await self._session.scalar(
            select(User.phone)
            .join(TeamMember, TeamMember.user_id == User.id)
            .where(TeamMember.id == member_id)
        )

    async def stage_pending(
        self,
        attempt: ForwardingAttempt,
        password: str,
        cipher: PasswordCipher,
        *,
        now: datetime,
    ) -> ForwardingAttempt:
        token = cipher.encrypt(password)
        await self._write_passwords(
            attempt,
            now=now,
            pending_password_ciphertext=token,
            pending_since=now,
        )
        account = attempt.account
        attempt.account = replace(
            account,
            passwords=Passwords(account.passwords.current, password),
            stored=Passwords(account.stored.current, token),
        )
        return attempt

    async def promote_pending(
        self, attempt: ForwardingAttempt, *, now: datetime
    ) -> ForwardingAttempt:
        account = attempt.account
        stored = account.stored.promoted()
        settings_id = await self._write_passwords(
            attempt,
            now=now,
            password_ciphertext=stored.current,
            password_changed_at=now,
            pending_password_ciphertext=None,
            pending_since=None,
            credentials_invalid_since=None,
        )
        record_audit(
            self._session,
            actor=None,
            action="forwarding.password_rotated",
            entity_type="call_forwarding_settings",
            entity_id=settings_id,
            summary="Hasło WCO zostało zmienione automatycznie",
        )
        attempt.account = replace(
            account,
            passwords=account.passwords.promoted(),
            stored=stored,
        )
        return attempt

    async def _write_passwords(
        self, attempt: ForwardingAttempt, *, now: datetime, **values: object
    ) -> uuid.UUID:
        """Write the settings row only while it still holds the passwords the
        attempt read, so an administrator's save in between always wins."""
        await _require_claim(self._session, attempt, now=now)
        stored = attempt.account.stored
        written = await self._session.execute(
            update(CallForwardingSettings)
            .where(
                CallForwardingSettings.password_ciphertext == stored.current,
                CallForwardingSettings.pending_password_ciphertext.is_not_distinct_from(
                    stored.pending
                ),
            )
            .values(**values)
            .returning(CallForwardingSettings.id)
            .execution_options(synchronize_session=False)
        )
        settings_id = written.scalar_one_or_none()
        if settings_id is None:
            raise ForwardingClaimLost("the WCO passwords were changed meanwhile")
        return settings_id


class SqlAlchemyForwardingAttempts:
    """Lease, outcomes, audit and alert rows for worker attempts."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def claim(
        self,
        account: ForwardingAccount,
        target: ForwardingTarget,
        *,
        now: datetime,
        lease_until: datetime,
    ) -> ForwardingAttempt | None:
        row = await load_singleton(self._session, CallForwardingState)
        same_desired = self._same_desired(row, target)
        if (
            same_desired
            and row.next_attempt_at is not None
            and as_utc(row.next_attempt_at) > as_utc(now)
        ):
            return None
        if account.mode is ForwardingMode.dry_run:
            if same_desired and row.last_outcome is ForwardingOutcome.dry_run:
                return None
        elif (
            same_desired
            and target.number == row.applied_number
            and row.alerted_for is None
            and row.last_outcome not in FAILING_OUTCOMES
        ):
            return None
        values: dict[str, object] = {"lease_until": lease_until}
        if not same_desired:
            values.update(attempts=0, next_attempt_at=None, failing_since=None)
        claimed = await self._session.execute(
            update(CallForwardingState)
            .where(
                CallForwardingState.id == row.id,
                or_(
                    CallForwardingState.lease_until.is_(None),
                    CallForwardingState.lease_until <= now,
                ),
            )
            .values(**values)
            .execution_options(synchronize_session=False)
        )
        if cast(CursorResult[Any], claimed).rowcount != 1:
            return None
        return ForwardingAttempt(account, target, lease_until)

    async def renew(
        self, attempt: ForwardingAttempt, *, now: datetime, lease_until: datetime
    ) -> ForwardingAttempt:
        renewed = await self._session.execute(
            update(CallForwardingState)
            .where(
                CallForwardingState.lease_until == attempt.lease_until,
                CallForwardingState.lease_until > now,
            )
            .values(lease_until=lease_until)
            .execution_options(synchronize_session=False)
        )
        if cast(CursorResult[Any], renewed).rowcount != 1:
            raise ForwardingClaimLost("the forwarding lease expired or was replaced")
        attempt.lease_until = lease_until
        return attempt

    async def record_skipped(
        self, target: ForwardingTarget, cause: ForwardingFailure, *, now: datetime
    ) -> RecordedForwarding | None:
        row = await load_singleton(self._session, CallForwardingState)
        if row.lease_until is not None and as_utc(row.lease_until) > as_utc(now):
            return None
        outcome = (
            ForwardingOutcome.skipped_no_primary
            if cause is ForwardingFailure.no_primary
            else ForwardingOutcome.skipped_no_phone
        )
        if self._same_desired(row, target) and row.last_outcome is outcome:
            return None
        self._start_episode(row, target, now=now)
        row.last_outcome = outcome
        row.last_error = FORWARDING_FAILURES[cause]
        row.attempts = 0
        row.next_attempt_at = None
        row.lease_until = None
        await self._alert(row, target, cause, now=now, immediate=True)
        self._audit_failure(row, target, cause, action="forwarding.skipped")
        return RecordedForwarding(outcome, 0)

    async def record_unclaimed_failure(
        self,
        target: ForwardingTarget,
        cause: ForwardingFailure,
        detail: str,
        *,
        now: datetime,
        hard_stop: bool = False,
    ) -> RecordedForwarding | None:
        row = await load_singleton(self._session, CallForwardingState)
        if row.lease_until is not None and as_utc(row.lease_until) > as_utc(now):
            return None
        if (
            hard_stop
            and self._same_desired(row, target)
            and row.last_outcome is ForwardingOutcome.failed
        ):
            return None
        if row.next_attempt_at is not None and as_utc(row.next_attempt_at) > as_utc(now):
            return None
        return await self._write_failure(
            row,
            target,
            cause,
            detail,
            permanent=True,
            invalidate_credentials=hard_stop,
            now=now,
        )

    async def record_failure(
        self,
        attempt: ForwardingAttempt,
        cause: ForwardingFailure,
        detail: str,
        *,
        permanent: bool,
        invalidate_credentials: bool,
        now: datetime,
    ) -> RecordedForwarding:
        if invalidate_credentials:
            # No retry: WCO refused every stored password, and only an
            # administrator's new one ends the stop. Written only over the
            # password the attempt was refused with, before the state row,
            # in the order an administrator's save takes the two rows.
            invalidated = await self._session.execute(
                update(CallForwardingSettings)
                .where(CallForwardingSettings.password_ciphertext == attempt.account.stored.current)
                .values(credentials_invalid_since=now)
                .execution_options(synchronize_session=False)
            )
            if cast(CursorResult[Any], invalidated).rowcount != 1:
                raise ForwardingClaimLost("the WCO passwords were changed meanwhile")
        row = await self._release(attempt, now=now)
        return await self._write_failure(
            row,
            attempt.target,
            cause,
            detail,
            permanent=permanent,
            invalidate_credentials=invalidate_credentials,
            now=now,
        )

    async def record_success(
        self,
        attempt: ForwardingAttempt,
        current_number: str,
        outcome: ForwardingOutcome,
        *,
        rotated: bool,
        now: datetime,
    ) -> RecordedForwarding:
        """The pass read `current_number` from WCO: applied, unchanged, or a
        dry run that only looked."""
        row = await self._release(attempt, now=now)
        alerted_for = row.alerted_for
        reached = current_number == attempt.target.number
        self._desired(row, attempt.target)
        row.applied_number = current_number
        row.applied_member_id = attempt.target.holder_id if reached else None
        row.applied_member_name = attempt.target.holder_name if reached else None
        row.applied_at = now
        row.last_attempt_at = now
        row.last_outcome = outcome
        row.last_error = None
        row.failing_since = None
        row.attempts = 0
        row.next_attempt_at = None
        if outcome is ForwardingOutcome.dry_run:
            record_audit(
                self._session,
                actor=None,
                action="forwarding.test",
                entity_type="call_forwarding_state",
                entity_id=row.id,
                summary=f"Próba przełączenia numeru na {attempt.target.holder_name}",
                details={
                    "day": attempt.target.day.isoformat(),
                    "desired_number": attempt.target.number,
                    "current_number": current_number,
                },
            )
            return RecordedForwarding(outcome, 0, rotated)
        row.alerted_for = None
        if outcome is ForwardingOutcome.applied:
            record_audit(
                self._session,
                actor=None,
                action="forwarding.applied",
                entity_type="call_forwarding_state",
                entity_id=row.id,
                summary=f"Numer on-call przełączono na {attempt.target.holder_name}",
                details={
                    "day": attempt.target.day.isoformat(),
                    "member_id": str(attempt.target.holder_id),
                    "number": attempt.target.number,
                },
            )
        if alerted_for is not None:
            await enqueue_forwarding_recovered(
                self._session, attempt.target, alerted_for=alerted_for
            )
        return RecordedForwarding(outcome, 0, rotated)

    async def _write_failure(
        self,
        row: CallForwardingState,
        target: ForwardingTarget,
        cause: ForwardingFailure,
        detail: str,
        *,
        permanent: bool,
        invalidate_credentials: bool,
        now: datetime,
    ) -> RecordedForwarding:
        same_episode = self._same_desired(row, target) and row.last_outcome in FAILING_OUTCOMES
        if not same_episode:
            self._start_episode(row, target, now=now)
        attempts = row.attempts + 1 if same_episode else 1
        self._desired(row, target)
        row.last_attempt_at = now
        row.last_outcome = ForwardingOutcome.failed
        row.last_error = detail[:500]
        row.attempts = attempts
        row.lease_until = None
        if invalidate_credentials:
            row.next_attempt_at = None
        else:
            row.next_attempt_at = now + (PERMANENT_BACKOFF if permanent else retry_delay(attempts))
        await self._alert(row, target, cause, now=now, immediate=permanent)
        self._audit_failure(row, target, cause, action="forwarding.failed")
        return RecordedForwarding(ForwardingOutcome.failed, attempts)

    async def _release(self, attempt: ForwardingAttempt, *, now: datetime) -> CallForwardingState:
        """End the attempt's lease in one compare-and-set, which also holds the
        state row until the unit of work ends: an administrator's save either
        revoked the lease first, and the outcome is dropped, or waits for it."""
        released = await self._session.execute(
            update(CallForwardingState)
            .where(
                CallForwardingState.lease_until == attempt.lease_until,
                CallForwardingState.lease_until > now,
            )
            .values(lease_until=None)
            .execution_options(synchronize_session=False)
        )
        if cast(CursorResult[Any], released).rowcount != 1:
            raise ForwardingClaimLost("the forwarding attempt was superseded")
        return await load_singleton(self._session, CallForwardingState)

    async def _alert(
        self,
        row: CallForwardingState,
        target: ForwardingTarget,
        cause: ForwardingFailure,
        *,
        now: datetime,
        immediate: bool,
    ) -> None:
        # A dry run writes nothing to WCO, so nobody is asked to act on it.
        settings = await load_singleton(self._session, CallForwardingSettings)
        if settings.mode is ForwardingMode.dry_run:
            return
        failing_since = as_utc(row.failing_since or now)
        if not immediate and as_utc(now) - failing_since < TRANSIENT_ALERT_AFTER:
            return
        alert_key = f"forwarding-failed:{target.alert_token}"
        queued = await enqueue_forwarding_alert(
            self._session,
            target,
            cause=cause,
            applied_number=row.applied_number,
            applied_at=row.applied_at,
            dedup_prefix=alert_key,
        )
        if queued:
            row.alerted_for = alert_key

    def _audit_failure(
        self,
        row: CallForwardingState,
        target: ForwardingTarget,
        cause: ForwardingFailure,
        *,
        action: str,
    ) -> None:
        record_audit(
            self._session,
            actor=None,
            action=action,
            entity_type="call_forwarding_state",
            entity_id=row.id,
            summary=f"Przełączanie numeru: {FORWARDING_FAILURES[cause]}",
            details={
                "day": target.day.isoformat(),
                "member_id": str(target.member_id) if target.member_id else None,
                "cause": cause.value,
            },
        )

    @staticmethod
    def _same_desired(row: CallForwardingState, target: ForwardingTarget) -> bool:
        return (
            row.desired_for_day == target.day
            and row.desired_member_name == target.holder_name
            and row.desired_number == target.number
        )

    @staticmethod
    def _desired(row: CallForwardingState, target: ForwardingTarget) -> None:
        row.desired_for_day = target.day
        row.desired_member_name = target.holder_name
        row.desired_number = target.number

    def _start_episode(
        self, row: CallForwardingState, target: ForwardingTarget, *, now: datetime
    ) -> None:
        self._desired(row, target)
        row.failing_since = now
        row.attempts = 0


class SqlAlchemyHandovers:
    """The number handovers, with the names of their two people."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def open(self) -> NumberHandover | None:
        giver, receiver = aliased(TeamMember), aliased(TeamMember)
        row = (
            await self._session.execute(
                select(ForwardingHandover, giver.display_name, receiver.display_name)
                .join(giver, giver.id == ForwardingHandover.from_member_id)
                .join(receiver, receiver.id == ForwardingHandover.to_member_id)
                .where(ForwardingHandover.ended_at.is_(None))
                .order_by(ForwardingHandover.starts_at.desc())
                .limit(1)
            )
        ).first()
        if row is None:
            return None
        handover, from_name, to_name = row
        return NumberHandover(
            id=handover.id,
            day=handover.day,
            from_member_id=handover.from_member_id,
            from_name=from_name,
            to_member_id=handover.to_member_id,
            to_name=to_name,
            starts_at=as_utc(handover.starts_at),
            until=as_utc(handover.until),
        )

    async def start(
        self,
        *,
        day: date,
        from_member_id: uuid.UUID,
        to_member_id: uuid.UUID,
        until: datetime,
        now: datetime,
        by_user_id: uuid.UUID,
    ) -> NumberHandover:
        row = ForwardingHandover(
            day=day,
            from_member_id=from_member_id,
            to_member_id=to_member_id,
            starts_at=now,
            until=until,
            created_by_user_id=by_user_id,
        )
        try:
            # A partial unique index allows one open handover a day; losing
            # that race undoes the insert alone, under a savepoint.
            async with self._session.begin_nested():
                self._session.add(row)
                await self._session.flush()
        except IntegrityError as error:
            existing = await self.open()
            if existing is None or not _unique_violation(error):
                raise
            raise errors.HandoverActive(existing.to_name) from None
        started = await self.open()
        assert started is not None and started.id == row.id
        return started

    async def end(
        self,
        handover: NumberHandover,
        reason: HandoverEnd,
        *,
        at: datetime,
        by_user_id: uuid.UUID | None,
    ) -> bool:
        ended = await self._session.execute(
            update(ForwardingHandover)
            .where(ForwardingHandover.id == handover.id, ForwardingHandover.ended_at.is_(None))
            .values(ended_at=at, end_reason=reason, ended_by_user_id=by_user_id)
            .execution_options(synchronize_session=False)
        )
        return cast(CursorResult[Any], ended).rowcount == 1


def _unique_violation(error: IntegrityError) -> bool:
    """Whether a unique index refused the row, as PostgreSQL or SQLite says."""
    return (
        getattr(error.orig, "sqlstate", None) == "23505"
        or getattr(error.orig, "sqlite_errorname", None) == "SQLITE_CONSTRAINT_UNIQUE"
    )


def _clock(moment: datetime) -> str:
    return f"{as_utc(moment).astimezone(BUSINESS_TIMEZONE):%H:%M}"


class SqlAlchemyHandoverJournal:
    """Audit entries of handovers, in the name of whoever acted (the worker:
    `actor` None), and the mail of an end the roster forced."""

    def __init__(self, session: AsyncSession, actor: User | None) -> None:
        self._session = session
        self._actor = actor

    def started(self, handover: NumberHandover) -> None:
        record_audit(
            self._session,
            actor=self._actor,
            action="forwarding.handover_started",
            entity_type="forwarding_handover",
            entity_id=handover.id,
            summary=(
                f"Przekazano numer on-call: {handover.from_name} → {handover.to_name} "
                f"do {_clock(handover.until)}"
            ),
            details=_details(handover),
        )

    def ended(self, handover: NumberHandover, reason: HandoverEnd) -> None:
        record_audit(
            self._session,
            actor=self._actor,
            action="forwarding.handover_ended",
            entity_type="forwarding_handover",
            entity_id=handover.id,
            summary=(
                f"Zakończono przekazanie numeru on-call: {handover.from_name} → "
                f"{handover.to_name}, {HANDOVER_END_WORDS[reason]}"
            ),
            details=_details(handover) | {"reason": reason.value},
        )

    async def ended_by_roster_change(
        self, handover: NumberHandover, primary_name: str | None
    ) -> None:
        await notify_handover_ended_by_roster_change(
            self._session, handover, primary_name=primary_name
        )


def _details(handover: NumberHandover) -> dict[str, object]:
    return {
        "day": handover.day.isoformat(),
        "from_member_id": str(handover.from_member_id),
        "to_member_id": str(handover.to_member_id),
        "until": handover.until.isoformat(),
    }
