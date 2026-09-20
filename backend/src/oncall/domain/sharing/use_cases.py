"""Share links for viewers outside the team, and calendar subscriptions.

A share link is a one-time token bound to a recipient, a date range and an
expiry; exchanging it starts a viewer session no longer than the link lives.
A calendar feed is a long-lived, revocable token a calendar application puts
in its URL, because it cannot hold a session. Nothing here commits.
"""

from datetime import date, datetime, timedelta

from oncall.domain.clock import as_utc
from oncall.domain.errors import NotATeamMember
from oncall.domain.sharing import errors
from oncall.domain.sharing.models import (
    CalendarFeed,
    FeedIssued,
    FeedRevocation,
    LinkFeedRequest,
    NewCalendarFeed,
    NewShareLink,
    OwnFeedRequest,
    ShareLink,
    ShareLinkExchanged,
    ShareLinkIssued,
    ShareLinkRequest,
    ShareLinkRevocation,
    SubscribedCalendar,
    calendar_name,
    feed_window,
)
from oncall.domain.sharing.ports import (
    CalendarSubscriptionPorts,
    LinkFeedPorts,
    MemberFeedPorts,
    ShareExchangePorts,
    ShareLinkCommandPorts,
    ShareLinkQueryPorts,
)
from oncall.domain.team import Actor
from oncall.domain.vocabulary import FeedTokenKind, UserRole


async def list_share_links(ports: ShareLinkQueryPorts) -> list[ShareLink]:
    return await ports.links.links()


async def create_share_link(
    request: ShareLinkRequest, ports: ShareLinkCommandPorts, *, now: datetime
) -> ShareLinkIssued:
    new = NewShareLink(
        label=request.label,
        starts_on=request.starts_on,
        ends_on=request.ends_on,
        expires_at=now + timedelta(days=request.expires_days),
        created_by_id=request.actor.user_id,
    )
    token = await ports.links.stage(new)
    await ports.link_journal.link_created(new, expires_days=request.expires_days)
    return ShareLinkIssued(link=await ports.links.staged_link(), token=token)


async def revoke_share_link(
    revocation: ShareLinkRevocation, ports: ShareLinkCommandPorts, *, now: datetime
) -> None:
    link = await ports.links.link(revocation.link_id)
    if link is None:
        raise errors.ShareLinkNotFound(revocation.link_id)
    if link.revoked_at is None:
        await ports.links.revoke(link.id, now)
        await ports.link_journal.link_revoked(link)


async def exchange_share_link(
    token: str, ports: ShareExchangePorts, *, now: datetime, session_lifetime: timedelta
) -> ShareLinkExchanged:
    link = await ports.links.link_for_exchange(token)
    if link is None:
        raise errors.ShareTokenUnknown()
    if link.used_at is not None:
        raise errors.ShareLinkAlreadyUsed(link.id)
    if not link.active(now):
        raise errors.ShareLinkInactive(link.id)
    # The session never outlives the link that granted it.
    session = await ports.sessions.open_for_share_link(
        link.id, min(as_utc(link.expires_at), now + session_lifetime)
    )
    await ports.links.mark_used(link.id, now)
    await ports.link_journal.link_exchanged(link)
    return ShareLinkExchanged(link=link, session=session)


async def subscribe_own_calendar(request: OwnFeedRequest, ports: MemberFeedPorts) -> FeedIssued:
    member = await ports.team.member_for_account(request.actor.user_id)
    if member is None:
        raise NotATeamMember()
    issued = await ports.feeds.issue(
        NewCalendarFeed(
            kind=FeedTokenKind.member,
            label=request.label,
            created_by_id=request.actor.user_id,
            member_id=member.id,
        )
    )
    await ports.feed_journal.member_feed_created(issued.feed, member)
    return issued


async def list_own_calendars(actor: Actor, ports: MemberFeedPorts) -> list[CalendarFeed]:
    # An account with no rotation member has no personal feed to list, so it
    # is turned away rather than shown an empty list.
    if await ports.team.member_for_account(actor.user_id) is None:
        raise NotATeamMember()
    return await ports.feeds.feeds_created_by(actor.user_id, FeedTokenKind.member)


async def revoke_calendar_feed(
    revocation: FeedRevocation, ports: MemberFeedPorts, *, now: datetime
) -> None:
    feed = await ports.feeds.feed(revocation.feed_id)
    if feed is None or (
        feed.created_by_id != revocation.actor.user_id and revocation.actor.role != UserRole.admin
    ):
        raise errors.FeedNotFound(revocation.feed_id)
    if feed.revoked_at is None:
        await ports.feeds.revoke(feed.id, now)
        await ports.feed_journal.feed_revoked(feed)


async def subscribe_share_link(request: LinkFeedRequest, ports: LinkFeedPorts) -> FeedIssued:
    link = await ports.links.link(request.link_id)
    if link is None:
        raise errors.ShareLinkNotFound(request.link_id)
    issued = await ports.feeds.issue(
        NewCalendarFeed(
            kind=FeedTokenKind.share_link,
            label=f"ICS: {link.label}",
            created_by_id=request.actor.user_id,
            share_link_id=link.id,
        )
    )
    await ports.feed_journal.link_feed_created(issued.feed, link)
    return issued


async def read_subscribed_calendar(
    token: str,
    ports: CalendarSubscriptionPorts,
    *,
    today: date,
    now: datetime,
    app_name: str = "On-call",
) -> SubscribedCalendar:
    """The duties a calendar application shows for one subscription: a
    member's own duties around today, or the published schedule within a
    share link's range while the link lasts."""
    feed = await ports.feeds.feed_for_token(token)
    if feed is None or feed.revoked_at is not None:
        raise errors.FeedUnavailable()
    if feed.kind == FeedTokenKind.member:
        member = await ports.team.member(feed.member_id) if feed.member_id is not None else None
        if member is None:
            raise errors.FeedUnavailable()
        starts_on, ends_on = feed_window(today)
        in_force = await ports.roster.duties_in_force(starts_on, ends_on)
        duties = [
            duty for duty in in_force.values() if duty.held_by(member.id, member.display_name)
        ]
        name = calendar_name(app_name, member.display_name)
    else:
        link = await ports.links.link(feed.share_link_id) if feed.share_link_id else None
        if link is None or not link.active(now):
            raise errors.FeedLinkInactive()
        duties = list((await ports.roster.duties_in_force(link.starts_on, link.ends_on)).values())
        name = calendar_name(app_name, link.label)
    await ports.feeds.mark_read(feed.id, now)
    return SubscribedCalendar(
        name=name, duties=sorted(duties, key=lambda duty: (duty.service_date, duty.role.value))
    )
