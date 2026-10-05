"""A member asks for a swap that breaks a rest rule, the way a coordinator's
correction may: knowingly, with a reason, acknowledged again by whoever lets
it into the schedule.

The roster is the one the request for this came from. Anna hands Tuesday the
6th of October - SECONDARY and the 11-19 that travels with it - to Bartosz,
who already serves the 7th, the 10th and the 11th: a fourth duty in his week.
Before, the request was refused outright and the screen greyed Bartosz out,
while a coordinator making the same move only had to tick a box.
"""

import uuid
from datetime import date

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.domain.vocabulary import AssignmentRole, SwapStatus, UserRole
from oncall.infrastructure.sqlalchemy.audit_model import AuditEvent
from oncall.infrastructure.sqlalchemy.notification_models import NotificationOutbox
from oncall.infrastructure.sqlalchemy.scheduling_models import Assignment
from oncall.infrastructure.sqlalchemy.swap_models import SwapRequest
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
DAYS = ["2026-10-06", "2026-10-07", "2026-10-10", "2026-10-11"]
BROKEN = {
    "rule": "three_in_seven",
    "message": "Więcej niż 3 dyżury on-call w okresie 7 dni.",
    "member_name": "Bartosz Nowak",
    "days": DAYS,
}
BROKEN_LINE = (
    "Bartosz Nowak: Więcej niż 3 dyżury on-call w okresie 7 dni. "
    "Dni: 06-10-2026, 07-10-2026, 10-10-2026, 11-10-2026."
)
SUFFIX = " · świadome naruszenie reguł: three_in_seven"
ACKNOWLEDGE = {"acknowledge_rule_violations": True}


@pytest.fixture
async def team(db: AsyncSession) -> dict:
    members = {}
    for username, name in PEOPLE.values():
        user = await create_user(db, username, email=f"{username}@example.com", display_name=name)
        members[name] = await create_member(db, user, display_name=name)
    await create_user(
        db,
        "koord",
        role=UserRole.coordinator,
        email="koord@example.com",
        display_name="Jan Koordynator",
    )
    members["schedule"] = await create_published_schedule(
        db,
        starts_on=START,
        days=14,
        primary=[PEOPLE[letter][1] for letter in PRIMARY],
        secondary=[PEOPLE[letter][1] for letter in SECONDARY],
    )
    return members


def _request(team: dict, **extra) -> dict:
    return {
        "schedule_id": str(team["schedule"].id),
        "service_date": "2026-10-06",
        "role": "secondary",
        "replacement_member_id": str(team["Bartosz Nowak"].id),
        **extra,
    }


async def _ask(client: AsyncClient, team: dict) -> str:
    await login(client, "ania")
    created = await client.post(
        "/api/v1/swaps", json=_request(team, note=REASON, acknowledge_rule_violations=True)
    )
    assert created.status_code == 201, created.text
    return created.json()["id"]


async def _holders_on_the_6th(db: AsyncSession) -> dict[AssignmentRole, str]:
    rows = await db.scalars(
        select(Assignment)
        .where(Assignment.service_date == date(2026, 10, 6))
        .execution_options(populate_existing=True)
    )
    return {row.role: row.assignee_name for row in rows}


async def _mails(db: AsyncSession, event: str) -> list[NotificationOutbox]:
    rows = (await db.scalars(select(NotificationOutbox))).all()
    return [row for row in rows if row.context["event"] == event]


async def _mail(db: AsyncSession, event: str) -> NotificationOutbox:
    (row,) = await _mails(db, event)
    return row


async def _audit(db: AsyncSession, action: str) -> AuditEvent:
    event = await db.scalar(select(AuditEvent).where(AuditEvent.action == action))
    assert event is not None, action
    return event


async def test_the_candidate_a_rest_rule_stands_against_can_be_asked(client, team) -> None:
    """Three of the four colleagues who could take the 6th break a rest rule
    by taking it. None of them is ruled out for that any more: each option
    says what a request to them has to acknowledge."""
    await login(client, "ania")

    options = (
        await client.get(
            "/api/v1/swaps/options", params={"service_date": "2026-10-06", "role": "secondary"}
        )
    ).json()

    by_name = {option["display_name"]: option for option in options}
    assert by_name["Bartosz Nowak"]["rule_violations"] == [BROKEN]
    assert {
        name: [item["rule"] for item in option["rule_violations"]]
        for name, option in by_name.items()
    } == {
        "Bartosz Nowak": ["three_in_seven"],
        "Celina Wiśniewska": ["rest_after_run"],
        "Dariusz Zieliński": [],
        "Filip Kamiński": ["three_in_seven"],
    }
    for option in options:
        assert option["blocking_violations"] == []
        assert option["next_step"] is None
        assert {(slot["service_date"], slot["role"]) for slot in option["slots"]} == {
            ("2026-10-06", "secondary"),
            ("2026-10-06", "late_shift"),
        }


async def test_the_request_is_refused_until_the_requester_acknowledges_and_says_why(
    client, db, team
) -> None:
    await login(client, "ania")

    unacknowledged = await client.post("/api/v1/swaps", json=_request(team, note=REASON))
    assert unacknowledged.status_code == 409, unacknowledged.text
    assert unacknowledged.json()["detail"] == {
        "message": "Zamiana złamie reguły twarde grafiku; potwierdź świadome naruszenie",
        "reason": "RULE_VIOLATIONS",
        "next_step": (
            "Potwierdź świadome naruszenie reguł twardych albo zrezygnuj z tej zamiany;"
            " potwierdzenie trafi do dziennika audytu."
        ),
        "violations": [BROKEN],
    }

    for note in (None, "pilne"):
        unexplained = await client.post(
            "/api/v1/swaps", json=_request(team, note=note, acknowledge_rule_violations=True)
        )
        assert unexplained.status_code == 422, unexplained.text
        assert unexplained.json()["detail"] == (
            "Zamiana łamiąca reguły twarde wymaga powodu (minimum 10 znaków)"
        )
    assert (await client.get("/api/v1/swaps")).json() == []

    created = await client.post(
        "/api/v1/swaps", json=_request(team, note=REASON, acknowledge_rule_violations=True)
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["status"] == "pending_replacement"
    assert body["note"] == REASON
    assert body["rule_violations"] == [BROKEN]

    # The request keeps the violation by side, with nobody's name in it.
    row = await db.get(SwapRequest, uuid.UUID(body["id"]))
    assert row.rule_violations == [{"rule": "three_in_seven", "party": "replacement", "days": DAYS}]
    created_event = await _audit(db, "swap.created")
    assert created_event.summary.endswith(f"Anna Kowalska → Bartosz Nowak{SUFFIX}")
    assert created_event.details == {
        "rule_violations": [
            {"rule": "three_in_seven", "member_name": "Bartosz Nowak", "days": DAYS}
        ]
    }
    asked = await _mail(db, "swap_requested")
    assert asked.recipient == "bartek@example.com"
    assert f"Zamiana łamie reguły grafiku:\n- {BROKEN_LINE}\n" in asked.body
    assert BROKEN_LINE in asked.html_body


async def test_an_english_request_is_answered_in_english_and_mailed_in_polish(
    client, db, team
) -> None:
    await login(client, "ania")
    english = {"Accept-Language": "en"}

    refused = await client.post("/api/v1/swaps", json=_request(team, note=REASON), headers=english)
    detail = refused.json()["detail"]
    assert detail["message"] == (
        "The swap would break the schedule's hard rules; confirm the deliberate violation"
    )
    assert detail["violations"][0]["message"] == "More than 3 on-call duties within 7 days."
    created = await client.post(
        "/api/v1/swaps",
        json=_request(team, note=REASON, acknowledge_rule_violations=True),
        headers=english,
    )
    assert created.status_code == 201, created.text

    assert BROKEN_LINE in (await _mail(db, "swap_requested")).body
    assert (await _audit(db, "swap.created")).summary.endswith(SUFFIX)


async def test_replacement_and_coordinator_each_acknowledge_what_the_swap_breaks(
    client, db, team
) -> None:
    """With the coordinator's approval on: three people, three acknowledgements,
    each against the roster as it is when they decide."""
    swap_id = await _ask(client, team)

    await login(client, "bartek")
    (listed,) = (await client.get("/api/v1/swaps")).json()
    assert listed["rule_violations"] == [BROKEN]
    for unacknowledged in (None, {}, {"acknowledge_rule_violations": False}):
        refused = await client.post(f"/api/v1/swaps/{swap_id}/accept", json=unacknowledged)
        assert refused.status_code == 409, refused.text
        assert refused.json()["detail"]["reason"] == "RULE_VIOLATIONS"
        assert refused.json()["detail"]["violations"] == [BROKEN]
    accepted = await client.post(f"/api/v1/swaps/{swap_id}/accept", json=ACKNOWLEDGE)
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["status"] == "pending_coordinator"
    assert accepted.json()["rule_violations"] == [BROKEN]

    await login(client, "koord")
    (listed,) = (await client.get("/api/v1/swaps")).json()
    assert listed["rule_violations"] == [BROKEN]
    refused = await client.post(f"/api/v1/swaps/{swap_id}/approve")
    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"]["reason"] == "RULE_VIOLATIONS"
    assert (await _holders_on_the_6th(db))[AssignmentRole.secondary] == "Anna Kowalska"
    approved = await client.post(f"/api/v1/swaps/{swap_id}/approve", json=ACKNOWLEDGE)
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "approved"
    assert approved.json()["rule_violations"] == [BROKEN]

    assert await _holders_on_the_6th(db) == {
        AssignmentRole.primary: "Ewa Lewandowska",
        AssignmentRole.secondary: "Bartosz Nowak",
        AssignmentRole.late_shift: "Bartosz Nowak",
    }
    # Once in the schedule the request shows what was acknowledged, for good.
    (listed,) = (await client.get("/api/v1/swaps")).json()
    assert listed["rule_violations"] == [BROKEN]
    row = await db.get(SwapRequest, uuid.UUID(swap_id), populate_existing=True)
    assert row.status == SwapStatus.approved
    assert row.rule_violations == [{"rule": "three_in_seven", "party": "replacement", "days": DAYS}]
    for action in ("swap.accepted", "swap.approved"):
        event = await _audit(db, action)
        assert event.summary.endswith(SUFFIX), action
        assert event.details["rule_violations"][0]["rule"] == "three_in_seven", action
    to_decide = await _mail(db, "swap_pending_coordinator")
    assert to_decide.recipient == "koord@example.com"
    assert BROKEN_LINE in to_decide.body
    decided = await _mails(db, "swap_approved")
    assert {mail.recipient for mail in decided} == {"ania@example.com", "bartek@example.com"}
    assert all(BROKEN_LINE in mail.body for mail in decided)


async def test_with_approval_off_the_acknowledged_acceptance_writes_the_schedule(
    client, db, team
) -> None:
    """The team asks no coordinator to approve swaps, and a rule-breaking one
    takes the same road: the replacement's acknowledged acceptance is the
    hand-over, and the coordinators' note names the rule that was broken."""
    await login(client, "koord")
    saved = await client.put(
        "/api/v1/scheduling/policy",
        json={"rotation_mode": "hybrid", "coordinator_swap_approval_required": False},
    )
    assert saved.status_code == 200, saved.text
    swap_id = await _ask(client, team)

    await login(client, "bartek")
    refused = await client.post(f"/api/v1/swaps/{swap_id}/accept")
    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"]["reason"] == "RULE_VIOLATIONS"
    assert (await _holders_on_the_6th(db))[AssignmentRole.secondary] == "Anna Kowalska"
    row = await db.get(SwapRequest, uuid.UUID(swap_id), populate_existing=True)
    assert row.status == SwapStatus.pending_replacement

    accepted = await client.post(f"/api/v1/swaps/{swap_id}/accept", json=ACKNOWLEDGE)
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["status"] == "approved"
    assert accepted.json()["rule_violations"] == [BROKEN]

    holders = await _holders_on_the_6th(db)
    assert holders[AssignmentRole.secondary] == "Bartosz Nowak"
    assert holders[AssignmentRole.late_shift] == "Bartosz Nowak"
    recorded = await _audit(db, "swap.approved")
    assert recorded.summary.endswith(SUFFIX)
    assert recorded.details["by_coordinator"] is False
    assert recorded.details["rule_violations"][0]["member_name"] == "Bartosz Nowak"
    note = await _mail(db, "swap_recorded_fyi")
    assert note.recipient == "koord@example.com"
    assert note.subject.startswith("Do wiadomości:")
    assert f"Zamiana łamie reguły grafiku:\n- {BROKEN_LINE}\n" in note.body
    assert BROKEN_LINE in note.html_body
