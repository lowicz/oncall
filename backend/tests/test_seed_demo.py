"""The demo seed's member names: the default set or ``ONCALL_DEMO_NAMES``."""

import asyncio
import runpy
import sys

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from oncall.infrastructure.sqlalchemy.access_models import User
from oncall.infrastructure.sqlalchemy.scheduling_models import Assignment, Schedule
from oncall.infrastructure.sqlalchemy.team_models import TeamMember
from oncall.seed_demo import DEMO_LOGINS, DEMO_NAMES, demo_names, seed_demo

ENGLISH_NAMES = ["Anna Carter", "Mark Brown", "Olivia Reed", "Peter Hale"]


def test_unset_or_blank_keeps_the_default_names() -> None:
    assert demo_names(None) == DEMO_NAMES
    assert demo_names("   ") == DEMO_NAMES
    assert demo_names(None) is not DEMO_NAMES, "callers get their own list"


def test_configured_names_are_split_and_trimmed_in_login_order() -> None:
    names = demo_names(" Anna Carter, Mark Brown ,Olivia Reed,Peter Hale ")

    assert names == ["Anna Carter", "Mark Brown", "Olivia Reed", "Peter Hale"]
    assert len(names) == len(DEMO_LOGINS)


@pytest.mark.parametrize(
    "configured",
    [
        "Anna Carter,Mark Brown,Olivia Reed",
        "Anna Carter,Mark Brown,Olivia Reed,Peter Hale,Extra Person",
        "Anna Carter,,Olivia Reed,Peter Hale",
    ],
)
def test_wrong_count_or_empty_name_stops_the_seed(configured: str) -> None:
    with pytest.raises(SystemExit, match="exactly 4 comma-separated names"):
        demo_names(configured)


async def test_seed_demo_builds_the_configured_english_schedule(
    db_factory: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
    frozen_clock: object,
) -> None:
    monkeypatch.setattr("oncall.seed_demo.SessionFactory", db_factory)
    monkeypatch.setenv("ONCALL_DEMO_PASSWORD", "demo-password-123")
    monkeypatch.setenv("ONCALL_DEMO_NAMES", ",".join(ENGLISH_NAMES))

    await seed_demo()

    async with db_factory() as db:
        usernames = set((await db.scalars(select(User.username))).all())
        assert usernames == {"admin", "viewer", *DEMO_LOGINS}

        members = (await db.scalars(select(TeamMember))).all()
        assert sorted(m.display_name for m in members) == sorted(ENGLISH_NAMES)
        assert all(m.user_id is not None for m in members)

        schedule = await db.scalar(select(Schedule).where(Schedule.name == "Demo schedule"))
        assert schedule is not None
        assignee_names = set((await db.scalars(select(Assignment.assignee_name))).all())
        assert assignee_names == set(ENGLISH_NAMES)


async def test_seed_demo_relinks_members_when_the_schedule_exists(
    db_factory: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
    frozen_clock: object,
) -> None:
    monkeypatch.setattr("oncall.seed_demo.SessionFactory", db_factory)
    monkeypatch.setenv("ONCALL_DEMO_PASSWORD", "demo-password-123")
    monkeypatch.setenv("ONCALL_DEMO_NAMES", ",".join(ENGLISH_NAMES))

    await seed_demo()
    async with db_factory() as db:
        await db.execute(TeamMember.__table__.update().values(user_id=None))
        await db.commit()

    await seed_demo()  # the schedule already exists: the second run relinks members

    async with db_factory() as db:
        members = (await db.scalars(select(TeamMember))).all()
        users = {u.username: u.id for u in (await db.scalars(select(User))).all()}
        by_name = dict(zip(ENGLISH_NAMES, DEMO_LOGINS, strict=True))
        for member in members:
            assert member.user_id == users[by_name[member.display_name]]


@pytest.mark.parametrize("password", [None, "too-short"])
async def test_the_seed_needs_a_real_demo_password(monkeypatch, password) -> None:
    if password is None:
        monkeypatch.delenv("ONCALL_DEMO_PASSWORD", raising=False)
    else:
        monkeypatch.setenv("ONCALL_DEMO_PASSWORD", password)

    with pytest.raises(SystemExit, match="ONCALL_DEMO_PASSWORD"):
        await seed_demo()


async def test_a_mail_domain_configured_later_gives_existing_accounts_an_address(
    db_factory: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
    frozen_clock: object,
) -> None:
    """A demo seeded before `ONCALL_DEMO_EMAIL_DOMAIN` was set gets addresses
    on the next run, and an address already there is left alone."""
    monkeypatch.setattr("oncall.seed_demo.SessionFactory", db_factory)
    monkeypatch.setenv("ONCALL_DEMO_PASSWORD", "demo-password-123")
    monkeypatch.delenv("ONCALL_DEMO_NAMES", raising=False)
    monkeypatch.delenv("ONCALL_DEMO_EMAIL_DOMAIN", raising=False)
    await seed_demo()
    async with db_factory() as db:
        assert set((await db.scalars(select(User.email))).all()) == {None}
        await db.execute(
            User.__table__.update().where(User.username == "anna").values(email="anna@own.example")
        )
        await db.commit()

    monkeypatch.setenv("ONCALL_DEMO_EMAIL_DOMAIN", "demo.example")
    await seed_demo()

    async with db_factory() as db:
        emails = {
            row.username: row.email for row in await db.execute(select(User.username, User.email))
        }
    assert emails == {
        "admin": "admin@demo.example",
        "anna": "anna@own.example",
        "marek": "marek@demo.example",
        "ola": "ola@demo.example",
        "piotr": "piotr@demo.example",
        "viewer": "viewer@demo.example",
    }


async def test_a_fresh_seed_with_a_mail_domain_creates_accounts_with_addresses(
    db_factory: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
    frozen_clock: object,
) -> None:
    monkeypatch.setattr("oncall.seed_demo.SessionFactory", db_factory)
    monkeypatch.setenv("ONCALL_DEMO_PASSWORD", "demo-password-123")
    monkeypatch.delenv("ONCALL_DEMO_NAMES", raising=False)
    monkeypatch.setenv("ONCALL_DEMO_EMAIL_DOMAIN", "demo.example")

    await seed_demo()

    async with db_factory() as db:
        members = (await db.scalars(select(TeamMember.display_name))).all()
        viewer = await db.scalar(select(User).where(User.username == "viewer"))
    assert sorted(members) == sorted(DEMO_NAMES)
    assert viewer is not None
    assert viewer.email == "viewer@demo.example"


def test_running_the_module_seeds_the_demo(monkeypatch) -> None:
    """`python -m oncall.seed_demo` is how an operator fills a demo database."""
    started: list[str] = []

    def fake_run(coroutine) -> None:
        started.append(coroutine.cr_code.co_name)
        coroutine.close()

    monkeypatch.setattr(asyncio, "run", fake_run)
    monkeypatch.delitem(sys.modules, "oncall.seed_demo")

    runpy.run_module("oncall.seed_demo", run_name="__main__")

    assert started == ["seed_demo"]
