"""Persistence models owned by the team roster and role eligibility."""

import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    UniqueConstraint,
    column,
    func,
)
from sqlalchemy.dialects.postgresql import ExcludeConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from oncall.domain.clock import utc_now
from oncall.domain.vocabulary import AssignmentRole
from oncall.infrastructure.sqlalchemy.base import Base, polish_text

if TYPE_CHECKING:
    from oncall.infrastructure.sqlalchemy.access_models import User
    from oncall.infrastructure.sqlalchemy.availability_model import Availability


class TeamMember(Base):
    __tablename__ = "team_members"
    __table_args__ = (
        CheckConstraint(
            "active_until IS NULL OR active_from <= active_until", name="ck_team_members_range"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), unique=True, nullable=True
    )
    display_name: Mapped[str] = mapped_column(polish_text(160), index=True)
    active_from: Mapped[date] = mapped_column(Date)
    active_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, server_default=func.now()
    )

    user: Mapped[User | None] = relationship(back_populates="team_member")
    eligibility: Mapped[list[Eligibility]] = relationship(
        back_populates="member", cascade="all, delete-orphan"
    )
    availability: Mapped[list[Availability]] = relationship(
        back_populates="member", cascade="all, delete-orphan"
    )


class Eligibility(Base):
    __tablename__ = "eligibility"
    __table_args__ = (
        UniqueConstraint("member_id", "role", "starts_on", name="uq_eligibility_period"),
        CheckConstraint("ends_on IS NULL OR starts_on <= ends_on", name="ck_eligibility_range"),
        # A person's periods for one role never overlap; an open end runs for
        # ever. PostgreSQL only; the use case holds the rule everywhere.
        ExcludeConstraint(
            ("member_id", "="),
            ("role", "="),
            (func.daterange(column("starts_on"), column("ends_on"), "[]"), "&&"),
            name="ex_eligibility_no_overlap",
            using="gist",
        ).ddl_if(dialect="postgresql"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    #: No index of its own: uq_eligibility_period leads with it.
    member_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("team_members.id", ondelete="CASCADE"))
    role: Mapped[AssignmentRole] = mapped_column(
        Enum(AssignmentRole, native_enum=False, create_constraint=True, name="ck_eligibility_role")
    )
    starts_on: Mapped[date] = mapped_column(Date)
    ends_on: Mapped[date | None] = mapped_column(Date, nullable=True)

    member: Mapped[TeamMember] = relationship(back_populates="eligibility")
