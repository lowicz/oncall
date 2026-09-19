"""Persistence models owned by the duty-swap feature."""

import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from oncall.domain.clock import utc_now
from oncall.domain.vocabulary import AssignmentRole, SwapStatus
from oncall.infrastructure.sqlalchemy.base import Base


class SwapRequest(Base):
    __tablename__ = "swap_requests"
    __table_args__ = (
        Index("ix_swap_requests_status", "status"),
        Index("ix_swap_requests_slot", "schedule_id", "service_date", "role"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    schedule_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schedules.id", ondelete="CASCADE"))
    service_date: Mapped[date] = mapped_column(Date)
    role: Mapped[AssignmentRole] = mapped_column(Enum(AssignmentRole, native_enum=False))
    requester_member_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("team_members.id", ondelete="CASCADE")
    )
    replacement_member_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("team_members.id", ondelete="CASCADE")
    )
    status: Mapped[SwapStatus] = mapped_column(Enum(SwapStatus, native_enum=False))
    schedule_version: Mapped[int] = mapped_column()
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    decision_note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )
    slots: Mapped[list[SwapRequestSlot]] = relationship(
        back_populates="swap_request",
        cascade="all, delete-orphan",
        order_by="SwapRequestSlot.role",
    )


class SwapRequestSlot(Base):
    __tablename__ = "swap_request_slots"
    __table_args__ = (
        UniqueConstraint("swap_request_id", "service_date", "role", name="uq_swap_request_slot"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    swap_request_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("swap_requests.id", ondelete="CASCADE"), index=True
    )
    service_date: Mapped[date] = mapped_column(Date)
    role: Mapped[AssignmentRole] = mapped_column(Enum(AssignmentRole, native_enum=False))
    swap_request: Mapped[SwapRequest] = relationship(back_populates="slots")


__all__ = ["SwapRequest", "SwapRequestSlot"]
