import pytest
from sqlalchemy import select

from oncall.database import SqlAlchemyUnitOfWork
from oncall.models import User, UserRole


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
