import base64
import ipaddress
import logging
import secrets
from datetime import timedelta
from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from oncall import login_log
from oncall.auth import (
    CsrfGuard,
    CurrentPrincipal,
    Principal,
    get_current_session,
    set_session_cookie,
)
from oncall.bootstrap.providers import (
    AccountLinkProvider,
    DirectoryPhotoProvider,
    OwnProfileProvider,
    PasswordProvider,
    SessionProvider,
    SignInProvider,
    SsoProvider,
    SsoSignInProvider,
)
from oncall.config import get_settings
from oncall.domain.access import errors, use_cases
from oncall.domain.access.models import AccountOverview, PasswordChoice, SignInRequest
from oncall.domain.admin.errors import DirectoryPasswordReadOnly
from oncall.domain.clock import utc_now
from oncall.domain.errors import DomainError
from oncall.domain.vocabulary import AccountTokenKind, AuthSource, UserRole
from oncall.i18n import translate
from oncall.infrastructure.sqlalchemy.access import account_from_row
from oncall.infrastructure.sqlalchemy.access_models import Session
from oncall.ldap_auth import photos_offered
from oncall.presentation.access import (
    AccountTokenInfoResponse,
    LoginRequest,
    SetPasswordRequest,
    ShareSessionInfo,
    UpdateOwnPhoneRequest,
    UserResponse,
)
from oncall.routes.domain_edge import domain_errors_as_http
from oncall.sso_auth import SsoRejectedError, SsoUnavailableError

router = APIRouter()
AVATAR_PATH = "/api/v1/auth/me/avatar"

#: What a single sign-on in progress leaves in the browser between the two
#: redirects: the cookie reaches only the two SSO routes and lives as long
#: as a person may take to sign in at the provider.
SSO_COOKIE = "oncall_sso"
SSO_COOKIE_PATH = "/api/v1/auth/sso"
SSO_COOKIE_MAX_AGE = 600
#: The login page's `?sso=` code for a refusal the use case named.
_SSO_REFUSAL_CODES = {"no_account": "no_account", "account_inactive": "inactive"}


ACCESS_ERROR_STATUSES = {
    errors.LoginThrottled: status.HTTP_429_TOO_MANY_REQUESTS,
    errors.LoginRejected: status.HTTP_401_UNAUTHORIZED,
    errors.DirectoryLoginUnavailable: status.HTTP_503_SERVICE_UNAVAILABLE,
    errors.DirectoryUnavailable: status.HTTP_503_SERVICE_UNAVAILABLE,
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
    may_have_photo = account.auth_source == AuthSource.ldap and photos_offered(get_settings())
    return UserResponse(
        username=account.username,
        display_name=account.display_name,
        role=account.role,
        has_team_member=overview.has_team_member,
        email=account.email,
        phone=account.phone,
        avatar_url=AVATAR_PATH if may_have_photo else None,
    )


def share_principal_response(principal: Principal) -> UserResponse:
    link = principal.share_link
    if link is None:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR, translate("access.session_link_missing")
        )
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


@lru_cache
def _trusted_networks(
    proxies: tuple[str, ...],
) -> tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...]:
    networks = []
    for entry in proxies:
        try:
            networks.append(ipaddress.ip_network(entry, strict=False))
        except ValueError:
            # A malformed entry trusts nothing rather than everything.
            continue
    return tuple(networks)


def _peer_is_trusted(peer: str | None) -> bool:
    if peer is None:
        return False
    try:
        address = ipaddress.ip_address(peer)
    except ValueError:
        return False
    networks = _trusted_networks(tuple(get_settings().trusted_proxies))
    return any(address in network for network in networks)


def client_ip(request: Request) -> str:
    """The caller's address for the per-IP throttle and the security log.

    `X-Real-IP` is honoured only when the immediate TCP peer is a trusted
    reverse proxy (`ONCALL_TRUSTED_PROXIES`): the shipped nginx sets it from
    `$remote_addr` over a private network. A direct caller - the API exposed
    without nginx in front - cannot spoof its throttle bucket by rotating the
    header; its own socket address is used instead.
    """
    peer = request.client.host if request.client else None
    real_ip = request.headers.get("x-real-ip", "").strip()
    if real_ip and _peer_is_trusted(peer):
        return real_ip
    return peer or "unknown"


def _log_refusal(login: str, refusal: DomainError) -> None:
    """How a refused sign-in ended, with the reason the answer leaves out.

    A directory outage says only that here: the `event=ldap_auth` record with
    the same attempt id says where the directory conversation stopped.
    """
    match refusal:
        case errors.LoginRejected(cause=cause):
            login_log.emit("login", login=login, outcome="rejected", cause=cause)
        case errors.LoginThrottled():
            login_log.emit("login", login=login, outcome="throttled")
        case errors.DirectoryLoginUnavailable():
            login_log.emit("login", login=login, outcome="directory_unavailable")
        case errors.DirectoryIdentityConflict(cause=cause):
            login_log.emit(
                "login",
                level=logging.WARNING,
                login=login,
                outcome="identity_conflict",
                cause=cause,
            )
        case _:
            login_log.emit("login", login=login, outcome=type(refusal).__name__)


@router.post("/api/v1/auth/login", response_model=UserResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    ports: SignInProvider,
) -> UserResponse:
    login_log.begin_attempt()
    with domain_errors_as_http(ACCESS_ERROR_STATUSES, headers=ACCESS_ERROR_HEADERS):
        try:
            signed_in = await use_cases.sign_in(
                SignInRequest(payload.username, payload.password, client_ip(request)),
                ports,
                now=utc_now(),
                session_lifetime=timedelta(hours=get_settings().session_ttl_hours),
            )
        except DomainError as refusal:
            _log_refusal(payload.username, refusal)
            raise
    login_log.emit(
        "login",
        login=payload.username,
        outcome="signed_in",
        source=signed_in.account.auth_source,
    )
    set_session_cookie(response, signed_in.session.token, signed_in.session.expires_at)
    response.headers["X-CSRF-Token"] = signed_in.session.csrf_token
    return user_response(AccountOverview(signed_in.account, signed_in.has_team_member))


@router.get("/api/v1/auth/password-token", response_model=AccountTokenInfoResponse)
async def password_token_info(
    token: Annotated[str, Query(min_length=20, max_length=200)],
    kind: AccountTokenKind,
    links: AccountLinkProvider,
) -> AccountTokenInfoResponse:
    with domain_errors_as_http(ACCESS_ERROR_STATUSES):
        account = await use_cases.describe_account_link(token, kind, links, now=utc_now())
    return AccountTokenInfoResponse(username=account.username, display_name=account.display_name)


async def _choose_password(
    payload: SetPasswordRequest,
    kind: AccountTokenKind,
    ports: PasswordProvider,
) -> None:
    with domain_errors_as_http(ACCESS_ERROR_STATUSES):
        await use_cases.choose_password(
            PasswordChoice(token=payload.token, kind=kind, password=payload.password),
            ports,
            now=utc_now(),
        )


@router.post("/api/v1/auth/activate", status_code=status.HTTP_204_NO_CONTENT)
async def activate_account(payload: SetPasswordRequest, ports: PasswordProvider) -> None:
    await _choose_password(payload, AccountTokenKind.activation, ports)


@router.post("/api/v1/auth/reset", status_code=status.HTTP_204_NO_CONTENT)
async def reset_password(payload: SetPasswordRequest, ports: PasswordProvider) -> None:
    await _choose_password(payload, AccountTokenKind.password_reset, ports)


@router.get("/api/v1/auth/me", response_model=UserResponse)
async def me(principal: CurrentPrincipal, profiles: OwnProfileProvider) -> UserResponse:
    if principal.user is not None:
        overview = await use_cases.describe_account(account_from_row(principal.user), profiles)
        return user_response(overview)
    return share_principal_response(principal)


@router.get(
    AVATAR_PATH,
    response_class=Response,
    responses={
        200: {
            "description": "The person's own photo as the directory holds it",
            "content": {"image/jpeg": {}, "image/png": {}},
        },
        404: {"description": "No photo: a local account, a share link or none in the directory"},
        503: {"description": "The directory could not answer"},
    },
)
async def my_avatar(principal: CurrentPrincipal, photos: DirectoryPhotoProvider) -> Response:
    """The signed-in person's photo, read from the directory on request and
    never stored here. `no-store`, so a browser shared by two people never
    shows one the other's face from its cache; the interface keeps it in
    memory for the session instead."""
    account = account_from_row(principal.user) if principal.user is not None else None
    with domain_errors_as_http(ACCESS_ERROR_STATUSES):
        photo = await use_cases.own_photo(account, photos)
    if photo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, translate("access.no_directory_photo"))
    return Response(
        content=photo.data, media_type=photo.media_type, headers={"Cache-Control": "no-store"}
    )


@router.patch("/api/v1/auth/me", response_model=UserResponse)
async def update_my_phone(
    payload: UpdateOwnPhoneRequest,
    principal: CurrentPrincipal,
    profiles: OwnProfileProvider,
    _: CsrfGuard,
) -> UserResponse:
    with domain_errors_as_http(ACCESS_ERROR_STATUSES):
        overview = await use_cases.change_own_phone(
            principal.user.id if principal.user is not None else None,
            payload.phone,
            profiles,
        )
    return user_response(overview)


class _PendingSso(BaseModel):
    """The `oncall_sso` cookie: what the callback must find again."""

    state: str
    nonce: str
    verifier: str
    next: str


def _same_origin_path(value: str | None) -> str:
    """`next` as a path on this origin, so the callback never sends the
    browser elsewhere: anything but an absolute path (`//host`, a scheme, a
    backslash a browser would read as a slash) is the front page."""
    if value and value.startswith("/") and value[1:2] not in ("/", "\\") and value.isprintable():
        return value
    return "/"


def _pending_sso(request: Request) -> _PendingSso | None:
    raw = request.cookies.get(SSO_COOKIE, "")
    try:
        return _PendingSso.model_validate_json(base64.urlsafe_b64decode(raw))
    except ValueError:
        return None


def _require_sso() -> None:
    if not get_settings().sso_enabled:
        raise HTTPException(status.HTTP_404_NOT_FOUND, translate("access.sso_disabled"))


def _sso_redirect(url: str, *, clear_cookie: bool) -> RedirectResponse:
    """A redirect the browser must not cache: the start one carries the
    pending state, the callback one the session cookie or a one-shot code."""
    response = RedirectResponse(url, status_code=status.HTTP_302_FOUND)
    response.headers["Cache-Control"] = "no-store"
    if clear_cookie:
        response.delete_cookie(
            SSO_COOKIE,
            path=SSO_COOKIE_PATH,
            httponly=True,
            secure=get_settings().session_cookie_secure,
            samesite="lax",
        )
    return response


def _back_to_login(code: str) -> RedirectResponse:
    return _sso_redirect(f"/?sso={code}", clear_cookie=True)


def _sso_refused(reason: str) -> RedirectResponse:
    """A callback refused before the provider is asked anything: no state
    cookie, a state that is not the cookie's, or no code to exchange. Anyone
    can send one, so it reaches the operator's log but not the audit trail."""
    login_log.emit("sso_auth", outcome="rejected", phase="callback", reason=reason)
    return _back_to_login("rejected")


@router.get(
    "/api/v1/auth/sso/start",
    status_code=status.HTTP_302_FOUND,
    response_class=RedirectResponse,
    responses={
        302: {
            "description": "To the identity provider, or to the login page with ?sso=unavailable"
        },
        404: {"description": "Single sign-on is not enabled"},
    },
)
async def sso_start(
    sso: SsoProvider,
    ports: SsoSignInProvider,
    next_path: Annotated[str | None, Query(alias="next", max_length=2000)] = None,
) -> RedirectResponse:
    """Send the browser to the identity provider (OpenID Connect,
    Authorization Code with PKCE). `next` is the screen to return to after
    the sign-on; it must be a path on this origin."""
    _require_sso()
    login_log.begin_attempt()
    # 32 random bytes make 43 URL-safe characters, the least PKCE asks of a
    # verifier; the state and the nonce take the same.
    pending = _PendingSso(
        state=secrets.token_urlsafe(32),
        nonce=secrets.token_urlsafe(32),
        verifier=secrets.token_urlsafe(32),
        next=_same_origin_path(next_path),
    )
    try:
        url = await sso.authorization_url(
            state=pending.state, nonce=pending.nonce, code_verifier=pending.verifier
        )
    except SsoUnavailableError as failure:
        await ports.attempts.sso_unavailable(failure.phase, failure.reason)
        return _back_to_login("unavailable")
    response = _sso_redirect(url, clear_cookie=False)
    response.set_cookie(
        SSO_COOKIE,
        base64.urlsafe_b64encode(pending.model_dump_json().encode()).decode(),
        max_age=SSO_COOKIE_MAX_AGE,
        path=SSO_COOKIE_PATH,
        httponly=True,
        secure=get_settings().session_cookie_secure,
        samesite="lax",
    )
    return response


@router.get(
    "/api/v1/auth/sso/callback",
    status_code=status.HTTP_302_FOUND,
    response_class=RedirectResponse,
    responses={
        302: {
            "description": "To the screen the sign-on started from, with the session cookie, "
            "or to the login page with ?sso=unavailable|rejected|no_account|inactive"
        },
        404: {"description": "Single sign-on is not enabled"},
    },
)
async def sso_callback(
    request: Request,
    sso: SsoProvider,
    ports: SsoSignInProvider,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> RedirectResponse:
    """Where the identity provider sends the browser back. The code is
    exchanged and the ID token verified over a back channel; the personnel
    number it carries names the account, and an active one gets the same
    session a password sign-in gets. A GET that changes state, as OpenID
    Connect redirects are: the state and nonce the `oncall_sso` cookie binds
    to this browser are what make it safe, so it is outside the CSRF guard
    and has no login throttle (the provider checked the password)."""
    _require_sso()
    login_log.begin_attempt()
    pending = _pending_sso(request)
    if pending is None or not state or not secrets.compare_digest(state, pending.state):
        return _sso_refused("state_mismatch")
    if error:
        return _sso_refused("provider_error")
    if not code:
        return _sso_refused("code_missing")
    try:
        number = await sso.exchange(code, code_verifier=pending.verifier, nonce=pending.nonce)
    except SsoUnavailableError as failure:
        await ports.attempts.sso_unavailable(failure.phase, failure.reason)
        return _back_to_login("unavailable")
    except SsoRejectedError as failure:
        await ports.attempts.sso_refused(failure.phase, failure.reason)
        return _back_to_login("rejected")
    try:
        signed_in = await use_cases.sign_in_with_sso(
            number,
            ports,
            now=utc_now(),
            session_lifetime=timedelta(hours=get_settings().session_ttl_hours),
        )
    except errors.SsoSignInRefused as refusal:
        login_log.emit(
            "sso_auth", outcome="rejected", phase="account", reason=refusal.cause, number=number
        )
        return _back_to_login(_SSO_REFUSAL_CODES[refusal.cause])
    login_log.emit("login", login=signed_in.account.username, outcome="signed_in", source="sso")
    response = _sso_redirect(pending.next, clear_cookie=True)
    set_session_cookie(response, signed_in.session.token, signed_in.session.expires_at)
    return response


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
