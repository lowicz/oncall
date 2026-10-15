"""HTTP contracts for the settings and state of forwarding the on-call number."""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from oncall.domain.forwarding.models import (
    DEFAULT_BASE_URL,
    ConnectionTestOutcome,
    ForwardingMode,
    ForwardingOutcome,
)


class ForwardingSettingsResponse(BaseModel):
    """The settings without the password, which no response carries."""

    model_config = ConfigDict(from_attributes=True)

    mode: ForwardingMode
    base_url: str
    vpbx_number: str | None
    username: str | None
    wco_user_id: str | None
    password_set: bool
    password_changed_at: datetime | None
    rotation_pending_since: datetime | None
    credentials_invalid_since: datetime | None
    updated_at: datetime


class ForwardingSettingsUpdate(BaseModel):
    """The whole settings form. `password` is write-only: null keeps the
    stored one."""

    model_config = ConfigDict(extra="forbid")

    mode: ForwardingMode = ForwardingMode.off
    #: HTTPS only: the connection to WCO is always verified.
    base_url: str = Field(default=DEFAULT_BASE_URL, pattern=r"^https://\S+$", max_length=200)
    vpbx_number: str | None = Field(default=None, max_length=20)
    username: str | None = Field(default=None, max_length=120)
    wco_user_id: str | None = Field(default=None, max_length=40)
    password: str | None = Field(default=None, min_length=1, max_length=200)

    @field_validator("vpbx_number", "username", "wco_user_id")
    @classmethod
    def blank_is_unset(cls, value: str | None) -> str | None:
        return (value or "").strip() or None


class PasswordRevealRequest(BaseModel):
    """The administrator's own sign-in password, confirming it is them."""

    model_config = ConfigDict(extra="forbid")

    password: str = Field(min_length=1, max_length=256)


class PasswordRevealResponse(BaseModel):
    """The stored WCO passwords in the clear. While a rotation is half done
    `pending` is set and is the one to try first."""

    model_config = ConfigDict(from_attributes=True)

    current: str
    pending: str | None
    pending_since: datetime | None
    credentials_invalid_since: datetime | None
    password_changed_at: datetime | None


class ConnectionTestResponse(BaseModel):
    """What one read-only round trip to WCO with the stored settings
    learned: `number` is what WCO forwards to when it could be read, and
    `detail` names the failed call or the configuration error."""

    model_config = ConfigDict(from_attributes=True)

    outcome: ConnectionTestOutcome
    number: str | None
    detail: str | None


class ForwardingStateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    applied_number: str | None
    applied_member_name: str | None
    applied_at: datetime | None
    desired_number: str | None
    desired_member_name: str | None
    desired_for_day: date | None
    last_attempt_at: datetime | None
    last_outcome: ForwardingOutcome | None
    last_error: str | None
    failing_since: datetime | None
    attempts: int
    next_attempt_at: datetime | None
