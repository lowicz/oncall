import uuid
from dataclasses import dataclass
from datetime import date, datetime

from oncall.domain.roster import Duty
from oncall.domain.team import Actor, RolePeriod
from oncall.domain.vocabulary import (
    AvailabilityKind,
    CalendarEventColor,
    ScheduleStatus,
    UserRole,
)

WEEKDAYS = ("pon", "wt", "śr", "czw", "pt", "sob", "niedz")
#: The longest range one calendar or events request may read.
MAX_RANGE_DAYS = 90
#: How far ahead the dashboard reads the published schedule.
DASHBOARD_HORIZON_DAYS = 90


@dataclass(frozen=True)
class Audience:
    """Whoever reads the calendar: a signed-in account, or a share link
    limited to its own date range."""

    role: UserRole
    account_id: uuid.UUID | None = None
    share_range: tuple[date, date] | None = None

    @property
    def coordinates(self) -> bool:
        return self.role in (UserRole.coordinator, UserRole.admin)

    @property
    def sees_contacts(self) -> bool:
        """Contact details stay inside the team: a viewer or a share link gets
        names and times only."""
        return (
            self.share_range is None
            and self.account_id is not None
            and (self.role != UserRole.viewer)
        )


@dataclass(frozen=True)
class CalendarEvent:
    id: uuid.UUID
    starts_on: date
    ends_on: date
    title: str
    color: CalendarEventColor
    created_at: datetime


@dataclass(frozen=True)
class NewCalendarEvent:
    actor: Actor
    starts_on: date
    ends_on: date
    title: str
    color: CalendarEventColor


@dataclass(frozen=True)
class CalendarEventChange:
    actor: Actor
    event_id: uuid.UUID
    #: Only the fields sent with a value; an explicit null leaves a field as is.
    changes: dict


@dataclass(frozen=True)
class AvailabilityNote:
    kind: AvailabilityKind
    starts_on: date
    ends_on: date
    note: str | None


@dataclass(frozen=True)
class CalendarMember:
    id: uuid.UUID
    display_name: str
    user_id: uuid.UUID | None
    active_from: date
    active_until: date | None
    eligibility: tuple[RolePeriod, ...]
    availability: tuple[AvailabilityNote, ...]


@dataclass(frozen=True)
class CalendarDay:
    service_date: date
    weekday: str
    is_day_off: bool
    holiday_name: str | None
    published: bool
    events: list[CalendarEvent]


@dataclass(frozen=True)
class CalendarDuty:
    duty: Duty
    #: "swap" for an approved swap, "manual_override" for any other override.
    change_kind: str | None


@dataclass(frozen=True)
class MemberAvailability:
    member_id: uuid.UUID
    entry: AvailabilityNote


@dataclass(frozen=True)
class CalendarMatrix:
    starts_on: date
    ends_on: date
    days: list[CalendarDay]
    members: list[CalendarMember]
    #: Eligibility is shown to coordinators only.
    shows_eligibility: bool
    duties: list[CalendarDuty]
    availability: list[MemberAvailability]


@dataclass(frozen=True)
class Contact:
    member_id: uuid.UUID
    display_name: str
    email: str | None
    phone: str | None


@dataclass(frozen=True)
class CurrentDuty:
    duty: Duty
    member_id: uuid.UUID | None
    contact_email: str | None
    contact_phone: str | None
    coverage_starts_at: str
    coverage_ends_at: str
    is_day_off: bool
    next_assignee_name: str | None
    next_service_date: date | None


@dataclass(frozen=True)
class Dashboard:
    duties: list[Duty]
    current: list[CurrentDuty]
    today_is_day_off: bool
    today_holiday_name: str | None

    @property
    def is_published(self) -> bool:
        """True when a visible day comes from a real publication, not only
        from imported history (MED5-01)."""
        return any(duty.schedule_status == ScheduleStatus.published for duty in self.duties)
