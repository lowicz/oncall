"""Swap impact preview: archive/docs/PLAN.md §4 requires showing the effect on points
before the request is sent."""

from datetime import date, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.domain.vocabulary import AssignmentRole, UserRole
from oncall.fairness import FairnessDuty
from oncall.fairness_data import reassign
from tests.conftest import create_member, create_published_schedule, create_user, login

START = date.today() + timedelta(days=1)


async def _team(db: AsyncSession) -> None:
    anna = await create_user(db, "anna", display_name="Anna Kowalska")
    marek = await create_user(db, "marek", display_name="Marek Nowak")
    ola = await create_user(db, "ola", display_name="Ola Wiśniewska")
    # Piotr is in the team but holds no duty, so he is a valid outsider to a
    # swap between the other three.
    piotr = await create_user(db, "piotr", display_name="Piotr Zieliński")
    await create_member(db, anna, display_name="Anna Kowalska")
    await create_member(db, marek, display_name="Marek Nowak")
    await create_member(db, ola, display_name="Ola Wiśniewska")
    await create_member(db, piotr, display_name="Piotr Zieliński")
    await create_published_schedule(
        db,
        starts_on=START,
        days=20,
        primary=["Anna Kowalska"],
        secondary=["Marek Nowak"],
        late_shift=["Ola Wiśniewska"],
    )


async def _replacement_id(client: AsyncClient, service_date: date) -> str:
    response = await client.get(
        "/api/v1/swaps/options",
        params={"service_date": service_date.isoformat(), "role": "primary"},
    )
    assert response.status_code == 200, response.text
    options = response.json()
    assert options, "expected at least one eligible replacement"
    return options[0]["member_id"]


@pytest.mark.anyio
async def test_impact_moves_points_between_the_two_people(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _team(db)
    await login(client, "anna")
    service_date = START + timedelta(days=2)
    replacement_id = await _replacement_id(client, service_date)

    response = await client.get(
        "/api/v1/swaps/impact",
        params={
            "service_date": service_date.isoformat(),
            "role": "primary",
            "replacement_member_id": replacement_id,
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["requester"]["display_name"] == "Anna Kowalska"
    assert body["points"] in (1.0, 2.0)

    # The requester loses exactly this duty, the replacement gains it.
    requester = body["requester"]
    replacement = body["replacement"]
    assert requester["after"]["primary"]["actual"] < requester["before"]["primary"]["actual"]
    assert replacement["after"]["primary"]["actual"] > replacement["before"]["primary"]["actual"]
    moved = requester["before"]["primary"]["actual"] - requester["after"]["primary"]["actual"]
    assert moved == pytest.approx(body["points"])


@pytest.mark.anyio
async def test_impact_writes_nothing(client: AsyncClient, db: AsyncSession) -> None:
    await _team(db)
    await login(client, "anna")
    service_date = START + timedelta(days=2)
    replacement_id = await _replacement_id(client, service_date)
    params = {
        "service_date": service_date.isoformat(),
        "role": "primary",
        "replacement_member_id": replacement_id,
    }

    first = await client.get("/api/v1/swaps/impact", params=params)
    second = await client.get("/api/v1/swaps/impact", params=params)
    assert first.json() == second.json()

    # No swap request was created as a side effect.
    listing = await client.get("/api/v1/swaps")
    assert listing.json() == []


@pytest.mark.anyio
async def test_impact_rejects_a_slot_without_a_published_assignment(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _team(db)
    await login(client, "anna")
    service_date = START + timedelta(days=2)
    replacement_id = await _replacement_id(client, service_date)

    response = await client.get(
        "/api/v1/swaps/impact",
        params={
            "service_date": (START + timedelta(days=400)).isoformat(),
            "role": "primary",
            "replacement_member_id": replacement_id,
        },
    )
    assert response.status_code == 404


@pytest.mark.anyio
async def test_member_cannot_preview_a_swap_they_are_not_part_of(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _team(db)
    await login(client, "anna")
    service_date = START + timedelta(days=2)
    # Anna is the assigned primary; the options exclude her and whoever holds the
    # opposite role that day, so this is somebody else entirely.
    replacement_id = await _replacement_id(client, service_date)

    await login(client, "piotr")
    response = await client.get(
        "/api/v1/swaps/impact",
        params={
            "service_date": service_date.isoformat(),
            "role": "primary",
            "replacement_member_id": replacement_id,
        },
    )
    assert response.status_code == 403


@pytest.mark.anyio
async def test_coordinator_may_preview_any_swap(client: AsyncClient, db: AsyncSession) -> None:
    await _team(db)
    await create_user(db, "koord", role=UserRole.coordinator)
    await login(client, "anna")
    service_date = START + timedelta(days=2)
    replacement_id = await _replacement_id(client, service_date)

    await login(client, "koord")
    response = await client.get(
        "/api/v1/swaps/impact",
        params={
            "service_date": service_date.isoformat(),
            "role": "primary",
            "replacement_member_id": replacement_id,
        },
    )
    assert response.status_code == 200, response.text


@pytest.mark.anyio
async def test_viewer_cannot_see_points(client: AsyncClient, db: AsyncSession) -> None:
    await _team(db)
    await create_user(db, "widz", role=UserRole.viewer)
    await login(client, "anna")
    service_date = START + timedelta(days=2)
    replacement_id = await _replacement_id(client, service_date)

    await login(client, "widz")
    response = await client.get(
        "/api/v1/swaps/impact",
        params={
            "service_date": service_date.isoformat(),
            "role": "primary",
            "replacement_member_id": replacement_id,
        },
    )
    assert response.status_code == 403


@pytest.mark.anyio
async def test_impact_does_not_invent_an_anchor_split_for_a_fully_coupled_swap(
    client: AsyncClient, db: AsyncSession
) -> None:
    """QA7 par. 8, D2 review: `/swaps/impact` used to check only the clicked
    slot, so a secondary-role swap that in reality moves 11-19 along with it
    (decision D1, both people eligible for both roles) looked like it split
    the anchor from its role - a violation `replacement_options` never
    reported for the very same request, next to the "moves both slots" note."""
    magda = await create_user(db, "magda", display_name="Magdalena Woźniak")
    marek = await create_user(db, "marek", display_name="Marek Nowak")
    await create_user(db, "ola", display_name="Ola Zalewska")
    await create_member(db, magda, display_name="Magdalena Woźniak")
    marek_member = await create_member(db, marek, display_name="Marek Nowak")
    await create_published_schedule(
        db,
        starts_on=START,
        days=7,
        primary=["Ola Zalewska"],
        secondary=["Magdalena Woźniak"],
        late_shift=["Magdalena Woźniak"],
    )
    service_date = START + timedelta(days=1)
    await login(client, "magda")

    response = await client.get(
        "/api/v1/swaps/impact",
        params={
            "service_date": service_date.isoformat(),
            "role": "secondary",
            "replacement_member_id": str(marek_member.id),
        },
    )
    assert response.status_code == 200, response.text
    rules = {item["rule"] for item in response.json()["warnings"]}
    assert "late_shift_anchor" not in rules, response.json()["warnings"]


def test_reassign_moves_only_the_named_slot() -> None:
    day = date(2026, 9, 14)
    duties = [
        FairnessDuty(day, AssignmentRole.primary, "Anna"),
        FairnessDuty(day, AssignmentRole.secondary, "Anna"),
        FairnessDuty(day + timedelta(days=1), AssignmentRole.primary, "Anna"),
    ]
    moved = reassign(duties, day, AssignmentRole.primary, "Anna", "Piotr")
    assert [d.assignee_name for d in moved] == ["Piotr", "Anna", "Anna"]


def test_reassign_ignores_a_slot_held_by_someone_else() -> None:
    day = date(2026, 9, 14)
    duties = [FairnessDuty(day, AssignmentRole.primary, "Marek")]
    assert reassign(duties, day, AssignmentRole.primary, "Anna", "Piotr") == duties
