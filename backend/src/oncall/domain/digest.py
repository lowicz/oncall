"""The coordinators' word, each working day, on who is on duty.

On a Polish working day, once the digest hour has come, every coordinator and
admin is told who holds PRIMARY, SECONDARY and 11–19 today and on every day
off that follows, up to the next working day: a Friday's digest covers the
weekend, and the one before a holiday covers the holiday. A day off brings no
digest of its own, so nobody is written to on one. A role nobody holds is said
to be a gap rather than left out, and days no schedule in force reaches are
all gaps and still sent: those are the days a coordinator most needs the mail.
"""

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from enum import StrEnum
from typing import Protocol

from oncall.domain.ports import PublishedRoster
from oncall.domain.vocabulary import AssignmentRole
from oncall.workdays import is_polish_working_day, next_working_day


class Gap(StrEnum):
    """Why a role has nobody on a day, in the words the mail says it in."""

    #: The role serves that day and no duty in force names anybody.
    unstaffed = "brak obsady"
    #: 11–19 on a day that is not a Polish working day: there is no shift,
    #: and the duties in force never name one.
    day_off = "brak dyżuru (dzień wolny)"


@dataclass(frozen=True)
class DayDuties:
    """Who is on duty on one day."""

    day: date
    #: In the order a day's roles are read in: PRIMARY, SECONDARY, 11–19. Each
    #: with the name of whoever holds it, or why nobody does.
    holders: tuple[tuple[AssignmentRole, str | Gap], ...]


@dataclass(frozen=True)
class DutyDigest:
    """One working day's digest."""

    #: The working day it is sent on, then the days off that follow it.
    days: tuple[DayDuties, ...]

    @property
    def sent_on(self) -> date:
        return self.days[0].day


class DigestRecipients(Protocol):
    async def send(self, digest: DutyDigest) -> int:
        """Queue the digest for every coordinator and admin who was not sent
        this day's before; answers how many were queued now."""
        ...


@dataclass(frozen=True)
class DigestPorts:
    roster: PublishedRoster
    recipients: DigestRecipients


async def digest_for(working_day: date, roster: PublishedRoster) -> DutyDigest:
    """The digest of a working day, read from the duties in force: that day
    and every day before the next working one."""
    following = next_working_day(working_day)
    duties = await roster.duties_in_force(working_day, following - timedelta(days=1))
    days = []
    for offset in range((following - working_day).days):
        day = working_day + timedelta(days=offset)
        holders: list[tuple[AssignmentRole, str | Gap]] = []
        for role in AssignmentRole:
            duty = duties.get((day, role))
            if duty is not None:
                holders.append((role, duty.assignee_name))
            elif role is AssignmentRole.late_shift and not is_polish_working_day(day):
                holders.append((role, Gap.day_off))
            else:
                holders.append((role, Gap.unstaffed))
        days.append(DayDuties(day=day, holders=tuple(holders)))
    return DutyDigest(days=tuple(days))


async def send_daily_digest(now_local: datetime, digest_hour: int, ports: DigestPorts) -> int:
    """Queue today's digest once the digest hour of a working day has come;
    answers how many were queued now. A scan later the same day reaches
    whoever has not had it - the worker was down at the hour, or the account
    is new - and otherwise answers 0. A day off queues nothing, whatever the
    working day before it missed."""
    today = now_local.date()
    if now_local.hour < digest_hour or not is_polish_working_day(today):
        return 0
    return await ports.recipients.send(await digest_for(today, ports.roster))
