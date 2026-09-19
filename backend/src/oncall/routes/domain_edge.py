"""Where HTTP meets the domain: who is acting, and how a business-rule
failure becomes a response.

Endpoints parse input with Pydantic, build the domain input, hand the use case
its SQLAlchemy adapters, and own the unit of work: they commit once the use
case returns. A `DomainError` leaves the transaction uncommitted, and the
session dependency rolls it back when the request ends. A `RecordedRefusal`
is the exception: what the use case recorded before refusing is committed
first, then the refusal is answered.
"""

from collections.abc import AsyncIterator, Callable, Iterator, Mapping
from contextlib import asynccontextmanager, contextmanager
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.auth import Principal
from oncall.domain.calendar.models import Audience
from oncall.domain.errors import DomainError, NotATeamMember, RecordedRefusal
from oncall.domain.team import Actor
from oncall.models import User

#: A domain error type, the HTTP status it answers with, and optionally how
#: its body and headers are built (the error's message and none otherwise).
ErrorStatuses = Mapping[type[DomainError], int]
ErrorDetails = Mapping[type[DomainError], Callable[[Any], Any]]
ErrorHeaders = Mapping[type[DomainError], Callable[[Any], dict[str, str]]]

SHARED_ERROR_STATUSES: ErrorStatuses = {NotATeamMember: status.HTTP_403_FORBIDDEN}


class RecordedHttpException(HTTPException):
    """HTTP refusal whose staged audit/security record must be committed."""

    commit_transaction = True


def actor_from(user: User) -> Actor:
    return Actor(user_id=user.id, display_name=user.display_name, role=user.role)


def audience_of(principal: Principal) -> Audience:
    link = principal.share_link
    return Audience(
        role=principal.role,
        account_id=principal.user.id if principal.user is not None else None,
        share_range=(link.starts_on, link.ends_on) if link is not None else None,
    )


def _closest(error: DomainError, mapping: Mapping[type[DomainError], Any]) -> Any:
    return next((mapping[kind] for kind in type(error).__mro__ if kind in mapping), None)


def http_error(
    error: DomainError,
    statuses: ErrorStatuses,
    details: ErrorDetails | None = None,
    headers: ErrorHeaders | None = None,
) -> HTTPException | None:
    """The response for this error, found by its closest mapped type."""
    code = _closest(error, statuses)
    if code is None:
        return None
    build_detail = _closest(error, details or {})
    build_headers = _closest(error, headers or {})
    return HTTPException(
        code,
        build_detail(error) if build_detail else str(error),
        headers=build_headers(error) if build_headers else None,
    )


@contextmanager
def domain_errors_as_http(
    statuses: ErrorStatuses, details: ErrorDetails | None = None
) -> Iterator[None]:
    try:
        yield
    except DomainError as error:
        response = http_error(error, statuses, details)
        if response is None:
            raise
        raise response from error


@asynccontextmanager
async def refusals_as_http(
    db: AsyncSession,
    statuses: ErrorStatuses,
    details: ErrorDetails | None = None,
    headers: ErrorHeaders | None = None,
) -> AsyncIterator[None]:
    """Like `domain_errors_as_http`, but a `RecordedRefusal` commits what the
    use case recorded before the refusal is answered."""
    try:
        yield
    except DomainError as error:
        response = http_error(error, statuses, details, headers)
        if response is None:
            raise
        if isinstance(error, RecordedRefusal):
            response = RecordedHttpException(
                response.status_code,
                response.detail,
                headers=response.headers,
            )
        raise response from error
