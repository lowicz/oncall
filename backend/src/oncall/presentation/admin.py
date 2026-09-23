"""HTTP contracts for account, rotation, eligibility and audit administration."""

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from oncall.domain.vocabulary import AssignmentRole, AuthSource, UserRole
from oncall.presentation.validation import validate_phone


class PendingActivationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    #: When the newest activation link stops working (in the past once it has
    #: expired); null when no unused link is left.
    link_expires_at: datetime | None


class AdminUserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    username: str
    personnel_number: str | None = Field(default=None, pattern=r"^[0-9]+$")
    first_name: str
    last_name: str
    display_name: str
    auth_source: AuthSource
    role: UserRole
    email: str | None
    phone: str | None = None
    is_active: bool
    created_at: datetime
    #: Set while a local account still waits for its first password, whether
    #: or not it is enabled; null once activated and for a directory account.
    pending_activation: PendingActivationResponse | None


class AdminUserUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    personnel_number: str | None = Field(default=None, pattern=r"^[0-9]+$")
    first_name: str | None = Field(default=None, min_length=1, max_length=120)
    last_name: str | None = Field(default=None, max_length=120)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=32)
    role: UserRole | None = None
    is_active: bool | None = None

    @field_validator("phone")
    @classmethod
    def validate_phone_format(cls, value: str | None) -> str | None:
        if not value:
            return None
        return validate_phone(value)


class AdminUserCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str = Field(min_length=1, max_length=120)
    personnel_number: str | None = Field(default=None, pattern=r"^[0-9]+$")
    first_name: str = Field(min_length=1, max_length=120)
    last_name: str = Field(default="", max_length=120)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=32)
    role: UserRole = UserRole.viewer

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value: str) -> str:
        normalized = value.strip().lower()
        if any(character.isspace() for character in normalized):
            raise ValueError("Login nie może zawierać spacji")
        return normalized

    @field_validator("phone")
    @classmethod
    def validate_phone_format(cls, value: str | None) -> str | None:
        if not value:
            return None
        return validate_phone(value)


class AdminUserCreatedResponse(BaseModel):
    user: AdminUserResponse
    activation_url: str


class PasswordLinkResponse(BaseModel):
    url: str
    expires_at: datetime


class EligibilityResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    role: AssignmentRole
    starts_on: date
    ends_on: date | None


class TeamMemberResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    #: The account this rotation member belongs to, so the administration screen
    #: can join the two without matching on display names.
    user_id: uuid.UUID | None
    display_name: str
    active_from: date
    active_until: date | None
    eligibility: list[EligibilityResponse]


class TeamMemberCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: uuid.UUID
    active_from: date


class TeamMemberUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    active_from: date | None = None
    active_until: date | None = None

    @model_validator(mode="after")
    def validate_dates(self) -> TeamMemberUpdate:
        if self.active_from and self.active_until and self.active_until < self.active_from:
            raise ValueError("Data końcowa nie może poprzedzać daty wejścia")
        return self


class EligibilityCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: AssignmentRole
    starts_on: date
    ends_on: date | None = None

    @model_validator(mode="after")
    def validate_dates(self) -> EligibilityCreate:
        if self.ends_on and self.ends_on < self.starts_on:
            raise ValueError("Data końcowa nie może poprzedzać daty początkowej")
        return self


class EligibilityUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    starts_on: date | None = None
    ends_on: date | None = None


class AuditEventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    occurred_at: datetime
    actor_label: str
    action: str
    entity_type: str | None
    entity_id: str | None
    summary: str
    details: dict[str, object] | None


__all__ = [
    "AdminUserCreate",
    "AdminUserCreatedResponse",
    "AdminUserResponse",
    "AdminUserUpdate",
    "AuditEventResponse",
    "EligibilityCreate",
    "EligibilityResponse",
    "EligibilityUpdate",
    "PasswordLinkResponse",
    "PendingActivationResponse",
    "TeamMemberCreate",
    "TeamMemberResponse",
    "TeamMemberUpdate",
]
