import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from oncall.domain.accounts import SignedInSession
from oncall.domain.ports import PublishedRoster, TeamDirectory
from oncall.domain.sharing.models import (
    CalendarFeed,
    FeedIssued,
    NewCalendarFeed,
    NewShareLink,
    ShareLink,
)
from oncall.domain.team import Member
from oncall.domain.vocabulary import FeedTokenKind


class ShareLinks(Protocol):
    async def links(self) -> list[ShareLink]:
        """Newest first."""
        ...

    async def link(self, link_id: uuid.UUID) -> ShareLink | None:
        """The link as it is stored now."""
        ...

    async def stage(self, link: NewShareLink) -> str:
        """Stage a new link and return its one-time token; `staged_link`
        returns the link as stored."""
        ...

    async def staged_link(self) -> ShareLink: ...

    async def link_for_exchange(self, token: str) -> ShareLink | None:
        """The link issued with this token, held until the unit of work ends
        so one token is exchanged once."""
        ...

    async def mark_used(self, link_id: uuid.UUID, at: datetime) -> None: ...

    async def revoke(self, link_id: uuid.UUID, at: datetime) -> None: ...


class SignedInSessions(Protocol):
    async def open_for_share_link(
        self, link_id: uuid.UUID, expires_at: datetime
    ) -> SignedInSession: ...


class ShareLinkJournal(Protocol):
    async def link_created(self, link: NewShareLink, *, expires_days: int) -> None: ...

    async def link_revoked(self, link: ShareLink) -> None: ...

    async def link_exchanged(self, link: ShareLink) -> None: ...


class CalendarFeeds(Protocol):
    async def issue(self, feed: NewCalendarFeed) -> FeedIssued: ...

    async def feed(self, feed_id: uuid.UUID) -> CalendarFeed | None: ...

    async def feed_for_token(self, token: str) -> CalendarFeed | None: ...

    async def feeds_created_by(
        self, account_id: uuid.UUID, kind: FeedTokenKind
    ) -> list[CalendarFeed]:
        """Newest first."""
        ...

    async def revoke(self, feed_id: uuid.UUID, at: datetime) -> None: ...

    async def mark_read(self, feed_id: uuid.UUID, at: datetime) -> None: ...


class FeedJournal(Protocol):
    async def member_feed_created(self, feed: CalendarFeed, member: Member) -> None: ...

    async def link_feed_created(self, feed: CalendarFeed, link: ShareLink) -> None: ...

    async def feed_revoked(self, feed: CalendarFeed) -> None: ...


@dataclass(frozen=True)
class ShareLinkCommandPorts:
    links: ShareLinks
    link_journal: ShareLinkJournal


@dataclass(frozen=True)
class ShareExchangePorts:
    links: ShareLinks
    sessions: SignedInSessions
    link_journal: ShareLinkJournal


@dataclass(frozen=True)
class MemberFeedPorts:
    feeds: CalendarFeeds
    feed_journal: FeedJournal
    team: TeamDirectory


@dataclass(frozen=True)
class LinkFeedPorts:
    links: ShareLinks
    feeds: CalendarFeeds
    feed_journal: FeedJournal


@dataclass(frozen=True)
class CalendarSubscriptionPorts:
    links: ShareLinks
    feeds: CalendarFeeds
    team: TeamDirectory
    roster: PublishedRoster
