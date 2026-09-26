"""Persistence model and vocabulary owned by the notification outbox."""

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import JSON, DateTime, Enum, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from oncall.domain.clock import utc_now
from oncall.infrastructure.sqlalchemy.base import Base


class NotificationChannel(StrEnum):
    email = "email"
    # Reserved for future providers such as MS Teams.


class NotificationStatus(StrEnum):
    """Where an outbox row stands. Stored as text with no check constraint, and
    exposed through no endpoint, so the set is ours to extend."""

    pending = "pending"
    """Enqueued with the business change that caused it. Nobody has it."""

    claimed = "claimed"
    """A worker is delivering it. `next_attempt_at` holds the lease: once that
    moment passes the row is eligible again, whether or not the worker that
    took it is still alive."""

    sent = "sent"
    """Handed to the provider without an error. Delivery is at-least-once, so
    this row may have been delivered more than once."""

    failed = "failed"
    """Permanently undeliverable, or out of attempts. `last_error` says why."""

    skipped = "skipped"
    """The channel is switched off. Kept eligible on a daily rhythm so the
    message goes out once the channel is configured, with no manual repair."""


class NotificationOutbox(Base):
    __tablename__ = "notification_outbox"
    __table_args__ = (
        Index("ix_notification_outbox_pending", "status", "next_attempt_at"),
        # Retention deletes the oldest finished rows first, by creation time;
        # without this the worker would sort the whole table for every batch.
        Index("ix_notification_outbox_created", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    channel: Mapped[NotificationChannel] = mapped_column(
        Enum(NotificationChannel, native_enum=False)
    )
    recipient: Mapped[str] = mapped_column(String(320))
    subject: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text)
    html_body: Mapped[str | None] = mapped_column(Text, nullable=True)
    context: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    status: Mapped[NotificationStatus] = mapped_column(
        Enum(NotificationStatus, native_enum=False), default=NotificationStatus.pending
    )
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    last_error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    dedup_key: Mapped[str | None] = mapped_column(String(160), unique=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


__all__ = ["NotificationChannel", "NotificationOutbox", "NotificationStatus"]
