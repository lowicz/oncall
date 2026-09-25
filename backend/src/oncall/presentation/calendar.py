"""HTTP contracts and edge mappers for the team calendar."""

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from oncall.domain.calendar.models import CalendarMatrix
from oncall.domain.vocabulary import AssignmentRole, AvailabilityKind, CalendarEventColor
from oncall.i18n import translate


class CalendarEventRef(BaseModel):
    id: uuid.UUID
    title: str
    color: CalendarEventColor


class CalendarDayResponse(BaseModel):
    service_date: date
    weekday: str
    is_day_off: bool
    holiday_name: str | None
    published: bool
    events: list[CalendarEventRef]


class CalendarEventResponse(CalendarEventRef):
    model_config = ConfigDict(from_attributes=True)

    starts_on: date
    ends_on: date
    created_at: datetime


class CalendarEventCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    starts_on: date
    ends_on: date
    title: str = Field(min_length=1, max_length=160, pattern=r"\S")
    color: CalendarEventColor

    @model_validator(mode="after")
    def validate_range(self) -> CalendarEventCreate:
        if self.ends_on < self.starts_on:
            raise ValueError(translate("calendar.range_ends_before_start"))
        return self


class CalendarEventUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    starts_on: date | None = None
    ends_on: date | None = None
    title: str | None = Field(default=None, min_length=1, max_length=160, pattern=r"\S")
    color: CalendarEventColor | None = None


class CalendarEligibilityResponse(BaseModel):
    role: AssignmentRole
    starts_on: date
    ends_on: date | None


class CalendarMemberResponse(BaseModel):
    id: uuid.UUID
    display_name: str
    active_from: date
    active_until: date | None
    eligibility: list[CalendarEligibilityResponse] = Field(default_factory=list)


class CalendarAssignmentResponse(BaseModel):
    schedule_id: uuid.UUID
    schedule_version: int
    service_date: date
    role: AssignmentRole
    assignee_name: str
    member_id: uuid.UUID | None
    is_override: bool
    change_kind: str | None


class CalendarAvailabilityResponse(BaseModel):
    member_id: uuid.UUID
    kind: AvailabilityKind
    starts_on: date
    ends_on: date
    note: str | None


class CalendarResponse(BaseModel):
    starts_on: date
    ends_on: date
    days: list[CalendarDayResponse]
    members: list[CalendarMemberResponse]
    team_has_members: bool
    assignments: list[CalendarAssignmentResponse]
    availability: list[CalendarAvailabilityResponse]


def calendar_response(matrix: CalendarMatrix) -> CalendarResponse:
    return CalendarResponse(
        starts_on=matrix.starts_on,
        ends_on=matrix.ends_on,
        days=[
            CalendarDayResponse(
                service_date=day.service_date,
                weekday=day.weekday,
                is_day_off=day.is_day_off,
                holiday_name=day.holiday_name,
                published=day.published,
                events=[
                    CalendarEventRef(id=event.id, title=event.title, color=event.color)
                    for event in day.events
                ],
            )
            for day in matrix.days
        ],
        members=[
            CalendarMemberResponse(
                id=member.id,
                display_name=member.display_name,
                active_from=member.active_from,
                active_until=member.active_until,
                eligibility=[
                    CalendarEligibilityResponse(
                        role=item.role, starts_on=item.starts_on, ends_on=item.ends_on
                    )
                    for item in member.eligibility
                ]
                if matrix.shows_eligibility
                else [],
            )
            for member in matrix.members
        ],
        team_has_members=matrix.team_has_members,
        assignments=[
            CalendarAssignmentResponse(
                schedule_id=item.duty.schedule_id,
                schedule_version=item.duty.schedule_version,
                service_date=item.duty.service_date,
                role=item.duty.role,
                assignee_name=item.duty.assignee_name,
                member_id=item.duty.member_id,
                is_override=item.duty.is_override,
                change_kind=item.change_kind,
            )
            for item in matrix.duties
        ],
        availability=[
            CalendarAvailabilityResponse(
                member_id=item.member_id,
                kind=item.entry.kind,
                starts_on=item.entry.starts_on,
                ends_on=item.entry.ends_on,
                note=item.entry.note,
            )
            for item in matrix.availability
        ],
    )


__all__ = [
    "CalendarAssignmentResponse",
    "CalendarAvailabilityResponse",
    "CalendarDayResponse",
    "CalendarEligibilityResponse",
    "CalendarEventCreate",
    "CalendarEventRef",
    "CalendarEventResponse",
    "CalendarEventUpdate",
    "CalendarMemberResponse",
    "CalendarResponse",
    "calendar_response",
]
