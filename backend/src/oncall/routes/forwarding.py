"""Administration of forwarding the on-call number through Orange WCO."""

from fastapi import APIRouter, Request, Response, status

from oncall.auth import CsrfGuard
from oncall.bootstrap.providers import (
    ForwardingPasswordRevealer,
    ForwardingSettingsReader,
    ForwardingSettingsWriter,
    ForwardingStateReader,
)
from oncall.domain.access import errors as access_errors
from oncall.domain.access.models import SignInRequest
from oncall.domain.clock import utc_now
from oncall.domain.forwarding import errors, use_cases
from oncall.domain.forwarding.models import SettingsChange
from oncall.infrastructure.sqlalchemy.access import account_from_row
from oncall.permissions import Admin
from oncall.presentation.forwarding import (
    ForwardingSettingsResponse,
    ForwardingSettingsUpdate,
    ForwardingStateResponse,
    PasswordRevealRequest,
    PasswordRevealResponse,
)
from oncall.routes.access import ACCESS_ERROR_HEADERS, client_ip
from oncall.routes.domain_edge import domain_errors_as_http

router = APIRouter(prefix="/api/v1/admin/forwarding", tags=["admin"])
FORWARDING_ERROR_STATUSES = {
    errors.SecretsKeyMissing: status.HTTP_409_CONFLICT,
    errors.SettingsIncomplete: status.HTTP_422_UNPROCESSABLE_CONTENT,
    errors.NewAddressNeedsPassword: status.HTTP_422_UNPROCESSABLE_CONTENT,
}
REVEAL_ERROR_STATUSES = {
    errors.PasswordNotSet: status.HTTP_404_NOT_FOUND,
    errors.SecretsKeyMissing: status.HTTP_409_CONFLICT,
    errors.StoredPasswordUnreadable: status.HTTP_409_CONFLICT,
    # Not 401: the session is fine, only the confirmation was wrong, and the
    # interface signs out on a 401.
    access_errors.LoginRejected: status.HTTP_403_FORBIDDEN,
    access_errors.LoginThrottled: status.HTTP_429_TOO_MANY_REQUESTS,
    access_errors.DirectoryLoginUnavailable: status.HTTP_503_SERVICE_UNAVAILABLE,
}


@router.get("/settings")
async def forwarding_settings(
    _: Admin, store: ForwardingSettingsReader
) -> ForwardingSettingsResponse:
    return ForwardingSettingsResponse.model_validate(await use_cases.current_settings(store))


@router.put("/settings")
async def change_forwarding_settings(
    payload: ForwardingSettingsUpdate,
    admin: Admin,
    ports: ForwardingSettingsWriter,
    __: CsrfGuard,
) -> ForwardingSettingsResponse:
    with domain_errors_as_http(FORWARDING_ERROR_STATUSES):
        settings = await use_cases.change_settings(
            SettingsChange(
                mode=payload.mode,
                base_url=payload.base_url,
                vpbx_number=payload.vpbx_number,
                username=payload.username,
                wco_user_id=payload.wco_user_id,
                updated_by_user_id=admin.id,
            ),
            payload.password,
            ports,
        )
    return ForwardingSettingsResponse.model_validate(settings)


@router.post("/password/reveal")
async def reveal_forwarding_password(
    payload: PasswordRevealRequest,
    request: Request,
    response: Response,
    admin: Admin,
    ports: ForwardingPasswordRevealer,
    __: CsrfGuard,
) -> PasswordRevealResponse:
    """The stored WCO password in the clear, after the administrator enters
    their own sign-in password again. Audited, and never cached."""
    with domain_errors_as_http(REVEAL_ERROR_STATUSES, headers=ACCESS_ERROR_HEADERS):
        revealed = await use_cases.reveal_password(
            account_from_row(admin),
            SignInRequest(admin.username, payload.password, client_ip(request)),
            ports,
            now=utc_now(),
        )
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    return PasswordRevealResponse.model_validate(revealed)


@router.get("/state")
async def forwarding_state(_: Admin, store: ForwardingStateReader) -> ForwardingStateResponse:
    return ForwardingStateResponse.model_validate(await use_cases.current_state(store))
