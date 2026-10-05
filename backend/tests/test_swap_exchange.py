"""A request names a duty of the replacement that the requester takes in
return: an exchange, checked as one move and decided by one acceptance and one
approval.

The roster is the one the request for this came from. Anna hands Tuesday the
6th of October - SECONDARY and the 11-19 that travels with it - to Bartosz,
who already serves the 7th, the 10th and the 11th. Handing the duty over alone
is a fourth duty in his week; taking his Wednesday in return only moves one,
and breaks nothing.
"""

from datetime import date, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.domain.vocabulary import (
    AssignmentRole,
    AvailabilityKind,
    ScheduleStatus,
    SwapSlotDirection,
    SwapStatus,
    UserRole,
)
from oncall.infrastructure.sqlalchemy.audit_model import AuditEvent
from oncall.infrastructure.sqlalchemy.availability_model import Availability
from oncall.infrastructure.sqlalchemy.notification_models import NotificationOutbox
from oncall.infrastructure.sqlalchemy.scheduling import publication_ports, schedule_query_ports
from oncall.infrastructure.sqlalchemy.scheduling_models import Assignment, Schedule
from oncall.infrastructure.sqlalchemy.swap_models import SwapRequest, SwapRequestSlot
from oncall.infrastructure.sqlalchemy.team_models import Eligibility
from oncall.presentation.scheduling import ScheduleTransitionRequest
from oncall.routes.scheduling import publication_preview, publish_schedule
from oncall.workdays import is_working_day
from tests.conftest import create_member, create_published_schedule, create_user, login

pytestmark = pytest.mark.usefixtures("frozen_clock")  # mid-September: October lies ahead

START = date(2026, 10, 5)  # Monday
PEOPLE = {
    "A": ("ania", "Anna Kowalska"),
    "B": ("bartek", "Bartosz Nowak"),
    "C": ("celina", "Celina Wiśniewska"),
    "D": ("darek", "Dariusz Zieliński"),
    "E": ("ewa", "Ewa Lewandowska"),
    "F": ("filip", "Filip Kamiński"),
}
#: Two weeks from Monday the 5th, one letter per day.
PRIMARY = "DEDFAFF" + "DEDDFEE"
SECONDARY = "CABCEBB" + "CACCBAA"

REASON = "Urlop od 6 października, nikt inny nie może"
GIVEN = {"service_date": "2026-10-06", "role": "secondary"}
WEDNESDAY = {"service_date": "2026-10-07", "role": "secondary"}
GIVEN_LINES = "- wt 06-10-2026 · SECONDARY\n- wt 06-10-2026 · 11–19\n"
RETURN_LINES = "- śr 07-10-2026 · SECONDARY (w zamian)\n- śr 07-10-2026 · 11–19 (w zamian)\n"
IN_RETURN = " · w zamian Anna Kowalska przejmuje [2026-10-07 · SECONDARY, 2026-10-07 · 11–19]"


def _names(letters: str) -> list[str]:
    return [PEOPLE[letter][1] for letter in letters]


async def _team(db: AsyncSession, *, publications: int = 1) -> dict:
    """The six people, a coordinator, and the fortnight as one publication or
    as two, a week each."""
    team: dict = {}
    for username, name in PEOPLE.values():
        user = await create_user(db, username, email=f"{username}@example.com", display_name=name)
        team[name] = await create_member(db, user, display_name=name)
    team["koord"] = await create_user(
        db,
        "koord",
        role=UserRole.coordinator,
        email="koord@example.com",
        display_name="Jan Koordynator",
    )
    days = 14 // publications
    team["schedules"] = [
        await create_published_schedule(
            db,
            starts_on=START + timedelta(days=first),
            days=days,
            primary=_names(PRIMARY[first : first + days]),
            secondary=_names(SECONDARY[first : first + days]),
            name=f"Grafik od {START + timedelta(days=first)}",
        )
        for first in range(0, 14, days)
    ]
    return team


@pytest.fixture
async def team(db: AsyncSession) -> dict:
    return await _team(db)


@pytest.fixture
async def two_weeks(db: AsyncSession) -> dict:
    return await _team(db, publications=2)


def _exchange(team: dict, **changes) -> dict:
    return {
        "schedule_id": str(team["schedules"][0].id),
        **GIVEN,
        "replacement_member_id": str(team["Bartosz Nowak"].id),
        "in_return": WEDNESDAY,
        **changes,
    }


async def _ask(client: AsyncClient, team: dict) -> str:
    await login(client, "ania")
    created = await client.post("/api/v1/swaps", json=_exchange(team))
    assert created.status_code == 201, created.text
    return created.json()["id"]


async def _decide(client: AsyncClient, username: str, swap_id: str, step: str):
    await login(client, username)
    return await client.post(f"/api/v1/swaps/{swap_id}/{step}")


async def _holders(db: AsyncSession, day: date) -> dict[AssignmentRole, str]:
    rows = await db.scalars(
        select(Assignment)
        .where(Assignment.service_date == day)
        .execution_options(populate_existing=True)
    )
    return {row.role: row.assignee_name for row in rows}


async def _mails(db: AsyncSession, event: str) -> list[NotificationOutbox]:
    rows = (await db.scalars(select(NotificationOutbox))).all()
    return [row for row in rows if row.context["event"] == event]


async def _audit(db: AsyncSession, action: str) -> AuditEvent:
    event = await db.scalar(select(AuditEvent).where(AuditEvent.action == action))
    assert event is not None, action
    return event


async def _return_options(client: AsyncClient, team: dict, replacement: str = "Bartosz Nowak"):
    response = await client.get(
        "/api/v1/swaps/return-options",
        params={**GIVEN, "replacement_member_id": str(team[replacement].id)},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _slots(*slots: tuple[str, str]) -> list[dict]:
    return [{"service_date": day, "role": role} for day, role in slots]


async def test_the_duties_offered_in_return_say_what_the_whole_exchange_breaks(
    client, team
) -> None:
    """Bartosz's coming duties, the clean exchange first. Each is judged with
    the duty given away as one move: his Wednesday undoes the fourth duty that
    taking Tuesday alone would give him."""
    await login(client, "ania")

    options = await _return_options(client, team)

    assert [
        (
            option["service_date"],
            option["role"],
            [item["rule"] for item in option["blocking_violations"]],
            [(item["rule"], item["member_name"]) for item in option["rule_violations"]],
            sorted({item["rule"] for item in option["warning_violations"]}),
        )
        for option in options
    ] == [
        ("2026-10-07", "secondary", [], [], []),
        ("2026-10-10", "secondary", [], [], ["day_off_block"]),
        ("2026-10-11", "secondary", [], [], ["day_off_block"]),
        (
            "2026-10-16",
            "secondary",
            [],
            [("three_in_seven", "Anna Kowalska"), ("three_in_seven", "Bartosz Nowak")],
            [],
        ),
    ]
    # A working day's pair is offered once, under its on-call role; a weekend
    # day stands alone.
    assert options[0]["slots"] == _slots(("2026-10-07", "secondary"), ("2026-10-07", "late_shift"))
    assert options[1]["slots"] == _slots(("2026-10-10", "secondary"))


async def test_nothing_is_offered_in_return_for_a_duty_already_past(client, team) -> None:
    await login(client, "ania")

    response = await client.get(
        "/api/v1/swaps/return-options",
        params={
            "service_date": "2026-09-01",
            "role": "secondary",
            "replacement_member_id": str(team["Bartosz Nowak"].id),
        },
    )

    assert (response.status_code, response.json()) == (200, [])


async def test_return_options_need_a_replacement_who_exists(client, team) -> None:
    await login(client, "ania")

    response = await client.get(
        "/api/v1/swaps/return-options",
        params={**GIVEN, "replacement_member_id": str(team["koord"].id)},
    )

    assert response.status_code == 404, response.text
    assert response.json()["detail"] == "Nie znaleziono zastępcy"


async def test_an_exchange_needs_no_acknowledgement_where_the_hand_over_alone_does(
    client, db, team
) -> None:
    await login(client, "ania")
    one_way = await client.post("/api/v1/swaps", json=_exchange(team, in_return=None))
    assert one_way.status_code == 409, one_way.text
    assert one_way.json()["detail"]["reason"] == "RULE_VIOLATIONS"

    created = await client.post("/api/v1/swaps", json=_exchange(team))

    assert created.status_code == 201, created.text
    body = created.json()
    assert body["status"] == "pending_replacement"
    assert (body["rule_violations"], body["warnings"]) == ([], [])
    assert body["slots"] == _slots(("2026-10-06", "late_shift"), ("2026-10-06", "secondary"))
    # The duty asked for first, then the 11-19 that travels with it.
    assert body["return_slots"] == _slots(("2026-10-07", "secondary"), ("2026-10-07", "late_shift"))
    rows = (await db.scalars(select(SwapRequestSlot))).all()
    assert {(row.service_date.day, row.role, row.direction) for row in rows} == {
        (6, AssignmentRole.secondary, SwapSlotDirection.given),
        (6, AssignmentRole.late_shift, SwapSlotDirection.given),
        (7, AssignmentRole.secondary, SwapSlotDirection.returned),
        (7, AssignmentRole.late_shift, SwapSlotDirection.returned),
    }
    assert {row.schedule_id for row in rows} == {team["schedules"][0].id}
    assert (await _audit(db, "swap.created")).summary == (
        "Prośba o zamianę [2026-10-06 · SECONDARY, 2026-10-06 · 11–19]: "
        "Anna Kowalska → Bartosz Nowak" + IN_RETURN
    )
    (asked,) = await _mails(db, "swap_requested")
    assert asked.recipient == "bartek@example.com"
    assert asked.subject == (
        "Prośba o zamianę: wt 06-10-2026 · SECONDARY ⇄ śr 07-10-2026 · SECONDARY"
    )
    assert f"Zamiana obejmuje:\n{GIVEN_LINES}{RETURN_LINES}\n" in asked.body
    assert "w zamian" in asked.html_body
    (listed,) = (await client.get("/api/v1/swaps")).json()
    assert listed["return_slots"] == body["return_slots"]


async def test_one_acceptance_and_one_approval_write_both_directions(client, db, team) -> None:
    swap_id = await _ask(client, team)
    schedule = team["schedules"][0]

    accepted = await _decide(client, "bartek", swap_id, "accept")
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["status"] == "pending_coordinator"
    assert (await _holders(db, date(2026, 10, 7)))[AssignmentRole.secondary] == "Bartosz Nowak"
    approved = await _decide(client, "koord", swap_id, "approve")

    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "approved"
    assert await _holders(db, date(2026, 10, 6)) == {
        AssignmentRole.primary: "Ewa Lewandowska",
        AssignmentRole.secondary: "Bartosz Nowak",
        AssignmentRole.late_shift: "Bartosz Nowak",
    }
    assert await _holders(db, date(2026, 10, 7)) == {
        AssignmentRole.primary: "Dariusz Zieliński",
        AssignmentRole.secondary: "Anna Kowalska",
        AssignmentRole.late_shift: "Anna Kowalska",
    }
    # One decision, one step of the schedule's version.
    await db.refresh(schedule)
    assert schedule.version == 2
    for action, start in (
        ("swap.accepted", "Zastępca zaakceptował zamianę 2026-10-06 · SECONDARY: "),
        ("swap.approved", "Zatwierdzono zamianę 2026-10-06 · SECONDARY: "),
    ):
        summary = (await _audit(db, action)).summary
        assert summary.startswith(start) and summary.endswith(IN_RETURN), summary
    decided = await _mails(db, "swap_approved")
    assert {mail.recipient for mail in decided} == {"ania@example.com", "bartek@example.com"}
    for mail in decided:
        assert f"Zamiana obejmuje:\n{GIVEN_LINES}{RETURN_LINES}\n" in mail.body
        assert "Pamiętaj o przełączeniu numeru on-call: wt 06-10-2026 i śr 07-10-2026." in mail.body
    (to_decide,) = await _mails(db, "swap_pending_coordinator")
    assert to_decide.subject.endswith("wt 06-10-2026 · SECONDARY ⇄ śr 07-10-2026 · SECONDARY")
    assert to_decide.body.count("Zamiana obejmuje:") == 1

    # The calendar marks every slot of the swap, in both directions.
    calendar = await client.get(
        "/api/v1/calendar", params={"starts_on": "2026-10-05", "ends_on": "2026-10-11"}
    )
    assert {
        (item["service_date"], item["role"], item["assignee_name"])
        for item in calendar.json()["assignments"]
        if item["change_kind"] == "swap"
    } == {
        ("2026-10-06", "secondary", "Bartosz Nowak"),
        ("2026-10-06", "late_shift", "Bartosz Nowak"),
        ("2026-10-07", "secondary", "Anna Kowalska"),
        ("2026-10-07", "late_shift", "Anna Kowalska"),
    }


async def test_with_approval_off_one_acceptance_writes_both_directions(client, db, team) -> None:
    await login(client, "koord")
    saved = await client.put(
        "/api/v1/scheduling/policy",
        json={"rotation_mode": "hybrid", "coordinator_swap_approval_required": False},
    )
    assert saved.status_code == 200, saved.text
    swap_id = await _ask(client, team)

    accepted = await _decide(client, "bartek", swap_id, "accept")

    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["status"] == "approved"
    assert (await _holders(db, date(2026, 10, 6)))[AssignmentRole.secondary] == "Bartosz Nowak"
    assert (await _holders(db, date(2026, 10, 7)))[AssignmentRole.secondary] == "Anna Kowalska"
    recorded = await _audit(db, "swap.approved")
    assert recorded.details["by_coordinator"] is False
    assert recorded.summary.endswith(IN_RETURN)
    (note,) = await _mails(db, "swap_recorded_fyi")
    assert note.recipient == "koord@example.com"
    assert f"Zamiana obejmuje:\n{GIVEN_LINES}{RETURN_LINES}\n" in note.body
    for mail in await _mails(db, "swap_recorded"):
        assert "numeru on-call: wt 06-10-2026 i śr 07-10-2026." in mail.body


async def _impact(client: AsyncClient, team: dict, **params) -> dict:
    response = await client.get(
        "/api/v1/swaps/impact",
        params={**GIVEN, "replacement_member_id": str(team["Bartosz Nowak"].id), **params},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _moved(side: dict, lens: str) -> float:
    return side["after"][lens]["actual"] - side["before"][lens]["actual"]


async def test_the_points_preview_follows_every_slot_the_swap_moves(client, team) -> None:
    """Alone, Tuesday costs Bartosz a SECONDARY duty and its 11-19. With his
    Wednesday taken in return both balances stay where they were."""
    await login(client, "ania")

    one_way = await _impact(client, team)
    exchange = await _impact(client, team, return_date="2026-10-07", return_role="secondary")

    assert (one_way["return_date"], one_way["return_points"]) == (None, None)
    for lens in ("secondary", "late_shift"):
        assert _moved(one_way["requester"], lens) == -1, lens
        assert _moved(one_way["replacement"], lens) == 1, lens
        assert _moved(exchange["requester"], lens) == 0, lens
        assert _moved(exchange["replacement"], lens) == 0, lens
    assert (exchange["points"], exchange["return_date"], exchange["return_points"]) == (
        1,
        "2026-10-07",
        1,
    )
    # The window ends on the last day that moves, or the balance would miss it.
    assert (one_way["window_end"], exchange["window_end"]) == ("2026-10-06", "2026-10-07")


async def test_the_points_preview_of_a_correction_couples_as_a_correction_does(
    client, team
) -> None:
    """A correction of 11-19 moves that slot alone; a swap asked for through
    11-19 takes the SECONDARY with it."""
    await login(client, "koord")

    swap = await _impact(client, team, role="late_shift")
    correction = await _impact(client, team, role="late_shift", correction="true")

    assert (_moved(swap["requester"], "secondary"), _moved(swap["requester"], "late_shift")) == (
        -1,
        -1,
    )
    assert (
        _moved(correction["requester"], "secondary"),
        _moved(correction["requester"], "late_shift"),
    ) == (0, -1)


@pytest.mark.parametrize("half", [{"return_date": "2026-10-07"}, {"return_role": "secondary"}])
async def test_the_duty_in_return_is_previewed_by_its_day_and_role_together(
    client, team, half
) -> None:
    await login(client, "ania")

    response = await client.get(
        "/api/v1/swaps/impact",
        params={**GIVEN, "replacement_member_id": str(team["Bartosz Nowak"].id), **half},
    )

    assert response.status_code == 422, response.text
    assert response.json()["detail"] == "Podaj dzień i rolę dyżuru branego w zamian"


@pytest.mark.parametrize(
    ("in_return", "status", "detail"),
    [
        (
            {"service_date": "2026-10-06", "role": "primary"},
            422,
            "W zamian można wziąć dyżur tylko z innego dnia",
        ),
        (
            {"service_date": "2026-10-08", "role": "secondary"},
            409,
            "Dyżur brany w zamian nie należy do zastępcy",
        ),
        (
            {"service_date": "2026-11-20", "role": "secondary"},
            404,
            "Nie znaleziono opublikowanego grafiku",
        ),
        (
            {"service_date": "2026-09-01", "role": "secondary"},
            422,
            "Nie można zamienić dyżuru, który już się odbył",
        ),
    ],
    ids=["same day", "not the replacement's", "not published", "already past"],
)
async def test_a_duty_that_cannot_come_back_is_refused(
    client, team, in_return, status, detail
) -> None:
    await login(client, "ania")

    refused = await client.post("/api/v1/swaps", json=_exchange(team, in_return=in_return))

    assert (refused.status_code, refused.json()["detail"]) == (status, detail), refused.text
    assert (await client.get("/api/v1/swaps")).json() == []


async def test_the_requester_has_to_be_eligible_for_the_duty_taken_in_return(
    client, db, team
) -> None:
    anna = team["Anna Kowalska"]
    period = await db.scalar(
        select(Eligibility).where(
            Eligibility.member_id == anna.id, Eligibility.role == AssignmentRole.secondary
        )
    )
    period.ends_on = date(2026, 10, 6)
    await db.commit()
    await login(client, "ania")

    refused = await client.post("/api/v1/swaps", json=_exchange(team))

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == "Autor prośby nie ma eligibility do dyżuru branego w zamian"
    # What cannot be taken is not offered either.
    assert "secondary" not in {option["role"] for option in await _return_options(client, team)}


async def test_the_requester_has_to_be_available_on_the_day_taken_in_return(
    client, db, team
) -> None:
    db.add(
        Availability(
            member_id=team["Anna Kowalska"].id,
            kind=AvailabilityKind.unavailable,
            starts_on=date(2026, 10, 7),
            ends_on=date(2026, 10, 7),
        )
    )
    await db.commit()
    await login(client, "ania")

    refused = await client.post("/api/v1/swaps", json=_exchange(team))

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == (
        "Autor prośby jest niedostępny w dniu dyżuru branego w zamian"
    )
    offered = {option["service_date"] for option in await _return_options(client, team)}
    assert "2026-10-07" not in offered and "2026-10-10" in offered


async def test_a_duty_with_a_swap_in_progress_cannot_be_taken_in_return(client, db, team) -> None:
    """Bartosz is already giving his Wednesday to Celina: no second request
    may move the same slot, whichever direction it names it in."""
    schedule = team["schedules"][0]
    db.add(
        SwapRequest(
            schedule_id=schedule.id,
            service_date=date(2026, 10, 7),
            role=AssignmentRole.secondary,
            requester_member_id=team["Bartosz Nowak"].id,
            replacement_member_id=team["Celina Wiśniewska"].id,
            status=SwapStatus.pending_replacement,
            schedule_version=1,
            slots=[
                SwapRequestSlot(
                    service_date=date(2026, 10, 7),
                    role=AssignmentRole.secondary,
                    schedule_id=schedule.id,
                )
            ],
        )
    )
    await db.commit()
    await login(client, "ania")

    refused = await client.post("/api/v1/swaps", json=_exchange(team))

    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == "Dla tego slotu istnieje aktywna zamiana"


async def test_a_slot_in_return_is_reserved_like_the_slot_given(client, team) -> None:
    await _ask(client, team)

    await login(client, "bartek")
    second = await client.post(
        "/api/v1/swaps",
        json={
            "schedule_id": str(team["schedules"][0].id),
            **WEDNESDAY,
            "replacement_member_id": str(team["Celina Wiśniewska"].id),
        },
    )

    assert second.status_code == 409, second.text
    assert second.json()["detail"] == "Dla tego slotu istnieje aktywna zamiana"


async def test_the_exchange_may_not_put_the_requester_on_call_twice_in_a_day(client, team) -> None:
    """Dariusz is PRIMARY on the 7th; taking Bartosz's SECONDARY of that day
    in return would give him both on-call roles. Both directions are checked
    on the roster as it would be after the exchange."""
    await login(client, "darek")
    request = {
        "schedule_id": str(team["schedules"][0].id),
        "service_date": "2026-10-05",
        "role": "primary",
        "replacement_member_id": str(team["Bartosz Nowak"].id),
        "in_return": WEDNESDAY,
    }

    refused = await client.post("/api/v1/swaps", json=request)

    assert refused.status_code == 409, refused.text
    detail = refused.json()["detail"]
    assert detail["message"] == "Operacja łamie reguły twarde grafiku"
    assert [(item["rule"], item["member_name"], item["days"]) for item in detail["violations"]] == [
        ("same_day_oncall", "Dariusz Zieliński", ["2026-10-07"])
    ]
    options = await client.get(
        "/api/v1/swaps/return-options",
        params={
            "service_date": "2026-10-05",
            "role": "primary",
            "replacement_member_id": str(team["Bartosz Nowak"].id),
        },
    )
    wednesday = next(o for o in options.json() if o["service_date"] == "2026-10-07")
    assert [item["rule"] for item in wednesday["blocking_violations"]] == ["same_day_oncall"]


async def test_the_requester_who_cannot_hold_11_19_leaves_it_with_the_replacement(
    client, db, team
) -> None:
    """Coupling is mirrored: Bartosz's SECONDARY and 11-19 travel together,
    but Anna may no longer hold 11-19 after the 6th, so the shift stays with
    him - the tolerated anchor split, a warning and not a broken rule."""
    period = await db.scalar(
        select(Eligibility).where(
            Eligibility.member_id == team["Anna Kowalska"].id,
            Eligibility.role == AssignmentRole.late_shift,
        )
    )
    period.ends_on = date(2026, 10, 6)
    await db.commit()
    await login(client, "ania")

    wednesday = (await _return_options(client, team))[0]
    assert wednesday["slots"] == _slots(("2026-10-07", "secondary"))
    assert wednesday["rule_violations"] == []
    assert {item["rule"] for item in wednesday["warning_violations"]} == {"late_shift_anchor"}
    created = await client.post("/api/v1/swaps", json=_exchange(team))

    assert created.status_code == 201, created.text
    assert created.json()["return_slots"] == _slots(("2026-10-07", "secondary"))
    assert {item["rule"] for item in created.json()["warnings"]} == {"late_shift_anchor"}
    swap_id = created.json()["id"]
    assert (await _decide(client, "bartek", swap_id, "accept")).status_code == 200
    approved = await _decide(client, "koord", swap_id, "approve")
    assert approved.status_code == 200, approved.text
    assert await _holders(db, date(2026, 10, 7)) == {
        AssignmentRole.primary: "Dariusz Zieliński",
        AssignmentRole.secondary: "Anna Kowalska",
        AssignmentRole.late_shift: "Bartosz Nowak",
    }


@pytest.mark.parametrize("day", [6, 7], ids=["the slot given", "the slot taken in return"])
async def test_a_slot_of_either_direction_that_changed_hands_cancels_the_exchange(
    client, db, team, day
) -> None:
    swap_id = await _ask(client, team)
    assert (await _decide(client, "bartek", swap_id, "accept")).status_code == 200
    slot = await db.scalar(
        select(Assignment).where(
            Assignment.service_date == date(2026, 10, day),
            Assignment.role == AssignmentRole.secondary,
        )
    )
    slot.assignee_name = "Celina Wiśniewska"
    await db.commit()

    refused = await _decide(client, "koord", swap_id, "approve")

    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"] == (
        "Slot zmienił właściciela; prośba została automatycznie anulowana"
    )
    (listed,) = (await client.get("/api/v1/swaps")).json()
    assert listed["status"] == "cancelled"
    assert listed["decision_note"] == "Slot zmienił właściciela przed zatwierdzeniem"
    # Neither half was written: the other day is as it was.
    other = date(2026, 10, 13 - day)
    assert (await _holders(db, other))[AssignmentRole.secondary] == (
        "Anna Kowalska" if day == 7 else "Bartosz Nowak"
    )


async def test_an_exchange_whose_earlier_day_has_passed_cannot_be_decided(
    client, team, frozen_clock
) -> None:
    """The exchange is one decision: once the 6th is gone, the 7th cannot be
    traded on its own."""
    swap_id = await _ask(client, team)
    frozen_clock.advance(date(2026, 10, 7) - frozen_clock.business_today())

    refused = await _decide(client, "bartek", swap_id, "accept")

    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == "Nie można zamienić dyżuru, który już się odbył"


# --- an exchange across two publications -----------------------------------
#
# Filip gives Saturday the 10th (PRIMARY, the first week's publication) to
# Dariusz and takes his Monday the 12th (the second week's) in return. Alone,
# the Saturday is a fourth duty in Dariusz's week.

SATURDAY = {"service_date": "2026-10-10", "role": "primary"}
MONDAY = {"service_date": "2026-10-12", "role": "primary"}


async def _ask_across(client: AsyncClient, team: dict, **changes) -> dict:
    await login(client, "filip")
    created = await client.post(
        "/api/v1/swaps",
        json={
            "schedule_id": str(team["schedules"][0].id),
            **SATURDAY,
            "replacement_member_id": str(team["Dariusz Zieliński"].id),
            "in_return": MONDAY,
            **changes,
        },
    )
    return created


async def test_an_exchange_crosses_a_publication_boundary(client, db, two_weeks) -> None:
    first, second = two_weeks["schedules"]
    one_way = await _ask_across(client, two_weeks, in_return=None)
    assert one_way.status_code == 409, one_way.text
    assert one_way.json()["detail"]["reason"] == "RULE_VIOLATIONS"

    created = await _ask_across(client, two_weeks)

    assert created.status_code == 201, created.text
    body = created.json()
    assert body["schedule_id"] == str(first.id)
    assert {item["rule"] for item in body["warnings"]} == {"day_off_block"}
    rows = (await db.scalars(select(SwapRequestSlot))).all()
    assert {(row.direction, row.service_date.day, row.schedule_id) for row in rows} == {
        (SwapSlotDirection.given, 10, first.id),
        (SwapSlotDirection.returned, 12, second.id),
    }
    assert (await _decide(client, "darek", body["id"], "accept")).status_code == 200
    approved = await _decide(client, "koord", body["id"], "approve")

    assert approved.status_code == 200, approved.text
    assert (await _holders(db, date(2026, 10, 10)))[AssignmentRole.primary] == "Dariusz Zieliński"
    assert (await _holders(db, date(2026, 10, 12)))[AssignmentRole.primary] == "Filip Kamiński"
    for schedule in (first, second):
        await db.refresh(schedule)
        assert schedule.version == 2


async def _propose(db: AsyncSession, team: dict, week: int) -> Schedule:
    """A proposal for one of the two weeks that repeats the original roster."""
    first = week * 7
    proposal = Schedule(
        name=f"Szkic {week}",
        starts_on=START + timedelta(days=first),
        ends_on=START + timedelta(days=first + 6),
        status=ScheduleStatus.proposed,
        solver_status="OPTIMAL",
    )
    for offset in range(first, first + 7):
        day = START + timedelta(days=offset)
        roles = [(AssignmentRole.primary, PRIMARY), (AssignmentRole.secondary, SECONDARY)]
        if is_working_day(day, set()):
            roles.append((AssignmentRole.late_shift, SECONDARY))
        for role, letters in roles:
            name = PEOPLE[letters[offset]][1]
            proposal.assignments.append(
                Assignment(service_date=day, role=role, assignee_name=name, member_id=team[name].id)
            )
    db.add(proposal)
    await db.commit()
    return proposal


async def _publish(db: AsyncSession, team: dict, proposal: Schedule) -> None:
    await publish_schedule(
        proposal.id,
        ScheduleTransitionRequest(
            expected_version=proposal.version,
            acknowledge_lost_changes=True,
            acknowledge_gap=True,
            acknowledge_rest_violations=True,
        ),
        team["koord"],
        publication_ports(db, team["koord"]),
        schedule_query_ports(db),
        None,
    )


@pytest.mark.parametrize("week", [0, 1], ids=["the week given from", "the week taken from"])
async def test_republishing_either_schedule_cancels_a_pending_exchange(
    client, db, two_weeks, week
) -> None:
    """An exchange is one decision, so a publication that replaces a slot of
    either direction takes the whole request, and tells both people."""
    swap_id = (await _ask_across(client, two_weeks)).json()["id"]
    proposal = await _propose(db, two_weeks, week)

    preview = await publication_preview(proposal.id, two_weeks["koord"], publication_ports(db))
    assert [str(item.id) for item in preview.pending_swaps] == [swap_id]
    await _publish(db, two_weeks, proposal)

    await login(client, "filip")
    (listed,) = (await client.get("/api/v1/swaps")).json()
    assert (listed["status"], listed["decision_note"]) == (
        "cancelled",
        "Grafik zastąpiony nową publikacją",
    )
    told = await _mails(db, "swap_cancelled_by_publication")
    assert {mail.recipient for mail in told} == {"filip@example.com", "darek@example.com"}
    for mail in told:
        assert (
            "Zamiana obejmuje:\n- sob 10-10-2026 · PRIMARY\n- pon 12-10-2026 · PRIMARY (w zamian)\n"
            in mail.body
        )


async def test_a_republish_knows_each_direction_of_an_exchange_by_its_own_holder(
    client, db, two_weeks
) -> None:
    """The Monday was Dariusz's before the exchange, although he is the
    request's replacement: a new publication that hands it back to him meets
    an approved swap whose original holder is Dariusz, not the requester."""
    swap_id = (await _ask_across(client, two_weeks)).json()["id"]
    assert (await _decide(client, "darek", swap_id, "accept")).status_code == 200
    assert (await _decide(client, "koord", swap_id, "approve")).status_code == 200
    proposal = await _propose(db, two_weeks, 1)

    preview = await publication_preview(proposal.id, two_weeks["koord"], publication_ports(db))

    assert [
        (
            item.service_date,
            item.role,
            item.source,
            item.previous_assignee_name,
            item.original_assignee_name,
        )
        for item in (*preview.carried_changes, *preview.lost_changes)
    ] == [
        (
            date(2026, 10, 12),
            AssignmentRole.primary,
            "approved_swap",
            "Filip Kamiński",
            "Dariusz Zieliński",
        )
    ]
