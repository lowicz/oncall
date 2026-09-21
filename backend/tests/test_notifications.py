from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select

from oncall.domain.clock import as_utc
from oncall.infrastructure.sqlalchemy.notification_models import (
    NotificationOutbox,
    NotificationStatus,
)
from oncall.notifications.base import (
    NotificationDisabled,
    NotificationError,
    NotificationMessage,
    TemporaryNotificationError,
)
from oncall.notifications.service import drain_outbox, enqueue_notification, retry_delay


class FakeProvider:
    channel = "email"

    def __init__(self, error: Exception | None = None) -> None:
        self.error = error
        self.sent: list[NotificationMessage] = []

    async def send(self, message: NotificationMessage) -> None:
        if self.error is not None:
            raise self.error
        self.sent.append(message)


async def _stored(db_factory) -> NotificationOutbox:
    """The one outbox row as stored, read on a session that has never seen it:
    a drain writes through units of work of its own."""
    async with db_factory() as reader:
        return await reader.scalar(select(NotificationOutbox))


def message(recipient: str = "anna@example.com") -> NotificationMessage:
    return NotificationMessage(
        channel="email",
        recipient=recipient,
        subject="Temat",
        body="Treść",
        context={"event": "test"},
    )


async def test_retry_delay_grows_exponentially_and_caps() -> None:
    assert retry_delay(1) == timedelta(minutes=2)
    assert retry_delay(2) == timedelta(minutes=4)
    assert retry_delay(10) == timedelta(hours=1)


async def test_enqueue_and_drain_sends_message(db, db_factory, frozen_clock) -> None:
    await enqueue_notification(db, message())
    await db.commit()
    provider = FakeProvider()
    stats = await drain_outbox(db_factory, {"email": provider})
    assert stats["sent"] == 1
    assert provider.sent[0].recipient == "anna@example.com"
    row = await _stored(db_factory)
    assert row.status == NotificationStatus.sent
    assert as_utc(row.sent_at) == frozen_clock.instant


async def test_temporary_error_retries_with_backoff(db, db_factory, frozen_clock) -> None:
    await enqueue_notification(db, message())
    await db.commit()
    provider = FakeProvider(error=TemporaryNotificationError("połączenie odrzucone"))
    stats = await drain_outbox(db_factory, {"email": provider})
    assert stats["retried"] == 1
    row = await _stored(db_factory)
    assert row.status == NotificationStatus.pending
    assert row.attempts == 1
    assert as_utc(row.next_attempt_at) == frozen_clock.instant + retry_delay(1)
    assert "odrzucone" in row.last_error


async def test_temporary_error_fails_after_max_attempts(db, db_factory) -> None:
    await enqueue_notification(db, message())
    await db.commit()
    provider = FakeProvider(error=TemporaryNotificationError("down"))
    stats = await drain_outbox(db_factory, {"email": provider}, max_attempts=1)
    assert stats["failed"] == 1
    row = await _stored(db_factory)
    assert row.status == NotificationStatus.failed


async def test_permanent_error_fails_without_retry(db, db_factory) -> None:
    await enqueue_notification(db, message())
    await db.commit()
    provider = FakeProvider(error=NotificationError("zły adres"))
    stats = await drain_outbox(db_factory, {"email": provider})
    assert stats["failed"] == 1
    row = await _stored(db_factory)
    assert row.status == NotificationStatus.failed
    assert row.attempts == 0


async def test_disabled_provider_marks_skipped(db, db_factory) -> None:
    await enqueue_notification(db, message())
    await db.commit()
    provider = FakeProvider(error=NotificationDisabled("brak konfiguracji"))
    stats = await drain_outbox(db_factory, {"email": provider})
    assert stats["skipped"] == 1
    row = await _stored(db_factory)
    assert row.status == NotificationStatus.skipped


async def test_missing_provider_marks_failed(db, db_factory) -> None:
    await enqueue_notification(db, message())
    await db.commit()
    stats = await drain_outbox(db_factory, {})
    assert stats["failed"] == 1
    row = await _stored(db_factory)
    assert row.status == NotificationStatus.failed
    assert "providera" in row.last_error


async def test_dedup_key_prevents_duplicates(db) -> None:
    first = await enqueue_notification(db, message(), dedup_key="event:1")
    second = await enqueue_notification(db, message(), dedup_key="event:1")
    await db.commit()
    assert first is not None
    assert second is None
    count = await db.scalar(select(func.count()).select_from(NotificationOutbox))
    assert count == 1


async def test_drain_respects_next_attempt_time(db, db_factory, frozen_clock) -> None:
    await enqueue_notification(db, message())
    await db.commit()
    provider = FakeProvider(error=TemporaryNotificationError("down"))
    await drain_outbox(db_factory, {"email": provider})

    frozen_clock.advance(timedelta(seconds=30))
    assert (await drain_outbox(db_factory, {"email": FakeProvider()}))["sent"] == 0

    frozen_clock.advance(retry_delay(1))
    assert (await drain_outbox(db_factory, {"email": FakeProvider()}))["sent"] == 1


async def test_unexpected_provider_error_is_retried(db, db_factory) -> None:
    await enqueue_notification(db, message())
    await db.commit()
    provider = FakeProvider(error=RuntimeError("bug"))
    stats = await drain_outbox(db_factory, {"email": provider})
    assert stats["retried"] == 1
    row = await _stored(db_factory)
    assert row.status == NotificationStatus.pending
    assert "bug" in row.last_error


async def test_batch_size_limits_rows(db, db_factory) -> None:
    for _ in range(5):
        await enqueue_notification(db, message())
    await db.commit()
    provider = FakeProvider()
    stats = await drain_outbox(db_factory, {"email": provider}, batch_size=2)
    assert stats["sent"] == 2
    pending = await db.scalar(
        select(func.count())
        .select_from(NotificationOutbox)
        .where(NotificationOutbox.status == NotificationStatus.pending)
    )
    assert pending == 3


async def test_attempts_accumulate_across_drains_until_the_row_gives_up(db, db_factory) -> None:
    """`max_attempts` is a count kept across drains, and nothing was checking it.

    Every existing test here drains once, so a row whose attempt counter failed
    to advance - stuck reading a stale value from the claim, say - would retry
    for ever and the suite would stay green. This walks a flaky provider to the
    limit and checks the backoff it is charged on the way.
    """
    await enqueue_notification(db, message())
    await db.commit()
    provider = FakeProvider(error=TemporaryNotificationError("SMTP padło"))
    start = datetime(2027, 3, 1, tzinfo=UTC)

    seen = []
    for drain in range(4):
        now = start + timedelta(hours=drain)
        stats = await drain_outbox(db_factory, {"email": provider}, now=now, max_attempts=4)
        async with db_factory() as reader:
            row = await reader.scalar(select(NotificationOutbox))
        seen.append((stats, row.attempts, row.status, row.next_attempt_at))

    assert [attempts for _stats, attempts, _status, _next in seen] == [1, 2, 3, 4]
    assert [status for _stats, _attempts, status, _next in seen] == [
        NotificationStatus.pending,
        NotificationStatus.pending,
        NotificationStatus.pending,
        NotificationStatus.failed,
    ]
    assert [stats["retried"] for stats, *_ in seen] == [1, 1, 1, 0]
    assert seen[-1][0]["failed"] == 1

    # And the backoff each retry was charged, from the attempt it had just
    # made. Compared without zones: SQLite stores these naive, and the point
    # here is the interval, which PostgreSQL and SQLite agree on.
    scheduled = [next_at.replace(tzinfo=None) for *_head, next_at in seen[:3]]
    assert scheduled == [
        (start + retry_delay(1)).replace(tzinfo=None),
        (start + timedelta(hours=1) + retry_delay(2)).replace(tzinfo=None),
        (start + timedelta(hours=2) + retry_delay(3)).replace(tzinfo=None),
    ]
