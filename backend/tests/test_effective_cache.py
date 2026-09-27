"""The short-lived cache of resolved assignments that PostgreSQL deployments use.

SQLite sessions bypass it (tests keep exact read-after-write semantics), so
these tests hand `effective_assignments` a session whose dialect reports
PostgreSQL and count how often the database is actually asked.
"""

import asyncio
from collections.abc import Iterator
from datetime import date, timedelta
from types import SimpleNamespace
from typing import Any

import pytest

from oncall import effective
from oncall.config import get_settings

DAY = date(2026, 9, 1)


class Loader:
    """Stands in for the query: records each range asked and can be held open."""

    def __init__(self) -> None:
        self.calls: list[tuple[date, date]] = []
        self.gate: asyncio.Event | None = None

    async def __call__(self, _db: Any, starts_on: date, ends_on: date) -> dict:
        self.calls.append((starts_on, ends_on))
        if self.gate is not None:
            await self.gate.wait()
        return {"range": (starts_on, ends_on), "call": len(self.calls)}


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def loader(monkeypatch: pytest.MonkeyPatch) -> Loader:
    loader = Loader()
    monkeypatch.setattr(effective, "_load_effective_assignments", loader)
    return loader


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> Clock:
    clock = Clock()
    # Only the module's view of the clock moves; the event loop keeps its own.
    monkeypatch.setattr(effective, "time", SimpleNamespace(monotonic=clock))
    return clock


@pytest.fixture(autouse=True)
def empty_cache() -> Iterator[None]:
    effective._effective_cache.clear()
    effective._effective_locks.clear()
    yield
    effective._effective_cache.clear()
    effective._effective_locks.clear()


def _session(dialect: str) -> Any:
    return SimpleNamespace(bind=SimpleNamespace(dialect=SimpleNamespace(name=dialect)))


POSTGRES = _session("postgresql")


async def test_a_repeated_read_within_the_ttl_is_served_from_the_cache(
    loader: Loader, clock: Clock
) -> None:
    first = await effective.effective_assignments(POSTGRES, DAY, DAY)
    clock.now += get_settings().effective_assignments_cache_seconds / 2
    second = await effective.effective_assignments(POSTGRES, DAY, DAY)

    assert second is first
    assert loader.calls == [(DAY, DAY)]


async def test_an_expired_entry_is_loaded_again(loader: Loader, clock: Clock) -> None:
    first = await effective.effective_assignments(POSTGRES, DAY, DAY)
    clock.now += get_settings().effective_assignments_cache_seconds + 0.1
    second = await effective.effective_assignments(POSTGRES, DAY, DAY)

    assert (first["call"], second["call"]) == (1, 2)
    assert loader.calls == [(DAY, DAY), (DAY, DAY)]


async def test_sqlite_sessions_are_never_cached(loader: Loader, clock: Clock) -> None:
    await effective.effective_assignments(_session("sqlite"), DAY, DAY)
    await effective.effective_assignments(_session("sqlite"), DAY, DAY)

    assert len(loader.calls) == 2
    assert effective._effective_cache == {}


async def test_concurrent_readers_of_one_range_share_a_single_load(
    loader: Loader, clock: Clock
) -> None:
    loader.gate = asyncio.Event()
    first = asyncio.create_task(effective.effective_assignments(POSTGRES, DAY, DAY))
    second = asyncio.create_task(effective.effective_assignments(POSTGRES, DAY, DAY))
    await asyncio.sleep(0)
    loader.gate.set()

    results = await asyncio.gather(first, second)

    assert results[0] is results[1]
    assert loader.calls == [(DAY, DAY)]


async def _fill(clock: Clock, *, expire_first: int) -> list[tuple[date, date]]:
    """Fill the cache to its limit; the first `expire_first` entries go stale."""
    keys = []
    for offset in range(effective._CACHE_LIMIT):
        day = DAY + timedelta(days=offset)
        keys.append((day, day))
        await effective.effective_assignments(POSTGRES, day, day)
        clock.now += 0.001
    ttl = get_settings().effective_assignments_cache_seconds
    if expire_first:
        # The next entry was stored `ttl` after the first, so it expires too;
        # advance to just past the expiry of entry number `expire_first`.
        clock.now = 1000.0 + ttl + 0.001 * (expire_first - 1) + 0.0005
    return keys


async def test_a_full_cache_drops_every_expired_entry_first(loader: Loader, clock: Clock) -> None:
    keys = await _fill(clock, expire_first=3)
    newcomer = (DAY - timedelta(days=1), DAY - timedelta(days=1))

    await effective.effective_assignments(POSTGRES, *newcomer)

    assert set(effective._effective_cache) == set(keys[3:]) | {newcomer}
    assert not set(keys[:3]) & set(effective._effective_locks)


async def test_a_full_cache_without_expired_entries_drops_the_oldest(
    loader: Loader, clock: Clock
) -> None:
    keys = await _fill(clock, expire_first=0)
    newcomer = (DAY - timedelta(days=1), DAY - timedelta(days=1))

    await effective.effective_assignments(POSTGRES, *newcomer)

    assert set(effective._effective_cache) == set(keys[1:]) | {newcomer}
    assert keys[0] not in effective._effective_locks
