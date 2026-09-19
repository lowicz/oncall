"""One explicit source of business dates and absolute instants."""

from datetime import UTC, date, datetime
from typing import Protocol
from zoneinfo import ZoneInfo

BUSINESS_TIMEZONE = ZoneInfo("Europe/Warsaw")


class Clock(Protocol):
    """Time needed by application use cases."""

    def utc_now(self) -> datetime: ...

    def business_today(self) -> date: ...


class SystemClock:
    def utc_now(self) -> datetime:
        return datetime.now(UTC)

    def business_today(self) -> date:
        return self.utc_now().astimezone(BUSINESS_TIMEZONE).date()


system_clock: Clock = SystemClock()


def utc_now() -> datetime:
    return system_clock.utc_now()


def business_today() -> date:
    return system_clock.business_today()


def as_utc(value: datetime) -> datetime:
    """SQLite returns naive datetimes; treat them as UTC."""
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value
