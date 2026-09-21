"""Persistence models owned by viewer sharing and calendar feeds."""

import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Date, DateTime, Enum, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from oncall.domain.clock import utc_now
from oncall.domain.vocabulary import FeedTokenKind
from oncall.infrastructure.sqlalchemy.base import Base

if TYPE_CHECKING:
    from oncall.infrastructure.sqlalchemy.access_models import User


class ShareLink(Base):
    __tablename__ = "share_links"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    label: Mapped[str] = mapped_column(String(160))
    starts_on: Mapped[date] = mapped_column(Date)
    ends_on: Mapped[date] = mapped_column(Date)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_by: Mapped[User] = relationship()


class CalendarFeedToken(Base):
    __tablename__ = "calendar_feed_tokens"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    kind: Mapped[FeedTokenKind] = mapped_column(Enum(FeedTokenKind, native_enum=False))
    label: Mapped[str] = mapped_column(String(160))
    member_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("team_members.id", ondelete="CASCADE"), nullable=True
    )
    share_link_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("share_links.id", ondelete="CASCADE"), nullable=True
    )
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


__all__ = ["CalendarFeedToken", "ShareLink"]
