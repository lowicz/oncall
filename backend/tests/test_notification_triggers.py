from datetime import timedelta

from sqlalchemy import select

from oncall.domain.clock import business_today
from oncall.domain.scheduling.models import ScheduledDuty
from oncall.domain.vocabulary import AssignmentRole, UserRole
from oncall.infrastructure.sqlalchemy.notification_models import NotificationOutbox
from oncall.notifications.templates import format_day
from oncall.notifications.triggers import notify_schedule_published
from tests.conftest import (
    create_member,
    create_published_schedule,
    create_user,
    login,
)


async def _seed_team(db):
    today = business_today()
    anna = await create_user(db, "anna", email="anna@example.com", display_name="Anna Kowalska")
    marek = await create_user(db, "marek", email="marek@example.com", display_name="Marek Nowak")
    ola = await create_user(db, "ola", email="ola@example.com", display_name="Ola Wiśniewska")
    members = {}
    for user, name in ((anna, "Anna Kowalska"), (marek, "Marek Nowak"), (ola, "Ola Wiśniewska")):
        members[name] = await create_member(db, user, display_name=name)
    return today, members


async def _outbox_rows(db):
    return (await db.scalars(select(NotificationOutbox))).all()


async def test_swap_lifecycle_enqueues_notifications(client, db) -> None:
    today, members = await _seed_team(db)
    schedule = await create_published_schedule(
        db,
        starts_on=today,
        days=7,
        primary=["Anna Kowalska"],
        secondary=["Ola Wiśniewska"],
        late_shift=["Ola Wiśniewska"],
    )
    await login(client, "anna")
    created = await client.post(
        "/api/v1/swaps",
        json={
            "schedule_id": str(schedule.id),
            "service_date": str(today),
            "role": "primary",
            "replacement_member_id": str(members["Marek Nowak"].id),
        },
    )
    assert created.status_code == 201, created.text
    rows = await _outbox_rows(db)
    assert len(rows) == 1
    assert rows[0].recipient == "marek@example.com"
    assert "Prośba o zamianę" in rows[0].subject

    swap_id = created.json()["id"]
    await login(client, "marek")
    accepted = await client.post(f"/api/v1/swaps/{swap_id}/accept")
    assert accepted.status_code == 200, accepted.text
    rows = await _outbox_rows(db)
    assert len(rows) == 2
    assert rows[1].recipient == "anna@example.com"
    assert "zaakceptowana" in rows[1].subject

    await create_user(db, "admin", role=UserRole.admin)
    await login(client, "admin")
    approved = await client.post(f"/api/v1/swaps/{swap_id}/approve")
    assert approved.status_code == 200, approved.text
    rows = await _outbox_rows(db)
    recipients = {row.recipient for row in rows[-2:]}
    assert recipients == {"anna@example.com", "marek@example.com"}
    assert all("zatwierdzona" in row.subject for row in rows[-2:])


async def test_swap_rejection_notifies_requester(client, db) -> None:
    today, members = await _seed_team(db)
    schedule = await create_published_schedule(
        db,
        starts_on=today,
        days=7,
        primary=["Anna Kowalska"],
        secondary=["Ola Wiśniewska"],
        late_shift=["Ola Wiśniewska"],
    )
    await login(client, "anna")
    created = await client.post(
        "/api/v1/swaps",
        json={
            "schedule_id": str(schedule.id),
            "service_date": str(today),
            "role": "primary",
            "replacement_member_id": str(members["Marek Nowak"].id),
        },
    )
    swap_id = created.json()["id"]
    await login(client, "marek")
    rejected = await client.post(
        f"/api/v1/swaps/{swap_id}/reject", json={"reason": "Nie mogę tego dnia"}
    )
    assert rejected.status_code == 200, rejected.text
    rows = await _outbox_rows(db)
    rejection = rows[-1]
    assert rejection.recipient == "anna@example.com"
    assert "odrzucona" in rejection.subject
    assert "Nie mogę tego dnia" in rejection.body


async def test_direct_override_notifies_both_sides(client, db) -> None:
    today, members = await _seed_team(db)
    schedule = await create_published_schedule(
        db,
        starts_on=today,
        days=7,
        primary=["Anna Kowalska"],
        secondary=["Ola Wiśniewska"],
        late_shift=["Ola Wiśniewska"],
    )
    await create_user(db, "admin", role=UserRole.admin)
    await login(client, "admin")
    response = await client.post(
        "/api/v1/calendar/override",
        json={
            "schedule_id": str(schedule.id),
            "expected_version": schedule.version,
            "service_date": str(today),
            "role": "primary",
            "replacement_member_id": str(members["Marek Nowak"].id),
        },
    )
    assert response.status_code == 200, response.text
    rows = await _outbox_rows(db)
    recipients = {row.recipient for row in rows}
    assert recipients == {"anna@example.com", "marek@example.com"}
    assert all("Zmiana przydziału" in row.subject for row in rows)
    assert any("Marek Nowak (poprzednio: Anna Kowalska)" in row.body for row in rows)


async def test_direct_override_rejects_current_assignee_without_side_effects(client, db) -> None:
    today, members = await _seed_team(db)
    schedule = await create_published_schedule(
        db,
        starts_on=today,
        days=1,
        primary=["Anna Kowalska"],
        secondary=["Ola Wiśniewska"],
        late_shift=["Ola Wiśniewska"],
    )
    await create_user(db, "admin", role=UserRole.admin)
    await login(client, "admin")

    response = await client.post(
        "/api/v1/calendar/override",
        json={
            "schedule_id": str(schedule.id),
            "expected_version": schedule.version,
            "service_date": str(today),
            "role": "primary",
            "replacement_member_id": str(members["Anna Kowalska"].id),
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Ta osoba już pełni tę rolę tego dnia"
    await db.refresh(schedule)
    assert schedule.version == 1
    assert await _outbox_rows(db) == []


async def test_publish_notification_goes_to_members_with_email(db) -> None:
    today, members = await _seed_team(db)
    piotr = await create_user(db, "piotr", email=None, display_name="Piotr Zieliński")
    await create_member(db, piotr, display_name="Piotr Zieliński")
    await notify_schedule_published(
        db, name="Szkic X", starts_on=today, ends_on=today + timedelta(days=13), duties=[]
    )
    await db.commit()
    rows = await _outbox_rows(db)
    recipients = {row.recipient for row in rows}
    assert recipients == {"anna@example.com", "marek@example.com", "ola@example.com"}
    assert all("Opublikowano grafik" in row.subject for row in rows)


async def test_publish_notification_lists_only_the_recipients_own_duties(db) -> None:
    today, members = await _seed_team(db)
    tomorrow = today + timedelta(days=1)

    def duty(day, role, name, *, by_id=True):
        return ScheduledDuty(
            service_date=day,
            role=role,
            assignee_name=name,
            member_id=members[name].id if by_id else None,
            is_override=False,
        )

    await notify_schedule_published(
        db,
        name="Grafik X",
        starts_on=today,
        ends_on=tomorrow,
        # Out of order on purpose: each mail reads by day, then PRIMARY first.
        duties=[
            duty(tomorrow, AssignmentRole.primary, "Anna Kowalska"),
            duty(today, AssignmentRole.secondary, "Anna Kowalska"),
            duty(today, AssignmentRole.primary, "Marek Nowak"),
            # A row with no identity is matched by name.
            duty(tomorrow, AssignmentRole.secondary, "Marek Nowak", by_id=False),
        ],
    )
    await db.commit()
    bodies = {row.recipient: row.body for row in await _outbox_rows(db)}

    moje = "Moje dyżury: http://localhost:8080/moje\n"
    assert bodies["anna@example.com"].endswith(moje)
    # Days read as the screens print them: weekday, then DD-MM-RRRR.
    assert (
        "Twoje dyżury w tym grafiku:\n"
        f"- {format_day(today)} · SECONDARY\n- {format_day(tomorrow)} · PRIMARY\n\n"
        in bodies["anna@example.com"]
    )
    assert (
        "Twoje dyżury w tym grafiku:\n"
        f"- {format_day(today)} · PRIMARY\n- {format_day(tomorrow)} · SECONDARY\n\n"
        in bodies["marek@example.com"]
    )
    assert "Anna" not in bodies["marek@example.com"]
    # The HTML twin lists the same duties, and nobody else's.
    htmls = {row.recipient: row.html_body for row in await _outbox_rows(db)}
    assert htmls["anna@example.com"].count(">SECONDARY<") == 1
    assert htmls["anna@example.com"].count(">PRIMARY<") == 1
    assert "Anna" not in htmls["marek@example.com"]
    assert 'href="http://localhost:8080/moje"' in htmls["ola@example.com"]
    # Somebody with nothing in the range still gets the mail and the link.
    assert "W tym grafiku nie masz żadnych dyżurów." in bodies["ola@example.com"]
    assert "Twoje dyżury w tym grafiku" not in bodies["ola@example.com"]
    assert bodies["ola@example.com"].endswith(moje)


async def test_unavailability_over_existing_duty_warns_member_and_coordinator(client, db) -> None:
    today, _ = await _seed_team(db)
    await create_published_schedule(
        db,
        starts_on=today,
        days=1,
        primary=["Anna Kowalska"],
        secondary=["Ola Wiśniewska"],
        late_shift=["Ola Wiśniewska"],
    )
    await create_user(
        db,
        "koord",
        role=UserRole.coordinator,
        email="koord@example.com",
    )
    await login(client, "anna")

    response = await client.post(
        "/api/v1/availability/me",
        json={"kind": "unavailable", "starts_on": str(today), "ends_on": str(today)},
    )

    assert response.status_code == 201, response.text
    assert response.json()["warning"].startswith("Masz w tym czasie dyżur")
    rows = await _outbox_rows(db)
    assert [row.recipient for row in rows] == ["koord@example.com"]
    assert "Anna Kowalska" in rows[0].subject
    assert f"{format_day(today)} · PRIMARY" in rows[0].body
