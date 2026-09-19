from datetime import date
from typing import Annotated

from fastapi import APIRouter, Query

from oncall.auth import CurrentPrincipal
from oncall.bootstrap.providers import CalendarReader
from oncall.domain.calendar import use_cases
from oncall.domain.clock import business_today, utc_now
from oncall.presentation.assignments import AssignmentResponse
from oncall.presentation.published import CurrentDutyResponse, PublishedScheduleResponse
from oncall.routes.calendar import calendar_errors_as_http
from oncall.routes.domain_edge import audience_of

router = APIRouter()


@router.get("/api/v1/schedules/published", response_model=PublishedScheduleResponse)
async def published_schedule(
    principal: CurrentPrincipal,
    ports: CalendarReader,
    starts_on: Annotated[date | None, Query()] = None,
    ends_on: Annotated[date | None, Query()] = None,
) -> PublishedScheduleResponse:
    with calendar_errors_as_http():
        board = await use_cases.dashboard(
            audience_of(principal), starts_on, ends_on, ports, today=business_today()
        )
    current = [
        CurrentDutyResponse(
            role=item.duty.role,
            service_date=item.duty.service_date,
            assignee_name=item.duty.assignee_name,
            member_id=item.member_id,
            contact_email=item.contact_email,
            contact_phone=item.contact_phone,
            coverage_starts_at=item.coverage_starts_at,
            coverage_ends_at=item.coverage_ends_at,
            is_day_off=item.is_day_off,
            is_override=item.duty.is_override,
            next_assignee_name=item.next_assignee_name,
            next_service_date=item.next_service_date,
        )
        for item in board.current
    ]
    if not board.duties:
        return PublishedScheduleResponse(
            generated_at=utc_now(),
            is_published=False,
            id=None,
            version=None,
            starts_on=None,
            ends_on=None,
            assignments=[],
            current=current,
            today_is_day_off=board.today_is_day_off,
            today_holiday_name=board.today_holiday_name,
        )
    owner = board.duties[0]
    return PublishedScheduleResponse(
        generated_at=utc_now(),
        is_published=board.is_published,
        id=owner.schedule_id,
        version=owner.schedule_version,
        starts_on=board.duties[0].service_date,
        ends_on=board.duties[-1].service_date,
        assignments=[
            AssignmentResponse(
                service_date=duty.service_date,
                role=duty.role,
                assignee_name=duty.assignee_name,
                is_override=duty.is_override,
            )
            for duty in board.duties
        ],
        current=current,
        today_is_day_off=board.today_is_day_off,
        today_holiday_name=board.today_holiday_name,
    )
