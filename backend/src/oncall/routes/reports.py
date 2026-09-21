import csv
import io
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from pydantic import BaseModel

from oncall.bootstrap.providers import ReportProvider
from oncall.domain.reports.errors import InvalidMonth
from oncall.domain.reports.models import DutyTally, MonthlyReport
from oncall.domain.reports.use_cases import monthly_report
from oncall.domain.vocabulary import UserRole
from oncall.infrastructure.sqlalchemy.access_models import User
from oncall.permissions import require_roles
from oncall.routes.domain_edge import domain_errors_as_http


class MonthlyReportRow(BaseModel):
    name: str
    primary_workdays: int
    primary_weekends: int
    primary_holidays: int
    secondary_workdays: int
    secondary_weekends: int
    secondary_holidays: int
    oncall_workdays: int
    oncall_weekends: int
    oncall_holidays: int
    late_shifts: int
    primary_points: float
    secondary_points: float
    total_points: float


class MonthlyReportPreviewResponse(BaseModel):
    month: str
    days_in_month: int
    staffed_days: int
    rows: list[MonthlyReportRow]


router = APIRouter(prefix="/api/v1/reports", tags=["reports"])
Coordinator = Annotated[User, Depends(require_roles(UserRole.coordinator, UserRole.admin))]

HEADERS = (
    "miesiac",
    "osoba",
    "primary_dni_robocze",
    "primary_weekendy",
    "primary_swieta",
    "secondary_dni_robocze",
    "secondary_weekendy",
    "secondary_swieta",
    "oncall_dni_robocze_razem",
    "oncall_weekendy_razem",
    "oncall_swieta_razem",
    "zmiany_11_19",
    "primary_punkty",
    "secondary_punkty",
    "punkty_razem",
)


REPORT_ERROR_STATUSES = {InvalidMonth: status.HTTP_422_UNPROCESSABLE_CONTENT}


async def _report(ports: ReportProvider, month: str) -> MonthlyReport:
    with domain_errors_as_http(REPORT_ERROR_STATUSES):
        return await monthly_report(month, ports)


def _row_values(tally: DutyTally) -> tuple[int | float, ...]:
    return (
        tally.primary_workday,
        tally.primary_weekend,
        tally.primary_holiday,
        tally.secondary_workday,
        tally.secondary_weekend,
        tally.secondary_holiday,
        tally.oncall_workdays,
        tally.oncall_weekends,
        tally.oncall_holidays,
        tally.late_shift,
        tally.primary_points,
        tally.secondary_points,
        tally.total_points,
    )


@router.get("/monthly.csv")
async def monthly_report_csv(
    _: Coordinator,
    ports: ReportProvider,
    month: Annotated[str, Query(pattern=r"^\d{4}-\d{2}$")],
) -> Response:
    report = await _report(ports, month)
    output = io.StringIO()
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(HEADERS)
    for row in report.rows:
        writer.writerow((month, row.name, *_row_values(row.tally)))
    return Response(
        content="\ufeff" + output.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="oncall-{month}.csv"'},
    )


@router.get("/monthly", response_model=MonthlyReportPreviewResponse)
async def monthly_report_preview(
    _: Coordinator,
    ports: ReportProvider,
    month: Annotated[str, Query(pattern=r"^\d{4}-\d{2}$")],
) -> MonthlyReportPreviewResponse:
    report = await _report(ports, month)
    return MonthlyReportPreviewResponse(
        month=month,
        days_in_month=report.days_in_month,
        staffed_days=report.staffed_days,
        rows=[
            MonthlyReportRow(
                name=row.name,
                primary_workdays=row.tally.primary_workday,
                primary_weekends=row.tally.primary_weekend,
                primary_holidays=row.tally.primary_holiday,
                secondary_workdays=row.tally.secondary_workday,
                secondary_weekends=row.tally.secondary_weekend,
                secondary_holidays=row.tally.secondary_holiday,
                oncall_workdays=row.tally.oncall_workdays,
                oncall_weekends=row.tally.oncall_weekends,
                oncall_holidays=row.tally.oncall_holidays,
                late_shifts=row.tally.late_shift,
                primary_points=row.tally.primary_points,
                secondary_points=row.tally.secondary_points,
                total_points=row.tally.total_points,
            )
            for row in report.rows
        ],
    )
