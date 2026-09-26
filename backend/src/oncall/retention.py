"""Retention: what the worker deletes, how old it must be, and in what batches.

Five tables grow with use and are read only for a while: the audit trail,
the notification outbox, finished generation runs, and the sessions and
account links that have expired. Nothing else in the application ever
deletes a row of theirs, so without this module a deployment's database
grows for as long as it is used.

Each rule names one table, the rows of it that are expired at a moment, and
how old is old. A pass over the rules deletes the oldest expired rows first,
`batch_size` at a time, each batch in a unit of work of its own, and stops
after `max_batches` per rule, so that a first pass over an old database is
bounded rather than one long transaction; whatever it left is simply older
still on the next pass. Every batch is a function of the clock alone, with
no watermark or bookkeeping row, so a pass interrupted anywhere has done
nothing the next pass would not have done anyway, and two workers pruning at
once only find each other's rows already gone.

The audit trail is not one kind of data. Sign-in records are a security log
with a rhythm of their own and are the bulk of the table; business events
are the history an administrator reads back, so they keep for longer; and
the override records a republish reads to tell a safe carry from a conflict
(`OVERRIDE_ORIGIN_ACTIONS`) are inputs to a live feature, so they are never
expired at all.
"""

import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Self, cast

from sqlalchemy import CursorResult, Select, delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from oncall.config import Settings
from oncall.database import SqlAlchemyUnitOfWork
from oncall.domain.scheduling.models import RunState
from oncall.domain.scheduling.publication import OVERRIDE_ORIGIN_ACTIONS
from oncall.infrastructure.sqlalchemy.access_models import AccountToken, Session
from oncall.infrastructure.sqlalchemy.audit_model import AuditEvent
from oncall.infrastructure.sqlalchemy.notification_models import (
    NotificationOutbox,
    NotificationStatus,
)
from oncall.infrastructure.sqlalchemy.scheduling_models import ScheduleRun

#: The sign-in records: one per sign-in and per refused attempt, plus the
#: rolling failure and throttle series. The login throttle reads the last
#: five minutes of these, so any retention of a day or more is safe for it.
LOGIN_ACTIONS = (
    "auth.login",
    "auth.login_attempt",
    "auth.login_failed",
    "auth.throttled",
    "auth.ldap_unavailable",
)

#: Audit rows a republish still reads, however old: never expired. Imported
#: rather than copied, so an action added to that reader is protected here
#: without a second edit.
PROTECTED_ACTIONS = OVERRIDE_ORIGIN_ACTIONS

#: Outbox rows nobody will deliver again: delivered, given up on, or parked
#: because the channel is off. A pending or claimed row is live work.
FINISHED_OUTBOX = (
    NotificationStatus.sent,
    NotificationStatus.failed,
    NotificationStatus.skipped,
)

#: Generation runs a lane has let go of. A queued or running run is live.
FINISHED_RUNS = (RunState.completed, RunState.failed)

#: An expired session or account link is dead the moment it expires: a
#: missing row and an expired one get the same answer. The rule still waits a
#: day past the expiry so that its cutoff is behind the clock, never on it.
EXPIRY_GRACE_DAYS = 1

#: A mapped row one of the rules deletes.
Pruned = AuditEvent | NotificationOutbox | ScheduleRun | Session | AccountToken

IdSelect = Select[uuid.UUID]


def _expired_audit(cutoff: datetime) -> IdSelect:
    return (
        select(AuditEvent.id)
        .where(
            AuditEvent.occurred_at < cutoff,
            AuditEvent.action.not_in(LOGIN_ACTIONS + PROTECTED_ACTIONS),
        )
        .order_by(AuditEvent.occurred_at)
    )


def _expired_logins(cutoff: datetime) -> IdSelect:
    return (
        select(AuditEvent.id)
        .where(AuditEvent.occurred_at < cutoff, AuditEvent.action.in_(LOGIN_ACTIONS))
        .order_by(AuditEvent.occurred_at)
    )


def _expired_outbox(cutoff: datetime) -> IdSelect:
    # `created_at` rather than `sent_at`, so one indexed column serves the
    # sent, failed and skipped rows alike; a row is sent within hours of its
    # creation at most, which is noise against an age measured in days.
    return (
        select(NotificationOutbox.id)
        .where(
            NotificationOutbox.created_at < cutoff,
            NotificationOutbox.status.in_(FINISHED_OUTBOX),
        )
        .order_by(NotificationOutbox.created_at)
    )


def _expired_runs(cutoff: datetime) -> IdSelect:
    return (
        select(ScheduleRun.id)
        .where(ScheduleRun.created_at < cutoff, ScheduleRun.status.in_(FINISHED_RUNS))
        .order_by(ScheduleRun.created_at)
    )


def _expired_sessions(cutoff: datetime) -> IdSelect:
    return select(Session.id).where(Session.expires_at < cutoff).order_by(Session.expires_at)


def _expired_tokens(cutoff: datetime) -> IdSelect:
    return (
        select(AccountToken.id)
        .where(AccountToken.expires_at < cutoff)
        .order_by(AccountToken.expires_at)
    )


@dataclass(frozen=True)
class Rule:
    """One table's retention: its name in the metrics record, the age in days
    (0 keeps the table for ever), the table, and its expired ids oldest first
    at a cutoff."""

    name: str
    days: int
    table: type[Pruned]
    expired: Callable[[datetime], IdSelect]

    @property
    def enabled(self) -> bool:
        return self.days > 0


@dataclass(frozen=True)
class RetentionPolicy:
    """The ages and the batching, read once from the settings so that one
    pass sees one policy."""

    audit_days: int
    login_audit_days: int
    outbox_days: int
    runs_days: int
    batch_size: int
    max_batches: int

    @classmethod
    def from_settings(cls, settings: Settings) -> Self:
        return cls(
            audit_days=settings.retention_audit_days,
            login_audit_days=settings.retention_login_audit_days,
            outbox_days=settings.retention_outbox_days,
            runs_days=settings.retention_runs_days,
            batch_size=settings.retention_batch_size,
            max_batches=settings.retention_max_batches,
        )

    def rules(self) -> tuple[Rule, ...]:
        return (
            Rule("audit", self.audit_days, AuditEvent, _expired_audit),
            Rule("logins", self.login_audit_days, AuditEvent, _expired_logins),
            Rule("outbox", self.outbox_days, NotificationOutbox, _expired_outbox),
            Rule("runs", self.runs_days, ScheduleRun, _expired_runs),
            Rule("sessions", EXPIRY_GRACE_DAYS, Session, _expired_sessions),
            Rule("tokens", EXPIRY_GRACE_DAYS, AccountToken, _expired_tokens),
        )


@dataclass
class RetentionReport:
    """What one pass deleted, per rule, and which rules hit their cap.

    Every rule is present, a disabled one with 0, so the metrics record has
    the same fields on every pass and a field can be followed across them.
    """

    deleted: dict[str, int] = field(default_factory=dict)
    capped: list[str] = field(default_factory=list)

    def fields(self) -> dict[str, int]:
        """The counts as one metrics record, plus how many rules were capped."""
        return {**self.deleted, "capped": len(self.capped)}


async def delete_batch(db: AsyncSession, rule: Rule, *, cutoff: datetime, batch_size: int) -> int:
    """Stage the deletion of one batch of a rule's oldest expired rows and
    answer with how many; the caller's unit of work writes it.

    The ids come from a subquery ordered by age and limited, which every
    database here runs on the table's timestamp index. A bulk statement whose
    only answer is a count, so the session synchronises nothing.
    """
    ids = rule.expired(cutoff).limit(batch_size)
    result = await db.execute(
        delete(rule.table)
        .where(rule.table.id.in_(ids))
        .execution_options(synchronize_session=False)
    )
    return cast(CursorResult[Any], result).rowcount


async def prune_expired(
    factory: async_sessionmaker[AsyncSession], policy: RetentionPolicy, *, now: datetime
) -> RetentionReport:
    """One pass: every enabled rule, oldest rows first, one unit of work per
    batch, at most `max_batches` batches per rule."""
    report = RetentionReport()
    for rule in policy.rules():
        report.deleted[rule.name] = 0
        if not rule.enabled:
            continue
        cutoff = now - timedelta(days=rule.days)
        for _ in range(policy.max_batches):
            async with SqlAlchemyUnitOfWork(factory) as db:
                count = await delete_batch(db, rule, cutoff=cutoff, batch_size=policy.batch_size)
            report.deleted[rule.name] += count
            if count < policy.batch_size:
                break
        else:
            # Every batch came back full: the table has more the next pass
            # will go on with.
            report.capped.append(rule.name)
    return report


__all__ = [
    "EXPIRY_GRACE_DAYS",
    "FINISHED_OUTBOX",
    "FINISHED_RUNS",
    "LOGIN_ACTIONS",
    "PROTECTED_ACTIONS",
    "RetentionPolicy",
    "RetentionReport",
    "Rule",
    "delete_batch",
    "prune_expired",
]
