import secrets
import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.audit import record_audit
from oncall.auth import token_hash
from oncall.domain.sharing.models import (
    CalendarFeed,
    FeedIssued,
    NewCalendarFeed,
    NewShareLink,
    ShareLink,
)
from oncall.domain.sharing.ports import CalendarFeeds, FeedJournal, ShareLinkJournal, ShareLinks
from oncall.domain.team import Member
from oncall.domain.vocabulary import FeedTokenKind
from oncall.infrastructure.sqlalchemy.access_models import User
from oncall.infrastructure.sqlalchemy.sharing_models import CalendarFeedToken
from oncall.infrastructure.sqlalchemy.sharing_models import ShareLink as ShareLinkRow


def _to_link(row: ShareLinkRow) -> ShareLink:
    return ShareLink(
        id=row.id,
        label=row.label,
        starts_on=row.starts_on,
        ends_on=row.ends_on,
        expires_at=row.expires_at,
        created_by_id=row.created_by_id,
        created_at=row.created_at,
        used_at=row.used_at,
        revoked_at=row.revoked_at,
    )


def _to_feed(row: CalendarFeedToken) -> CalendarFeed:
    return CalendarFeed(
        id=row.id,
        kind=row.kind,
        label=row.label,
        member_id=row.member_id,
        share_link_id=row.share_link_id,
        created_by_id=row.created_by_id,
        created_at=row.created_at,
        revoked_at=row.revoked_at,
        last_used_at=row.last_used_at,
    )


class SqlAlchemyShareLinks(ShareLinks, ShareLinkJournal):
    """Share links and their audit trail over one session.

    One object implements both ports because the audit entry of a new link
    names the row just staged. It carries whatever id the row has at that
    moment, which is none until the session flushes it: that is how new links
    have always been audited.
    """

    def __init__(self, session: AsyncSession, actor: User | None = None) -> None:
        self._session = session
        self._actor = actor
        self._staged: ShareLinkRow | None = None

    async def links(self) -> list[ShareLink]:
        rows = await self._session.scalars(
            select(ShareLinkRow).order_by(ShareLinkRow.created_at.desc())
        )
        return [_to_link(row) for row in rows]

    async def link(self, link_id: uuid.UUID) -> ShareLink | None:
        row = await self._session.scalar(
            select(ShareLinkRow)
            .where(ShareLinkRow.id == link_id)
            .execution_options(populate_existing=True)
        )
        return _to_link(row) if row is not None else None

    async def stage(self, link: NewShareLink) -> str:
        raw_token = secrets.token_urlsafe(32)
        self._staged = ShareLinkRow(
            token_hash=token_hash(raw_token),
            label=link.label,
            starts_on=link.starts_on,
            ends_on=link.ends_on,
            expires_at=link.expires_at,
            created_by_id=link.created_by_id,
        )
        self._session.add(self._staged)
        return raw_token

    async def staged_link(self) -> ShareLink:
        if self._staged is None:
            raise LookupError("no share link was staged")
        await self._session.flush()
        return _to_link(self._staged)

    async def link_for_exchange(self, token: str) -> ShareLink | None:
        # Atomic exchange: the row stays locked until the unit of work ends, so
        # a second exchange of the same token waits and then sees it used.
        row = await self._session.scalar(
            select(ShareLinkRow)
            .where(ShareLinkRow.token_hash == token_hash(token))
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        return _to_link(row) if row is not None else None

    async def mark_used(self, link_id: uuid.UUID, at: datetime) -> None:
        row = await self._session.get(ShareLinkRow, link_id)
        row.used_at = at

    async def revoke(self, link_id: uuid.UUID, at: datetime) -> None:
        row = await self._session.get(ShareLinkRow, link_id)
        row.revoked_at = at

    async def link_created(self, link: NewShareLink, *, expires_days: int) -> None:
        record_audit(
            self._session,
            actor=self._actor,
            action="share_link.created",
            entity_type="share_link",
            entity_id=self._staged.id if self._staged is not None else None,
            summary=(
                f"Utworzono link viewer dla „{link.label}” "
                f"({link.starts_on} – {link.ends_on}, ważny {expires_days} dni)"
            ),
        )

    async def link_revoked(self, link: ShareLink) -> None:
        record_audit(
            self._session,
            actor=self._actor,
            action="share_link.revoked",
            entity_type="share_link",
            entity_id=link.id,
            summary=f"Odwołano link viewer dla „{link.label}”",
        )

    async def link_exchanged(self, link: ShareLink) -> None:
        record_audit(
            self._session,
            actor=None,
            actor_label=f"link: {link.label}",
            action="share_link.exchanged",
            entity_type="share_link",
            entity_id=link.id,
            summary=f"Wymieniono jednorazowy link „{link.label}” na sesję viewer",
        )


class SqlAlchemyCalendarFeeds(CalendarFeeds, FeedJournal):
    def __init__(self, session: AsyncSession, actor: User | None = None) -> None:
        self._session = session
        self._actor = actor

    async def issue(self, feed: NewCalendarFeed) -> FeedIssued:
        raw_token = secrets.token_urlsafe(32)
        row = CalendarFeedToken(
            token_hash=token_hash(raw_token),
            kind=feed.kind,
            label=feed.label,
            member_id=feed.member_id,
            share_link_id=feed.share_link_id,
            created_by_id=feed.created_by_id,
        )
        self._session.add(row)
        await self._session.flush()
        return FeedIssued(feed=_to_feed(row), token=raw_token)

    async def feed(self, feed_id: uuid.UUID) -> CalendarFeed | None:
        row = await self._session.get(CalendarFeedToken, feed_id)
        return _to_feed(row) if row is not None else None

    async def feed_for_token(self, token: str) -> CalendarFeed | None:
        row = await self._session.scalar(
            select(CalendarFeedToken).where(CalendarFeedToken.token_hash == token_hash(token))
        )
        return _to_feed(row) if row is not None else None

    async def feeds_created_by(
        self, account_id: uuid.UUID, kind: FeedTokenKind
    ) -> list[CalendarFeed]:
        rows = await self._session.scalars(
            select(CalendarFeedToken)
            .where(CalendarFeedToken.created_by_id == account_id, CalendarFeedToken.kind == kind)
            .order_by(CalendarFeedToken.created_at.desc())
        )
        return [_to_feed(row) for row in rows]

    async def revoke(self, feed_id: uuid.UUID, at: datetime) -> None:
        row = await self._session.get(CalendarFeedToken, feed_id)
        row.revoked_at = at

    async def mark_read(self, feed_id: uuid.UUID, at: datetime) -> None:
        row = await self._session.get(CalendarFeedToken, feed_id)
        row.last_used_at = at

    async def member_feed_created(self, feed: CalendarFeed, member: Member) -> None:
        record_audit(
            self._session,
            actor=self._actor,
            action="feed.created",
            entity_type="calendar_feed",
            entity_id=feed.id,
            summary=f"Utworzono subskrypcję ICS „{feed.label}” ({member.display_name})",
        )

    async def link_feed_created(self, feed: CalendarFeed, link: ShareLink) -> None:
        record_audit(
            self._session,
            actor=self._actor,
            action="feed.created",
            entity_type="calendar_feed",
            entity_id=feed.id,
            summary=f"Utworzono kanał ICS dla linku „{link.label}”",
        )

    async def feed_revoked(self, feed: CalendarFeed) -> None:
        record_audit(
            self._session,
            actor=self._actor,
            action="feed.revoked",
            entity_type="calendar_feed",
            entity_id=feed.id,
            summary=f"Odwołano subskrypcję ICS „{feed.label}”",
        )
