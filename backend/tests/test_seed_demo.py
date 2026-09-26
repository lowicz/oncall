"""The demo seed's member names: the default set or ``ONCALL_DEMO_NAMES``."""

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
