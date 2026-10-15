"""Administration of forwarding the on-call number through Orange WCO."""

from fastapi import APIRouter, status

from oncall.auth import CsrfGuard
from oncall.bootstrap.providers import (
    ForwardingSettingsReader,
    ForwardingSettingsWriter,
    ForwardingStateReader,
)
from oncall.domain.forwarding import errors, use_cases
from oncall.domain.forwarding.models import SettingsChange
from oncall.permissions import Admin
from oncall.presentation.forwarding import (
    ForwardingSettingsResponse,
    ForwardingSettingsUpdate,
    ForwardingStateResponse,
)
from oncall.routes.domain_edge import domain_errors_as_http

router = APIRouter(prefix="/api/v1/admin/forwarding", tags=["admin"])
FORWARDING_ERROR_STATUSES = {
    errors.SecretsKeyMissing: status.HTTP_409_CONFLICT,
    errors.SettingsIncomplete: status.HTTP_422_UNPROCESSABLE_CONTENT,
    errors.NewAddressNeedsPassword: status.HTTP_422_UNPROCESSABLE_CONTENT,
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


@router.get("/state")
async def forwarding_state(_: Admin, store: ForwardingStateReader) -> ForwardingStateResponse:
    return ForwardingStateResponse.model_validate(await use_cases.current_state(store))
