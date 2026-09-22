"""D3/Z8: hard rules are enforced on the swap path - a swap that would break
them is rejected with 409 naming the rule and the days, both at create
(up-front) and at approve (deciding, because the roster may have moved)."""

from datetime import date, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.domain.vocabulary import UserRole
from tests.conftest import (
    create_member,
    create_published_schedule,
    create_user,
    login,
)

START = date(2026, 9, 22)  # Tuesday; the 26th-27th are the weekend


async def _team(db: AsyncSession) -> dict:
    members = {}
    for username, name in (
        ("magda", "Magdalena Woźniak"),
        ("julia", "Julia Kowal"),
        ("ola", "Ola Zalewska"),
        ("marek", "Marek Nowak"),
    ):
        user = await create_user(db, username, display_name=name)
        members[name] = await create_member(db, user, display_name=name)
    await create_user(db, "koord", role=UserRole.coordinator)
    return members


async def _roster(db: AsyncSession):
    """Magdalena serves secondary 22-24, Julia on the 28th; late shift follows."""
    secondary = [
        "Magdalena Woźniak",
        "Magdalena Woźniak",
        "Magdalena Woźniak",
        "Ola Zalewska",
        "Ola Zalewska",
        "Ola Zalewska",
        "Julia Kowal",
    ]
    return await create_published_schedule(
        db,
        starts_on=START,
        days=7,
        primary=["Ola Zalewska"],
        secondary=secondary,
        late_shift=secondary,
    )


@pytest.mark.anyio
async def test_swap_breaking_three_in_seven_is_rejected_at_create(
    client: AsyncClient, db: AsyncSession
) -> None:
    """The regression case from QA-REPORT-5: Magdalena has 22-24, the swap
    would add the 28th into the same seven-day window."""
    members = await _team(db)
    schedule = await _roster(db)
    await login(client, "julia")

    created = await client.post(
        "/api/v1/swaps",
        json={
            "schedule_id": str(schedule.id),
            "service_date": "2026-09-28",
            "role": "secondary",
            "replacement_member_id": str(members["Magdalena Woźniak"].id),
        },
    )

    assert created.status_code == 409, created.text
    violations = created.json()["detail"]["violations"]
    three_in_seven = next(item for item in violations if item["rule"] == "three_in_seven")
    assert three_in_seven["member_name"] == "Magdalena Woźniak"
    assert "2026-09-28" in three_in_seven["days"]
    # The anchor no longer splits: the coupled swap (decision D1) moves 11-19
    # together with the secondary role, so `late_shift_anchor` is not raised.
    assert "late_shift_anchor" not in {item["rule"] for item in violations}
    assert created.json()["detail"]["next_step"]


@pytest.mark.anyio
async def test_swapping_the_late_shift_couples_the_anchor_role(
    client: AsyncClient, db: AsyncSession
) -> None:
    """Giving away 11-19 moves the anchor role with it as one decision (D1),
    so the swap is created rather than rejected for splitting the anchor."""
    members = await _team(db)
    schedule = await _roster(db)
    await login(client, "magda")

    created = await client.post(
        "/api/v1/swaps",
        json={
            "schedule_id": str(schedule.id),
            "service_date": "2026-09-23",
            "role": "late_shift",
            "replacement_member_id": str(members["Marek Nowak"].id),
        },
    )

    assert created.status_code == 201, created.text
    body = created.json()
    moved = {(slot["service_date"], slot["role"]) for slot in body["slots"]}
    assert moved == {("2026-09-23", "late_shift"), ("2026-09-23", "secondary")}


@pytest.mark.anyio
async def test_valid_swap_still_passes_and_approve_rechecks_the_rules(
    client: AsyncClient, db: AsyncSession
) -> None:
    """A clean swap (a primary weekday slot, which the secondary anchor does
    not touch) is created; when the roster moves before approval so the same
    swap would now break three_in_seven, approval rejects it."""
    members = await _team(db)
    schedule = await _roster(db)
    await login(client, "ola")
    created = await client.post(
        "/api/v1/swaps",
        json={
            "schedule_id": str(schedule.id),
            "service_date": "2026-09-23",
            "role": "primary",
            "replacement_member_id": str(members["Marek Nowak"].id),
        },
    )
    assert created.status_code == 201, created.text
    swap_id = created.json()["id"]
    await login(client, "marek")
    accepted = await client.post(f"/api/v1/swaps/{swap_id}/accept")
    assert accepted.status_code == 200, accepted.text

    # Between request and approval Marek picks up secondary on 21, 22 and 24
    # elsewhere, so taking primary on the 23rd now puts four duties in one
    # seven-day window.
    await create_published_schedule(
        db,
        starts_on=START - timedelta(days=1),
        days=5,
        primary=["Ola Zalewska"],
        secondary=[
            "Marek Nowak",
            "Marek Nowak",
            "Ola Zalewska",
            "Marek Nowak",
            "Ola Zalewska",
        ],
        late_shift=[
            "Marek Nowak",
            "Marek Nowak",
            "Ola Zalewska",
            "Marek Nowak",
            "Ola Zalewska",
        ],
        name="Późniejsza publikacja",
    )

    await login(client, "koord")
    approved = await client.post(f"/api/v1/swaps/{swap_id}/approve")
    assert approved.status_code == 409, approved.text
    violations = approved.json()["detail"]["violations"]
    three_in_seven = next(item for item in violations if item["rule"] == "three_in_seven")
    assert three_in_seven["member_name"] == "Marek Nowak"


@pytest.mark.anyio
async def test_coordinator_cannot_approve_own_swap_when_another_approver_exists(
    client: AsyncClient, db: AsyncSession, frozen_clock: object
) -> None:
    members = await _team(db)
    coordinator = await create_user(
        db, "self-coord", role=UserRole.coordinator, display_name="Tomasz Koordynator"
    )
    await create_member(db, coordinator, display_name="Tomasz Koordynator")
    schedule = await create_published_schedule(
        db,
        starts_on=START,
        days=1,
        primary=["Tomasz Koordynator"],
        secondary=["Ola Zalewska"],
        late_shift=["Ola Zalewska"],
    )
    await login(client, "self-coord")
    created = await client.post(
        "/api/v1/swaps",
        json={
            "schedule_id": str(schedule.id),
            "service_date": START.isoformat(),
            "role": "primary",
            "replacement_member_id": str(members["Marek Nowak"].id),
        },
    )
    assert created.status_code == 201, created.text
    await login(client, "marek")
    accepted = await client.post(f"/api/v1/swaps/{created.json()['id']}/accept")
    assert accepted.status_code == 200, accepted.text
    await login(client, "self-coord")

    approved = await client.post(f"/api/v1/swaps/{created.json()['id']}/approve")

    assert approved.status_code == 403
    assert approved.json()["detail"] == "Własną zamianę zatwierdza inny koordynator"
