"""HTTP contracts for forwarding the on-call number: its settings and state,
and the day's pair handing the number over."""

import uuid
from datetime import date, datetime

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator

from oncall.domain.forwarding.models import (
    DEFAULT_BASE_URL,
    ConnectionTestOutcome,
    ForwardingMode,
    ForwardingOutcome,
    SwitchStatus,
)
from oncall.domain.vocabulary import AssignmentRole


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


class HandoverRequest(BaseModel):
    """Hand the on-call number to the day's SECONDARY until `until`."""

    model_config = ConfigDict(extra="forbid")

    until: AwareDatetime


class HandoverResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    day: date
    from_member_id: uuid.UUID
    from_name: str
    to_member_id: uuid.UUID
    to_name: str
    starts_at: datetime
    until: datetime
    #: Who started it; null once their account is gone.
    started_by_name: str | None


class PairMemberResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str
    #: Whether the reader is this person.
    is_you: bool
    #: Whether a phone number is set; the number itself is never told here.
    has_phone: bool


class HandoverPairResponse(BaseModel):
    """The duty day's PRIMARY and SECONDARY, between whom the number is
    handed over."""

    model_config = ConfigDict(from_attributes=True)

    primary: PairMemberResponse
    secondary: PairMemberResponse


class ForwardingNowResponse(BaseModel):
    """Where the on-call number rings now: names and roles, never a number.
    Only `mode` is set while forwarding is off."""

    model_config = ConfigDict(from_attributes=True)

    mode: ForwardingMode
    day: date | None
    #: The latest `until` a handover may have: the end of the duty day.
    day_ends_at: datetime | None
    holder_member_id: uuid.UUID | None
    holder_name: str | None
    holder_role: AssignmentRole | None
    handover: HandoverResponse | None
    status: SwitchStatus | None
    confirmed_at: datetime | None
    #: The duty day's pair, only for either of them or a coordinator: the
    #: ones who may hand the number over (D1).
    pair: HandoverPairResponse | None
