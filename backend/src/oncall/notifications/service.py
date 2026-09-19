"""Transactional outbox for notifications.

Writers enqueue rows inside the same database transaction as the business
change, so a notification is never lost nor sent for rolled-back data. The
worker drains pending rows and delivers them through the provider registered
for the row's channel.

**Delivery is at-least-once** (decision D-03). A provider call is network I/O
to somebody else's server, and there is no way to hand a message over and
record that fact in one atomic step: whichever order they happen in, a process
that dies between them leaves the two disagreeing. This module chooses the
order that loses nothing - send first, record after - and therefore accepts
that a message can go out twice.

What it does not accept is sending a *batch* twice, which is what a single
transaction wrapped around a whole drain costs. A drain is now three
separated steps: one short transaction claims a batch under a lease, each
message is sent with no transaction open and no lock held, and each outcome is
recorded on its own. A crash can therefore duplicate one message, never more,
and never one that was already recorded.

Every message carries `idempotency_key`, the outbox row's own id, stable across
every retry of that row. It is what lets a provider recognise a repeat - the
SMTP provider spends it as a fixed `Message-ID`.
"""

import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, case, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from oncall.domain.clock import as_utc
from oncall.models import NotificationOutbox, NotificationStatus
from oncall.notifications.base import (
    NotificationDisabled,
    NotificationError,
    NotificationMessage,
    NotificationProvider,
    TemporaryNotificationError,
)

logger = logging.getLogger(__name__)

MAX_ERROR_LENGTH = 500

#: Lease length when a caller does not name one; the worker passes the
#: configured `notification_lease_seconds`.
DEFAULT_LEASE = timedelta(minutes=5)


def retry_delay(attempts: int) -> timedelta:
    """Exponential backoff: 1 min, 2 min, 4 min, ... capped at 1 hour."""
    return timedelta(seconds=min(60 * 2**attempts, 3600))


async def enqueue_notification(
    db: AsyncSession,
    message: NotificationMessage,
    *,
    dedup_key: str | None = None,
) -> uuid.UUID | None:
    """Add a pending outbox row; returns None when dedup_key already exists.

    Does not commit: the caller's transaction guarantees atomicity with the
    business change that triggered the notification.
    """
    if dedup_key is not None:
        existing = await db.scalar(
            select(NotificationOutbox.id).where(NotificationOutbox.dedup_key == dedup_key)
        )
        if existing is not None:
            return None
    row = NotificationOutbox(
        channel=message.channel,
        recipient=message.recipient,
        subject=message.subject[:200],
        body=message.body,
        context=message.context or None,
        dedup_key=dedup_key,
    )
    db.add(row)
    await db.flush()
    return row.id


#: Outbox rows a drain may take: never delivered, delivered nowhere because the
#: channel was off, or claimed by a worker whose lease has since run out.
CLAIMABLE_STATES = (
    NotificationStatus.pending,
    NotificationStatus.skipped,
    NotificationStatus.claimed,
)


@dataclass(frozen=True)
class OutboxHealth:
    """The outbox as an operator watches it, at one moment.

    Split by what a drain would do with each row rather than by status, because
    that is the question being asked: `eligible` is work owed right now, and
    `oldest_eligible_seconds` is how long the oldest of it has been owed - the
    number that says whether the worker is keeping up or has stopped.

    `waiting` is everything not terminal and not yet due: rows serving a
    backoff, rows a worker holds under a lease, and rows parked a day out
    because their channel is disabled. They are counted apart so a deliberately
    disabled SMTP channel cannot make the age of the eligible queue scream for
    ever, and counted at all so nothing becomes invisible.
    """

    eligible: int
    oldest_eligible_seconds: float
    retrying: int
    attempts_max: int
    waiting: int
    dead: int


def _count(condition: ColumnElement[bool]) -> ColumnElement[int]:
    """How many rows of one aggregate read satisfy a condition."""
    return func.coalesce(func.sum(case((condition, 1), else_=0)), 0)


async def outbox_health(db: AsyncSession, *, now: datetime) -> OutboxHealth:
    """Measure the outbox in one read.

    Deliberately one statement on an indexed predicate: this is sampled on a
    timer for the life of the worker, so its cost must not grow with the size
    of the table.
    """
    claimable = NotificationOutbox.status.in_(CLAIMABLE_STATES)
    eligible = and_(claimable, NotificationOutbox.next_attempt_at <= now)
    row = (
        await db.execute(
            select(
                _count(eligible),
                func.min(case((eligible, NotificationOutbox.created_at))),
                _count(and_(eligible, NotificationOutbox.attempts > 0)),
                func.coalesce(func.max(case((eligible, NotificationOutbox.attempts))), 0),
                _count(and_(claimable, NotificationOutbox.next_attempt_at > now)),
                _count(NotificationOutbox.status == NotificationStatus.failed),
            )
        )
    ).one()
    oldest = row[1]
    return OutboxHealth(
        eligible=row[0],
        oldest_eligible_seconds=(
            max(0.0, (now - as_utc(oldest)).total_seconds()) if oldest else 0.0
        ),
        retrying=row[2],
        attempts_max=row[3],
        waiting=row[4],
        dead=row[5],
    )


async def _claim_batch(
    db: AsyncSession, *, now: datetime, batch_size: int, lease: timedelta
) -> list[NotificationOutbox]:
    """Take a batch off the eligible list in one short transaction.

    A lease, not a hand-off: the claim moves `next_attempt_at` forward rather
    than taking the row out of circulation, so a worker that dies holding a
    message leaves something that goes out when the lease expires instead of
    something nobody will look at again. `SKIP LOCKED` keeps two workers off
    each other's rows, and the transaction closes before anything is awaited,
    so no lock is held across a provider call.
    """
    rows = (
        await db.scalars(
            select(NotificationOutbox)
            .where(
                NotificationOutbox.status.in_(CLAIMABLE_STATES),
                NotificationOutbox.next_attempt_at <= now,
            )
            .order_by(NotificationOutbox.created_at)
            .limit(batch_size)
            .with_for_update(skip_locked=True)
        )
    ).all()
    for row in rows:
        row.status = NotificationStatus.claimed
        row.next_attempt_at = now + lease
    await db.commit()
    return list(rows)


async def _record(db: AsyncSession, row_id: uuid.UUID, **values: object) -> None:
    """Write one row's outcome, alone, and commit.

    A statement rather than an attribute write: the claimed batch is all in
    this session's identity map, and mutating rows as the loop walks them would
    let one commit flush outcomes for messages that have not been sent yet.

    The statement still synchronises back into those loaded rows, which is
    wanted here rather than merely tolerated: it is what keeps `row.attempts`
    telling the truth if the same row is drained again on the same session.
    """
    await db.execute(
        update(NotificationOutbox).where(NotificationOutbox.id == row_id).values(**values)
    )
    await db.commit()


def _outcome(
    row: NotificationOutbox, exc: Exception | None, *, now: datetime, max_attempts: int
) -> tuple[str, dict[str, object]]:
    """What one delivery attempt did, as a stat name and a row update."""
    if exc is None:
        return "sent", {
            "status": NotificationStatus.sent,
            "sent_at": now,
            "last_error": None,
        }
    error = str(exc)[:MAX_ERROR_LENGTH]
    if isinstance(exc, NotificationDisabled):
        # Keep disabled-channel messages recoverable. Once SMTP is enabled,
        # skipped rows become eligible again without a manual DB repair, and
        # the attempt is not counted against them: nothing was attempted.
        return "skipped", {
            "status": NotificationStatus.skipped,
            "last_error": error,
            "next_attempt_at": now + timedelta(days=1),
        }
    if isinstance(exc, NotificationError) and not isinstance(exc, TemporaryNotificationError):
        return "failed", {"status": NotificationStatus.failed, "last_error": error}
    attempts = row.attempts + 1
    if attempts >= max_attempts:
        return "failed", {
            "status": NotificationStatus.failed,
            "attempts": attempts,
            "last_error": error,
        }
    return "retried", {
        "status": NotificationStatus.pending,
        "attempts": attempts,
        "last_error": error,
        "next_attempt_at": now + retry_delay(attempts),
    }


async def _deliver(row: NotificationOutbox, providers: dict[str, NotificationProvider]) -> None:
    """Hand one row to its provider, or raise the reason it could not go."""
    provider = providers.get(row.channel.value)
    if provider is None:
        raise NotificationError(f"Brak providera dla kanału {row.channel.value}")
    await provider.send(
        NotificationMessage(
            channel=row.channel.value,
            recipient=row.recipient,
            subject=row.subject,
            body=row.body,
            context=row.context or {},
            idempotency_key=str(row.id),
        )
    )


async def drain_outbox(
    db: AsyncSession,
    providers: dict[str, NotificationProvider],
    *,
    now: datetime | None = None,
    batch_size: int = 20,
    max_attempts: int = 5,
    lease: timedelta = DEFAULT_LEASE,
) -> dict[str, int]:
    """Deliver a batch of eligible notifications; commits as it goes."""
    now = now or datetime.now(UTC)
    rows = await _claim_batch(db, now=now, batch_size=batch_size, lease=lease)
    stats = {"sent": 0, "retried": 0, "failed": 0, "skipped": 0}
    for row in rows:
        try:
            await _deliver(row, providers)
        except Exception as exc:  # noqa: BLE001 - every outcome is a row state
            if not isinstance(exc, NotificationError):
                logger.exception("Unexpected provider error for outbox row %s", row.id)
            name, values = _outcome(row, exc, now=now, max_attempts=max_attempts)
        else:
            name, values = _outcome(row, None, now=now, max_attempts=max_attempts)
        await _record(db, row.id, **values)
        stats[name] += 1
    return stats
