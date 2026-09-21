"""Persistence model owned by the availability feature."""

import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from oncall.domain.clock import utc_now
from oncall.domain.vocabulary import AvailabilityKind
from oncall.infrastructure.sqlalchemy.base import Base

if TYPE_CHECKING:
    from oncall.infrastructure.sqlalchemy.access_models import User
    from oncall.infrastructure.sqlalchemy.team_models import TeamMember


class Availability(Base):
    __tablename__ = "availability"
    __table_args__ = (Index("ix_availability_member_dates", "member_id", "starts_on", "ends_on"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("team_members.id", ondelete="CASCADE"))
    kind: Mapped[AvailabilityKind] = mapped_column(Enum(AvailabilityKind, native_enum=False))
    starts_on: Mapped[date] = mapped_column(Date)
    ends_on: Mapped[date] = mapped_column(Date)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    member: Mapped[TeamMember] = relationship(back_populates="availability")
    created_by: Mapped[User | None] = relationship()


__all__ = ["Availability"]
