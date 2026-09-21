import pytest
from sqlalchemy import func, select

from oncall.database import SqlAlchemyUnitOfWork
from oncall.domain.vocabulary import UserRole
from oncall.infrastructure.sqlalchemy.access_models import User
from oncall.infrastructure.sqlalchemy.scheduling_models import SchedulingPolicy
from oncall.policy import load_policy


def _user(username: str) -> User:
    return User(
        username=username,
        display_name=username.title(),
        password_hash="not-used",
        role=UserRole.member,
    )


async def test_unit_of_work_commits_success(db_factory) -> None:
    async with SqlAlchemyUnitOfWork(db_factory) as session:
        session.add(_user("committed"))

    async with db_factory() as session:
        assert await session.scalar(select(User.username)) == "committed"


async def test_unit_of_work_rolls_back_failure(db_factory) -> None:
    with pytest.raises(RuntimeError):
        async with SqlAlchemyUnitOfWork(db_factory) as session:
            session.add(_user("rolled-back"))
            raise RuntimeError("stop")

    async with db_factory() as session:
        assert await session.scalar(select(User.username)) is None


async def test_recorded_exception_commits_deliberate_outcome(db_factory) -> None:
    class RecordedOutcome(RuntimeError):
        commit_transaction = True

    with pytest.raises(RecordedOutcome):
        async with SqlAlchemyUnitOfWork(db_factory) as session:
            session.add(_user("recorded"))
            raise RecordedOutcome("refused but recorded")

    async with db_factory() as session:
        assert await session.scalar(select(User.username)) == "recorded"


async def test_the_default_policy_belongs_to_the_unit_of_work_that_created_it(
    db_factory,
) -> None:
    """The policy row is created on first read and flushed, never committed by
    the read itself: a unit of work that fails takes the new row with it, and
    one that succeeds writes it."""
    with pytest.raises(RuntimeError):
        async with SqlAlchemyUnitOfWork(db_factory) as session:
            await load_policy(session)
            raise RuntimeError("stop")

    async with db_factory() as session:
        assert await session.scalar(select(func.count()).select_from(SchedulingPolicy)) == 0

    async with SqlAlchemyUnitOfWork(db_factory) as session:
        created = await load_policy(session)

    async with db_factory() as session:
        assert await session.scalar(select(SchedulingPolicy.id)) == created.id
