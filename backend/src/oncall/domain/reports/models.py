import uuid
from dataclasses import dataclass, field
from datetime import date


@dataclass(frozen=True)
class RosterEntry:
    """A member as a report lists them."""

    id: uuid.UUID
    display_name: str


@dataclass
class DutyTally:
    """One person's duties in a month, split the way payroll reads them."""

    primary_workday: int = 0
    primary_weekend: int = 0
    primary_holiday: int = 0
    secondary_workday: int = 0
    secondary_weekend: int = 0
    secondary_holiday: int = 0
    late_shift: int = 0
    primary_points: float = 0.0
    secondary_points: float = 0.0

    @property
    def oncall_workdays(self) -> int:
        return self.primary_workday + self.secondary_workday

    @property
    def oncall_weekends(self) -> int:
        return self.primary_weekend + self.secondary_weekend

    @property
    def oncall_holidays(self) -> int:
        return self.primary_holiday + self.secondary_holiday

    @property
    def oncall_days_off(self) -> int:
        """Duty days on weekends and statutory holidays together (the 2X days)."""
        return self.oncall_weekends + self.oncall_holidays

    @property
    def oncall_total(self) -> int:
        """Every primary and secondary duty day; the 11-19 shift is not one."""
        return self.oncall_workdays + self.oncall_days_off

    @property
    def total_points(self) -> float:
        return self.primary_points + self.secondary_points


@dataclass(frozen=True)
class MonthlyRow:
    name: str
    tally: DutyTally


@dataclass(frozen=True)
class MonthlyReport:
    month: str
    starts_on: date
    ends_on: date
    #: Days on which both on-call roles are held.
    staffed_days: int
    rows: list[MonthlyRow] = field(default_factory=list)

    @property
    def days_in_month(self) -> int:
        return (self.ends_on - self.starts_on).days + 1
