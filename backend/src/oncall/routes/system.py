from fastapi import APIRouter

from oncall.config import get_settings
from oncall.presentation.system import HealthResponse, PublicConfigResponse

router = APIRouter()


@router.get("/api/v1/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse()


@router.get("/api/v1/config", response_model=PublicConfigResponse)
async def public_config() -> PublicConfigResponse:
    settings = get_settings()
    return PublicConfigResponse(
        ldap_enabled=settings.ldap_enabled,
        app_name=settings.app_name,
        app_subtitle=settings.app_subtitle,
        version=settings.version,
        audit_retention_days=settings.retention_audit_days,
        login_audit_retention_days=settings.retention_login_audit_days,
    )
