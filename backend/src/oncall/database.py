from collections.abc import AsyncIterator
from types import TracebackType

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from oncall.config import Settings, get_settings


def create_database_engine(settings: Settings) -> AsyncEngine:
    pool_options = (
        {
            "pool_size": settings.database_pool_size,
            "max_overflow": settings.database_max_overflow,
        }
        if settings.database_url.startswith("postgresql")
        else {}
    )
    return create_async_engine(settings.database_url, pool_pre_ping=True, **pool_options)


def create_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


engine = create_database_engine(get_settings())
SessionFactory = create_session_factory(engine)


class SqlAlchemyUnitOfWork:
    """One transaction owned by an application entry point.

    An exceptional outcome normally rolls back. A deliberately recorded
    refusal can opt into commit by exposing ``commit_transaction = True``.
    """

    def __init__(self, factory: async_sessionmaker[AsyncSession] = SessionFactory) -> None:
        self._factory = factory
        self.session: AsyncSession | None = None

    async def __aenter__(self) -> AsyncSession:
        self.session = self._factory()
        return self.session

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        assert self.session is not None
        try:
            if exc_type is None or getattr(exc, "commit_transaction", False):
                await self.session.commit()
            else:
                await self.session.rollback()
        finally:
            await self.session.close()


async def get_db() -> AsyncIterator[AsyncSession]:
    async with SqlAlchemyUnitOfWork() as session:
        yield session
