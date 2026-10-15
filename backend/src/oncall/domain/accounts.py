"""Accounts: who can sign in, and with which role."""

import re
import uuid
from dataclasses import dataclass
from datetime import datetime

from oncall.domain.vocabulary import AuthSource, UserRole

#: A Polish number as people type it; the stored form is `+48` and the nine
#: digits, the shape the call forwarding sends to the switchboard unchanged.
_POLISH_NUMBER = re.compile(r"^(?:\+?48)?(\d{9})$", re.ASCII)


def normalize_phone(value: str) -> str | None:
    """The stored form of a number as people type it: spaces and dashes are
    dropped, nine bare digits or `48` and nine digits get the `+48` prefix.
    None when it is not a Polish mobile or landline number."""
    match = _POLISH_NUMBER.fullmatch(re.sub(r"[ \-]", "", value.strip()))
    return f"+48{match.group(1)}" if match else None


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
