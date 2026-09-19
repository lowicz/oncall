from dataclasses import dataclass
from datetime import UTC, date, datetime

from oncall.domain import clock


@dataclass(frozen=True)
class FrozenClock:
    instant: datetime

    def utc_now(self) -> datetime:
        return self.instant

    def business_today(self) -> date:
        return self.instant.astimezone(clock.BUSINESS_TIMEZONE).date()


def test_warsaw_business_day_can_lead_utc(monkeypatch) -> None:
    frozen = FrozenClock(datetime(2026, 9, 15, 22, 30, tzinfo=UTC))
    monkeypatch.setattr(clock, "system_clock", frozen)

    assert clock.utc_now() == datetime(2026, 9, 15, 22, 30, tzinfo=UTC)
    assert clock.business_today() == date(2026, 9, 16)


def test_naive_database_timestamp_is_interpreted_as_utc() -> None:
    assert clock.as_utc(datetime(2026, 9, 15, 12, 0)) == datetime(2026, 9, 15, 12, 0, tzinfo=UTC)
