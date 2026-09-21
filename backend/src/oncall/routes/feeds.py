"""ICS calendar feeds.

Calendar applications cannot hold sessions, so feeds are authorized by a
long-lived, revocable token in the URL. A member token exposes that member's
own duties; a share-link token exposes the published schedule limited to the
link's date range and expiry.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status

from oncall.auth import CsrfGuard, CurrentUser
from oncall.bootstrap.providers import (
    CalendarSubscriptionProvider,
    LinkFeedProvider,
    MemberFeedProvider,
)
from oncall.config import get_settings
from oncall.domain.clock import business_today, utc_now
from oncall.domain.sharing import use_cases
from oncall.domain.sharing.models import FeedRevocation, LinkFeedRequest, OwnFeedRequest
from oncall.domain.vocabulary import UserRole
from oncall.ical import IcsEvent, build_ics
from oncall.infrastructure.sqlalchemy.access_models import User
from oncall.permissions import require_roles
from oncall.presentation.sharing import (
    FeedTokenCreate,
    FeedTokenCreatedResponse,
    FeedTokenResponse,
    feed_created_response,
)
from oncall.routes.domain_edge import actor_from
from oncall.routes.share_links import sharing_errors

router = APIRouter(tags=["calendar-feeds"])
Admin = Annotated[User, Depends(require_roles(UserRole.admin))]


def _feed_url(raw_token: str) -> str:
    return f"{get_settings().public_base_url}/calendar/feed/{raw_token}.ics"


@router.post(
    "/api/v1/calendar/feeds",
    response_model=FeedTokenCreatedResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_member_feed(
    payload: FeedTokenCreate, user: CurrentUser, ports: MemberFeedProvider, _: CsrfGuard
) -> FeedTokenCreatedResponse:
    with sharing_errors():
        issued = await use_cases.subscribe_own_calendar(
            OwnFeedRequest(actor=actor_from(user), label=payload.label), ports
        )
    return feed_created_response(issued, _feed_url(issued.token))


@router.get("/api/v1/calendar/feeds", response_model=list[FeedTokenResponse])
async def list_member_feeds(
    user: CurrentUser, ports: MemberFeedProvider
) -> list[FeedTokenResponse]:
    with sharing_errors():
        feeds = await use_cases.list_own_calendars(actor_from(user), ports)
    return [FeedTokenResponse.model_validate(feed) for feed in feeds]


@router.delete("/api/v1/calendar/feeds/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_member_feed(
    token_id: uuid.UUID, user: CurrentUser, ports: MemberFeedProvider, _: CsrfGuard
) -> None:
    with sharing_errors():
        await use_cases.revoke_calendar_feed(
            FeedRevocation(actor=actor_from(user), feed_id=token_id),
            ports,
            now=utc_now(),
        )


@router.post(
    "/api/v1/admin/share-links/{link_id}/feed",
    response_model=FeedTokenCreatedResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_share_link_feed(
    link_id: uuid.UUID, admin: Admin, ports: LinkFeedProvider, _: CsrfGuard
) -> FeedTokenCreatedResponse:
    with sharing_errors():
        issued = await use_cases.subscribe_share_link(
            LinkFeedRequest(actor=actor_from(admin), link_id=link_id), ports
        )
    return feed_created_response(issued, _feed_url(issued.token))


@router.get("/calendar/feed/{token}.ics")
async def calendar_feed(token: str, ports: CalendarSubscriptionProvider) -> Response:
    with sharing_errors():
        calendar = await use_cases.read_subscribed_calendar(
            token,
            ports,
            today=business_today(),
            now=utc_now(),
            app_name=get_settings().app_name,
        )
    events = [
        IcsEvent(
            schedule_id=duty.schedule_id,
            service_date=duty.service_date,
            role=duty.role,
            assignee_name=duty.assignee_name,
            sequence=duty.schedule_version,
            is_override=duty.is_override,
        )
        for duty in calendar.duties
    ]
    return Response(
        content=build_ics(events, calendar_name=calendar.name),
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": "inline; filename=oncall.ics"},
    )
