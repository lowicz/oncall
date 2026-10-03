"""Persistence model owned by the availability feature."""

import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    String,
    column,
    func,
)
from sqlalchemy.dialects.postgresql import ExcludeConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from oncall.domain.clock import utc_now
from oncall.domain.vocabulary import AvailabilityKind
from oncall.infrastructure.sqlalchemy.base import Base

if TYPE_CHECKING:
    from oncall.infrastructure.sqlalchemy.access_models import User
    from oncall.infrastructure.sqlalchemy.team_models import TeamMember


class Availability(Base):
    __tablename__ = "availability"
    __table_args__ = (
        Index("ix_availability_member_dates", "member_id", "starts_on", "ends_on"),
        CheckConstraint("starts_on <= ends_on", name="ck_availability_range"),
        # A person's entries never overlap, whatever their kind. PostgreSQL
        # only; the use case holds the rule everywhere.
        ExcludeConstraint(
            ("member_id", "="),
            (func.daterange(column("starts_on"), column("ends_on"), "[]"), "&&"),
            name="ex_availability_no_overlap",
            using="gist",
        ).ddl_if(dialect="postgresql"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("team_members.id", ondelete="CASCADE"))
    kind: Mapped[AvailabilityKind] = mapped_column(
        Enum(
            AvailabilityKind, native_enum=False, create_constraint=True, name="ck_availability_kind"
        )
    )
    starts_on: Mapped[date] = mapped_column(Date)
    ends_on: Mapped[date] = mapped_column(Date)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, server_default=func.now()
    )
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL", name="fk_availability_created_by_user"),
        nullable=True,
    )

    member: Mapped[TeamMember] = relationship(back_populates="availability")
    created_by: Mapped[User | None] = relationship()
