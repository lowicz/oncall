"""A clock that stands still until a test moves it.

The `frozen_clock` fixture installs one over `oncall.domain.clock.system_clock`,
so every `utc_now()` and `business_today()` in the application answers from
here and a test can put itself on any moment it likes, including the half hour
in which the Warsaw date is already tomorrow.
"""

from datetime import date, datetime, timedelta

from oncall.domain.clock import BUSINESS_TIMEZONE


class FrozenClock:
    def __init__(self, instant: datetime) -> None:
        self.instant = instant

    def utc_now(self) -> datetime:
        return self.instant

    def business_today(self) -> date:
        return self.instant.astimezone(BUSINESS_TIMEZONE).date()

    def advance(self, delta: timedelta) -> datetime:
        """Move time forward and return the new instant."""
        self.instant += delta
        return self.instant
