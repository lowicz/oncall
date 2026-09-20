import uuid
from datetime import UTC, date, datetime
from enum import StrEnum

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    column,
    or_,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship, validates

# The rotation vocabulary is declared framework-free in the domain and
# re-exported here, so `from oncall.models import AssignmentRole` keeps working.
from oncall.domain.vocabulary import (
    AccountTokenKind,
    AssignmentRole,
    AuthSource,
    LateShiftAnchor,
    RotationMode,
    ScheduleStatus,
    UserRole,
)
from oncall.domain.vocabulary import AvailabilityKind as AvailabilityKind
from oncall.domain.vocabulary import SwapStatus as SwapStatus
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


def utc_now() -> datetime:
    return datetime.now(UTC)


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("personnel_number", name="uq_user_personnel_number"),
        CheckConstraint(
            or_(
                column("personnel_number").is_(None),
                column("personnel_number").regexp_match(r"^[0-9]+$"),
            ),
            name="ck_user_personnel_number_digits",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    personnel_number: Mapped[str | None] = mapped_column(String(32), nullable=True)
    first_name: Mapped[str] = mapped_column(String(120))
    last_name: Mapped[str] = mapped_column(String(120), default="")
    auth_source: Mapped[AuthSource] = mapped_column(
        Enum(AuthSource, native_enum=False, length=16), default=AuthSource.local
    )
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole, native_enum=False))
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    #: Contact number for the "who is on call now" card (decision D8); optional,
    #: not shown in a share-link session.
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    team_member: Mapped[TeamMember | None] = relationship(back_populates="user")
    account_tokens: Mapped[list[AccountToken]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )

    @property
    def display_name(self) -> str:
        """Public label derived from the separately managed identity fields."""
        return " ".join(part for part in (self.first_name, self.last_name) if part)

    @display_name.setter
    def display_name(self, value: str) -> None:
        """Keep callers using the old constructor compatible while splitting names."""
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("Imię nie może być puste")
        self.first_name, separator, self.last_name = normalized.partition(" ")
        if not separator:
            self.last_name = ""

    @validates("personnel_number")
    def validate_personnel_number(self, _: str, value: str | None) -> str | None:
        if value is not None and (not value or not value.isascii() or not value.isdigit()):
            raise ValueError("Numer pracownika może zawierać wyłącznie cyfry")
        return value


class AccountToken(Base):
    __tablename__ = "account_tokens"
    __table_args__ = (Index("ix_account_tokens_user_kind", "user_id", "kind"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    kind: Mapped[AccountTokenKind] = mapped_column(
        Enum(AccountTokenKind, native_enum=False, length=20)
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    user: Mapped[User] = relationship(back_populates="account_tokens")


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    share_link_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("share_links.id", ondelete="CASCADE"), nullable=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    csrf_token: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    user: Mapped[User | None] = relationship()
    share_link: Mapped[ShareLink | None] = relationship()


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
    # A partial unique index on (starts_on, ends_on) WHERE status IN
    # ('queued', 'running') lives in migration 0028. It is Postgres-only (the
    # predicate is raw SQL), so it is not declared here and the route's
    # check-then-insert guard is what SQLite test databases rely on.


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


class TeamMember(Base):
    __tablename__ = "team_members"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), unique=True, nullable=True
    )
    display_name: Mapped[str] = mapped_column(String(160), index=True)
    active_from: Mapped[date] = mapped_column(Date)
    active_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

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
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    member_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("team_members.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[AssignmentRole] = mapped_column(Enum(AssignmentRole, native_enum=False))
    starts_on: Mapped[date] = mapped_column(Date)
    ends_on: Mapped[date | None] = mapped_column(Date, nullable=True)

    member: Mapped[TeamMember] = relationship(back_populates="eligibility")


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


class NotificationOutbox(Base):
    __tablename__ = "notification_outbox"
    __table_args__ = (Index("ix_notification_outbox_pending", "status", "next_attempt_at"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    channel: Mapped[NotificationChannel] = mapped_column(
        Enum(NotificationChannel, native_enum=False)
    )
    recipient: Mapped[str] = mapped_column(String(320))
    subject: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text)
    context: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    status: Mapped[NotificationStatus] = mapped_column(
        Enum(NotificationStatus, native_enum=False), default=NotificationStatus.pending
    )
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    last_error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    dedup_key: Mapped[str | None] = mapped_column(String(160), unique=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


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
    details: Mapped[dict | None] = mapped_column(JSON, nullable=True)


# Compatibility export while callers migrate to the feature-owned model.
from oncall.infrastructure.sqlalchemy.availability_model import (  # noqa: E402
    Availability as Availability,
)
from oncall.infrastructure.sqlalchemy.calendar_model import (  # noqa: E402
    CalendarEvent as CalendarEvent,
)
from oncall.infrastructure.sqlalchemy.sharing_models import (  # noqa: E402
    CalendarFeedToken as CalendarFeedToken,
)
from oncall.infrastructure.sqlalchemy.sharing_models import (  # noqa: E402
    ShareLink as ShareLink,
)
from oncall.infrastructure.sqlalchemy.swap_models import (  # noqa: E402
    SwapRequest as SwapRequest,
)
from oncall.infrastructure.sqlalchemy.swap_models import (  # noqa: E402
    SwapRequestSlot as SwapRequestSlot,
)
