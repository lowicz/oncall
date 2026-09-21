"""Persistence models owned by scheduling: schedules, duties, runs and policy."""

import uuid
from datetime import date, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from oncall.domain.clock import utc_now
from oncall.domain.vocabulary import AssignmentRole, LateShiftAnchor, RotationMode, ScheduleStatus
from oncall.infrastructure.sqlalchemy.base import Base


class Schedule(Base):
    __tablename__ = "schedules"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(160))
    starts_on: Mapped[date] = mapped_column(Date)
    ends_on: Mapped[date] = mapped_column(Date)
    status: Mapped[ScheduleStatus] = mapped_column(Enum(ScheduleStatus, native_enum=False))
    version: Mapped[int] = mapped_column(default=1)
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=True
    )
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rotation_mode: Mapped[RotationMode | None] = mapped_column(
        Enum(RotationMode, native_enum=False), nullable=True
    )
    solver_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    #: Lowest achievable lens spread when the solver proved the acceptance
    #: criterion unattainable for this roster (decision D2); None when the
    #: criterion holds by construction. Surfaced in the draft impact preview
    #: so the coordinator can tell inherited imbalance from generation quality.
    acceptance_floor: Mapped[int | None] = mapped_column(nullable=True)
    fairness_proven: Mapped[bool] = mapped_column(default=False)
    continuity_gap: Mapped[float | None] = mapped_column(Float, nullable=True)
    #: What the solver had to give up to produce this schedule, in its own
    #: words. Kept with the schedule, not only in the run record and the audit
    #: log, so the generator screen can show it every time the draft is opened.
    solver_warnings: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)

    assignments: Mapped[list[Assignment]] = relationship(
        back_populates="schedule", cascade="all, delete-orphan"
    )


class ScheduleRun(Base):
    __tablename__ = "schedule_runs"
    __table_args__ = (
        # At most one queued or running run per range, from migration 0028.
        # The predicate is PostgreSQL SQL, so the index exists on PostgreSQL
        # only; SQLite test databases rely on the route's check-then-insert
        # guard.
        Index(
            "uq_schedule_run_active_range",
            "starts_on",
            "ends_on",
            unique=True,
            postgresql_where=text("status IN ('queued', 'running')"),
        ).ddl_if(dialect="postgresql"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    starts_on: Mapped[date] = mapped_column(Date)
    ends_on: Mapped[date] = mapped_column(Date)
    requested_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(20), default="queued", index=True)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    schedule_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("schedules.id", ondelete="SET NULL"), nullable=True
    )
    error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    conflicts: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )


class Assignment(Base):
    __tablename__ = "assignments"
    __table_args__ = (
        UniqueConstraint("schedule_id", "service_date", "role", name="uq_assignment_slot"),
        Index("ix_assignment_published_lookup", "service_date", "role"),
        Index("ix_assignment_member", "member_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    schedule_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("schedules.id", ondelete="CASCADE"))
    service_date: Mapped[date] = mapped_column(Date)
    role: Mapped[AssignmentRole] = mapped_column(Enum(AssignmentRole, native_enum=False))
    #: The identity of the person on duty. Nullable because imported history can
    #: name somebody who was never a team member; `assignee_name` stays as the
    #: label and is the fallback for those rows.
    member_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("team_members.id", ondelete="SET NULL"), nullable=True
    )
    assignee_name: Mapped[str] = mapped_column(String(160))
    is_override: Mapped[bool] = mapped_column(Boolean, default=False)

    schedule: Mapped[Schedule] = relationship(back_populates="assignments")


#: Default solver budget, in seconds. Measured, not guessed: with the fairness
#: window and the 11-19 tie-break as they now stand, the graded lens spread is
#: 3.0 at every budget from 5 s to 90 s, and 15 s is the smallest budget at which
#: the hard branch - the one that has to prove the criterion unattainable and
#: find the floor - reaches OPTIMAL instead of stopping at FEASIBLE. The runs
#: behind those numbers are archive/docs/qa-suite-5/budget-z14*.jsonl; re-measure there
#: before changing this.
DEFAULT_SOLVE_SECONDS = 15.0


class SchedulingPolicy(Base):
    __tablename__ = "scheduling_policies"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    rotation_mode: Mapped[RotationMode] = mapped_column(
        Enum(RotationMode, native_enum=False), default=RotationMode.hybrid
    )
    fairness_weight: Mapped[float] = mapped_column(Float, default=3.0)
    continuity_weight: Mapped[float] = mapped_column(Float, default=1.0)
    preference_weight: Mapped[float] = mapped_column(Float, default=2.0)
    late_shift_anchor: Mapped[LateShiftAnchor] = mapped_column(
        Enum(LateShiftAnchor, native_enum=False, length=12), default=LateShiftAnchor.secondary
    )
    #: Solver time budget per generation, in seconds. Kept with the policy
    #: rather than in the environment because the UNKNOWN message already
    #: tells the coordinator to raise it „w ustawieniach generowania".
    #: Must equal `scheduler.SOLVE_SECONDS`; a test holds the two together.
    solve_seconds: Mapped[float] = mapped_column(Float, default=DEFAULT_SOLVE_SECONDS)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )


__all__ = [
    "DEFAULT_SOLVE_SECONDS",
    "Assignment",
    "Schedule",
    "ScheduleRun",
    "SchedulingPolicy",
]
