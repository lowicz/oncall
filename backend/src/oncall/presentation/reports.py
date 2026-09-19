"""HTTP contracts for the fairness report and the draft impact preview."""

import uuid
from datetime import date

from pydantic import BaseModel, Field

from oncall.domain.vocabulary import AssignmentRole


class FairnessCategoryResponse(BaseModel):
    actual: float
    expected: float
    deviation: float


class FairnessMemberResponse(BaseModel):
    member_id: uuid.UUID
    display_name: str
    #: Rotation join date; the screen uses it to explain a low absolute total
    #: that still matches the fair share.
    active_from: date
    eligible_days: dict[str, int]
    primary: FairnessCategoryResponse
    secondary: FairnessCategoryResponse
    late_shift: FairnessCategoryResponse
    weekends: FairnessCategoryResponse
    holidays: FairnessCategoryResponse
    total_points: float
    in_criterion: bool = True


class FairnessOutlierResponse(BaseModel):
    member_id: uuid.UUID
    display_name: str
    deviation: float


class FairnessLensOutliersResponse(BaseModel):
    lens: str
    highest: FairnessOutlierResponse | None
    lowest: FairnessOutlierResponse | None


class FairnessLensSpreadResponse(BaseModel):
    """One graded lens on the rolling report: the spread between the most-
    and least-served member, and whether it fits the acceptance criterion."""

    lens: str
    spread: float
    meets_criterion: bool


class DraftLensSpreadResponse(BaseModel):
    """One graded lens in the draft impact preview, before vs after."""

    lens: str
    before: float
    after: float
    meets_criterion: bool


class FairnessReportResponse(BaseModel):
    as_of: date
    window_start: date
    window_end: date
    totals: dict[str, float]
    members: list[FairnessMemberResponse]
    #: Whether the 11-19 shift is balanced on its own (anchor `independent`).
    #: When anchored, the shift count follows the anchor role, the column is
    #: hidden in the UI, and the per-member numbers stay filled but
    #: informational (decision D1).
    late_shift_balanced: bool
    #: Acceptance criterion from docs/PLAN.md par. 3 with the per-lens spreads
    #: it judges, computed here so the threshold lives in one place.
    criterion_points: int
    criterion_met: bool
    spreads: list[FairnessLensSpreadResponse]
    outliers: list[FairnessLensOutliersResponse] = Field(default_factory=list)
    #: Real end of the latest published schedule, unbounded by the 90-day
    #: window `/schedules/published` caps itself to.
    latest_publish_end: date | None = None


class DraftFairnessImpactResponse(BaseModel):
    schedule_id: uuid.UUID
    schedule_version: int
    baseline_as_of: date
    projected_as_of: date
    baseline_members: list[FairnessMemberResponse]
    projected_members: list[FairnessMemberResponse]
    #: Same semantics as on the fairness report (decision D1).
    late_shift_balanced: bool
    criterion_points: int
    criterion_met: bool
    spreads: list[DraftLensSpreadResponse]
    #: Lowest achievable spread when the solver proved the criterion
    #: unattainable for this roster (decision D2); None when it holds.
    acceptance_floor: int | None


class FairnessDutyResponse(BaseModel):
    service_date: date
    role: AssignmentRole
    points: float
    is_day_off: bool


__all__ = [
    "DraftFairnessImpactResponse",
    "DraftLensSpreadResponse",
    "FairnessCategoryResponse",
    "FairnessDutyResponse",
    "FairnessLensOutliersResponse",
    "FairnessLensSpreadResponse",
    "FairnessMemberResponse",
    "FairnessOutlierResponse",
    "FairnessReportResponse",
]
