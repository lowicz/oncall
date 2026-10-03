"""Persistence models owned by the duty-swap feature."""

import uuid
from datetime import date, datetime

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from oncall.domain.clock import utc_now
from oncall.domain.vocabulary import AssignmentRole, SwapStatus
from oncall.infrastructure.sqlalchemy.base import Base


class SwapRequest(Base):
    __tablename__ = "swap_requests"
    __table_args__ = (
        Index("ix_swap_requests_status", "status"),
        Index("ix_swap_requests_slot", "schedule_id", "service_date", "role"),
        # A member's swaps, either side; also what removing a member checks.
        Index("ix_swap_requests_requester", "requester_member_id"),
        Index("ix_swap_requests_replacement", "replacement_member_id"),
        CheckConstraint(
            "requester_member_id <> replacement_member_id", name="ck_swap_requests_two_people"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    schedule_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schedules.id", ondelete="CASCADE"))
    service_date: Mapped[date] = mapped_column(Date)
    role: Mapped[AssignmentRole] = mapped_column(
        Enum(
            AssignmentRole, native_enum=False, create_constraint=True, name="ck_swap_requests_role"
        )
    )
    #: RESTRICT: a swap is part of the record of who was on duty, which
    #: outlives a membership. Offboarding ends a membership and
    #: pseudonymises it; nothing deletes a member with swaps.
    requester_member_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("team_members.id", ondelete="RESTRICT")
    )
    replacement_member_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("team_members.id", ondelete="RESTRICT")
    )
    status: Mapped[SwapStatus] = mapped_column(
        Enum(SwapStatus, native_enum=False, create_constraint=True, name="ck_swap_requests_status")
    )
    schedule_version: Mapped[int] = mapped_column()
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    decision_note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, server_default=func.now()
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
        # Whether a slot already has a swap in progress, asked of every new one.
        Index("ix_swap_request_slots_day_role", "service_date", "role"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    #: No index of its own: uq_swap_request_slot leads with it.
    swap_request_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("swap_requests.id", ondelete="CASCADE")
    )
    service_date: Mapped[date] = mapped_column(Date)
    #: Twenty characters wide, as migration 0027 created the column.
    role: Mapped[AssignmentRole] = mapped_column(
        Enum(
            AssignmentRole,
            native_enum=False,
            length=20,
            create_constraint=True,
            name="ck_swap_request_slots_role",
        )
    )
    swap_request: Mapped[SwapRequest] = relationship(back_populates="slots")
