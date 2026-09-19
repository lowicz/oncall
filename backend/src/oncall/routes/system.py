from fastapi import APIRouter

from oncall.config import get_settings
from oncall.presentation.system import HealthResponse, PublicConfigResponse

router = APIRouter()


@router.get("/api/v1/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse()


@router.get("/api/v1/config", response_model=PublicConfigResponse)
async def public_config() -> PublicConfigResponse:
    return PublicConfigResponse(ldap_enabled=get_settings().ldap_enabled)
