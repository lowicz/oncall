"""HTTP contracts for the health probe and the settings the UI reads before login."""

from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str = "ok"


class PublicConfigResponse(BaseModel):
    """Instance settings the UI needs before anyone is logged in."""

    ldap_enabled: bool


__all__ = ["HealthResponse", "PublicConfigResponse"]
