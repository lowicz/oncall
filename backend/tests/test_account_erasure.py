"""Deleting an account takes the person's name off everything other users see.

The deletion sheet promises that the first and last name are removed while the
duty history and points stay for fairness. The team member outlives the
account, so it and every duty label that carried the name are pseudonymised in
the same unit of work; the audit trail keeps what it recorded.
"""

import uuid
from datetime import timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.domain.clock import business_today
from oncall.domain.vocabulary import UserRole
from oncall.infrastructure.sqlalchemy.audit_model import AuditEvent
from oncall.infrastructure.sqlalchemy.scheduling_models import Assignment
from oncall.infrastructure.sqlalchemy.team_models import TeamMember
from tests.conftest import create_member, create_published_schedule, create_user, login

NAME = "Tymon Testowy"
TODAY = business_today()
START = TODAY - timedelta(days=20)
DAYS = 28
RANGE = f"starts_on={START}&ends_on={START + timedelta(days=DAYS - 1)}"
#: What each role can open: the viewer only the Grafik, a member the team as
#: well, a coordinator also fairness and the monthly report.
PAGES = {
    "widz": ("calendar",),
    "marek": ("calendar", "team"),
    "koord": ("calendar", "team", "fairness", "report"),
}
URLS = {
    "calendar": f"/api/v1/calendar?{RANGE}",
    "team": "/api/v1/team",
    "fairness": "/api/v1/fairness",
    "report": f"/api/v1/reports/monthly.csv?month={TODAY:%Y-%m}",
}


async def _member(db: AsyncSession, username: str, name: str) -> tuple[uuid.UUID, uuid.UUID]:
    """The member's id and its account's id."""
    user = await create_user(db, username, display_name=name)
    member = await create_member(db, user, display_name=name)
    return member.id, user.id


async def _world(db: AsyncSession) -> tuple[uuid.UUID, uuid.UUID]:
    """Tymon's member and account ids, with a month of published duty."""
    for username, name in (("anna", "Anna Kowalska"), ("marek", "Marek Nowak")):
        await _member(db, username, name)
    await create_user(db, "admin", role=UserRole.admin)
    await create_user(db, "koord", role=UserRole.coordinator)
    await create_user(db, "widz", role=UserRole.viewer)
    tymon = await _member(db, "tymczasowy", NAME)
    await create_published_schedule(
        db,
        starts_on=START,
        days=DAYS,
        primary=[NAME, "Anna Kowalska"],
        secondary=["Marek Nowak", NAME],
        late_shift=["Anna Kowalska", "Marek Nowak"],
    )
    members = {row.display_name: row.id for row in await db.scalars(select(TeamMember))}
    rows = (await db.scalars(select(Assignment).order_by(Assignment.service_date))).all()
    for row in rows:
        row.member_id = members[row.assignee_name]
    # Imported before the person was enrolled: the label is their only link.
    next(row for row in rows if row.assignee_name == NAME).member_id = None
    await db.commit()
    return tymon


def pseudonym(member_id: uuid.UUID) -> str:
    return f"Osoba usunięta #{member_id.hex[:6]}"


async def _visible(client: AsyncClient) -> dict[tuple[str, str], str]:
    pages = {}
    for username, names in PAGES.items():
        await login(client, username)
        for page in names:
            response = await client.get(URLS[page])
            assert response.status_code == 200, (username, page)
            pages[username, page] = response.text
    return pages


async def _balance(client: AsyncClient, name: str) -> dict:
    await login(client, "koord")
    fairness = (await client.get("/api/v1/fairness")).json()
    member = next(item for item in fairness["members"] if item["display_name"] == name)
    return {key: member[key] for key in ("primary", "secondary", "late_shift", "total_points")}


async def _delete(client: AsyncClient, account_id: uuid.UUID) -> int:
    await login(client, "admin")
    return (await client.delete(f"/api/v1/admin/users/{account_id}")).status_code


async def _names(db: AsyncSession) -> dict[uuid.UUID, str]:
    db.expire_all()
    return {row.id: row.display_name for row in await db.scalars(select(TeamMember))}


@pytest.mark.anyio
async def test_deletion_pseudonymises_the_member_everywhere_others_look(
    client: AsyncClient, db: AsyncSession
) -> None:
    member_id, account_id = await _world(db)
    assert all(NAME in text for text in (await _visible(client)).values())
    points = await _balance(client, NAME)

    assert await _delete(client, account_id) == 204

    for page, text in (await _visible(client)).items():
        assert NAME not in text, page
        assert pseudonym(member_id) in text, page
    assert await _balance(client, pseudonym(member_id)) == points
    member = await db.get(TeamMember, member_id)
    assert (member.display_name, member.user_id) == (pseudonym(member_id), None)
    labels = {row.assignee_name for row in await db.scalars(select(Assignment))}
    assert NAME not in labels and pseudonym(member_id) in labels


@pytest.mark.anyio
async def test_the_audit_trail_keeps_the_name_and_learns_the_pseudonym(
    client: AsyncClient, db: AsyncSession
) -> None:
    member_id, account_id = await _world(db)
    url = f"/api/v1/admin/team-members/{member_id}"
    await login(client, "admin")
    assert (await client.patch(url, json={"active_until": None})).status_code == 200

    assert await _delete(client, account_id) == 204
    assert (await client.patch(url, json={"active_until": None})).status_code == 200

    db.expire_all()
    updates = await db.scalars(
        select(AuditEvent.summary)
        .where(AuditEvent.action == "admin.team_member_updated")
        .order_by(AuditEvent.occurred_at)
    )
    # Written before the deletion and kept; written after it with the pseudonym.
    assert updates.all() == [
        f"Zaktualizowano okres rotacji: {NAME}",
        f"Zaktualizowano okres rotacji: {pseudonym(member_id)}",
    ]
    deleted = await db.scalar(select(AuditEvent).where(AuditEvent.action == "admin.user_deleted"))
    assert deleted.details == {"display_name": NAME, "pseudonym": pseudonym(member_id)}


@pytest.mark.anyio
async def test_deleting_again_changes_nothing_and_every_pseudonym_is_distinct(
    client: AsyncClient, db: AsyncSession
) -> None:
    tymon, tymon_account = await _world(db)
    ola, ola_account = await _member(db, "ola", "Ola Wiśniewska")

    assert await _delete(client, tymon_account) == 204
    assert await _delete(client, tymon_account) == 404
    assert await _delete(client, ola_account) == 204

    names = await _names(db)
    assert (names[tymon], names[ola]) == (pseudonym(tymon), pseudonym(ola))
    assert len(set(names.values())) == len(names)
    deletions = await db.scalars(
        select(AuditEvent.entity_id).where(AuditEvent.action == "admin.user_deleted")
    )
    assert sorted(deletions.all()) == sorted([str(tymon_account), str(ola_account)])


@pytest.mark.anyio
async def test_a_taken_pseudonym_falls_back_to_the_full_id(
    client: AsyncClient, db: AsyncSession
) -> None:
    member_id, account_id = await _world(db)
    await _member(db, "osoba", pseudonym(member_id))

    assert await _delete(client, account_id) == 204

    assert (await _names(db))[member_id] == f"Osoba usunięta #{member_id.hex}"


@pytest.mark.anyio
async def test_a_namesake_keeps_the_unlinked_history_that_may_be_theirs(
    client: AsyncClient, db: AsyncSession
) -> None:
    member_id, account_id = await _world(db)
    await _member(db, "tymon2", NAME)

    assert await _delete(client, account_id) == 204

    db.expire_all()
    unlinked = await db.scalars(
        select(Assignment.assignee_name).where(Assignment.member_id.is_(None))
    )
    assert set(unlinked.all()) == {NAME}
    linked = await db.scalars(
        select(Assignment.assignee_name).where(Assignment.member_id == member_id)
    )
    assert set(linked.all()) == {pseudonym(member_id)}
