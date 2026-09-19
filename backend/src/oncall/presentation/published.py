"""HTTP contracts for the published roster the dashboard shows."""

import uuid
from datetime import date, datetime

from pydantic import BaseModel

from oncall.domain.vocabulary import AssignmentRole
from oncall.presentation.assignments import AssignmentResponse


class CurrentDutyResponse(BaseModel):
    """Today's duty, with what the dashboard needs to act on it.

    Separate from AssignmentResponse so the shared schema stays lean: only this
    endpoint carries contact details and the coverage window.
    """

    role: AssignmentRole
    service_date: date
    assignee_name: str
    member_id: uuid.UUID | None
    #: Omitted for viewers and share-link sessions.
    contact_email: str | None
    #: Decision D8: same visibility as `contact_email`, never in a share link.
    contact_phone: str | None
    coverage_starts_at: str
    coverage_ends_at: str
    is_day_off: bool
    is_override: bool
    #: Who takes this role over next, and when.
    next_assignee_name: str | None
    next_service_date: date | None


class PublishedScheduleResponse(BaseModel):
    generated_at: datetime
    #: True when at least one visible day comes from a real publication. A
    #: non-empty `id` is not the same thing: imported history is stored as a
    #: `superseded` schedule and fills `id` too.
    is_published: bool = False
    id: uuid.UUID | None
    version: int | None
    starts_on: date | None
    ends_on: date | None
    assignments: list[AssignmentResponse]
    current: list[CurrentDutyResponse] = []
    #: Lets the dashboard say "not applicable today" for the 11-19 shift on
    #: days off instead of a misleading "nobody assigned".
    today_is_day_off: bool = False
    today_holiday_name: str | None = None


__all__ = ["CurrentDutyResponse", "PublishedScheduleResponse"]
