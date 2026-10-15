"""Persistence ports for forwarding settings and the worker's attempts."""

import uuid
from dataclasses import replace
from datetime import datetime, timedelta
from typing import Any, cast

from sqlalchemy import CursorResult, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.audit import record_audit
from oncall.domain.clock import as_utc, utc_now
from oncall.domain.forwarding.job import (
    ForwardingAccount,
    ForwardingAttempt,
    ForwardingFailure,
    ForwardingTarget,
    RecordedForwarding,
)
from oncall.domain.forwarding.models import (
    ForwardingMode,
    ForwardingOutcome,
    ForwardingSettings,
    ForwardingState,
    SettingsChange,
)
from oncall.domain.forwarding.passwords import Passwords
from oncall.domain.forwarding.ports import PasswordCipher
from oncall.infrastructure.sqlalchemy.access_models import User
from oncall.infrastructure.sqlalchemy.base import load_singleton
from oncall.infrastructure.sqlalchemy.forwarding_models import (
    CallForwardingSettings,
    CallForwardingState,
)
from oncall.infrastructure.sqlalchemy.team_models import TeamMember
from oncall.notifications.service import retry_delay
from oncall.notifications.triggers import (
    enqueue_forwarding_alert,
    enqueue_forwarding_recovered,
)

PERMANENT_BACKOFF = timedelta(hours=1)
TRANSIENT_ALERT_AFTER = timedelta(minutes=10)

_FAILURE_SUMMARY = {
    ForwardingFailure.connection: "Nie udało się połączyć z WCO",
    ForwardingFailure.login_refused: "WCO odrzuciło dane logowania",
    ForwardingFailure.password_rotation_failed: "Nie udało się zmienić hasła WCO",
    ForwardingFailure.update_refused: "WCO odrzuciło zmianę numeru",
    ForwardingFailure.settings_invalid: "Konfiguracja WCO jest niekompletna",
    ForwardingFailure.no_primary: "Brak osoby na dyżurze PRIMARY",
    ForwardingFailure.no_phone: "Osoba na dyżurze PRIMARY nie ma numeru telefonu",
}


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

    async def change(
        self, change: SettingsChange, password_token: str | None
    ) -> ForwardingSettings:
        row = await load_singleton(self._session, CallForwardingSettings)
        now = utc_now()
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
        current_token = row.password_ciphertext
        assert current_token is not None
        pending = (
            cipher.decrypt(row.pending_password_ciphertext)
            if row.pending_password_ciphertext is not None
            else None
        )
        return ForwardingAccount(
            settings_id=row.id,
            mode=row.mode,
            base_url=row.base_url,
            vpbx_number=row.vpbx_number or "",
            username=row.username or "",
            wco_user_id=row.wco_user_id or "",
            passwords=Passwords(cipher.decrypt(current_token), pending),
            credentials_invalid_since=row.credentials_invalid_since,
        )

    async def phone(self, member_id: uuid.UUID) -> str | None:
        return await self._session.scalar(
            select(User.phone)
            .join(TeamMember, TeamMember.user_id == User.id)
            .where(TeamMember.id == member_id)
        )

    async def stage_pending(
        self, account: ForwardingAccount, password: str, cipher: PasswordCipher, *, now: datetime
    ) -> ForwardingAccount:
        row = await self._session.get(CallForwardingSettings, account.settings_id)
        if row is None:
            raise RuntimeError("the WCO settings disappeared during password rotation")
        row.pending_password_ciphertext = cipher.encrypt(password)
        row.pending_since = now
        return replace(account, passwords=Passwords(account.passwords.current, password))

    async def promote_pending(
        self, account: ForwardingAccount, *, now: datetime
    ) -> ForwardingAccount:
        row = await self._session.get(CallForwardingSettings, account.settings_id)
        if row is None or row.pending_password_ciphertext is None:
            raise RuntimeError("the pending WCO password disappeared before promotion")
        row.password_ciphertext = row.pending_password_ciphertext
        row.password_changed_at = now
        row.pending_password_ciphertext = None
        row.pending_since = None
        row.credentials_invalid_since = None
        record_audit(
            self._session,
            actor=None,
            action="forwarding.password_rotated",
            entity_type="call_forwarding_settings",
            entity_id=row.id,
            summary="Hasło WCO zostało zmienione automatycznie",
        )
        return replace(account, passwords=account.passwords.promoted())


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
        if row.next_attempt_at is not None and as_utc(row.next_attempt_at) > as_utc(now):
            return None
        same_desired = self._same_desired(row, target)
        if account.mode is ForwardingMode.dry_run:
            if same_desired and row.last_outcome is ForwardingOutcome.dry_run:
                return None
        elif (
            target.number == row.applied_number
            and row.alerted_for is None
            and row.last_outcome
            not in (
                ForwardingOutcome.failed,
                ForwardingOutcome.skipped_no_primary,
                ForwardingOutcome.skipped_no_phone,
            )
        ):
            return None
        claimed = await self._session.execute(
            update(CallForwardingState)
            .where(
                CallForwardingState.id == row.id,
                or_(
                    CallForwardingState.lease_until.is_(None),
                    CallForwardingState.lease_until <= now,
                ),
                or_(
                    CallForwardingState.next_attempt_at.is_(None),
                    CallForwardingState.next_attempt_at <= now,
                ),
            )
            .values(lease_until=lease_until)
            .execution_options(synchronize_session=False)
        )
        if cast(CursorResult[Any], claimed).rowcount != 1:
            return None
        return ForwardingAttempt(account, target, lease_until, row.attempts)

    async def record_skipped(
        self, target: ForwardingTarget, cause: ForwardingFailure, *, now: datetime
    ) -> RecordedForwarding | None:
        row = await load_singleton(self._session, CallForwardingState)
        outcome = (
            ForwardingOutcome.skipped_no_primary
            if cause is ForwardingFailure.no_primary
            else ForwardingOutcome.skipped_no_phone
        )
        if self._same_desired(row, target) and row.last_outcome is outcome:
            return None
        self._start_episode(row, target, now=now)
        row.last_outcome = outcome
        row.last_error = _FAILURE_SUMMARY[cause]
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
    ) -> RecordedForwarding | None:
        row = await self._owned(attempt)
        if row is None:
            return None
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
    ) -> RecordedForwarding | None:
        row = await self._owned(attempt)
        if row is None:
            return None
        alerted_for = row.alerted_for
        self._desired(row, attempt.target)
        row.applied_number = current_number
        row.applied_member_id = (
            attempt.target.member_id if current_number == attempt.target.number else None
        )
        row.applied_member_name = (
            attempt.target.member_name if current_number == attempt.target.number else None
        )
        row.applied_at = now
        row.last_attempt_at = now
        row.last_outcome = outcome
        row.last_error = None
        row.failing_since = None
        row.attempts = 0
        row.next_attempt_at = None
        row.lease_until = None
        row.alerted_for = None
        if outcome is ForwardingOutcome.applied:
            record_audit(
                self._session,
                actor=None,
                action="forwarding.applied",
                entity_type="call_forwarding_state",
                entity_id=row.id,
                summary=f"Numer on-call przełączono na {attempt.target.member_name}",
                details={
                    "day": attempt.target.day.isoformat(),
                    "member_id": str(attempt.target.member_id),
                    "number": attempt.target.number,
                },
            )
        if alerted_for is not None:
            await enqueue_forwarding_recovered(
                self._session, attempt.target, alerted_for=alerted_for
            )
        return RecordedForwarding(outcome, 0, rotated)

    async def record_dry_run(
        self,
        attempt: ForwardingAttempt,
        current_number: str,
        *,
        rotated: bool,
        now: datetime,
    ) -> RecordedForwarding | None:
        row = await self._owned(attempt)
        if row is None:
            return None
        self._desired(row, attempt.target)
        row.applied_number = current_number
        row.applied_member_id = (
            attempt.target.member_id if current_number == attempt.target.number else None
        )
        row.applied_member_name = (
            attempt.target.member_name if current_number == attempt.target.number else None
        )
        row.applied_at = now
        row.last_attempt_at = now
        row.last_outcome = ForwardingOutcome.dry_run
        row.last_error = None
        row.failing_since = None
        row.attempts = 0
        row.next_attempt_at = None
        row.lease_until = None
        record_audit(
            self._session,
            actor=None,
            action="forwarding.test",
            entity_type="call_forwarding_state",
            entity_id=row.id,
            summary=f"Próba przełączenia numeru na {attempt.target.member_name}",
            details={
                "day": attempt.target.day.isoformat(),
                "desired_number": attempt.target.number,
                "current_number": current_number,
            },
        )
        return RecordedForwarding(ForwardingOutcome.dry_run, 0, rotated)

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
        same_episode = self._same_desired(row, target) and row.last_outcome in (
            ForwardingOutcome.failed,
            ForwardingOutcome.skipped_no_primary,
            ForwardingOutcome.skipped_no_phone,
        )
        if not same_episode:
            self._start_episode(row, target, now=now)
        attempts = row.attempts + 1 if same_episode else 1
        self._desired(row, target)
        row.last_attempt_at = now
        row.last_outcome = ForwardingOutcome.failed
        row.last_error = detail[:500]
        row.attempts = attempts
        row.next_attempt_at = (
            None
            if invalidate_credentials
            else now + (PERMANENT_BACKOFF if permanent else retry_delay(attempts))
        )
        row.lease_until = None
        if invalidate_credentials:
            settings = await load_singleton(self._session, CallForwardingSettings)
            settings.credentials_invalid_since = settings.credentials_invalid_since or now
        await self._alert(row, target, cause, now=now, immediate=permanent)
        self._audit_failure(row, target, cause, action="forwarding.failed")
        return RecordedForwarding(ForwardingOutcome.failed, attempts)

    async def _owned(self, attempt: ForwardingAttempt) -> CallForwardingState | None:
        row = await load_singleton(self._session, CallForwardingState)
        if row.lease_until is None or as_utc(row.lease_until) != as_utc(attempt.lease_until):
            return None
        return row

    async def _alert(
        self,
        row: CallForwardingState,
        target: ForwardingTarget,
        cause: ForwardingFailure,
        *,
        now: datetime,
        immediate: bool,
    ) -> None:
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
            summary=f"Przełączanie numeru: {_FAILURE_SUMMARY[cause]}",
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
            and row.desired_member_name == target.member_name
            and row.desired_number == target.number
        )

    @staticmethod
    def _desired(row: CallForwardingState, target: ForwardingTarget) -> None:
        row.desired_for_day = target.day
        row.desired_member_name = target.member_name
        row.desired_number = target.number

    def _start_episode(
        self, row: CallForwardingState, target: ForwardingTarget, *, now: datetime
    ) -> None:
        self._desired(row, target)
        row.failing_since = now
        row.attempts = 0
        row.alerted_for = None
