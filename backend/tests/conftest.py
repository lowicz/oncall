import uuid
from collections.abc import AsyncIterator
from datetime import UTC, date, datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

import oncall.infrastructure.sqlalchemy.model_registry  # noqa: F401  # registers every mapper
from oncall.auth import hash_password
from oncall.database import SqlAlchemyUnitOfWork, get_db
from oncall.domain import clock
from oncall.domain.clock import business_today, utc_now
from oncall.domain.vocabulary import AssignmentRole, ScheduleStatus, UserRole
from oncall.infrastructure.sqlalchemy.access_models import User
from oncall.infrastructure.sqlalchemy.base import Base
from oncall.infrastructure.sqlalchemy.scheduling_models import Assignment, Schedule
from oncall.infrastructure.sqlalchemy.team_models import Eligibility, TeamMember
from oncall.main import app
from tests.frozen_clock import FrozenClock

TEST_PASSWORD = "test-password-123"

#: Where a frozen test starts unless it moves itself: an ordinary working
#: morning, the same day in Warsaw and in UTC.
FROZEN_AT = datetime(2026, 9, 15, 10, 0, tzinfo=UTC)


@pytest.fixture
async def db_factory() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    # SQLite ignores foreign keys unless asked, which would leave every
    # ON DELETE CASCADE in the schema untested and let a dangling row look
    # like production behaviour.
    @event.listens_for(engine.sync_engine, "connect")
    def _enforce_foreign_keys(connection, _record) -> None:
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    yield factory
    await engine.dispose()


@pytest.fixture
async def db(db_factory: async_sessionmaker[AsyncSession]) -> AsyncIterator[AsyncSession]:
    async with db_factory() as session:
        yield session


@pytest.fixture
async def client(db_factory: async_sessionmaker[AsyncSession]) -> AsyncIterator[AsyncClient]:
    async def override_get_db() -> AsyncIterator[AsyncSession]:
        async with SqlAlchemyUnitOfWork(db_factory) as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def frozen_clock(monkeypatch: pytest.MonkeyPatch) -> FrozenClock:
    """Every `utc_now()` and `business_today()` in the application answers
    from this clock for the duration of the test."""
    frozen = FrozenClock(FROZEN_AT)
    monkeypatch.setattr(clock, "system_clock", frozen)
    return frozen


async def create_user(
    db: AsyncSession,
    username: str,
    *,
    role: UserRole = UserRole.member,
    email: str | None = None,
    phone: str | None = None,
    display_name: str | None = None,
) -> User:
    user = User(
        username=username,
        display_name=display_name or username.title(),
        password_hash=hash_password(TEST_PASSWORD),
        role=role,
        email=email,
        phone=phone,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def create_member(
    db: AsyncSession,
    user: User,
    *,
    display_name: str,
    active_from: date | None = None,
) -> TeamMember:
    member = TeamMember(
        user_id=user.id,
        display_name=display_name,
        active_from=active_from or (business_today() - timedelta(days=365)),
    )
    member.eligibility = [
        Eligibility(role=role, starts_on=member.active_from) for role in AssignmentRole
    ]
    db.add(member)
    await db.commit()
    await db.refresh(member)
    return member


async def create_published_schedule(
    db: AsyncSession,
    *,
    starts_on: date,
    days: int,
    primary: list[str],
    secondary: list[str] | None = None,
    late_shift: list[str] | None = None,
    name: str = "Test schedule",
) -> Schedule:
    secondary = secondary or primary
    late_shift = late_shift or secondary
    schedule = Schedule(
        name=name,
        starts_on=starts_on,
        ends_on=starts_on + timedelta(days=days - 1),
        status=ScheduleStatus.published,
        published_at=utc_now(),
    )
    for offset in range(days):
        service_date = starts_on + timedelta(days=offset)
        for role, names in (
            (AssignmentRole.primary, primary),
            (AssignmentRole.secondary, secondary),
            (AssignmentRole.late_shift, late_shift),
        ):
            schedule.assignments.append(
                Assignment(
                    service_date=service_date,
                    role=role,
                    assignee_name=names[offset % len(names)],
                )
            )
    db.add(schedule)
    await db.commit()
    await db.refresh(schedule)
    return schedule


async def generate_draft_directly(
    db: AsyncSession, username: str, starts_on: date, ends_on: date
) -> dict:
    """A draft produced the way the worker produces one.

    The synchronous `POST /scheduling/generate` is gone (decision D4): its
    budget equalled nginx's read timeout, so it always ended in a 504 that
    left a finished but orphaned draft behind. The function stayed, and this
    is the seam the tests use instead of the endpoint.
    """
    from oncall.domain.scheduling.models import GenerationRequest
    from oncall.domain.team import Actor
    from oncall.infrastructure.sqlalchemy.scheduling import schedule_query_ports
    from oncall.presentation.scheduling import GenerateScheduleRequest
    from oncall.routes.scheduling import get_schedule
    from oncall.worker import generate_draft

    user = await db.scalar(select(User).where(User.username == username))
    assert user is not None, username
    request = GenerateScheduleRequest(starts_on=starts_on, ends_on=ends_on)
    stored = await generate_draft(
        GenerationRequest(
            Actor(user.id, user.display_name, user.role), request.starts_on, request.ends_on
        ),
        user,
        db,
    )
    response = await get_schedule(stored.id, user, schedule_query_ports(db))
    return response.model_dump(mode="json")


async def login(client: AsyncClient, username: str) -> dict:
    response = await client.post(
        "/api/v1/auth/login", json={"username": username, "password": TEST_PASSWORD}
    )
    assert response.status_code == 200, response.text
    client.headers["X-CSRF-Token"] = response.headers["x-csrf-token"]
    return response.json()


def any_uuid() -> uuid.UUID:
    return uuid.uuid4()


async def staged_draft(
    session: AsyncSession, *, starts_on: date | None = None, days: int = 14
) -> Schedule:
    """What `generate_draft` leaves in the session: a draft row the finished
    run points at. Tests that fake the generator still need a real one, or the
    run's foreign key has nothing to name."""
    first = starts_on or business_today() + timedelta(days=1)
    schedule = Schedule(
        name="Szkic",
        starts_on=first,
        ends_on=first + timedelta(days=days - 1),
        status=ScheduleStatus.draft,
    )
    session.add(schedule)
    await session.flush()
    return schedule
