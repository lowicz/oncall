"""HTTP contracts and edge mappers for share links and calendar feeds."""

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from oncall.domain.sharing.models import FeedIssued, ShareLink
from oncall.domain.vocabulary import UserRole


class ShareLinkCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str = Field(min_length=1, max_length=160)
    starts_on: date
    ends_on: date
    expires_days: int = Field(default=7, ge=1, le=30)

    @model_validator(mode="after")
    def validate_dates(self) -> ShareLinkCreate:
        if self.ends_on < self.starts_on:
            raise ValueError("Data końcowa nie może poprzedzać początkowej")
        if (self.ends_on - self.starts_on).days > 366:
            raise ValueError("Zakres linku może obejmować maksymalnie 366 dni")
        return self


class ShareLinkCreatedResponse(BaseModel):
    id: uuid.UUID
    url: str
    expires_at: datetime


class ShareLinkResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    label: str
    starts_on: date
    ends_on: date
    expires_at: datetime
    created_at: datetime
    used_at: datetime | None
    revoked_at: datetime | None


class ShareExchangeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: str = Field(min_length=20, max_length=200)


class ShareExchangeResponse(BaseModel):
    display_name: str
    role: UserRole
    starts_on: date
    ends_on: date
    expires_at: datetime


class FeedTokenCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str = Field(min_length=1, max_length=160)


class FeedTokenResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    label: str
    created_at: datetime
    last_used_at: datetime | None
    revoked_at: datetime | None


class FeedTokenCreatedResponse(BaseModel):
    id: uuid.UUID
    url: str


def share_link_created_response(link: ShareLink, url: str) -> ShareLinkCreatedResponse:
    return ShareLinkCreatedResponse(id=link.id, url=url, expires_at=link.expires_at)


def share_exchange_response(link: ShareLink) -> ShareExchangeResponse:
    return ShareExchangeResponse(
        display_name=link.label,
        role=UserRole.viewer,
        starts_on=link.starts_on,
        ends_on=link.ends_on,
        expires_at=link.expires_at,
    )


def feed_created_response(issued: FeedIssued, url: str) -> FeedTokenCreatedResponse:
    return FeedTokenCreatedResponse(id=issued.feed.id, url=url)


__all__ = [
    "FeedTokenCreate",
    "FeedTokenCreatedResponse",
    "FeedTokenResponse",
    "ShareExchangeRequest",
    "ShareExchangeResponse",
    "ShareLinkCreate",
    "ShareLinkCreatedResponse",
    "ShareLinkResponse",
    "feed_created_response",
    "share_exchange_response",
    "share_link_created_response",
]
