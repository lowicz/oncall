"""What the sharing use cases take and give back."""

import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from oncall.domain.accounts import SignedInSession
from oncall.domain.clock import as_utc
from oncall.domain.roster import Duty
from oncall.domain.team import Actor
from oncall.domain.vocabulary import FeedTokenKind

#: How far back and ahead a member's own calendar subscription reaches.
FEED_PAST_DAYS = 14
FEED_FUTURE_DAYS = 90
#: Joins the product name and whose calendar it is: "On-call · Anna".
CALENDAR_NAME_SEPARATOR = " · "


def calendar_name(app_name: str, owner: str) -> str:
    """What a subscribed calendar is called: the product name, then the owner."""
    return f"{app_name}{CALENDAR_NAME_SEPARATOR}{owner}"


def link_is_active(revoked_at: datetime | None, expires_at: datetime, now: datetime) -> bool:
    """A share link grants access until it is revoked or expires."""
    return revoked_at is None and as_utc(expires_at) > now


@dataclass(frozen=True)
class ShareLink:
    id: uuid.UUID
    label: str
    starts_on: date
    ends_on: date
    expires_at: datetime
    created_by_id: uuid.UUID
    created_at: datetime
    used_at: datetime | None
    revoked_at: datetime | None

    def active(self, now: datetime) -> bool:
        return link_is_active(self.revoked_at, self.expires_at, now)


@dataclass(frozen=True)
class ShareLinkRequest:
    actor: Actor
    label: str
    starts_on: date
    ends_on: date
    expires_days: int


@dataclass(frozen=True)
class NewShareLink:
    label: str
    starts_on: date
    ends_on: date
    expires_at: datetime
    created_by_id: uuid.UUID


@dataclass(frozen=True)
class ShareLinkIssued:
    link: ShareLink
    #: The one-time token. It exists only here: stored as a hash, shown once.
    token: str


@dataclass(frozen=True)
class ShareLinkRevocation:
    actor: Actor
    link_id: uuid.UUID


@dataclass(frozen=True)
class ShareLinkExchanged:
    link: ShareLink
    session: SignedInSession


@dataclass(frozen=True)
class CalendarFeed:
    id: uuid.UUID
    kind: FeedTokenKind
    label: str
    member_id: uuid.UUID | None
    share_link_id: uuid.UUID | None
    created_by_id: uuid.UUID | None
    created_at: datetime
    revoked_at: datetime | None
    last_used_at: datetime | None


@dataclass(frozen=True)
class NewCalendarFeed:
    kind: FeedTokenKind
    label: str
    created_by_id: uuid.UUID
    member_id: uuid.UUID | None = None
    share_link_id: uuid.UUID | None = None


@dataclass(frozen=True)
class FeedIssued:
    feed: CalendarFeed
    #: The token the calendar application puts in the URL. Shown once.
    token: str


@dataclass(frozen=True)
class OwnFeedRequest:
    actor: Actor
    label: str


@dataclass(frozen=True)
class FeedRevocation:
    actor: Actor
    feed_id: uuid.UUID


@dataclass(frozen=True)
class LinkFeedRequest:
    actor: Actor
    link_id: uuid.UUID


@dataclass(frozen=True)
class SubscribedCalendar:
    """What a calendar application receives for one subscription."""

    name: str
    duties: list[Duty]


def feed_window(today: date) -> tuple[date, date]:
    return today - timedelta(days=FEED_PAST_DAYS), today + timedelta(days=FEED_FUTURE_DAYS)
