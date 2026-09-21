from datetime import date

import pytest
from pydantic import ValidationError

from oncall.domain.vocabulary import AvailabilityKind
from oncall.infrastructure.sqlalchemy.availability_model import Availability
from oncall.infrastructure.sqlalchemy.swap_models import SwapRequest
from oncall.presentation.availability import AvailabilityCreate
from oncall.presentation.scheduling import GenerateScheduleRequest
from oncall.presentation.swaps import SwapDecisionRequest


def test_availability_rejects_reversed_range() -> None:
    with pytest.raises(ValidationError):
        AvailabilityCreate(
            kind=AvailabilityKind.unavailable,
            starts_on=date(2026, 9, 10),
            ends_on=date(2026, 9, 9),
        )


def test_availability_accepts_single_day() -> None:
    entry = AvailabilityCreate(
        kind=AvailabilityKind.prefer_not,
        starts_on=date(2026, 9, 12),
        ends_on=date(2026, 9, 12),
    )
    assert entry.starts_on == entry.ends_on


def test_swap_decision_requires_non_blank_reason() -> None:
    with pytest.raises(ValidationError):
        SwapDecisionRequest(reason="   ")


def test_swap_decision_accepts_reason() -> None:
    decision = SwapDecisionRequest(reason="Mam zaplanowany urlop")
    assert decision.reason == "Mam zaplanowany urlop"


def test_swap_decision_column_belongs_to_swap_request() -> None:
    assert "decision_note" in SwapRequest.__table__.columns
    assert "decision_note" not in Availability.__table__.columns


def test_generation_accepts_35_days_but_rejects_36() -> None:
    GenerateScheduleRequest(starts_on=date(2026, 9, 1), ends_on=date(2026, 10, 5))
    with pytest.raises(ValidationError, match="maksymalnie 35 dni"):
        GenerateScheduleRequest(starts_on=date(2026, 9, 1), ends_on=date(2026, 10, 6))
