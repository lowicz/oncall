from datetime import UTC, date, datetime, timedelta

from oncall.domain import clock
from tests.frozen_clock import FrozenClock


def test_warsaw_business_day_can_lead_utc(monkeypatch) -> None:
    frozen = FrozenClock(datetime(2026, 9, 15, 22, 30, tzinfo=UTC))
    monkeypatch.setattr(clock, "system_clock", frozen)

    assert clock.utc_now() == datetime(2026, 9, 15, 22, 30, tzinfo=UTC)
    assert clock.business_today() == date(2026, 9, 16)


def test_the_instant_and_the_business_day_part_at_half_past_eleven_utc(frozen_clock) -> None:
    """23:30 UTC is 01:30 in Warsaw: the instant's own date is still the 15th,
    the team's day is already the 16th, and neither may stand in for the other."""
    frozen_clock.instant = datetime(2026, 9, 15, 23, 30, tzinfo=UTC)

    instant = clock.utc_now()
    assert instant == datetime(2026, 9, 15, 23, 30, tzinfo=UTC)
    assert instant.date() == date(2026, 9, 15)
    assert instant.astimezone(clock.BUSINESS_TIMEZONE).strftime("%Y-%m-%d %H:%M") == (
        "2026-09-16 01:30"
    )
    assert clock.business_today() == date(2026, 9, 16)


def test_a_frozen_clock_moves_only_when_told(frozen_clock) -> None:
    before = clock.utc_now()
    assert clock.utc_now() == before
    assert frozen_clock.advance(timedelta(hours=1)) == before + timedelta(hours=1)
    assert clock.utc_now() == before + timedelta(hours=1)


def test_naive_database_timestamp_is_interpreted_as_utc() -> None:
    assert clock.as_utc(datetime(2026, 9, 15, 12, 0)) == datetime(2026, 9, 15, 12, 0, tzinfo=UTC)
