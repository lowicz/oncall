"""The worker's daily digest for coordinators, from the duties in force to the
outbox.

11 October 2026 is a Sunday, the 12th a Monday and 11 November 2026 a
Wednesday that is a Polish holiday.
"""

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select

from oncall.config import get_settings
from oncall.domain.clock import utc_now
from oncall.domain.vocabulary import AssignmentRole, ScheduleStatus, UserRole
from oncall.infrastructure.sqlalchemy.notification_models import NotificationOutbox
from oncall.infrastructure.sqlalchemy.scheduling_models import Assignment, Schedule
from oncall.worker import notification_cycle, scan_digest, scan_handover
from tests.conftest import create_user

WARSAW = ZoneInfo("Europe/Warsaw")

SUNDAY = date(2026, 10, 11)
MONDAY = date(2026, 10, 12)
HOLIDAY = date(2026, 11, 11)

PRIMARY, SECONDARY, LATE = (
    AssignmentRole.primary,
    AssignmentRole.secondary,
    AssignmentRole.late_shift,
)


@pytest.fixture(autouse=True)
def _email_is_on(monkeypatch) -> None:
    monkeypatch.setattr(get_settings(), "smtp_host", "smtp.example.com")


def warsaw(day: date, hour: int | None = None) -> datetime:
    digest = get_settings().coordinator_digest_hour
    return datetime(day.year, day.month, day.day, digest if hour is None else hour, tzinfo=WARSAW)


async def _outbox(db) -> list[NotificationOutbox]:
    return list((await db.scalars(select(NotificationOutbox))).all())


async def _coordinator(db, username: str = "koord", **fields):
    return await create_user(
        db, username, role=UserRole.coordinator, email=f"{username}@example.com", **fields
    )


async def _publish(db, day: date, holders: dict[AssignmentRole, str]) -> None:
    """A published schedule of one day with exactly these slots filled."""
    schedule = Schedule(
        name="Test schedule",
        starts_on=day,
        ends_on=day,
        status=ScheduleStatus.published,
        published_at=utc_now(),
    )
    for role, name in holders.items():
        schedule.assignments.append(Assignment(service_date=day, role=role, assignee_name=name))
    db.add(schedule)
    await db.commit()


async def test_every_coordinator_and_admin_is_told_who_is_on_duty_today(db) -> None:
    koord = await _coordinator(db, phone="+48 600 100 200")
    admin = await create_user(db, "szef", role=UserRole.admin, email="szef@example.com")
    await create_user(db, "anna", email="anna@example.com")
    inactive = await _coordinator(db, "dawny")
    inactive.is_active = False
    await create_user(db, "niemy", role=UserRole.coordinator)
    await _publish(
        db, MONDAY, {PRIMARY: "Anna Kowalska", SECONDARY: "Marek Nowak", LATE: "Ola Wiśniewska"}
    )

    assert await scan_digest(db, now_warsaw=warsaw(MONDAY)) == 2
    rows = {row.recipient: row for row in await _outbox(db)}
    assert set(rows) == {"koord@example.com", "szef@example.com"}
    row = rows["koord@example.com"]
    assert row.subject == "Dyżury na dziś, 12 października"
    assert row.body == (
        "Dziś (pon 12-10-2026) na dyżurze:\n"
        "- PRIMARY: Anna Kowalska\n"
        "- SECONDARY: Marek Nowak\n"
        "- 11–19: Ola Wiśniewska\n"
        "\n"
        "Aktualny grafik: http://localhost:8080/\n"
    )
    for name in ("Anna Kowalska", "Marek Nowak", "Ola Wiśniewska"):
        assert name in row.html_body
    assert "brak" not in row.html_body
    assert "100 200" not in row.body + row.html_body
    assert row.dedup_key == f"digest:2026-10-12:{koord.id}"
    assert rows["szef@example.com"].dedup_key == f"digest:2026-10-12:{admin.id}"
    assert row.context == {
        "event": "duty_digest",
        "day": "2026-10-12",
        "holders": [
            {"role": "primary", "holder": "Anna Kowalska"},
            {"role": "secondary", "holder": "Marek Nowak"},
            {"role": "late_shift", "holder": "Ola Wiśniewska"},
        ],
    }


async def test_nobody_is_told_before_the_digest_hour(db) -> None:
    await _coordinator(db)
    await _publish(db, MONDAY, {PRIMARY: "Anna Kowalska"})

    assert await scan_digest(db, now_warsaw=warsaw(MONDAY, 0)) == 0
    assert (
        await scan_digest(db, now_warsaw=warsaw(MONDAY, get_settings().coordinator_digest_hour - 1))
        == 0
    )
    assert await _outbox(db) == []


async def test_the_digest_hour_is_its_own_setting(db, monkeypatch) -> None:
    """The digest goes out at 8 and the rotation notices at 9 by default;
    moving one hour leaves the other where it was."""
    settings = get_settings()
    assert (settings.coordinator_digest_hour, settings.handover_reminder_hour) == (8, 9)
    await _coordinator(db)
    await create_user(db, "anna", email="anna@example.com", display_name="Anna Kowalska")
    await _publish(db, MONDAY, {PRIMARY: "Anna Kowalska"})

    assert await scan_handover(db, now_warsaw=warsaw(MONDAY, 8)) == 0
    monkeypatch.setattr(settings, "coordinator_digest_hour", 14)
    assert await scan_digest(db, now_warsaw=warsaw(MONDAY, 13)) == 0
    assert await scan_digest(db, now_warsaw=warsaw(MONDAY, 14)) == 1
    assert settings.handover_reminder_hour == 9


async def test_a_repeated_scan_sends_nothing_more_that_day(db) -> None:
    await _coordinator(db)
    await _publish(db, SUNDAY, {PRIMARY: "Anna Kowalska", SECONDARY: "Marek Nowak"})
    await _publish(db, MONDAY, {PRIMARY: "Anna Kowalska", SECONDARY: "Marek Nowak"})

    assert await scan_digest(db, now_warsaw=warsaw(SUNDAY)) == 1
    await db.commit()
    for hour in (get_settings().coordinator_digest_hour, 13, 23):
        assert await scan_digest(db, now_warsaw=warsaw(SUNDAY, hour)) == 0
        await db.commit()

    # The next day is a digest of its own.
    assert await scan_digest(db, now_warsaw=warsaw(MONDAY)) == 1
    assert sorted(row.subject for row in await _outbox(db)) == [
        "Dyżury na dziś, 11 października",
        "Dyżury na dziś, 12 października",
    ]


async def test_a_scan_after_the_hour_catches_up(db) -> None:
    """The worker was down at the hour: the first scan after it still sends,
    and a coordinator added later in the day gets theirs then, once."""
    await _coordinator(db)
    await _publish(db, MONDAY, {PRIMARY: "Anna Kowalska"})

    assert await scan_digest(db, now_warsaw=warsaw(MONDAY, 17)) == 1
    await db.commit()

    await _coordinator(db, "nowa")
    assert await scan_digest(db, now_warsaw=warsaw(MONDAY, 18)) == 1
    await db.commit()
    assert await scan_digest(db, now_warsaw=warsaw(MONDAY, 19)) == 0
    assert sorted(row.recipient for row in await _outbox(db)) == [
        "koord@example.com",
        "nowa@example.com",
    ]


async def test_a_role_nobody_holds_is_named_as_a_gap(db) -> None:
    await _coordinator(db)
    await _publish(db, MONDAY, {PRIMARY: "Anna Kowalska"})

    assert await scan_digest(db, now_warsaw=warsaw(MONDAY)) == 1
    [row] = await _outbox(db)
    assert row.body == (
        "Dziś (pon 12-10-2026) na dyżurze:\n"
        "- PRIMARY: Anna Kowalska\n"
        "- SECONDARY: brak obsady\n"
        "- 11–19: brak obsady\n"
        "\n"
        "Nie wszystkie dyżury są dziś obsadzone.\n"
        "Aktualny grafik: http://localhost:8080/\n"
    )
    assert row.html_body.count("brak obsady") == 2
    assert "Nie wszystkie dyżury są dziś obsadzone." in row.html_body
    assert row.context["holders"][1:] == [
        {"role": "secondary", "gap": "unstaffed"},
        {"role": "late_shift", "gap": "unstaffed"},
    ]


async def test_the_late_shift_has_no_duty_on_a_day_off(db) -> None:
    """Sent at the weekend and on a holiday like any other day: PRIMARY and
    SECONDARY serve, 11-19 does not, and that is no gap."""
    await _coordinator(db)
    for day in (SUNDAY, HOLIDAY):
        await _publish(
            db, day, {PRIMARY: "Anna Kowalska", SECONDARY: "Marek Nowak", LATE: "Ola Wiśniewska"}
        )
        assert await scan_digest(db, now_warsaw=warsaw(day)) == 1

    sunday, holiday = sorted(await _outbox(db), key=lambda row: row.context["day"])
    assert sunday.subject == "Dyżury na dziś, 11 października"
    assert sunday.body == (
        "Dziś (niedz 11-10-2026) na dyżurze:\n"
        "- PRIMARY: Anna Kowalska\n"
        "- SECONDARY: Marek Nowak\n"
        "- 11–19: brak dyżuru (dzień wolny)\n"
        "\n"
        "Aktualny grafik: http://localhost:8080/\n"
    )
    assert "brak dyżuru (dzień wolny)" in sunday.html_body
    assert "brak obsady" not in sunday.html_body
    assert "Ola" not in sunday.body + sunday.html_body
    assert sunday.context["holders"][2] == {"role": "late_shift", "gap": "day_off"}
    assert holiday.subject == "Dyżury na dziś, 11 listopada"
    assert "- 11–19: brak dyżuru (dzień wolny)\n" in holiday.body


async def test_without_a_published_schedule_the_digest_still_goes_out(db) -> None:
    await _coordinator(db)

    assert await scan_digest(db, now_warsaw=warsaw(MONDAY)) == 1
    assert await scan_digest(db, now_warsaw=warsaw(SUNDAY)) == 1
    monday, sunday = sorted(await _outbox(db), key=lambda row: row.context["day"], reverse=True)
    assert monday.subject == "Dyżury na dziś, 12 października"
    assert monday.body == (
        "Dziś (pon 12-10-2026) na dyżurze:\n"
        "- PRIMARY: brak obsady\n"
        "- SECONDARY: brak obsady\n"
        "- 11–19: brak obsady\n"
        "\n"
        "Na dziś nie ma opublikowanego grafiku.\n"
        "Aktualny grafik: http://localhost:8080/\n"
    )
    assert "Na dziś nie ma opublikowanego grafiku." in monday.html_body
    assert "- 11–19: brak dyżuru (dzień wolny)\n" in sunday.body
    assert "Na dziś nie ma opublikowanego grafiku.\n" in sunday.body


async def test_without_a_coordinator_nothing_is_queued(db) -> None:
    await create_user(db, "anna", email="anna@example.com")
    await _publish(db, MONDAY, {PRIMARY: "Anna Kowalska"})

    assert await scan_digest(db, now_warsaw=warsaw(MONDAY)) == 0
    assert await _outbox(db) == []


async def test_no_digest_is_queued_while_email_is_off(db, monkeypatch) -> None:
    """A digest queued without SMTP would be delivered, stale, on the day
    SMTP is configured: none is queued until then, and that day's is."""
    settings = get_settings()
    monkeypatch.setattr(settings, "smtp_host", None)
    await _coordinator(db)
    await _publish(db, SUNDAY, {PRIMARY: "Anna Kowalska"})
    await _publish(db, MONDAY, {PRIMARY: "Anna Kowalska"})

    assert await scan_digest(db, now_warsaw=warsaw(SUNDAY)) == 0
    assert await scan_digest(db, now_warsaw=warsaw(MONDAY)) == 0
    assert await _outbox(db) == []

    monkeypatch.setattr(settings, "smtp_host", "smtp.example.com")
    assert await scan_digest(db, now_warsaw=warsaw(MONDAY, 15)) == 1
    assert [row.subject for row in await _outbox(db)] == ["Dyżury na dziś, 12 października"]


async def test_the_worker_cycle_sends_the_digest_once_a_day(
    db, db_factory, frozen_clock, monkeypatch
) -> None:
    """The clock stands at noon in Warsaw: the cycle queues the digest and
    commits it, the next cycle queues nothing, and the next day's waits for
    the hour."""
    sent: list[str] = []

    class Mailbox:
        async def send(self, message) -> None:
            sent.append(message.subject)

    monkeypatch.setattr("oncall.worker.default_providers", lambda settings: {"email": Mailbox()})
    await _coordinator(db)

    assert (await notification_cycle(db_factory))["digest"] == 1
    assert (await notification_cycle(db_factory))["digest"] == 0
    assert sent == ["Dyżury na dziś, 15 września"]
    async with db_factory() as fresh:
        assert [row.subject for row in await _outbox(fresh)] == ["Dyżury na dziś, 15 września"]

    frozen_clock.advance(timedelta(hours=19))
    assert frozen_clock.instant.astimezone(WARSAW).hour == 7
    assert (await notification_cycle(db_factory))["digest"] == 0
    frozen_clock.advance(timedelta(hours=1))
    assert (await notification_cycle(db_factory))["digest"] == 1
