"""What a worker that dies mid-drain costs (decision D-03).

Handing a message to an SMTP server and recording that fact are two steps in
two different systems, and no ordering of them is atomic. Delivery is
therefore at-least-once, which is the approved contract: a duplicate attempt is
allowed, a lost notification is not.

What is *not* allowed is paying for that guarantee by the batch. `drain_outbox`
used to hold one transaction across every send in a batch and commit at the
end, so a crash before that commit re-sent every message in it - reproduced
here as `test_a_crash_before_the_outcome_costs_one_message_not_the_batch`,
which now asserts the improved shape and fails on the old one.

Each test names one crash point: part way through a batch, while rows are held
under a lease, and inside the claim itself. Between them they also say what the
lease is worth and what the idempotency key is for.
"""

from datetime import timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.models import NotificationOutbox, NotificationStatus
from oncall.notifications.base import NotificationMessage
from oncall.notifications.service import (
    DEFAULT_LEASE,
    drain_outbox,
    enqueue_notification,
)
from tests.frozen_clock import FrozenClock
from tests.test_notifications import message

WHO = ("anna@example.com", "bartek@example.com", "celina@example.com")


class _Provider:
    """Records what reached the server, and can die at a chosen message."""

    channel = "email"

    def __init__(self, die_after: int | None = None) -> None:
        self.sent: list[NotificationMessage] = []
        self.die_after = die_after

    async def send(self, message: NotificationMessage) -> None:
        self.sent.append(message)
        if self.die_after is not None and len(self.sent) >= self.die_after:
            raise _Crash("proces workera zabity")

    @property
    def recipients(self) -> list[str]:
        return [item.recipient for item in self.sent]


class _Crash(BaseException):
    """Not a `NotificationError`: the worker process is gone, and no outcome is
    written for anything in flight. `BaseException` so the drain's own handler
    cannot mistake it for a provider failure."""


async def _enqueue(db: AsyncSession, clock: FrozenClock, count: int) -> None:
    """Rows a second apart, so `created_at` orders them the way `WHO` reads."""
    for who in WHO[:count]:
        await enqueue_notification(db, message(who))
        clock.advance(timedelta(seconds=1))
    await db.commit()


async def _rows(db_factory) -> list[NotificationOutbox]:
    async with db_factory() as reader:
        query = select(NotificationOutbox).order_by(NotificationOutbox.created_at)
        return list((await reader.scalars(query)).all())


def _kill_the_commit(monkeypatch) -> None:
    """The database connection dies before the outcome can be written."""

    async def lost_connection(self) -> None:
        raise _Crash("połączenie z bazą zerwane")

    monkeypatch.setattr(AsyncSession, "commit", lost_connection)


async def test_a_crash_before_the_outcome_costs_one_message_not_the_batch(
    db, db_factory, frozen_clock
) -> None:
    """The reproduction, turned into the guarantee.

    Three messages are claimed. The first two go out and are recorded. The
    third reaches the SMTP server and the worker dies before writing that down.
    The whole batch used to be re-sent; now only the third is.
    """
    await _enqueue(db, frozen_clock, 3)
    first = _Provider(die_after=3)

    async with db_factory() as dying:
        with pytest.raises(_Crash):
            await drain_outbox(dying, {"email": first})

    assert first.recipients == list(WHO)
    recorded = {row.recipient: row.status for row in await _rows(db_factory)}
    assert recorded[WHO[0]] == NotificationStatus.sent
    assert recorded[WHO[1]] == NotificationStatus.sent
    assert recorded[WHO[2]] == NotificationStatus.claimed

    # The worker comes back once the lease has run out.
    second = _Provider()
    frozen_clock.advance(DEFAULT_LEASE)
    async with db_factory() as restarted:
        stats = await drain_outbox(restarted, {"email": second})

    assert second.recipients == [WHO[2]], "a message outside the crash was re-sent"
    assert stats["sent"] == 1
    assert all(row.status == NotificationStatus.sent for row in await _rows(db_factory))


async def test_a_claimed_row_is_never_lost_only_delayed_by_its_lease(
    db, db_factory, frozen_clock
) -> None:
    """The other side of at-least-once: a claim must not swallow a message.

    A claim that took rows out of circulation would be an at-most-once design,
    and a worker dying here would lose the notification outright. The lease is
    what keeps it. The price shows in the last assertion: the first message,
    which did reach the server before the crash, goes out a second time. That
    is the approved trade - a duplicate attempt, never a lost notification.
    """
    await _enqueue(db, frozen_clock, 2)

    async with db_factory() as dying:
        with pytest.raises(_Crash):
            await drain_outbox(dying, {"email": _Provider(die_after=1)})

    claimed = await _rows(db_factory)
    assert [row.status for row in claimed] == [NotificationStatus.claimed] * 2

    # Still leased: another worker must not take them.
    provider = _Provider()
    async with db_factory() as too_early:
        assert await drain_outbox(too_early, {"email": provider}) == {
            "sent": 0,
            "retried": 0,
            "failed": 0,
            "skipped": 0,
        }
    assert provider.recipients == []

    frozen_clock.advance(DEFAULT_LEASE)
    async with db_factory() as later:
        await drain_outbox(later, {"email": provider})
    assert provider.recipients == list(WHO[:2])


async def test_a_crash_inside_the_claim_delivers_nothing_at_all(
    db, db_factory, monkeypatch, frozen_clock
) -> None:
    """A database that dies before the claim commits costs nothing.

    Worth stating because it is the one crash point with no duplicate at all.
    The claim is a drain's first write, so losing it means no message was ever
    handed over: the rows are still `pending`, not `claimed`, and the next
    drain is an ordinary first delivery.
    """
    await _enqueue(db, frozen_clock, 2)
    provider = _Provider()

    async with db_factory() as dying:
        _kill_the_commit(monkeypatch)
        with pytest.raises(_Crash):
            await drain_outbox(dying, {"email": provider})
    monkeypatch.undo()

    assert provider.recipients == []
    assert [row.status for row in await _rows(db_factory)] == [NotificationStatus.pending] * 2

    async with db_factory() as restarted:
        await drain_outbox(restarted, {"email": provider})
    assert provider.recipients == list(WHO[:2])


async def test_a_claim_holds_the_row_only_for_its_lease(db, db_factory, frozen_clock) -> None:
    """The lease is a boundary, not a mood, and it is the caller's to set."""
    await _enqueue(db, frozen_clock, 1)
    now = frozen_clock.instant

    async with db_factory() as worker:
        with pytest.raises(_Crash):
            await drain_outbox(
                worker, {"email": _Provider(die_after=1)}, now=now, lease=timedelta(minutes=30)
            )

    provider = _Provider()
    async with db_factory() as other:
        await drain_outbox(other, {"email": provider}, now=now + timedelta(minutes=29))
    assert provider.recipients == []

    async with db_factory() as other:
        await drain_outbox(other, {"email": provider}, now=now + timedelta(minutes=31))
    assert provider.recipients == [WHO[0]]


async def test_every_attempt_at_one_message_carries_the_same_key(
    db, db_factory, frozen_clock
) -> None:
    """The idempotency key is the row's own id, so a retry is recognisable as a
    repeat rather than as a second notification."""
    await _enqueue(db, frozen_clock, 1)
    row_id = (await _rows(db_factory))[0].id
    provider = _Provider(die_after=1)

    for offset in (timedelta(0), DEFAULT_LEASE, DEFAULT_LEASE * 2):
        async with db_factory() as worker:
            with pytest.raises(_Crash):
                await drain_outbox(worker, {"email": provider}, now=frozen_clock.instant + offset)

    keys = {item.idempotency_key for item in provider.sent}
    assert len(provider.sent) == 3
    assert keys == {str(row_id)}
