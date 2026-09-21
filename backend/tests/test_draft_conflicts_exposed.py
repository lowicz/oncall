"""Konflikty twardej niedostępności widoczne przed kliknięciem (HGH5-02).

`_hard_unavailability_conflicts` liczyło dokładnie tę listę, ale docierała ona
do koordynatora dopiero jako 409 po kliknięciu „Przekaż do akceptacji".
Teraz jedzie z każdą odpowiedzią o szkicu, więc macierz szkicu może pokazać
baner, a ekran nie twierdzi, że grafik spełnia wszystkie reguły twarde.
"""

from datetime import date

from oncall.domain.vocabulary import AvailabilityKind
from oncall.infrastructure.sqlalchemy.availability_model import Availability
from tests.conftest import login
from tests.test_schedule_unavailability_guard import WEEKDAY, _complete_draft, _seed_team


async def test_draft_response_carries_the_conflicts_that_would_block_propose(client, db) -> None:
    anna, marek = await _seed_team(db)
    db.add(
        Availability(
            member_id=anna.id,
            kind=AvailabilityKind.unavailable,
            starts_on=WEEKDAY,
            ends_on=WEEKDAY,
        )
    )
    draft = _complete_draft(anna, marek)
    db.add(draft)
    await db.commit()
    await db.refresh(draft)

    await login(client, "koord.bd")
    response = await client.get(f"/api/v1/scheduling/{draft.id}")
    assert response.status_code == 200, response.text
    conflicts = response.json()["unavailability_conflicts"]
    assert conflicts == [
        {
            "service_date": WEEKDAY.isoformat(),
            "role": "primary",
            "assignee_name": "Anna BD",
        }
    ], conflicts

    # Ta sama lista, ten sam wniosek: przekazanie kończy się 409.
    blocked = await client.post(
        f"/api/v1/scheduling/{draft.id}/propose", json={"expected_version": 1}
    )
    assert blocked.status_code == 409, blocked.text
    assert blocked.json()["detail"]["conflicts"] == [
        f"{WEEKDAY.isoformat()} · primary: Anna BD ma twardą niedostępność"
    ]


async def test_draft_without_unavailability_reports_no_conflicts(client, db) -> None:
    anna, marek = await _seed_team(db)
    db.add(
        Availability(
            member_id=anna.id,
            kind=AvailabilityKind.unavailable,
            starts_on=date(2026, 12, 1),
            ends_on=date(2026, 12, 2),
        )
    )
    draft = _complete_draft(anna, marek)
    db.add(draft)
    await db.commit()
    await db.refresh(draft)

    await login(client, "koord.bd")
    response = await client.get(f"/api/v1/scheduling/{draft.id}")
    assert response.status_code == 200, response.text
    assert response.json()["unavailability_conflicts"] == []


async def test_propose_conflict_message_offers_a_draft_correction(client, db) -> None:
    """Pojedynczą komórkę da się poprawić korektą, więc komunikat nie może
    podawać pełnej regeneracji jako jedynego wyjścia."""
    anna, marek = await _seed_team(db)
    db.add(
        Availability(
            member_id=anna.id,
            kind=AvailabilityKind.unavailable,
            starts_on=WEEKDAY,
            ends_on=WEEKDAY,
        )
    )
    draft = _complete_draft(anna, marek)
    db.add(draft)
    await db.commit()
    await db.refresh(draft)

    await login(client, "koord.bd")
    response = await client.post(
        f"/api/v1/scheduling/{draft.id}/propose", json={"expected_version": 1}
    )
    assert response.status_code == 409, response.text
    message = response.json()["detail"]["message"]
    assert "korektą w macierzy szkicu" in message, message
