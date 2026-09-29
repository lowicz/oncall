"""The worker's rotation-notice scan, from the published schedule to the outbox.

5 October 2026 is a Monday; the schedules here run two weeks from the Monday
before it, one person per role and week unless a test says otherwise.
"""

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select

from oncall.config import get_settings
from oncall.infrastructure.sqlalchemy.notification_models import NotificationOutbox
from oncall.worker import scan_handover
from tests.conftest import create_member, create_published_schedule, create_user

WARSAW = ZoneInfo("Europe/Warsaw")

FIRST_MONDAY = date(2026, 9, 28)
FRIDAY = date(2026, 10, 2)
MONDAY = date(2026, 10, 5)
TUESDAY = date(2026, 10, 6)

SWITCH_URL = "https://centrala.example/przelacz?zespol=a&numer=1"


def warsaw(day: date, hour: int | None = None) -> datetime:
    reminder = get_settings().handover_reminder_hour
    return datetime(day.year, day.month, day.day, reminder if hour is None else hour, tzinfo=WARSAW)


def weeks(first: str, second: str) -> list[str]:
    return [first] * 7 + [second] * 7


async def _outbox(db) -> list[NotificationOutbox]:
    return list((await db.scalars(select(NotificationOutbox))).all())


async def _seed_members(db, *, anna_email: str | None = "anna@example.com") -> dict:
    members = {}
    for username, name, email in (
        ("anna", "Anna Kowalska", anna_email),
        ("marek", "Marek Nowak", "marek@example.com"),
        ("ola", "Ola Wiśniewska", "ola@example.com"),
    ):
        user = await create_user(db, username, email=email, display_name=name)
        members[name] = await create_member(db, user, display_name=name)
    return members


async def _primary_handover(db) -> None:
    """Marek holds PRIMARY the first week and Anna the second; Ola keeps
    SECONDARY and 11-19 throughout, so Anna is the only one starting."""
    await create_published_schedule(
        db,
        starts_on=FIRST_MONDAY,
        days=14,
        primary=weeks("Marek Nowak", "Anna Kowalska"),
        secondary=["Ola Wiśniewska"],
        late_shift=["Ola Wiśniewska"],
    )


async def test_nobody_is_told_before_the_reminder_hour(db) -> None:
    await _seed_members(db)
    await _primary_handover(db)
    reminder = get_settings().handover_reminder_hour

    assert await scan_handover(db, now_warsaw=warsaw(FRIDAY, reminder - 1)) == 0
    assert await scan_handover(db, now_warsaw=warsaw(MONDAY, reminder - 1)) == 0
    assert await _outbox(db) == []


async def test_the_person_taking_over_is_told_the_working_day_before_and_on_the_day(
    db,
) -> None:
    members = await _seed_members(db)
    await _primary_handover(db)
    anna = members["Anna Kowalska"].id

    assert await scan_handover(db, now_warsaw=warsaw(FRIDAY)) == 1
    await db.commit()
    [ahead] = await _outbox(db)
    assert ahead.recipient == "anna@example.com"
    assert ahead.subject == "Zapowiedź dyżuru: pon 05-10-2026 · PRIMARY"
    assert ahead.body.startswith(
        "W dniu pon 05-10-2026 zaczynasz dyżur:\n"
        "- pon 05-10-2026 · PRIMARY · ostatni dzień: niedz 11-10-2026\n"
    )
    assert ahead.dedup_key == f"rotation:d-1:2026-10-05:{anna}"
    assert ahead.context == {
        "event": "rotation_notice",
        "timing": "d-1",
        "starts_on": "2026-10-05",
        "member": "Anna Kowalska",
        "segments": [{"role": "primary", "ends_on": "2026-10-11"}],
    }

    # The weekend in between and the days inside the week bring nothing.
    for day in (date(2026, 10, 3), date(2026, 10, 4), TUESDAY):
        assert await scan_handover(db, now_warsaw=warsaw(day)) == 0

    assert await scan_handover(db, now_warsaw=warsaw(MONDAY)) == 1
    await db.commit()
    rows = await _outbox(db)
    assert {row.recipient for row in rows} == {"anna@example.com"}
    [first_day] = [row for row in rows if row.id != ahead.id]
    assert first_day.subject == "Dziś zaczynasz dyżur: pon 05-10-2026 · PRIMARY"
    assert first_day.dedup_key == f"rotation:d0:2026-10-05:{anna}"
    assert "Pamiętaj o przełączeniu numeru on-call." in first_day.body


async def test_a_repeated_scan_queues_nothing_more(db) -> None:
    await _seed_members(db)
    await _primary_handover(db)

    for day in (FRIDAY, MONDAY):
        assert await scan_handover(db, now_warsaw=warsaw(day)) == 1
        await db.commit()
        for hour in (get_settings().handover_reminder_hour, 13, 23):
            assert await scan_handover(db, now_warsaw=warsaw(day, hour)) == 0
            await db.commit()
    assert len(await _outbox(db)) == 2


async def test_roles_starting_together_are_one_mail(db) -> None:
    """Ola takes SECONDARY and 11-19 from Monday: one mail naming both, each
    with the last day of its own segment."""
    await _seed_members(db)
    await create_published_schedule(
        db,
        starts_on=FIRST_MONDAY,
        days=14,
        primary=["Marek Nowak"],
        secondary=weeks("Anna Kowalska", "Ola Wiśniewska"),
        late_shift=weeks("Anna Kowalska", "Ola Wiśniewska"),
    )

    assert await scan_handover(db, now_warsaw=warsaw(MONDAY)) == 1
    [row] = await _outbox(db)
    assert row.recipient == "ola@example.com"
    assert row.subject == "Dziś zaczynasz dyżury: pon 05-10-2026 · SECONDARY, 11–19"
    assert (
        "- pon 05-10-2026 · SECONDARY · ostatni dzień: niedz 11-10-2026\n"
        "- pon 05-10-2026 · 11–19 · ostatni dzień: pt 09-10-2026\n"
    ) in row.body
    assert "numer" not in row.body


async def test_the_first_day_of_primary_links_the_configured_switch(db, monkeypatch) -> None:
    monkeypatch.setattr(get_settings(), "oncall_switch_url", SWITCH_URL)
    await _seed_members(db)
    await _primary_handover(db)

    assert await scan_handover(db, now_warsaw=warsaw(FRIDAY)) == 1
    assert await scan_handover(db, now_warsaw=warsaw(MONDAY)) == 1
    by_timing = {row.context["timing"]: row for row in await _outbox(db)}
    ahead, first_day = by_timing["d-1"], by_timing["d0"]

    assert SWITCH_URL not in ahead.body
    assert f"Przełącz numer on-call: {SWITCH_URL}\n" in first_day.body
    assert 'href="https://centrala.example/przelacz?zespol=a&amp;numer=1"' in first_day.html_body


async def test_without_a_switch_url_the_first_day_asks_without_a_link(db) -> None:
    await _seed_members(db)
    await _primary_handover(db)

    assert await scan_handover(db, now_warsaw=warsaw(MONDAY)) == 1
    [row] = await _outbox(db)
    assert "Pamiętaj o przełączeniu numeru on-call." in row.body
    assert "Przełącz numer" not in row.body
    assert "Przełącz numer" not in row.html_body


async def test_a_person_without_an_email_is_skipped(db) -> None:
    await _seed_members(db, anna_email=None)
    await _primary_handover(db)

    assert await scan_handover(db, now_warsaw=warsaw(MONDAY)) == 0
    assert await _outbox(db) == []


async def test_no_published_schedule_no_notice(db) -> None:
    assert await scan_handover(db, now_warsaw=warsaw(MONDAY)) == 0
    assert await scan_handover(db, now_warsaw=warsaw(MONDAY + timedelta(days=5))) == 0
