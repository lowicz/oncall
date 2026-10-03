"""Persistence model owned by the calendar-event feature."""

import uuid
from datetime import date, datetime

from sqlalchemy import CheckConstraint, Date, DateTime, Enum, ForeignKey, Index, func
from sqlalchemy.orm import Mapped, mapped_column

from oncall.domain.clock import utc_now
from oncall.domain.vocabulary import CalendarEventColor
from oncall.infrastructure.sqlalchemy.base import Base, polish_text


class CalendarEvent(Base):
    __tablename__ = "calendar_events"
    __table_args__ = (
        Index("ix_calendar_events_starts_on", "starts_on"),
        Index("ix_calendar_events_ends_on", "ends_on"),
        CheckConstraint("starts_on <= ends_on", name="ck_calendar_events_range"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    starts_on: Mapped[date] = mapped_column(Date)
    ends_on: Mapped[date] = mapped_column(Date)
    title: Mapped[str] = mapped_column(polish_text(160))
    color: Mapped[CalendarEventColor] = mapped_column(
        Enum(
            CalendarEventColor,
            native_enum=False,
            length=12,
            create_constraint=True,
            name="ck_calendar_events_color",
        )
    )
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, server_default=func.now()
    )
