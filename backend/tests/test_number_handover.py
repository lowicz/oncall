"""The day's pair hands the on-call number over over HTTP: who may start and
end it, what the API refuses, and what every role and share link reads of
where the number rings. The worker's side is in `test_forwarding_worker.py`."""

from datetime import timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from oncall.domain.forwarding import errors
from oncall.domain.forwarding.models import ForwardingMode, HandoverEnd
from oncall.domain.vocabulary import AssignmentRole, UserRole
from oncall.infrastructure.sqlalchemy.access_models import User
from oncall.infrastructure.sqlalchemy.audit_model import AuditEvent
from oncall.infrastructure.sqlalchemy.forwarding import SqlAlchemyHandovers
from oncall.infrastructure.sqlalchemy.forwarding_models import (
    CallForwardingSettings,
    ForwardingHandover,
)
from oncall.infrastructure.sqlalchemy.scheduling_models import Assignment
from tests.conftest import create_member, create_published_schedule, create_user, login

NOW = "/api/v1/forwarding/now"
HANDOVER = "/api/v1/forwarding/handover"


@pytest.fixture
async def pair(db, frozen_clock):
    """Anna PRIMARY and Marek SECONDARY today; Jan on the team, outside the pair."""
    people = {}
    for username, name, phone in (
        ("anna", "Anna Kowalska", "+48500500500"),
        ("marek", "Marek Nowak", "+48600700800"),
        ("jan", "Jan Wiśniewski", "+48700700700"),
    ):
        user = await create_user(db, username, phone=phone, display_name=name)
        people[name] = await create_member(db, user, display_name=name)
    await create_published_schedule(
        db,
        starts_on=frozen_clock.business_today() - timedelta(days=1),
        days=4,
        primary=["Anna Kowalska"],
        secondary=["Marek Nowak"],
    )
    for row in (await db.scalars(select(Assignment))).all():
        row.member_id = people[row.assignee_name].id
    await create_user(db, "koordynator", role=UserRole.coordinator)
    await db.commit()
    return people


async def _mode(db, mode: ForwardingMode) -> None:
    db.add(CallForwardingSettings(mode=mode))
    await db.commit()


def _until(frozen_clock, **delta) -> str:
    return (frozen_clock.instant + timedelta(**delta)).isoformat()


async def _start(client, frozen_clock, **delta):
    return await client.post(
        HANDOVER, json={"until": _until(frozen_clock, **(delta or {"hours": 2}))}
    )


async def _audit(db) -> list[AuditEvent]:
    query = select(AuditEvent).where(AuditEvent.action.startswith("forwarding.handover"))
    return list((await db.scalars(query.order_by(AuditEvent.occurred_at))).all())


async def test_while_forwarding_is_off_nothing_can_be_handed_over_or_read(
    client, db, pair, frozen_clock
) -> None:
    await login(client, "anna")

    started = await _start(client, frozen_clock)
    now = await client.get(NOW)

    assert started.status_code == 409
    assert started.json()["detail"] == str(errors.ForwardingOff())
    assert now.json() == {
        "mode": "off",
        "day": None,
        "holder_member_id": None,
        "holder_name": None,
        "holder_role": None,
        "handover": None,
        "status": None,
        "confirmed_at": None,
    }


async def test_the_primary_hands_the_number_over_and_everyone_reads_where_it_rings(
    client, db, pair, frozen_clock
) -> None:
    await _mode(db, ForwardingMode.live)
    await login(client, "anna")
    before = (await client.get(NOW)).json()

    started = await _start(client, frozen_clock)

    assert before["holder_name"] == "Anna Kowalska"
    assert before["holder_role"] == "primary"
    assert started.status_code == 201, started.text
    handover = started.json()
    assert (handover["from_name"], handover["to_name"]) == ("Anna Kowalska", "Marek Nowak")
    await login(client, "jan")
    now = await client.get(NOW)
    assert now.status_code == 200
    assert now.json() | {"handover": None} == {
        "mode": "live",
        "day": frozen_clock.business_today().isoformat(),
        "holder_member_id": str(pair["Marek Nowak"].id),
        "holder_name": "Marek Nowak",
        "holder_role": "secondary",
        "handover": None,
        "status": "switching",
        "confirmed_at": None,
    }
    assert now.json()["handover"]["id"] == handover["id"]
    # No phone number ever: the duty cards show the ones the reader may see.
    assert "+48" not in now.text
    [entry] = await _audit(db)
    assert entry.summary == "Przekazano numer on-call: Anna Kowalska → Marek Nowak do 14:00"
    assert entry.actor_label == "Anna Kowalska"


async def test_the_secondary_or_a_coordinator_may_start_it_but_nobody_else(
    client, db, pair, frozen_clock
) -> None:
    await _mode(db, ForwardingMode.dry_run)
    await login(client, "jan")
    outsider = await _start(client, frozen_clock)

    assert outsider.status_code == 403
    assert outsider.json()["detail"] == str(errors.NotInThePair())
    for username in ("marek", "koordynator"):
        await login(client, username)
        started = await _start(client, frozen_clock)
        assert started.status_code == 201, started.text
        ended = await client.delete(f"{HANDOVER}/{started.json()['id']}")
        assert ended.status_code == 204


async def test_a_second_handover_is_refused_while_the_first_holds(
    client, db, pair, frozen_clock
) -> None:
    await _mode(db, ForwardingMode.live)
    await login(client, "anna")
    await _start(client, frozen_clock)
    await login(client, "marek")

    second = await _start(client, frozen_clock, hours=1)

    assert second.status_code == 409
    assert "Marek Nowak" in second.json()["detail"]


@pytest.mark.parametrize("delta", [{"minutes": -1}, {"hours": 21, "minutes": 1}])
async def test_the_end_must_lie_after_now_and_within_the_duty_day(
    client, db, pair, frozen_clock, delta
) -> None:
    await _mode(db, ForwardingMode.live)
    await login(client, "anna")

    refused = await _start(client, frozen_clock, **delta)
    latest = await _start(client, frozen_clock, hours=21)

    assert refused.status_code == 422
    assert "16-09-2026 09:00" in refused.json()["detail"]
    assert latest.status_code == 201, latest.text


async def test_a_receiver_without_a_number_is_refused_in_the_request_language(
    client, db, pair, frozen_clock
) -> None:
    await _mode(db, ForwardingMode.live)
    marek = await db.get(User, pair["Marek Nowak"].user_id)
    assert marek is not None
    marek.phone = None
    await db.commit()
    await login(client, "anna")

    polish = await _start(client, frozen_clock)
    english = await client.post(
        HANDOVER,
        json={"until": _until(frozen_clock, hours=2)},
        headers={"Accept-Language": "en"},
    )

    assert polish.status_code == 422
    assert polish.json()["detail"] == (
        "Marek Nowak nie ma numeru telefonu na ekranie „Moje dyżury”. Poproś o jego uzupełnienie."
    )
    assert english.json()["detail"] == (
        "Marek Nowak has no phone number on the My duties screen. Ask for it to be filled in."
    )


async def test_a_day_without_a_whole_pair_has_nobody_to_hand_over_to(
    client, db, pair, frozen_clock
) -> None:
    await _mode(db, ForwardingMode.live)
    secondary = await db.scalar(
        select(Assignment).where(
            Assignment.service_date == frozen_clock.business_today(),
            Assignment.role == AssignmentRole.secondary,
        )
    )
    assert secondary is not None
    await db.delete(secondary)
    await db.commit()
    await login(client, "anna")

    refused = await _start(client, frozen_clock)

    assert refused.status_code == 422
    assert refused.json()["detail"] == str(errors.HandoverNeedsPair())


async def test_either_of_its_people_ends_it_once_and_nobody_else(
    client, db, pair, frozen_clock
) -> None:
    await _mode(db, ForwardingMode.live)
    await login(client, "anna")
    handover = (await _start(client, frozen_clock)).json()
    await login(client, "jan")
    outsider = await client.delete(f"{HANDOVER}/{handover['id']}")
    await login(client, "marek")

    ended = await client.delete(f"{HANDOVER}/{handover['id']}")
    again = await client.delete(f"{HANDOVER}/{handover['id']}")

    assert outsider.status_code == 403
    assert ended.status_code == 204
    assert again.status_code == 404
    assert again.json()["detail"] == str(errors.HandoverNotFound())
    row = await db.scalar(select(ForwardingHandover).execution_options(populate_existing=True))
    assert row is not None
    assert (row.end_reason, row.ended_by_user_id) == (
        HandoverEnd.manual,
        pair["Marek Nowak"].user_id,
    )
    started, finished = await _audit(db)
    assert finished.summary == (
        "Zakończono przekazanie numeru on-call: Anna Kowalska → Marek Nowak, zakończone ręcznie"
    )
    assert finished.details is not None
    assert finished.details["reason"] == "manual"
    assert (await client.get(NOW)).json()["holder_name"] == "Anna Kowalska"


async def test_a_share_link_reads_the_holder_only_within_its_range(
    client, db, pair, frozen_clock
) -> None:
    await _mode(db, ForwardingMode.live)
    await create_user(db, "admin", role=UserRole.admin)
    await login(client, "admin")
    today = frozen_clock.business_today()

    async def holder(starts_on, ends_on):
        created = await client.post(
            "/api/v1/admin/share-links",
            json={
                "label": "Dyspozytor",
                "starts_on": str(starts_on),
                "ends_on": str(ends_on),
                "expires_days": 7,
            },
        )
        token = created.json()["url"].rsplit("/share/", 1)[1]
        guest = client.__class__(transport=client._transport, base_url="http://test")
        await guest.post("/api/v1/share/exchange", json={"token": token})
        response = await guest.get(NOW)
        assert response.status_code == 200, response.text
        return response.json()["holder_name"]

    assert await holder(today, today + timedelta(days=3)) == "Anna Kowalska"
    assert await holder(today + timedelta(days=1), today + timedelta(days=3)) is None


async def test_the_correction_check_names_the_handover_it_would_end(
    client, db, pair, frozen_clock
) -> None:
    await _mode(db, ForwardingMode.live)
    await login(client, "anna")
    handover = (await _start(client, frozen_clock)).json()
    await login(client, "koordynator")

    async def check(role: str) -> dict:
        response = await client.post(
            "/api/v1/calendar/override/check",
            json={
                "service_date": frozen_clock.business_today().isoformat(),
                "role": role,
                "replacement_member_id": str(pair["Jan Wiśniewski"].id),
            },
        )
        assert response.status_code == 200, response.text
        return response.json()

    secondary = await check("secondary")
    late_shift = await check("late_shift")

    assert secondary["ends_handover"]["id"] == handover["id"]
    assert secondary["ends_handover"]["to_name"] == "Marek Nowak"
    assert late_shift["ends_handover"] is None

    settings = await db.scalar(select(CallForwardingSettings))
    settings.mode = ForwardingMode.off
    await db.commit()
    assert (await check("secondary"))["ends_handover"] is None


async def test_the_batch_correction_check_names_the_handover_it_would_end(
    client, db, pair, frozen_clock
) -> None:
    """Taking a person off the roster corrects many slots at once; the one
    on the pair's day ends the handover there as well (NP-16)."""
    await _mode(db, ForwardingMode.live)
    await login(client, "anna")
    handover = (await _start(client, frozen_clock)).json()
    await login(client, "koordynator")
    schedule_id = (await db.scalars(select(Assignment.schedule_id))).first()
    today = frozen_clock.business_today()

    async def check(*slots: tuple) -> dict:
        response = await client.post(
            "/api/v1/calendar/override/batch/check",
            json={
                "batches": [
                    {
                        "schedule_id": str(schedule_id),
                        "assignments": [
                            {
                                "service_date": day.isoformat(),
                                "role": role,
                                "replacement_member_id": str(pair["Jan Wiśniewski"].id),
                            }
                            for day, role in slots
                        ],
                    }
                ]
            },
        )
        assert response.status_code == 200, response.text
        return response.json()

    offboarding = await check((today + timedelta(days=1), "secondary"), (today, "secondary"))
    later_only = await check((today + timedelta(days=1), "secondary"))

    assert offboarding["ends_handover"]["id"] == handover["id"]
    assert offboarding["ends_handover"]["to_name"] == "Marek Nowak"
    assert later_only["ends_handover"] is None


async def test_the_store_answers_a_second_open_handover_as_the_first(
    db, pair, frozen_clock
) -> None:
    """The open handover of the day is refused by the unique index, which a
    request that passed the check before the other committed runs into. Any
    other refused row is not a handover already open."""
    store = SqlAlchemyHandovers(db)
    values = {
        "day": frozen_clock.business_today(),
        "from_member_id": pair["Anna Kowalska"].id,
        "to_member_id": pair["Marek Nowak"].id,
        "now": frozen_clock.instant,
        "by_user_id": pair["Anna Kowalska"].user_id,
    }
    await store.start(until=frozen_clock.instant + timedelta(hours=1), **values)

    second = store.start(until=frozen_clock.instant + timedelta(hours=2), **values)
    with pytest.raises(errors.HandoverActive) as refused:
        await second
    pending = store.start(
        until=frozen_clock.instant, **values | {"day": values["day"] + timedelta(days=1)}
    )
    with pytest.raises(IntegrityError, match="ck_forwarding_handovers_period"):
        await pending

    assert "Marek Nowak" in str(refused.value)
