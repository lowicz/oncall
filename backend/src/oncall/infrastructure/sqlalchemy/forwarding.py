"""The forwarding settings and state rows, and the audit of a settings change."""

from sqlalchemy.ext.asyncio import AsyncSession

from oncall.audit import record_audit
from oncall.domain.clock import utc_now
from oncall.domain.forwarding.models import ForwardingSettings, ForwardingState, SettingsChange
from oncall.infrastructure.sqlalchemy.access_models import User
from oncall.infrastructure.sqlalchemy.base import load_singleton
from oncall.infrastructure.sqlalchemy.forwarding_models import (
    CallForwardingSettings,
    CallForwardingState,
)


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

    async def settings_updated(
        self, settings: ForwardingSettings, *, password_changed: bool
    ) -> None:
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
