"""Share links and calendar feeds against in-memory ports: no database, no HTTP."""

import uuid
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta

import pytest

from oncall.domain.errors import NotATeamMember
from oncall.domain.sharing import errors, use_cases
from oncall.domain.sharing.models import (
    FeedRevocation,
    LinkFeedRequest,
    OwnFeedRequest,
    ShareLink,
    ShareLinkRequest,
    ShareLinkRevocation,
)
from oncall.domain.team import Actor
from oncall.domain.vocabulary import AssignmentRole, FeedTokenKind, UserRole
from tests.domain.access_fakes import SharingWorld
from tests.domain.fakes import member

NOW = datetime(2030, 3, 1, 12, tzinfo=UTC)
TODAY = NOW.date()
LIFETIME = timedelta(hours=8)


@pytest.fixture
def world() -> SharingWorld:
    world = SharingWorld()
    world.admin = Actor(uuid.uuid4(), "Ada", UserRole.admin)
    world.anna = world.team.add(member("Anna"))
    return world


def stored_link(world, token="t" * 40, **changes) -> ShareLink:
    values = {
        "id": uuid.uuid4(),
        "label": "Piotr",
        "starts_on": TODAY,
        "ends_on": TODAY + timedelta(days=2),
        "expires_at": NOW + timedelta(days=1),
        "created_by_id": world.admin.user_id,
        "created_at": NOW,
        "used_at": None,
        "revoked_at": None,
    }
    return world.links.put(ShareLink(**(values | changes)), token)


def exchange(world, token="t" * 40, now=NOW):
    return use_cases.exchange_share_link(token, world.exchange, now=now, session_lifetime=LIFETIME)


async def test_a_new_link_expires_after_the_chosen_days_and_is_audited(world) -> None:
    issued = await use_cases.create_share_link(
        ShareLinkRequest(world.admin, "Piotr", TODAY, TODAY, expires_days=3),
        world.link_commands,
        now=NOW,
    )
    assert issued.link.expires_at == NOW + timedelta(days=3)
    assert issued.token
    name, call = world.journal.events[0]
    assert (name, call["expires_days"]) == ("link_created", 3)


async def test_an_exchange_starts_a_session_no_longer_than_the_link(world) -> None:
    link = stored_link(world, expires_at=NOW + timedelta(hours=2))

    exchanged = await exchange(world)

    assert exchanged.link == link
    assert world.sessions.opened == [("link", link.id, NOW + timedelta(hours=2))]
    assert world.links.by_id[link.id].used_at == NOW
    assert world.journal.names == ["link_exchanged"]


async def test_a_long_lived_link_gets_a_session_of_the_usual_length(world) -> None:
    link = stored_link(world, expires_at=NOW + timedelta(days=5))
    await exchange(world)
    assert world.sessions.opened == [("link", link.id, NOW + LIFETIME)]


async def test_a_link_is_exchanged_once_and_only_while_active(world) -> None:
    stored_link(world)
    stored_link(world, token="r" * 40, revoked_at=NOW)
    stored_link(world, token="e" * 40, expires_at=NOW)

    await exchange(world)
    with pytest.raises(errors.ShareLinkAlreadyUsed):
        await exchange(world)
    for token in ("r" * 40, "e" * 40):
        with pytest.raises(errors.ShareLinkInactive):
            await exchange(world, token)
    with pytest.raises(errors.ShareTokenUnknown):
        await exchange(world, "u" * 40)
    assert len(world.sessions.opened) == 1
    assert world.links.held == ["t" * 40, "t" * 40, "r" * 40, "e" * 40, "u" * 40]


async def test_revoking_twice_audits_once(world) -> None:
    link = stored_link(world)
    revocation = ShareLinkRevocation(world.admin, link.id)
    await use_cases.revoke_share_link(revocation, world.link_commands, now=NOW)
    await use_cases.revoke_share_link(revocation, world.link_commands, now=NOW)
    assert world.journal.names == ["link_revoked"]
    with pytest.raises(errors.ShareLinkNotFound):
        await use_cases.revoke_share_link(
            ShareLinkRevocation(world.admin, uuid.uuid4()), world.link_commands, now=NOW
        )


async def test_only_rotation_members_subscribe_to_their_own_calendar(world) -> None:
    stranger = Actor(uuid.uuid4(), "Gość", UserRole.member)
    anna = Actor(world.anna.user_id, "Anna", UserRole.member)

    with pytest.raises(NotATeamMember):
        await use_cases.subscribe_own_calendar(OwnFeedRequest(stranger, "x"), world.member_feeds)
    with pytest.raises(NotATeamMember):
        await use_cases.list_own_calendars(stranger, world.member_feeds)

    issued = await use_cases.subscribe_own_calendar(
        OwnFeedRequest(anna, "Telefon"), world.member_feeds
    )
    assert (issued.feed.kind, issued.feed.member_id) == (FeedTokenKind.member, world.anna.id)
    assert [item.id for item in await use_cases.list_own_calendars(anna, world.member_feeds)] == [
        issued.feed.id
    ]


async def test_a_feed_is_revoked_by_its_owner_or_an_admin_only(world) -> None:
    anna = Actor(world.anna.user_id, "Anna", UserRole.member)
    issued = await use_cases.subscribe_own_calendar(
        OwnFeedRequest(anna, "Telefon"), world.member_feeds
    )
    someone = Actor(uuid.uuid4(), "Ktoś", UserRole.coordinator)

    with pytest.raises(errors.FeedNotFound):
        await use_cases.revoke_calendar_feed(
            FeedRevocation(someone, issued.feed.id), world.member_feeds, now=NOW
        )
    for actor in (world.admin, anna):
        await use_cases.revoke_calendar_feed(
            FeedRevocation(actor, issued.feed.id), world.member_feeds, now=NOW
        )
    assert world.journal.names == ["member_feed_created", "feed_revoked"]


async def test_a_member_calendar_shows_their_own_duties_around_today(world) -> None:
    anna = Actor(world.anna.user_id, "Anna", UserRole.member)
    issued = await use_cases.subscribe_own_calendar(
        OwnFeedRequest(anna, "Telefon"), world.member_feeds
    )
    world.roster.assign(TODAY + timedelta(days=1), AssignmentRole.secondary, world.anna)
    world.roster.assign(TODAY, AssignmentRole.primary, world.anna)
    world.roster.assign(TODAY, AssignmentRole.secondary, "Bartek")
    world.roster.assign(TODAY + timedelta(days=91), AssignmentRole.primary, world.anna)
    world.roster.assign(TODAY - timedelta(days=15), AssignmentRole.primary, world.anna)

    calendar = await use_cases.read_subscribed_calendar(
        issued.token, world.subscription, today=TODAY, now=NOW
    )

    assert calendar.name == "On-call · Anna"
    assert [duty.slot for duty in calendar.duties] == [
        (TODAY, AssignmentRole.primary),
        (TODAY + timedelta(days=1), AssignmentRole.secondary),
    ]
    assert world.feeds.read == [issued.feed.id]


async def test_a_link_calendar_follows_the_link_range_and_life(world) -> None:
    link = stored_link(world, starts_on=TODAY, ends_on=TODAY)
    issued = await use_cases.subscribe_share_link(
        LinkFeedRequest(world.admin, link.id), world.link_feeds
    )
    world.roster.assign(TODAY, AssignmentRole.primary, "Bartek")
    world.roster.assign(TODAY + timedelta(days=1), AssignmentRole.primary, "Bartek")

    calendar = await use_cases.read_subscribed_calendar(
        issued.token, world.subscription, today=TODAY, now=NOW
    )
    assert issued.feed.label == "ICS: Piotr"
    assert (calendar.name, len(calendar.duties)) == ("On-call · Piotr", 1)

    world.links.by_id[link.id] = replace(link, revoked_at=NOW)
    with pytest.raises(errors.FeedLinkInactive):
        await use_cases.read_subscribed_calendar(
            issued.token, world.subscription, today=TODAY, now=NOW
        )
    with pytest.raises(errors.ShareLinkNotFound):
        await use_cases.subscribe_share_link(
            LinkFeedRequest(world.admin, uuid.uuid4()), world.link_feeds
        )


async def test_a_revoked_or_orphaned_feed_serves_nothing(world) -> None:
    anna = Actor(world.anna.user_id, "Anna", UserRole.member)
    issued = await use_cases.subscribe_own_calendar(
        OwnFeedRequest(anna, "Telefon"), world.member_feeds
    )
    del world.team.by_id[world.anna.id]
    with pytest.raises(errors.FeedUnavailable):
        await use_cases.read_subscribed_calendar(
            issued.token, world.subscription, today=TODAY, now=NOW
        )
    world.feeds.by_id[issued.feed.id] = replace(issued.feed, revoked_at=NOW)
    with pytest.raises(errors.FeedUnavailable):
        await use_cases.read_subscribed_calendar(
            issued.token, world.subscription, today=TODAY, now=NOW
        )
    with pytest.raises(errors.FeedUnavailable):
        await use_cases.read_subscribed_calendar(
            "nope", world.subscription, today=date.max, now=NOW
        )
    assert world.feeds.read == []
