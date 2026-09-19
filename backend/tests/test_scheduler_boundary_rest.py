from datetime import date, timedelta

from oncall.models import AssignmentRole, RotationMode
from oncall.scheduler import DateRange, SolverMember, generate_schedule


def member(name: str) -> SolverMember:
    active = DateRange(date(2026, 1, 1), None)
    return SolverMember(
        name=name,
        active=active,
        eligibility={role: (active,) for role in AssignmentRole},
    )


def test_prior_weekend_is_included_in_boundary_rest_rules() -> None:
    starts_on = date(2026, 9, 7)
    result = generate_schedule(
        starts_on=starts_on,
        ends_on=starts_on + timedelta(days=6),
        mode=RotationMode.hybrid,
        members=[member(name) for name in ("Anna", "Bartosz", "Celina", "Dawid")],
        historical_points={},
        holidays=set(),
        prior_oncall={"Anna": {starts_on - timedelta(days=2), starts_on - timedelta(days=1)}},
        solve_seconds=10,
    )

    assert result.conflicts == ()
    anna_oncall = {
        item.service_date
        for item in result.assignments
        if item.assignee_name == "Anna"
        and item.role in (AssignmentRole.primary, AssignmentRole.secondary)
    }
    assert not {
        starts_on,
        starts_on + timedelta(days=1),
    }.issubset(anna_oncall)


def test_preexisting_violation_warns_without_making_model_infeasible() -> None:
    starts_on = date(2026, 9, 7)
    result = generate_schedule(
        starts_on=starts_on,
        ends_on=starts_on + timedelta(days=3),
        mode=RotationMode.daily,
        members=[member(name) for name in ("Anna", "Bartosz", "Celina", "Dawid")],
        historical_points={},
        holidays=set(),
        prior_oncall={"Anna": {starts_on - timedelta(days=offset) for offset in range(1, 6)}},
        solve_seconds=10,
    )

    assert result.conflicts == ()
    assert any("Historia przed początkiem zakresu" in warning for warning in result.warnings)
    assert result.assignments
    assert not any(
        item.assignee_name == "Anna"
        and item.role in (AssignmentRole.primary, AssignmentRole.secondary)
        for item in result.assignments
    )
