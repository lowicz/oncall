import uuid
from dataclasses import dataclass
from datetime import date

from oncall.domain.team import Actor
from oncall.domain.vocabulary import AssignmentRole
from oncall.fairness import MemberBalance


@dataclass(frozen=True)
class BalanceQuery:
    actor: Actor
    as_of: date


@dataclass(frozen=True)
class LensSpread:
    lens: str
    spread: float
    meets_criterion: bool


@dataclass(frozen=True)
class LensOutliers:
    lens: str
    lowest: MemberBalance | None
    highest: MemberBalance | None


@dataclass(frozen=True)
class BalanceReport:
    as_of: date
    window_start: date
    window_end: date
    totals: dict[str, float]
    members: list[MemberBalance]
    criterion_ids: set[uuid.UUID]
    late_shift_balanced: bool
    criterion_points: int
    spreads: list[LensSpread]
    outliers: list[LensOutliers]
    latest_publish_end: date | None

    @property
    def criterion_met(self) -> bool:
        return all(item.meets_criterion for item in self.spreads)


@dataclass(frozen=True)
class DutyBreakdownQuery:
    actor: Actor
    member_id: uuid.UUID
    as_of: date


@dataclass(frozen=True)
class DutyPoints:
    service_date: date
    role: AssignmentRole
    points: float
    is_day_off: bool
