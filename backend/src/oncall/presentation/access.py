"""HTTP contracts for signing in, the current account and password links."""

from datetime import date, datetime
from functools import cache
from importlib import resources

from pydantic import BaseModel, ConfigDict, Field, field_validator

from oncall.domain.vocabulary import UserRole
from oncall.i18n import translate
from oncall.presentation.validation import validate_phone


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=8, max_length=256)

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value: str) -> str:
        return value.strip().lower()


class ShareSessionInfo(BaseModel):
    label: str
    starts_on: date
    ends_on: date
    expires_at: datetime


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    username: str
    display_name: str
    role: UserRole
    has_team_member: bool = False
    email: str | None = None
    phone: str | None = None
    share: ShareSessionInfo | None = None
    #: Where the person's own photo is served when the directory may hold one:
    #: a directory account on a deployment that reads photos. None for a local
    #: account, a share-link session or a deployment without them. The image
    #: is fetched separately so this answer never waits on the directory.
    avatar_url: str | None = None


class UpdateOwnPhoneRequest(BaseModel):
    """`PATCH /auth/me`: the one field an account owner may edit themselves."""

    model_config = ConfigDict(extra="forbid")

    phone: str | None = Field(default=None, max_length=32)

    @field_validator("phone")
    @classmethod
    def validate_phone_format(cls, value: str | None) -> str | None:
        if not value:
            return None
        return validate_phone(value)


@cache
def _common_passwords() -> frozenset[str]:
    """10 000 real passwords (rockyou.txt, length >= 12) the length policy
    would otherwise let straight through, such as `Qwerty123456`."""
    text = resources.files("oncall.data").joinpath("common_passwords.txt").read_text()
    return frozenset(line.strip().lower() for line in text.splitlines() if line.strip())


class SetPasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: str = Field(min_length=20, max_length=200)
    password: str = Field(min_length=12, max_length=256)

    @field_validator("password")
    @classmethod
    def reject_weak_password(cls, value: str) -> str:
        if value.lower() in _common_passwords() or len(set(value)) == 1:
            raise ValueError(translate("access.password_too_easy"))
        return value


class AccountTokenInfoResponse(BaseModel):
    username: str
    display_name: str


__all__ = [
    "AccountTokenInfoResponse",
    "LoginRequest",
    "SetPasswordRequest",
    "ShareSessionInfo",
    "UpdateOwnPhoneRequest",
    "UserResponse",
]
