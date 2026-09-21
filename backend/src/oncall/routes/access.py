from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.auth import (
    CsrfGuard,
    CurrentPrincipal,
    Principal,
    get_current_session,
    set_session_cookie,
)
from oncall.bootstrap.providers import (
    AccountLinkProvider,
    OwnProfileProvider,
    PasswordProvider,
    SessionProvider,
    SignInProvider,
)
from oncall.config import get_settings
from oncall.database import get_db
from oncall.domain.access import errors, use_cases
from oncall.domain.access.models import AccountOverview, PasswordChoice, SignInRequest
from oncall.domain.admin.errors import DirectoryPasswordReadOnly
from oncall.domain.clock import utc_now
from oncall.domain.vocabulary import AccountTokenKind, UserRole
from oncall.infrastructure.sqlalchemy.access import account_from_row
from oncall.infrastructure.sqlalchemy.access_models import Session
from oncall.presentation.access import (
    AccountTokenInfoResponse,
    LoginRequest,
    SetPasswordRequest,
    ShareSessionInfo,
    UpdateOwnPhoneRequest,
    UserResponse,
)
from oncall.routes.domain_edge import refusals_as_http

router = APIRouter()
DbSession = Annotated[AsyncSession, Depends(get_db, scope="function")]


ACCESS_ERROR_STATUSES = {
    errors.LoginThrottled: status.HTTP_429_TOO_MANY_REQUESTS,
    errors.LoginRejected: status.HTTP_401_UNAUTHORIZED,
    errors.DirectoryLoginUnavailable: status.HTTP_503_SERVICE_UNAVAILABLE,
    errors.DirectoryIdentityConflict: status.HTTP_409_CONFLICT,
    errors.AccountLinkInvalid: status.HTTP_400_BAD_REQUEST,
    DirectoryPasswordReadOnly: status.HTTP_409_CONFLICT,
    errors.AccountAlreadyActivated: status.HTTP_409_CONFLICT,
    errors.PasswordSameAsLogin: status.HTTP_422_UNPROCESSABLE_CONTENT,
    errors.ShareSessionHasNoAccount: status.HTTP_403_FORBIDDEN,
    # Not 404: the caller asked about themselves, and what is gone is the
    # account behind their session, so the client should sign out.
    errors.AccountGone: status.HTTP_401_UNAUTHORIZED,
}
ACCESS_ERROR_HEADERS = {
    errors.LoginThrottled: lambda error: {"Retry-After": str(error.retry_after)},
}


def user_response(overview: AccountOverview) -> UserResponse:
    account = overview.account
    return UserResponse(
        username=account.username,
        display_name=account.display_name,
        role=account.role,
        has_team_member=overview.has_team_member,
        email=account.email,
        phone=account.phone,
    )


def share_principal_response(principal: Principal) -> UserResponse:
    link = principal.share_link
    if link is None:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Brak linku sesji")
    return UserResponse(
        username="viewer-link",
        display_name=link.label,
        role=UserRole.viewer,
        has_team_member=False,
        share=ShareSessionInfo(
            label=link.label,
            starts_on=link.starts_on,
            ends_on=link.ends_on,
            expires_at=link.expires_at,
        ),
    )


def _client_ip(request: Request) -> str:
    """Return the address accepted by the trusted reverse proxy."""
    real_ip = request.headers.get("x-real-ip", "").strip()
    return real_ip or (request.client.host if request.client else "unknown")


@router.post("/api/v1/auth/login", response_model=UserResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: DbSession,
    ports: SignInProvider,
) -> UserResponse:
    async with refusals_as_http(db, ACCESS_ERROR_STATUSES, headers=ACCESS_ERROR_HEADERS):
        signed_in = await use_cases.sign_in(
            SignInRequest(payload.username, payload.password, _client_ip(request)),
            ports,
            now=utc_now(),
            session_lifetime=timedelta(hours=get_settings().session_ttl_hours),
        )
    set_session_cookie(response, signed_in.session.token, signed_in.session.expires_at)
    response.headers["X-CSRF-Token"] = signed_in.session.csrf_token
    return user_response(AccountOverview(signed_in.account, signed_in.has_team_member))


@router.get("/api/v1/auth/password-token", response_model=AccountTokenInfoResponse)
async def password_token_info(
    token: Annotated[str, Query(min_length=20, max_length=200)],
    kind: AccountTokenKind,
    db: DbSession,
    links: AccountLinkProvider,
) -> AccountTokenInfoResponse:
    async with refusals_as_http(db, ACCESS_ERROR_STATUSES):
        account = await use_cases.describe_account_link(token, kind, links, now=utc_now())
    return AccountTokenInfoResponse(username=account.username, display_name=account.display_name)


async def _choose_password(
    payload: SetPasswordRequest,
    kind: AccountTokenKind,
    db: AsyncSession,
    ports: PasswordProvider,
) -> None:
    async with refusals_as_http(db, ACCESS_ERROR_STATUSES):
        await use_cases.choose_password(
            PasswordChoice(token=payload.token, kind=kind, password=payload.password),
            ports,
            now=utc_now(),
        )


@router.post("/api/v1/auth/activate", status_code=status.HTTP_204_NO_CONTENT)
async def activate_account(
    payload: SetPasswordRequest, db: DbSession, ports: PasswordProvider
) -> None:
    await _choose_password(payload, AccountTokenKind.activation, db, ports)


@router.post("/api/v1/auth/reset", status_code=status.HTTP_204_NO_CONTENT)
async def reset_password(
    payload: SetPasswordRequest, db: DbSession, ports: PasswordProvider
) -> None:
    await _choose_password(payload, AccountTokenKind.password_reset, db, ports)


@router.get("/api/v1/auth/me", response_model=UserResponse)
async def me(principal: CurrentPrincipal, profiles: OwnProfileProvider) -> UserResponse:
    if principal.user is not None:
        overview = await use_cases.describe_account(account_from_row(principal.user), profiles)
        return user_response(overview)
    return share_principal_response(principal)


@router.patch("/api/v1/auth/me", response_model=UserResponse)
async def update_my_phone(
    payload: UpdateOwnPhoneRequest,
    principal: CurrentPrincipal,
    db: DbSession,
    profiles: OwnProfileProvider,
    _: CsrfGuard,
) -> UserResponse:
    async with refusals_as_http(db, ACCESS_ERROR_STATUSES):
        overview = await use_cases.change_own_phone(
            principal.user.id if principal.user is not None else None,
            payload.phone,
            profiles,
        )
    return user_response(overview)


@router.get("/api/v1/auth/csrf")
async def csrf(session: Annotated[Session, Depends(get_current_session)]) -> dict[str, str]:
    return {"csrf_token": session.csrf_token}


@router.post("/api/v1/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    response: Response,
    session: Annotated[Session, Depends(get_current_session)],
    sessions: SessionProvider,
    _: CsrfGuard,
) -> None:
    await sessions.end(session)
    response.delete_cookie(get_settings().session_cookie_name, path="/")
