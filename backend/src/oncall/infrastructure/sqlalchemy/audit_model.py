"""Persistence model owned by the audit trail."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from oncall.domain.clock import utc_now
from oncall.infrastructure.sqlalchemy.base import Base


class AuditEvent(Base):
    __tablename__ = "audit_events"
    __table_args__ = (
        Index("ix_audit_events_occurred", "occurred_at"),
        Index("ix_audit_events_action", "action"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    actor_label: Mapped[str] = mapped_column(String(160))
    action: Mapped[str] = mapped_column(String(60))
    entity_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    entity_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    summary: Mapped[str] = mapped_column(String(300))
    details: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)


__all__ = ["AuditEvent"]
