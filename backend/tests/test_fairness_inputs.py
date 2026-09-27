"""What the fairness report reads and how it reads an empty team."""

import uuid
from datetime import date

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.domain.vocabulary import AssignmentRole, AvailabilityKind, UserRole
from oncall.fairness import FairnessDuty, duty_points
from oncall.fairness_data import load_inputs
from oncall.infrastructure.sqlalchemy.availability_model import Availability
from tests.conftest import create_member, create_user, login

WINDOW_START = date(2030, 1, 1)
WINDOW_END = date(2030, 12, 31)


async def test_only_hard_unavailability_touching_the_window_reaches_the_formula(
    db: AsyncSession,
) -> None:
    user = await create_user(db, "anna", display_name="Anna")
    anna = await create_member(db, user, display_name="Anna", active_from=date(2029, 1, 1))
    db.add_all(
        [
            # Straddles the window start: still read, as stored.
            Availability(
                member_id=anna.id,
                kind=AvailabilityKind.unavailable,
                starts_on=date(2029, 12, 28),
                ends_on=date(2030, 1, 3),
            ),
            Availability(
                member_id=anna.id,
                kind=AvailabilityKind.unavailable,
                starts_on=date(2030, 6, 1),
                ends_on=date(2030, 6, 5),
            ),
            # A soft preference is not unavailability.
            Availability(
                member_id=anna.id,
                kind=AvailabilityKind.prefer_not,
                starts_on=date(2030, 7, 1),
                ends_on=date(2030, 7, 2),
            ),
            # Wholly before the window.
            Availability(
                member_id=anna.id,
                kind=AvailabilityKind.unavailable,
                starts_on=date(2029, 3, 1),
                ends_on=date(2029, 3, 2),
            ),
        ]
    )
    await db.commit()

    members, duties, _holidays = await load_inputs(db, WINDOW_START, WINDOW_END)

    (only,) = members
    assert only.id == anna.id
    assert only.unavailable_periods == [
        (date(2029, 12, 28), date(2030, 1, 3)),
        (date(2030, 6, 1), date(2030, 6, 5)),
    ]
    assert duties == []


def test_the_duty_breakdown_skips_duties_outside_the_window() -> None:
    anna = uuid.uuid4()
    duties = [
        FairnessDuty(date(2029, 12, 31), AssignmentRole.primary, "Anna", anna),
        FairnessDuty(date(2030, 3, 9), AssignmentRole.primary, "Anna", anna),
        FairnessDuty(date(2031, 1, 1), AssignmentRole.secondary, "Anna", anna),
    ]

    breakdown = duty_points(
        duties,
        assignee_name="Anna",
        member_id=anna,
        holidays=set(),
        window_start=WINDOW_START,
        window_end=WINDOW_END,
    )

    assert [(day, role, is_day_off) for day, role, _points, is_day_off in breakdown] == [
        (date(2030, 3, 9), AssignmentRole.primary, True)
    ]


async def test_a_team_report_without_members_has_no_outliers_and_no_spread(
    client: AsyncClient, db: AsyncSession
) -> None:
    await create_user(db, "koord", role=UserRole.coordinator)
    await login(client, "koord")

    response = await client.get("/api/v1/fairness", params={"as_of": "2030-03-09"})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["members"] == []
    assert body["outliers"]
    assert all(item["lowest"] is None and item["highest"] is None for item in body["outliers"])
    assert body["spreads"]
    assert all(item["spread"] == 0 and item["meets_criterion"] for item in body["spreads"])
