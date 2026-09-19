"""Fairness report endpoints.

Coordinators and administrators see the whole team; a team member sees only
their own balance. Viewers and share-link sessions see nothing, because
points are private to the team.
"""

import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Query, status

from oncall.auth import CurrentUser
from oncall.bootstrap.providers import BalanceProvider
from oncall.domain.balance import errors, use_cases
from oncall.domain.balance.models import BalanceQuery, DutyBreakdownQuery
from oncall.domain.clock import business_today
from oncall.fairness_data import member_response
from oncall.presentation.reports import (
    FairnessDutyResponse,
    FairnessLensOutliersResponse,
    FairnessLensSpreadResponse,
    FairnessOutlierResponse,
    FairnessReportResponse,
)
from oncall.routes.domain_edge import SHARED_ERROR_STATUSES, actor_from, domain_errors_as_http

router = APIRouter(prefix="/api/v1/fairness", tags=["fairness"])

BALANCE_ERROR_STATUSES = {
    **SHARED_ERROR_STATUSES,
    errors.PointsTeamOnly: status.HTTP_403_FORBIDDEN,
    errors.OwnDutiesOnly: status.HTTP_403_FORBIDDEN,
    errors.BalanceMemberNotFound: status.HTTP_404_NOT_FOUND,
}


@router.get("", response_model=FairnessReportResponse)
async def fairness_report(
    user: CurrentUser,
    ports: BalanceProvider,
    as_of: Annotated[date | None, Query()] = None,
) -> FairnessReportResponse:
    with domain_errors_as_http(BALANCE_ERROR_STATUSES):
        report = await use_cases.balance_report(
            BalanceQuery(actor=actor_from(user), as_of=as_of or business_today()), ports
        )
    return FairnessReportResponse(
        as_of=report.as_of,
        window_start=report.window_start,
        window_end=report.window_end,
        totals=report.totals,
        members=[member_response(member, report.criterion_ids) for member in report.members],
        late_shift_balanced=report.late_shift_balanced,
        criterion_points=report.criterion_points,
        criterion_met=report.criterion_met,
        spreads=[
            FairnessLensSpreadResponse(
                lens=item.lens, spread=item.spread, meets_criterion=item.meets_criterion
            )
            for item in report.spreads
        ],
        outliers=[
            FairnessLensOutliersResponse(
                lens=item.lens,
                lowest=_outlier_for(item.lowest, item.lens),
                highest=_outlier_for(item.highest, item.lens),
            )
            for item in report.outliers
        ],
        latest_publish_end=report.latest_publish_end,
    )


def _outlier_for(balance, lens: str) -> FairnessOutlierResponse | None:
    if balance is None:
        return None
    return FairnessOutlierResponse(
        member_id=balance.member_id,
        display_name=balance.display_name,
        deviation=getattr(balance, lens).deviation,
    )


@router.get("/duties", response_model=list[FairnessDutyResponse])
async def fairness_duties(
    user: CurrentUser,
    ports: BalanceProvider,
    member_id: Annotated[uuid.UUID, Query()],
    as_of: Annotated[date | None, Query()] = None,
) -> list[FairnessDutyResponse]:
    with domain_errors_as_http(BALANCE_ERROR_STATUSES):
        duties = await use_cases.duty_breakdown(
            DutyBreakdownQuery(
                actor=actor_from(user), member_id=member_id, as_of=as_of or business_today()
            ),
            ports,
        )
    return [
        FairnessDutyResponse(
            service_date=item.service_date,
            role=item.role,
            points=item.points,
            is_day_off=item.is_day_off,
        )
        for item in duties
    ]
