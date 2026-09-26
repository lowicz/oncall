"""HTTP contracts for the health probe and the settings the UI reads before login."""

from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str = "ok"


class PublicConfigResponse(BaseModel):
    """Instance settings the UI needs before anyone is logged in."""

    ldap_enabled: bool
    #: Brand shown before login: the product name and its optional subtitle.
    app_name: str
    app_subtitle: str
    #: The release running, as its image was built: `1.2.0`, `1.3.0-rc.1`,
    #: or `dev` for a build from a checkout.
    version: str
    #: How long the worker keeps audit entries, in days, business events and
    #: sign-in records separately; 0 means for ever. The Audit screen states
    #: it so an administrator reading the trail knows where it ends. A
    #: deployment's retention ages are policy, not a secret, which is why they
    #: travel with the settings anyone may read.
    audit_retention_days: int
    login_audit_retention_days: int


__all__ = ["HealthResponse", "PublicConfigResponse"]
