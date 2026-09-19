"""Accounts: who can sign in, and with which role."""

import uuid
from dataclasses import dataclass
from datetime import datetime

from oncall.domain.vocabulary import AuthSource, UserRole


@dataclass(frozen=True)
class Account:
    id: uuid.UUID
    username: str
    personnel_number: str | None
    first_name: str
    last_name: str
    auth_source: AuthSource
    role: UserRole
    email: str | None
    phone: str | None
    is_active: bool
    created_at: datetime
    #: The rotation member this account is linked to, if any.
    member_id: uuid.UUID | None = None

    @property
    def display_name(self) -> str:
        return " ".join(part for part in (self.first_name, self.last_name) if part)

    @property
    def is_active_admin(self) -> bool:
        return self.role == UserRole.admin and self.is_active


@dataclass(frozen=True)
class SignedInSession:
    """A session as the browser receives it. The token exists only here; the
    session is stored under its hash."""

    token: str
    csrf_token: str
    expires_at: datetime
