from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select

from oncall.config import get_settings
from oncall.infrastructure.sqlalchemy.notification_models import NotificationOutbox
from oncall.worker import scan_handover
from tests.conftest import create_member, create_published_schedule, create_user

WARSAW = ZoneInfo("Europe/Warsaw")


def warsaw(day: date, hour: int) -> datetime:
    return datetime(day.year, day.month, day.day, hour, tzinfo=ZoneInfo("Europe/Warsaw"))


async def _outbox_count(db) -> int:
    return await db.scalar(select(func.count()).select_from(NotificationOutbox))


async def _seed_members(db) -> None:
    anna = await create_user(db, "anna", email="anna@example.com", display_name="Anna Kowalska")
    marek = await create_user(db, "marek", email="marek@example.com", display_name="Marek Nowak")
    await create_member(db, anna, display_name="Anna Kowalska")
    await create_member(db, marek, display_name="Marek Nowak")


async def test_no_scan_before_reminder_hour(db) -> None:
    await _seed_members(db)
    today = date.today()
    await create_published_schedule(
        db,
        starts_on=today - timedelta(days=1),
        days=3,
        primary=["Marek Nowak", "Anna Kowalska"],
    )
    now = warsaw(today, get_settings().handover_reminder_hour - 1)
    assert await scan_handover(db, now_warsaw=now) == 0
    assert await _outbox_count(db) == 0


async def test_handover_reminder_enqueued_once_when_primary_changes(db) -> None:
    await _seed_members(db)
    today = date.today()
    await create_published_schedule(
        db,
        starts_on=today - timedelta(days=1),
        days=3,
        primary=["Marek Nowak", "Anna Kowalska"],
    )
    now = warsaw(today, get_settings().handover_reminder_hour)
    enqueued = await scan_handover(db, now_warsaw=now)
    await db.commit()
    assert enqueued == 2
    rows = (await db.scalars(select(NotificationOutbox))).all()
    recipients = {row.recipient for row in rows}
    assert recipients == {"anna@example.com", "marek@example.com"}
    assert any("Przejęcie numeru" in row.subject for row in rows)
    assert any("Przekazanie numeru" in row.subject for row in rows)

    again = await scan_handover(db, now_warsaw=now)
    assert again == 0
    assert await _outbox_count(db) == 2


async def test_no_reminder_when_primary_stays_the_same(db) -> None:
    await _seed_members(db)
    today = date.today()
    await create_published_schedule(
        db,
        starts_on=today - timedelta(days=1),
        days=3,
        primary=["Anna Kowalska"],
    )
    now = warsaw(today, get_settings().handover_reminder_hour + 2)
    assert await scan_handover(db, now_warsaw=now) == 0
    assert await _outbox_count(db) == 0


async def test_member_without_email_is_skipped(db) -> None:
    anna = await create_user(db, "anna", email=None, display_name="Anna Kowalska")
    marek = await create_user(db, "marek", email="marek@example.com", display_name="Marek Nowak")
    await create_member(db, anna, display_name="Anna Kowalska")
    await create_member(db, marek, display_name="Marek Nowak")
    today = date.today()
    await create_published_schedule(
        db,
        starts_on=today - timedelta(days=1),
        days=3,
        primary=["Marek Nowak", "Anna Kowalska"],
    )
    now = warsaw(today, get_settings().handover_reminder_hour)
    enqueued = await scan_handover(db, now_warsaw=now)
    assert enqueued == 1
    row = await db.scalar(select(NotificationOutbox))
    assert row.recipient == "marek@example.com"


async def test_no_published_schedule_no_reminder(db) -> None:
    today = date.today()
    now = warsaw(today, get_settings().handover_reminder_hour + 1)
    assert await scan_handover(db, now_warsaw=now) == 0
