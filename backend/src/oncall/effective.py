"""Which assignment is actually in force for a given day and role.

Several schedules can legitimately cover the same date: a month is published,
then a fortnight inside it is regenerated and published again. The one in force
for each slot is the one from the most recently published schedule.

Resolving per slot, rather than picking a single winning schedule, is what keeps
a partial republication from blanking out the days around it. Historical CSV
imports take part too: `routes/history.py` stores them as ``superseded`` with a
``published_at``, so they lose to any real publication of the same slot but
still count where nothing else covers it.

That same per-slot resolution is why the 11-19 rule is enforced here rather than
only in the generator: a Saturday 11-19 slot is simply absent from a schedule
built under the rule, so without this filter an older schedule from before the
rule would keep winning the slot and the shift would stay visible forever.
"""

import asyncio
import time
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.models import Assignment, AssignmentRole, Schedule, ScheduleStatus
from oncall.workdays import is_working_day, polish_holidays

#: Statuses that describe duty actually served or scheduled to be served.
#: ``superseded`` is included because it carries both replaced publications and
#: imported history, and a replaced slot always loses to its replacement anyway.
RESOLVED_STATUSES = (ScheduleStatus.published, ScheduleStatus.superseded)

#: Publications without a timestamp sort first, so anything dated beats them.
_EPOCH = datetime.min.replace(tzinfo=UTC)


@dataclass(frozen=True)
class EffectiveAssignment:
    service_date: date
    role: AssignmentRole
    #: Identity of the person on duty. None for rows that predate the foreign key
    #: or that name somebody who was never a team member (imported history).
    member_id: uuid.UUID | None
    #: Label. Kept because it is the only identity those null-id rows have.
    assignee_name: str
    is_override: bool
    schedule_id: object
    schedule_version: int
    schedule_status: ScheduleStatus
    published_at: datetime | None


_CACHE_LIMIT = 64
_effective_cache: dict[
    tuple[date, date], tuple[float, dict[tuple[date, AssignmentRole], EffectiveAssignment]]
] = {}
_effective_locks: dict[tuple[date, date], asyncio.Lock] = {}


async def effective_assignments(
    db: AsyncSession,
    starts_on: date,
    ends_on: date,
) -> dict[tuple[date, AssignmentRole], EffectiveAssignment]:
    """The assignment in force for every covered (date, role) in the range."""
    # The calendar, published schedule and fairness endpoints repeatedly resolve
    # the same immutable publication rows.  Cache only this authorization-free
    # data layer, never a user response.  SQLite tests remain uncached so writes
    # and reads in one test transaction retain exact read-after-write semantics.
    from oncall.config import get_settings

    cache_seconds = (
        get_settings().effective_assignments_cache_seconds
        if db.bind is not None and db.bind.dialect.name == "postgresql"
        else 0
    )
    cache_key = (starts_on, ends_on)
    now = time.monotonic()
    cached = _effective_cache.get(cache_key)
    if cache_seconds and cached is not None and cached[0] > now:
        return cached[1]
    if cache_seconds:
        lock = _effective_locks.setdefault(cache_key, asyncio.Lock())
        async with lock:
            now = time.monotonic()
            cached = _effective_cache.get(cache_key)
            if cached is not None and cached[0] > now:
                return cached[1]
            result = await _load_effective_assignments(db, starts_on, ends_on)
            if len(_effective_cache) >= _CACHE_LIMIT:
                expired = [key for key, (until, _) in _effective_cache.items() if until <= now]
                oldest = min(_effective_cache, key=lambda key: _effective_cache[key][0])
                for key in expired or [oldest]:
                    _effective_cache.pop(key, None)
                    _effective_locks.pop(key, None)
            _effective_cache[cache_key] = (now + cache_seconds, result)
            return result
    return await _load_effective_assignments(db, starts_on, ends_on)


async def _load_effective_assignments(
    db: AsyncSession,
    starts_on: date,
    ends_on: date,
) -> dict[tuple[date, AssignmentRole], EffectiveAssignment]:
    rows = (
        await db.execute(
            select(Assignment, Schedule)
            .join(Schedule, Assignment.schedule_id == Schedule.id)
            .where(
                Schedule.status.in_(RESOLVED_STATUSES),
                Assignment.service_date >= starts_on,
                Assignment.service_date <= ends_on,
            )
        )
    ).all()
    # Real publications decide every slot; imported history only fills the gaps.
    # ``published_at`` alone is not enough: a CSV is stamped at import time and
    # would look newer than an earlier real publication. Sorting any import
    # before all real schedules means a publication always overwrites it per
    # slot, regardless of timestamps (HGH-05).
    rows.sort(
        key=lambda row: (
            not row[1].name.startswith("Import historii:"),
            row[1].published_at or _EPOCH,
            str(row[1].id),
        )
    )
    holidays = polish_holidays(starts_on, ends_on)
    resolved: dict[tuple[date, AssignmentRole], EffectiveAssignment] = {}
    for assignment, schedule in rows:
        if assignment.role == AssignmentRole.late_shift and not is_working_day(
            assignment.service_date, holidays
        ):
            continue
        resolved[(assignment.service_date, assignment.role)] = EffectiveAssignment(
            service_date=assignment.service_date,
            role=assignment.role,
            member_id=assignment.member_id,
            assignee_name=assignment.assignee_name,
            is_override=assignment.is_override,
            schedule_id=schedule.id,
            schedule_version=schedule.version,
            schedule_status=schedule.status,
            published_at=schedule.published_at,
        )
    return resolved


def sorted_assignments(
    resolved: dict[tuple[date, AssignmentRole], EffectiveAssignment],
) -> list[EffectiveAssignment]:
    return sorted(resolved.values(), key=lambda item: (item.service_date, item.role.value))


def matches_member(item: EffectiveAssignment, member_id: uuid.UUID, display_name: str) -> bool:
    """Whether this duty belongs to the given member.

    Prefers the identity; falls back to the label only for rows that have no id,
    so a renamed member keeps their history while imported rows still count.
    """
    if item.member_id is not None:
        return item.member_id == member_id
    return item.assignee_name == display_name
