"""BLK6-01 / decisions D1, D2: the 11-19 anchor couples two slots into one
swap, a replacement without 11-19 eligibility still takes the anchor role, and
`day_off_block` warns instead of blocking on the swap path."""

from datetime import date, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.domain.vocabulary import AssignmentRole, SwapStatus, UserRole
from oncall.infrastructure.sqlalchemy.swap_models import SwapRequest, SwapRequestSlot
from oncall.infrastructure.sqlalchemy.team_models import Eligibility
from tests.conftest import create_member, create_published_schedule, create_user, login
from tests.frozen_clock import FrozenClock

# 2026-09-21 is a Monday; the 26th-27th are the weekend (a day-off block).
START = date(2026, 9, 21)


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
    """Magdalena holds secondary + 11-19 all week; Ola primary."""
    return await create_published_schedule(
        db,
        starts_on=START,
        days=7,
        primary=["Ola Zalewska"],
        secondary=["Magdalena Woźniak"],
        late_shift=["Magdalena Woźniak"],
    )


@pytest.mark.anyio
@pytest.mark.usefixtures("frozen_clock")  # the swapped duty must still lie ahead
async def test_swapping_the_anchor_role_moves_the_late_shift_with_it(
    client: AsyncClient, db: AsyncSession
) -> None:
    members = await _team(db)
    schedule = await _roster(db)
    await login(client, "magda")

    created = await client.post(
        "/api/v1/swaps",
        json={
            "schedule_id": str(schedule.id),
            "service_date": "2026-09-22",
            "role": "secondary",
            "replacement_member_id": str(members["Marek Nowak"].id),
        },
    )
    assert created.status_code == 201, created.text
    slots = {(s["service_date"], s["role"]) for s in created.json()["slots"]}
    assert slots == {("2026-09-22", "secondary"), ("2026-09-22", "late_shift")}

    # A second request for either slot of that day is refused.
    dup = await client.post(
        "/api/v1/swaps",
        json={
            "schedule_id": str(schedule.id),
            "service_date": "2026-09-22",
            "role": "late_shift",
            "replacement_member_id": str(members["Julia Kowal"].id),
        },
    )
    assert dup.status_code == 409

    # Approval moves both assignments.
    swap_id = created.json()["id"]
    await login(client, "marek")
    assert (await client.post(f"/api/v1/swaps/{swap_id}/accept")).status_code == 200
    await login(client, "koord")
    approved = await client.post(f"/api/v1/swaps/{swap_id}/approve")
    assert approved.status_code == 200, approved.text
    published = (await client.get("/api/v1/schedules/published")).json()
    on_22 = {
        a["role"]: a["assignee_name"]
        for a in published["assignments"]
        if a["service_date"] == "2026-09-22"
    }
    assert on_22["secondary"] == "Marek Nowak"
    assert on_22["late_shift"] == "Marek Nowak"


@pytest.mark.anyio
@pytest.mark.usefixtures("frozen_clock")  # the swapped duty must still lie ahead
async def test_under_a_primary_anchor_the_late_shift_alone_goes_into_the_schedule(
    client: AsyncClient, db: AsyncSession
) -> None:
    """The anchor is a setting. With 11-19 following PRIMARY, Ola's Tuesday is
    PRIMARY + 11-19 and she gives the 11-19 alone, knowingly, to Marek."""
    members = await _team(db)
    schedule = await create_published_schedule(
        db,
        starts_on=START,
        days=7,
        primary=["Ola Zalewska"],
        secondary=["Magdalena Woźniak"],
        late_shift=["Ola Zalewska"],
    )
    await login(client, "koord")
    saved = await client.put(
        "/api/v1/scheduling/policy",
        json={"rotation_mode": "hybrid", "late_shift_anchor": "primary"},
    )
    assert saved.status_code == 200, saved.text
    await login(client, "ola")
    marek = str(members["Marek Nowak"].id)
    late_shift_alone = {"service_date": "2026-09-22", "role": "late_shift", "scope": "single"}
    split = {("late_shift_anchor", "Ola Zalewska"), ("late_shift_anchor", "Marek Nowak")}

    options = await client.get("/api/v1/swaps/options", params=late_shift_alone)
    assert options.status_code == 200, options.text
    by_name = {option["display_name"]: option for option in options.json()}
    assert by_name["Marek Nowak"]["slots"] == [{"service_date": "2026-09-22", "role": "late_shift"}]
    assert {
        (item["rule"], item["member_name"]) for item in by_name["Marek Nowak"]["rule_violations"]
    } == split
    # Magdalena holds SECONDARY that day: the pair would give her both on-call
    # roles, the 11-19 alone does not.
    assert by_name["Magdalena Woźniak"]["blocking_violations"] == []

    impact = await client.get(
        "/api/v1/swaps/impact", params={**late_shift_alone, "replacement_member_id": marek}
    )
    assert impact.status_code == 200, impact.text
    taker = impact.json()["replacement"]
    assert taker["after"]["late_shift"]["actual"] == taker["before"]["late_shift"]["actual"] + 1
    assert taker["after"]["primary"]["actual"] == taker["before"]["primary"]["actual"]

    created = await client.post(
        "/api/v1/swaps",
        json={
            **late_shift_alone,
            "schedule_id": str(schedule.id),
            "replacement_member_id": marek,
            "acknowledge_rule_violations": True,
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["slots"] == [{"service_date": "2026-09-22", "role": "late_shift"}]

    swap_id = created.json()["id"]
    acknowledged = {"acknowledge_rule_violations": True}
    await login(client, "marek")
    accepted = await client.post(f"/api/v1/swaps/{swap_id}/accept", json=acknowledged)
    assert accepted.status_code == 200, accepted.text
    await login(client, "koord")
    approved = await client.post(f"/api/v1/swaps/{swap_id}/approve", json=acknowledged)
    assert approved.status_code == 200, approved.text
    published = (await client.get("/api/v1/schedules/published")).json()
    assert {
        a["role"]: a["assignee_name"]
        for a in published["assignments"]
        if a["service_date"] == "2026-09-22"
    } == {"primary": "Ola Zalewska", "secondary": "Magdalena Woźniak", "late_shift": "Marek Nowak"}


@pytest.mark.anyio
@pytest.mark.usefixtures("frozen_clock")  # the swapped duty must still lie ahead
async def test_replacement_without_late_shift_eligibility_takes_only_the_anchor(
    client: AsyncClient, db: AsyncSession
) -> None:
    members = await _team(db)
    schedule = await _roster(db)
    # Marek can hold secondary but not 11-19.
    await db.execute(
        delete(Eligibility).where(
            Eligibility.member_id == members["Marek Nowak"].id,
            Eligibility.role == AssignmentRole.late_shift,
        )
    )
    await db.commit()
    await login(client, "magda")

    created = await client.post(
        "/api/v1/swaps",
        json={
            "schedule_id": str(schedule.id),
            "service_date": "2026-09-22",
            "role": "secondary",
            "replacement_member_id": str(members["Marek Nowak"].id),
        },
    )
    assert created.status_code == 201, created.text
    body = created.json()
    # Only the anchor role moves; 11-19 stays with Magdalena.
    assert {(s["service_date"], s["role"]) for s in body["slots"]} == {("2026-09-22", "secondary")}
    # The anchor split is surfaced as a warning, not a block.
    assert "late_shift_anchor" in {w["rule"] for w in body["warnings"]}


@pytest.mark.anyio
@pytest.mark.usefixtures("frozen_clock")  # the swapped duty must still lie ahead
async def test_day_off_block_split_warns_but_does_not_block(
    client: AsyncClient, db: AsyncSession
) -> None:
    members = await _team(db)
    # Magdalena holds the weekend block (26-27) and nothing adjacent, so the
    # only rule the split touches is `day_off_block`.
    schedule = await create_published_schedule(
        db,
        starts_on=START,
        days=7,
        primary=["Ola Zalewska"],
        secondary=[
            "Julia Kowal",
            "Julia Kowal",
            "Julia Kowal",
            "Julia Kowal",
            "Julia Kowal",
            "Magdalena Woźniak",
            "Magdalena Woźniak",
        ],
        late_shift=["Julia Kowal"],
    )
    await login(client, "magda")

    created = await client.post(
        "/api/v1/swaps",
        json={
            "schedule_id": str(schedule.id),
            "service_date": "2026-09-26",
            "role": "secondary",
            "replacement_member_id": str(members["Marek Nowak"].id),
        },
    )
    assert created.status_code == 201, created.text
    assert {w["rule"] for w in created.json()["warnings"]} == {"day_off_block"}


@pytest.mark.anyio
async def test_options_keep_a_rule_breaking_candidate_and_say_what_it_breaks(
    client: AsyncClient, db: AsyncSession, frozen_clock: FrozenClock
) -> None:
    # The frozen clock keeps the swapped duty ahead; it moves on between the
    # two publications so the later one is the one in force.
    await _team(db)
    await _roster(db)
    frozen_clock.advance(timedelta(minutes=1))
    # Julia already serves secondary on 21, 22, 24 elsewhere, so taking 25 too
    # is a four-in-seven break - she stays on the list, with the rule a request
    # to her would have to acknowledge.
    await create_published_schedule(
        db,
        starts_on=START,
        days=4,
        primary=["Ola Zalewska"],
        secondary=["Julia Kowal", "Julia Kowal", "Ola Zalewska", "Julia Kowal"],
        late_shift=["Julia Kowal", "Julia Kowal", "Ola Zalewska", "Julia Kowal"],
        name="Wcześniejszy tydzień Julii",
    )
    await login(client, "magda")
    options = (
        await client.get(
            "/api/v1/swaps/options",
            params={"service_date": "2026-09-25", "role": "secondary"},
        )
    ).json()
    julia = next(o for o in options if o["display_name"] == "Julia Kowal")
    assert "three_in_seven" in {v["rule"] for v in julia["rule_violations"]}
    assert julia["blocking_violations"] == []
    assert julia["next_step"] is None
    marek = next(o for o in options if o["display_name"] == "Marek Nowak")
    assert marek["rule_violations"] == []
    assert marek["blocking_violations"] == []


@pytest.mark.anyio
async def test_options_block_a_candidate_the_coupled_move_double_books(
    client: AsyncClient, db: AsyncSession, frozen_clock
) -> None:
    """The clicked-slot filter only checks the opposite of the clicked role. A
    coupled swap of 11-19 also moves the anchor role, so a candidate already on
    the opposite on-call role that day has to be blocked here too, or
    `create_swap` would refuse an option this endpoint offered."""
    await _team(db)
    # Magdalena holds secondary + 11-19; Marek holds primary the same day.
    schedule = await create_published_schedule(
        db,
        starts_on=START,
        days=1,
        primary=["Marek Nowak"],
        secondary=["Magdalena Woźniak"],
        late_shift=["Magdalena Woźniak"],
    )
    assert schedule.starts_on == START
    await login(client, "magda")
    options = (
        await client.get(
            "/api/v1/swaps/options",
            params={"service_date": START.isoformat(), "role": "late_shift"},
        )
    ).json()
    marek = next(o for o in options if o["display_name"] == "Marek Nowak")
    assert "double_oncall" in {v["rule"] for v in marek["blocking_violations"]}
    # And POST agrees.
    posted = await client.post(
        "/api/v1/swaps",
        json={
            "schedule_id": str(schedule.id),
            "service_date": START.isoformat(),
            "role": "late_shift",
            "replacement_member_id": marek["member_id"],
        },
    )
    assert posted.status_code == 422


@pytest.mark.anyio
@pytest.mark.usefixtures("frozen_clock")  # the swapped duty must still lie ahead
async def test_backfilled_slot_lets_a_legacy_request_still_approve(
    client: AsyncClient, db: AsyncSession
) -> None:
    """A request with no slot rows (pre-0027) falls back to its headline slot."""
    members = await _team(db)
    schedule = await create_published_schedule(
        db,
        starts_on=date(2026, 9, 23),
        days=1,
        primary=["Ola Zalewska"],
        secondary=["Julia Kowal"],
        late_shift=["Julia Kowal"],
    )
    request = SwapRequest(
        schedule_id=schedule.id,
        service_date=date(2026, 9, 23),
        role=AssignmentRole.primary,
        requester_member_id=members["Ola Zalewska"].id,
        replacement_member_id=members["Marek Nowak"].id,
        status=SwapStatus.pending_coordinator,
        schedule_version=schedule.version,
    )
    db.add(request)
    await db.commit()
    assert (await db.scalar(select(SwapRequestSlot))) is None

    await login(client, "koord")
    approved = await client.post(f"/api/v1/swaps/{request.id}/approve")
    assert approved.status_code == 200, approved.text
