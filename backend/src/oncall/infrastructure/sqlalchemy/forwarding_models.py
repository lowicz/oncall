"""Persistence models owned by forwarding the on-call number through WCO."""

import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column

from oncall.domain.clock import utc_now
from oncall.domain.forwarding.models import DEFAULT_BASE_URL, ForwardingMode, ForwardingOutcome
from oncall.infrastructure.sqlalchemy.base import Base


class CallForwardingSettings(Base):
    """The WCO account the forwarding pass logs in with. One row, edited by
    an administrator; the passwords are Fernet tokens (`oncall.secrets`)."""

    __tablename__ = "call_forwarding_settings"
    __table_args__ = (
        CheckConstraint("singleton", name="ck_call_forwarding_settings_singleton"),
        UniqueConstraint("singleton", name="uq_call_forwarding_settings_singleton"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    #: Always true and unique, so the table holds one row.
    singleton: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    mode: Mapped[ForwardingMode] = mapped_column(
        Enum(
            ForwardingMode,
            native_enum=False,
            create_constraint=True,
            name="ck_call_forwarding_settings_mode",
        ),
        default=ForwardingMode.off,
        server_default=ForwardingMode.off.value,
    )
    base_url: Mapped[str] = mapped_column(
        String(200), default=DEFAULT_BASE_URL, server_default=DEFAULT_BASE_URL
    )
    vpbx_number: Mapped[str | None] = mapped_column(String(20))
    username: Mapped[str | None] = mapped_column(String(120))
    wco_user_id: Mapped[str | None] = mapped_column(String(40))
    password_ciphertext: Mapped[str | None] = mapped_column(Text)
    #: Set by an administrator's new password and by every rotation.
    password_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    #: A generated password stored before WCO is asked to take it, so that
    #: neither the old nor the new one is ever written down nowhere
    #: (`oncall.domain.forwarding.passwords`).
    pending_password_ciphertext: Mapped[str | None] = mapped_column(Text)
    pending_since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    #: Set when WCO refused every stored password; while set the pass does
    #: not log in, and an administrator's new password clears it.
    credentials_invalid_since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    #: The last time an administrator saved the settings; rotations leave it.
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, server_default=func.now()
    )


class CallForwardingState(Base):
    """Where forwarding stands. One row, written by the forwarding pass and
    read by the administration screen; audit entries expire, so everything
    the screen shows is kept here."""

    __tablename__ = "call_forwarding_state"
    __table_args__ = (
        CheckConstraint("singleton", name="ck_call_forwarding_state_singleton"),
        UniqueConstraint("singleton", name="uq_call_forwarding_state_singleton"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    singleton: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    #: The last number WCO confirmed it forwards to, read back after the update.
    applied_number: Mapped[str | None] = mapped_column(String(32))
    applied_member_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("team_members.id", ondelete="SET NULL")
    )
    applied_member_name: Mapped[str | None] = mapped_column(String(160))
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    #: What the last pass wanted, for which duty day.
    desired_number: Mapped[str | None] = mapped_column(String(32))
    desired_member_name: Mapped[str | None] = mapped_column(String(160))
    desired_for_day: Mapped[date | None] = mapped_column(Date)
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_outcome: Mapped[ForwardingOutcome | None] = mapped_column(
        Enum(
            ForwardingOutcome,
            native_enum=False,
            create_constraint=True,
            name="ck_call_forwarding_state_last_outcome",
        )
    )
    last_error: Mapped[str | None] = mapped_column(String(500))
    #: Backoff after a failure: since when it fails, how often it was tried,
    #: and when the next pass may try again.
    failing_since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    #: The worker's claim on the pass, like the outbox lease.
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    #: The dedup key of the last failure alert, which a recovery mail answers.
    alerted_for: Mapped[str | None] = mapped_column(String(160))
