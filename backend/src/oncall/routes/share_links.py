"""Temporary viewer share links.

An administrator creates a one-time link bound to a recipient label, a date
range and an expiry (at most 30 days). Exchanging the one-time token starts
a limited viewer session and the token leaves the URL immediately after.
"""

import uuid
from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status

from oncall.auth import CsrfGuard, set_session_cookie
from oncall.bootstrap.providers import (
    ShareExchangeProvider,
    ShareLinkCommandProvider,
    ShareLinkQueryProvider,
)
from oncall.config import get_settings
from oncall.domain.clock import utc_now
from oncall.domain.sharing import errors, use_cases
from oncall.domain.sharing.models import ShareLinkRequest, ShareLinkRevocation
from oncall.models import User, UserRole
from oncall.permissions import require_roles
from oncall.presentation.sharing import (
    ShareExchangeRequest,
    ShareExchangeResponse,
    ShareLinkCreate,
    ShareLinkCreatedResponse,
    ShareLinkResponse,
    share_exchange_response,
    share_link_created_response,
)
from oncall.routes.domain_edge import SHARED_ERROR_STATUSES, actor_from, domain_errors_as_http

router = APIRouter(tags=["share-links"])
Admin = Annotated[User, Depends(require_roles(UserRole.admin))]

SHARING_ERROR_STATUSES = {
    **SHARED_ERROR_STATUSES,
    errors.ShareLinkNotFound: status.HTTP_404_NOT_FOUND,
    errors.ShareTokenUnknown: status.HTTP_404_NOT_FOUND,
    errors.ShareLinkGone: status.HTTP_410_GONE,
    errors.FeedNotFound: status.HTTP_404_NOT_FOUND,
    errors.FeedUnavailable: status.HTTP_404_NOT_FOUND,
    errors.FeedLinkInactive: status.HTTP_404_NOT_FOUND,
}


def sharing_errors():
    return domain_errors_as_http(SHARING_ERROR_STATUSES)


def _one_time_url(token: str) -> str:
    return f"{get_settings().public_base_url}/share/{token}"


@router.post(
    "/api/v1/admin/share-links",
    response_model=ShareLinkCreatedResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_share_link(
    payload: ShareLinkCreate,
    admin: Admin,
    ports: ShareLinkCommandProvider,
    _: CsrfGuard,
) -> ShareLinkCreatedResponse:
    issued = await use_cases.create_share_link(
        ShareLinkRequest(
            actor=actor_from(admin),
            label=payload.label,
            starts_on=payload.starts_on,
            ends_on=payload.ends_on,
            expires_days=payload.expires_days,
        ),
        ports,
        now=utc_now(),
    )
    stored = await ports.links.link(issued.link.id)
    return share_link_created_response(stored, _one_time_url(issued.token))


@router.get("/api/v1/admin/share-links", response_model=list[ShareLinkResponse])
async def list_share_links(_: Admin, ports: ShareLinkQueryProvider) -> list[ShareLinkResponse]:
    links = await use_cases.list_share_links(ports)
    return [ShareLinkResponse.model_validate(link) for link in links]


@router.delete("/api/v1/admin/share-links/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_share_link(
    link_id: uuid.UUID, admin: Admin, ports: ShareLinkCommandProvider, __: CsrfGuard
) -> None:
    with sharing_errors():
        await use_cases.revoke_share_link(
            ShareLinkRevocation(actor=actor_from(admin), link_id=link_id),
            ports,
            now=utc_now(),
        )


@router.post("/api/v1/share/exchange", response_model=ShareExchangeResponse)
async def exchange_share_link(
    payload: ShareExchangeRequest, response: Response, ports: ShareExchangeProvider
) -> ShareExchangeResponse:
    with sharing_errors():
        exchanged = await use_cases.exchange_share_link(
            payload.token,
            ports,
            now=utc_now(),
            session_lifetime=timedelta(hours=get_settings().session_ttl_hours),
        )
    set_session_cookie(response, exchanged.session.token, exchanged.session.expires_at)
    return share_exchange_response(exchanged.link)
