"""The coordinators' daily word on who is on duty today.

Once the digest hour has come, every coordinator and admin is told who holds
PRIMARY, SECONDARY and 11–19 today. It goes out every day, weekends and
holidays included, because PRIMARY and SECONDARY serve on all of them, and a
role nobody holds is said to be a gap rather than left out. A day no schedule
in force reaches is three gaps, and is still sent: that is the day a
coordinator most needs the mail.
"""

from dataclasses import dataclass
from datetime import date, datetime
from enum import StrEnum
from typing import Protocol

from oncall.domain.ports import PublishedRoster
from oncall.domain.vocabulary import AssignmentRole
from oncall.workdays import is_polish_working_day


class Gap(StrEnum):
    """Why a role has nobody today, in the words the mail says it in."""

    #: The role serves today and no duty in force names anybody.
    unstaffed = "brak obsady"
    #: 11–19 on a day that is not a Polish working day: there is no shift,
    #: and the duties in force never name one.
    day_off = "brak dyżuru (dzień wolny)"


@dataclass(frozen=True)
class DutyDigest:
    """Who is on duty on one day."""

    day: date
    #: In the order a day's roles are read in: PRIMARY, SECONDARY, 11–19. Each
    #: with the name of whoever holds it, or why nobody does.
    holders: tuple[tuple[AssignmentRole, str | Gap], ...]


class DigestRecipients(Protocol):
    async def send(self, digest: DutyDigest) -> int:
        """Queue the digest for every coordinator and admin who was not sent
        this day's before; answers how many were queued now."""
        ...


@dataclass(frozen=True)
class DigestPorts:
    roster: PublishedRoster
    recipients: DigestRecipients


async def digest_for(day: date, roster: PublishedRoster) -> DutyDigest:
    """The day's digest, read from the duties in force."""
    duties = await roster.duties_in_force(day, day)
    holders: list[tuple[AssignmentRole, str | Gap]] = []
    for role in AssignmentRole:
        duty = duties.get((day, role))
        if duty is not None:
            holders.append((role, duty.assignee_name))
        elif role is AssignmentRole.late_shift and not is_polish_working_day(day):
            holders.append((role, Gap.day_off))
        else:
            holders.append((role, Gap.unstaffed))
    return DutyDigest(day=day, holders=tuple(holders))


async def send_daily_digest(now_local: datetime, digest_hour: int, ports: DigestPorts) -> int:
    """Queue today's digest once the digest hour has come; answers how many
    were queued now. A scan later the same day reaches whoever has not had
    it - the worker was down at the hour, or the account is new - and
    otherwise answers 0."""
    if now_local.hour < digest_hour:
        return 0
    return await ports.recipients.send(await digest_for(now_local.date(), ports.roster))
