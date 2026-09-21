"""Persistence models owned by accounts, sign-in and sessions."""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    column,
    or_,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship, validates

from oncall.domain.clock import utc_now
from oncall.domain.vocabulary import AccountTokenKind, AuthSource, UserRole
from oncall.infrastructure.sqlalchemy.base import Base

if TYPE_CHECKING:
    from oncall.infrastructure.sqlalchemy.sharing_models import ShareLink
    from oncall.infrastructure.sqlalchemy.team_models import TeamMember


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("personnel_number", name="uq_user_personnel_number"),
        CheckConstraint(
            or_(
                column("personnel_number").is_(None),
                column("personnel_number").regexp_match(r"^[0-9]+$"),
            ),
            name="ck_user_personnel_number_digits",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    personnel_number: Mapped[str | None] = mapped_column(String(32), nullable=True)
    first_name: Mapped[str] = mapped_column(String(120))
    last_name: Mapped[str] = mapped_column(String(120), default="")
    auth_source: Mapped[AuthSource] = mapped_column(
        Enum(AuthSource, native_enum=False, length=16), default=AuthSource.local
    )
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole, native_enum=False))
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    #: Contact number for the "who is on call now" card (decision D8); optional,
    #: not shown in a share-link session.
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    team_member: Mapped[TeamMember | None] = relationship(back_populates="user")
    account_tokens: Mapped[list[AccountToken]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )

    @property
    def display_name(self) -> str:
        """Public label derived from the separately managed identity fields."""
        return " ".join(part for part in (self.first_name, self.last_name) if part)

    @display_name.setter
    def display_name(self, value: str) -> None:
        """Keep callers using the old constructor compatible while splitting names."""
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("Imię nie może być puste")
        self.first_name, separator, self.last_name = normalized.partition(" ")
        if not separator:
            self.last_name = ""

    @validates("personnel_number")
    def validate_personnel_number(self, _: str, value: str | None) -> str | None:
        if value is not None and (not value or not value.isascii() or not value.isdigit()):
            raise ValueError("Numer pracownika może zawierać wyłącznie cyfry")
        return value


class AccountToken(Base):
    __tablename__ = "account_tokens"
    __table_args__ = (Index("ix_account_tokens_user_kind", "user_id", "kind"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    kind: Mapped[AccountTokenKind] = mapped_column(
        Enum(AccountTokenKind, native_enum=False, length=20)
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    user: Mapped[User] = relationship(back_populates="account_tokens")


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    share_link_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("share_links.id", ondelete="CASCADE"), nullable=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    csrf_token: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    user: Mapped[User | None] = relationship()
    share_link: Mapped[ShareLink | None] = relationship()


__all__ = ["AccountToken", "Session", "User"]
