"""Unit tests for the pure helpers in `fairness_data` that forecast a change."""

from datetime import date

from oncall.fairness import FairnessDuty
from oncall.fairness_data import project_duties
from oncall.models import AssignmentRole

D1 = date(2026, 9, 21)
D2 = date(2026, 9, 22)
D3 = date(2026, 9, 23)


def _duty(day: date, role: AssignmentRole, name: str) -> FairnessDuty:
    return FairnessDuty(service_date=day, role=role, assignee_name=name, member_id=None)


def test_draft_substitutes_the_slots_it_regenerates() -> None:
    historical = [
        _duty(D1, AssignmentRole.primary, "Anna"),
        _duty(D1, AssignmentRole.secondary, "Marek"),
        _duty(D2, AssignmentRole.primary, "Anna"),
    ]
    draft = [
        _duty(D1, AssignmentRole.primary, "Ola"),
        _duty(D1, AssignmentRole.secondary, "Ola"),
        _duty(D2, AssignmentRole.primary, "Ola"),
    ]
    projected = project_duties(historical, draft)
    # Every historical slot the draft touches is gone; the draft rows replace it.
    assert projected == draft
    assert len(projected) == 3


def test_slots_outside_the_draft_are_kept() -> None:
    historical = [
        _duty(D1, AssignmentRole.primary, "Anna"),
        _duty(D3, AssignmentRole.primary, "Marek"),
    ]
    draft = [_duty(D1, AssignmentRole.primary, "Ola")]
    projected = project_duties(historical, draft)
    assert _duty(D3, AssignmentRole.primary, "Marek") in projected
    assert _duty(D1, AssignmentRole.primary, "Anna") not in projected
    assert _duty(D1, AssignmentRole.primary, "Ola") in projected


def test_draft_over_uncovered_range_is_a_plain_append() -> None:
    historical = [_duty(D1, AssignmentRole.primary, "Anna")]
    draft = [_duty(D3, AssignmentRole.primary, "Ola")]
    assert project_duties(historical, draft) == historical + draft
