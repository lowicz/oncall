"""Statements the adapters send to PostgreSQL only, checked on the SQLite
suite against a session or connection that reports its dialect and records
what it is asked to run."""

from datetime import date, timedelta
from types import SimpleNamespace
from typing import Any

from oncall.domain.vocabulary import AssignmentRole
from oncall.infrastructure.sqlalchemy.base import Base, _create_btree_gist
from oncall.infrastructure.sqlalchemy.swaps import SWAP_DAY_LOCK_NAMESPACE, SqlAlchemySwapRequests

DAY = date(2030, 3, 13)


class _RecordingConnection:
    def __init__(self, dialect: str) -> None:
        self.dialect = SimpleNamespace(name=dialect)
        self.statements: list[str] = []

    def execute(self, statement: Any) -> None:
        self.statements.append(str(statement))


class _RecordingSession:
    """Enough of an `AsyncSession` for the swap store's slot check: no
    request holds the slot, and every lock statement is kept."""

    def __init__(self, dialect: str) -> None:
        self.bind = SimpleNamespace(dialect=SimpleNamespace(name=dialect))
        self.executed: list[Any] = []

    async def execute(self, statement: Any) -> None:
        self.executed.append(statement)

    async def scalar(self, _statement: Any) -> None:
        return None


def test_a_schema_built_on_postgresql_first_creates_btree_gist() -> None:
    postgres = _RecordingConnection("postgresql")
    sqlite = _RecordingConnection("sqlite")

    _create_btree_gist(Base.metadata, postgres)  # type: ignore[arg-type]
    _create_btree_gist(Base.metadata, sqlite)  # type: ignore[arg-type]

    assert postgres.statements == ["CREATE EXTENSION IF NOT EXISTS btree_gist"]
    assert sqlite.statements == []


async def test_the_slot_check_locks_each_service_day_once_on_postgresql() -> None:
    session = _RecordingSession("postgresql")
    store = SqlAlchemySwapRequests(session)  # type: ignore[arg-type]
    later = DAY + timedelta(days=1)

    assert not await store.has_active_request_for((DAY, AssignmentRole.primary))
    assert not await store.has_active_request_for((DAY, AssignmentRole.late_shift))
    assert not await store.has_active_request_for((later, AssignmentRole.primary))

    locks = [statement.compile() for statement in session.executed]
    assert [str(lock).split("(")[0] for lock in locks] == [
        "SELECT pg_advisory_xact_lock",
        "SELECT pg_advisory_xact_lock",
    ]
    assert [list(lock.params.values()) for lock in locks] == [
        [SWAP_DAY_LOCK_NAMESPACE, DAY.toordinal()],
        [SWAP_DAY_LOCK_NAMESPACE, later.toordinal()],
    ]


async def test_the_slot_check_takes_no_lock_on_sqlite() -> None:
    session = _RecordingSession("sqlite")
    store = SqlAlchemySwapRequests(session)  # type: ignore[arg-type]

    assert not await store.has_active_request_for((DAY, AssignmentRole.primary))

    assert session.executed == []
