"""Ostrzeżenia solvera docierają do koordynatora (HGH5-06).

`SolverResult.warnings` trafiały tylko do rekordu zadania i do audytu, bo
odpowiedź o szkicu budowała pole `warnings` od zera z reguł twardych. Teraz
oba źródła jadą razem i są rozróżnialne, a reguły podają nazwisko i dni.
"""

from datetime import date

from oncall.models import (
    Assignment,
    AssignmentRole,
    Eligibility,
    RotationMode,
    Schedule,
    ScheduleStatus,
    TeamMember,
    UserRole,
)
from tests.conftest import create_user, login

MONDAY = date(2026, 9, 7)
SUSPENDED = (
    "Reguły rozrzedzania musiały zostać zawieszone, bo przy tej "
    "obsadzie i nieobecnościach nie da się ich spełnić."
)


async def _schedule_with_suspended_spacing(db) -> Schedule:
    await create_user(db, "koord.hgh", role=UserRole.coordinator, display_name="Koord HGH")
    solo_user = await create_user(db, "solo.hgh", display_name="Solo HGH")
    other_user = await create_user(db, "other.hgh", display_name="Other HGH")
    solo = TeamMember(user_id=solo_user.id, display_name="Solo HGH", active_from=date(2025, 1, 1))
    other = TeamMember(
        user_id=other_user.id, display_name="Other HGH", active_from=date(2025, 1, 1)
    )
    for member in (solo, other):
        member.eligibility = [
            Eligibility(role=role, starts_on=member.active_from) for role in AssignmentRole
        ]
    db.add_all((solo, other))
    await db.commit()
    await db.refresh(solo)
    await db.refresh(other)

    # Four consecutive on-call days for one person: exactly what the solver
    # produces once the spacing rules are suspended.
    schedule = Schedule(
        name="Szkic hybrydowy 07-09-2026 - 10-09-2026",
        starts_on=MONDAY,
        ends_on=date(2026, 9, 10),
        status=ScheduleStatus.draft,
        version=1,
        rotation_mode=RotationMode.hybrid,
        solver_status="OPTIMAL",
        solver_warnings=[SUSPENDED],
        assignments=[
            item
            for offset in range(4)
            for item in (
                Assignment(
                    service_date=MONDAY.replace(day=7 + offset),
                    role=AssignmentRole.primary,
                    assignee_name=solo.display_name,
                    member_id=solo.id,
                ),
                Assignment(
                    service_date=MONDAY.replace(day=7 + offset),
                    role=AssignmentRole.secondary,
                    assignee_name=other.display_name,
                    member_id=other.id,
                ),
            )
        ],
    )
    db.add(schedule)
    await db.commit()
    await db.refresh(schedule)
    return schedule


async def test_solver_warning_reaches_the_response_labelled_as_the_solver(client, db) -> None:
    schedule = await _schedule_with_suspended_spacing(db)
    await login(client, "koord.hgh")
    response = await client.get(f"/api/v1/scheduling/{schedule.id}")
    assert response.status_code == 200, response.text
    warnings = response.json()["warnings"]

    solver = [item["message"] for item in warnings if item["source"] == "solver"]
    assert solver == [SUSPENDED], warnings
    # Nobody performed a correction, so nothing may claim one did.
    assert not any("Korekta" in item["message"] for item in warnings), warnings


async def test_rule_warnings_name_the_person_and_the_days(client, db) -> None:
    schedule = await _schedule_with_suspended_spacing(db)
    await login(client, "koord.hgh")
    response = await client.get(f"/api/v1/scheduling/{schedule.id}")
    rules = [item["message"] for item in response.json()["warnings"] if item["source"] == "rules"]
    assert rules, response.text
    assert any("Solo HGH" in message and "07-09-2026" in message for message in rules), rules
    assert all(message.startswith(("Solo HGH:", "Other HGH:")) for message in rules), rules


async def test_a_schedule_without_solver_warnings_reports_none(client, db) -> None:
    schedule = await _schedule_with_suspended_spacing(db)
    schedule.solver_warnings = None
    await db.commit()
    await login(client, "koord.hgh")
    response = await client.get(f"/api/v1/scheduling/{schedule.id}")
    warnings = response.json()["warnings"]
    assert [item for item in warnings if item["source"] == "solver"] == []
    assert [item for item in warnings if item["source"] == "rules"], warnings


async def test_rule_warnings_are_one_sentence_per_person_and_rule(client, db) -> None:
    """`oncall_rest_violations` reports one violation per starting day, so an
    over-loaded fortnight used to produce a dozen near-identical alerts."""
    schedule = await _schedule_with_suspended_spacing(db)
    await login(client, "koord.hgh")
    response = await client.get(f"/api/v1/scheduling/{schedule.id}")
    rules = [item["message"] for item in response.json()["warnings"] if item["source"] == "rules"]
    assert len(rules) == len(set(rules)), rules
    # Both hold four consecutive days, so both break both rest rules - once
    # each, over the union of the days, not once per sliding window.
    days = "Dni: 07-09-2026, 08-09-2026, 09-09-2026, 10-09-2026."
    assert sorted(rules) == sorted(
        f"{name}: {rule} {days}"
        for name in ("Solo HGH", "Other HGH")
        for rule in (
            "Więcej niż 3 dyżury on-call w okresie 7 dni.",
            "Więcej niż 3 kolejne dni dyżuru on-call.",
        )
    ), rules
