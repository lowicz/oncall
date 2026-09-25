"""HTTP contract and mapping for the availability feature."""

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from oncall.domain.availability.models import AvailabilityEntry
from oncall.domain.team import Member
from oncall.domain.vocabulary import AvailabilityKind
from oncall.i18n import translate


class AvailabilityCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: AvailabilityKind
    starts_on: date
    ends_on: date
    note: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def validate_dates(self) -> AvailabilityCreate:
        if self.ends_on < self.starts_on:
            raise ValueError(translate("availability.range_reversed"))
        if (self.ends_on - self.starts_on).days > 366:
            raise ValueError(translate("availability.range_too_long"))
        return self


class AvailabilityResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: AvailabilityKind
    starts_on: date
    ends_on: date
    note: str | None
    created_at: datetime
    warning: str | None = None
    created_by_name: str | None = None


def availability_response(
    entry: AvailabilityEntry, member: Member, warning: str | None = None
) -> AvailabilityResponse:
    """Translate a domain entry into the established HTTP representation."""
    return AvailabilityResponse(
        id=entry.id,
        kind=entry.kind,
        starts_on=entry.starts_on,
        ends_on=entry.ends_on,
        note=entry.note,
        created_at=entry.created_at,
        warning=warning,
        created_by_name=entry.filed_for(member),
    )


__all__ = ["AvailabilityCreate", "AvailabilityResponse", "availability_response"]
