"""What the worker deletes and, more importantly, what it never touches.

Retention is the one place in the application that deletes history, so
every rule is pinned from both sides: the rows past their age go, and the
rows that are younger, live, or protected stay. The batching is pinned too,
because a first pass over an old database has to be bounded and resumable,
and the wiring, because a rule nobody runs deletes nothing.
"""

import logging
import uuid
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.config import Settings
from oncall.domain.scheduling.models import RunState
from oncall.domain.scheduling.publication import OVERRIDE_ORIGIN_ACTIONS
from oncall.domain.vocabulary import AccountTokenKind, UserRole
from oncall.infrastructure.sqlalchemy.access_models import AccountToken, Session
from oncall.infrastructure.sqlalchemy.audit_model import AuditEvent
from oncall.infrastructure.sqlalchemy.notification_models import (
    NotificationChannel,
    NotificationOutbox,
    NotificationStatus,
)
from oncall.infrastructure.sqlalchemy.scheduling_models import ScheduleRun
from oncall.retention import PROTECTED_ACTIONS, RetentionPolicy, prune_expired
from oncall.worker import retention_cycle
from tests.conftest import create_user

NOW = datetime(2026, 9, 26, 12, 0, tzinfo=UTC)
DAY = timedelta(days=1)

#: The accepted defaults: business audit a year, sign-ins a quarter, the
#: outbox a quarter, finished runs a month.
POLICY = RetentionPolicy(
    audit_days=365,
    login_audit_days=90,
    outbox_days=90,
    runs_days=30,
    batch_size=1000,
    max_batches=20,
)


def _audit(action: str, age: timedelta) -> AuditEvent:
    return AuditEvent(
        occurred_at=NOW - age,
        actor_label="anna",
        action=action,
        entity_type="schedule",
        entity_id=str(uuid.uuid4()),
        summary="x",
    )


def _mail(status: NotificationStatus, age: timedelta) -> NotificationOutbox:
    return NotificationOutbox(
        channel=NotificationChannel.email,
        recipient="anna@example.com",
        subject="s",
        body="b",
        status=status,
        attempts=1,
        next_attempt_at=NOW - age,
        created_at=NOW - age,
        sent_at=NOW - age if status is NotificationStatus.sent else None,
    )


def _run(status: RunState, age: timedelta, requester: uuid.UUID) -> ScheduleRun:
    return ScheduleRun(
        starts_on=date(2026, 10, 1),
        ends_on=date(2026, 10, 31),
        requested_by_id=requester,
        status=status,
        progress=100,
        created_at=NOW - age,
        updated_at=NOW - age,
    )


async def _count(db: AsyncSession, model: type) -> int:
    return (await db.scalar(select(func.count()).select_from(model))) or 0


async def _actions(db: AsyncSession) -> list[str]:
    return sorted((await db.scalars(select(AuditEvent.action))).all())


def test_the_policy_reads_the_accepted_defaults_from_the_settings() -> None:
    assert RetentionPolicy.from_settings(Settings()) == POLICY


def test_the_protected_actions_are_the_ones_a_republish_reads() -> None:
    """Imported, not copied: an action added to the republish reader is
    protected here without a second edit."""
    assert PROTECTED_ACTIONS is OVERRIDE_ORIGIN_ACTIONS
    assert "schedule.override" in PROTECTED_ACTIONS


async def test_audit_rows_expire_by_tier_and_protected_actions_never(db, db_factory) -> None:
    db.add_all(
        [
            _audit("swap.created", 366 * DAY),  # business, past its age: goes
            _audit("swap.accepted", 364 * DAY),  # business, within: stays
            _audit("auth.login", 91 * DAY),  # sign-in, past its age: goes
            _audit("auth.login_attempt", 91 * DAY),  # refused attempt: goes
            _audit("auth.throttled", 91 * DAY),  # throttle series: goes
            _audit("auth.login", 89 * DAY),  # sign-in, within: stays
            _audit("auth.login", timedelta(minutes=2)),  # what the throttle reads: stays
            _audit("auth.login", 3000 * DAY),  # a sign-in is never business audit
            _audit("schedule.override", 3000 * DAY),  # republish input: never
            _audit("schedule.override_batch", 3000 * DAY),
            _audit("schedule.draft_override", 3000 * DAY),
            _audit("schedule.override_carried", 3000 * DAY),  # a result, not an input: goes
        ]
    )
    await db.commit()

    report = await prune_expired(db_factory, POLICY, now=NOW)

    assert report.deleted["audit"] == 2
    assert report.deleted["logins"] == 4
    assert await _actions(db) == [
        "auth.login",
        "auth.login",
        "schedule.draft_override",
        "schedule.override",
        "schedule.override_batch",
        "swap.accepted",
    ]


async def test_outbox_keeps_live_rows_and_expires_finished_ones(db, db_factory) -> None:
    db.add_all(
        [
            _mail(NotificationStatus.sent, 91 * DAY),
            _mail(NotificationStatus.failed, 91 * DAY),
            _mail(NotificationStatus.skipped, 91 * DAY),
            _mail(NotificationStatus.sent, 89 * DAY),
            _mail(NotificationStatus.pending, 400 * DAY),  # live work, however old
            _mail(NotificationStatus.claimed, 400 * DAY),
        ]
    )
    await db.commit()

    report = await prune_expired(db_factory, POLICY, now=NOW)

    assert report.deleted["outbox"] == 3
    statuses = sorted((await db.scalars(select(NotificationOutbox.status))).all())
    assert statuses == [
        NotificationStatus.claimed,
        NotificationStatus.pending,
        NotificationStatus.sent,
    ]


async def test_finished_runs_expire_and_active_runs_stay(db, db_factory) -> None:
    user = await create_user(db, "anna", role=UserRole.coordinator)
    db.add_all(
        [
            _run(RunState.completed, 31 * DAY, user.id),
            _run(RunState.failed, 31 * DAY, user.id),
            _run(RunState.completed, 29 * DAY, user.id),
            _run(RunState.queued, 400 * DAY, user.id),
            _run(RunState.running, 400 * DAY, user.id),
        ]
    )
    await db.commit()

    report = await prune_expired(db_factory, POLICY, now=NOW)

    assert report.deleted["runs"] == 2
    assert sorted((await db.scalars(select(ScheduleRun.status))).all()) == [
        "completed",
        "queued",
        "running",
    ]


async def test_expired_sessions_and_links_go_and_live_ones_stay(db, db_factory) -> None:
    user = await create_user(db, "anna")
    db.add_all(
        [
            Session(user_id=user.id, token_hash="a" * 64, csrf_token="c", expires_at=NOW - 2 * DAY),
            # Expired, but not yet a day ago: the cutoff stays behind the clock.
            Session(user_id=user.id, token_hash="b" * 64, csrf_token="c", expires_at=NOW - DAY / 2),
            Session(user_id=user.id, token_hash="c" * 64, csrf_token="c", expires_at=NOW + DAY),
            AccountToken(
                user_id=user.id,
                kind=AccountTokenKind.password_reset,
                token_hash="d" * 64,
                expires_at=NOW - 2 * DAY,
                used_at=NOW - 3 * DAY,
            ),
            AccountToken(
                user_id=user.id,
                kind=AccountTokenKind.password_reset,
                token_hash="e" * 64,
                expires_at=NOW + DAY,
            ),
        ]
    )
    await db.commit()

    report = await prune_expired(db_factory, POLICY, now=NOW)

    assert report.deleted["sessions"] == 1
    assert report.deleted["tokens"] == 1
    assert await _count(db, Session) == 2
    assert await _count(db, AccountToken) == 1


async def test_a_zero_age_keeps_a_table_for_ever(db, db_factory) -> None:
    db.add_all([_audit("auth.login", 3000 * DAY), _audit("swap.created", 3000 * DAY)])
    await db.commit()

    report = await prune_expired(
        db_factory,
        RetentionPolicy(
            audit_days=0,
            login_audit_days=0,
            outbox_days=0,
            runs_days=0,
            batch_size=1000,
            max_batches=20,
        ),
        now=NOW,
    )

    # A disabled rule still reports, as zero, so the record keeps its shape.
    assert report.deleted == {
        "audit": 0,
        "logins": 0,
        "outbox": 0,
        "runs": 0,
        "sessions": 0,
        "tokens": 0,
    }
    assert await _count(db, AuditEvent) == 2


async def test_a_pass_is_bounded_oldest_first_and_the_next_pass_resumes(db, db_factory) -> None:
    db.add_all([_audit("auth.login", (100 + i) * DAY) for i in range(5)])
    await db.commit()
    policy = RetentionPolicy(
        audit_days=365,
        login_audit_days=90,
        outbox_days=90,
        runs_days=30,
        batch_size=2,
        max_batches=1,
    )

    first = await prune_expired(db_factory, policy, now=NOW)
    assert first.deleted["logins"] == 2
    assert first.capped == ["logins"]
    assert first.fields()["capped"] == 1
    left = sorted((await db.scalars(select(AuditEvent.occurred_at))).all())
    assert left[0].replace(tzinfo=UTC) == NOW - 102 * DAY, "the two oldest went first"

    second = await prune_expired(db_factory, policy, now=NOW)
    assert second.deleted["logins"] == 2 and second.capped == ["logins"]
    third = await prune_expired(db_factory, policy, now=NOW)
    assert third.deleted["logins"] == 1 and third.capped == []
    assert await _count(db, AuditEvent) == 0

    # Idempotent: a pass over a drained table deletes nothing and reports so.
    fourth = await prune_expired(db_factory, policy, now=NOW)
    assert fourth.deleted["logins"] == 0 and fourth.capped == []


async def test_a_pass_whose_every_batch_was_full_reports_the_cap(db, db_factory) -> None:
    """Exactly `batch_size` rows in `max_batches` batches: the cap was reached
    and there may be more, so the pass says so rather than guessing."""
    db.add_all([_audit("auth.login", (100 + i) * DAY) for i in range(4)])
    await db.commit()
    policy = RetentionPolicy(
        audit_days=0, login_audit_days=90, outbox_days=0, runs_days=0, batch_size=2, max_batches=2
    )

    report = await prune_expired(db_factory, policy, now=NOW)

    assert report.deleted["logins"] == 4
    assert report.capped == ["logins"], "every batch came back full, so there may be more"
    assert (await prune_expired(db_factory, policy, now=NOW)).capped == []


async def test_every_batch_is_its_own_unit_of_work(db, db_factory, monkeypatch) -> None:
    commits = 0
    commit = AsyncSession.commit

    async def counted(session: AsyncSession) -> None:
        nonlocal commits
        commits += 1
        await commit(session)

    monkeypatch.setattr(AsyncSession, "commit", counted)
    db.add_all([_audit("auth.login", (100 + i) * DAY) for i in range(5)])
    await db.commit()
    commits = 0
    policy = RetentionPolicy(
        audit_days=0, login_audit_days=90, outbox_days=0, runs_days=0, batch_size=2, max_batches=20
    )

    await prune_expired(db_factory, policy, now=NOW)

    # Three batches of logins (2, 2, 1) and one for each of the two rules that
    # take no age and matched nothing: a unit of work per batch, nothing wider.
    assert commits == 3 + 2


async def test_the_worker_reports_every_pass_even_an_empty_one(
    db_factory, caplog, monkeypatch
) -> None:
    caplog.set_level(logging.INFO, logger="oncall.metrics")
    monkeypatch.setattr("oncall.worker.utc_now", lambda: NOW)

    await retention_cycle(db_factory)

    records = [r.getMessage() for r in caplog.records if r.name == "oncall.metrics"]
    assert len(records) == 1
    fields = dict(part.split("=", 1) for part in records[0].split(" "))
    assert fields.pop("event") == "retention"
    assert float(fields.pop("seconds")) >= 0
    assert fields == {
        "audit": "0",
        "logins": "0",
        "outbox": "0",
        "runs": "0",
        "sessions": "0",
        "tokens": "0",
        "capped": "0",
    }


async def test_the_worker_prunes_by_the_settings_and_the_clock(
    db, db_factory, caplog, monkeypatch
) -> None:
    """The cycle reads the live settings and the application clock, so an
    operator's `.env` and nothing else decides what goes."""
    caplog.set_level(logging.INFO, logger="oncall.metrics")
    monkeypatch.setattr("oncall.worker.utc_now", lambda: NOW)
    monkeypatch.setattr(
        "oncall.worker.get_settings", lambda: Settings(retention_login_audit_days=30)
    )
    db.add_all([_audit("auth.login", 31 * DAY), _audit("auth.login", 29 * DAY)])
    await db.commit()

    report = await retention_cycle(db_factory)

    assert report.deleted["logins"] == 1
    assert await _count(db, AuditEvent) == 1
    assert "event=retention" in caplog.records[-1].getMessage()
    assert "logins=1" in caplog.records[-1].getMessage()
