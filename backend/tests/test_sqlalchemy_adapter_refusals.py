"""The SQLAlchemy adapters off their main path: a constraint another request
won, a row still referenced, a read of something never staged, and an
account that is not in the rotation."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from oncall.audit import record_audit
from oncall.domain.admin import errors
from oncall.domain.admin.models import AccountRecord
from oncall.domain.clock import business_today
from oncall.domain.swaps.models import SwapRequest
from oncall.domain.vocabulary import AssignmentRole, AvailabilityKind, SwapStatus, UserRole
from oncall.infrastructure.sqlalchemy.access import SqlAlchemyAccessAccounts
from oncall.infrastructure.sqlalchemy.access_models import User
from oncall.infrastructure.sqlalchemy.admin import SqlAlchemyAccounts, SqlAlchemyRotation
from oncall.infrastructure.sqlalchemy.audit_model import AuditEvent
from oncall.infrastructure.sqlalchemy.availability import SqlAlchemyAvailability
from oncall.infrastructure.sqlalchemy.availability_model import Availability
from oncall.infrastructure.sqlalchemy.history import SqlAlchemyHistory
from oncall.infrastructure.sqlalchemy.sharing import SqlAlchemyShareLinks
from oncall.infrastructure.sqlalchemy.sharing_models import ShareLink
from oncall.infrastructure.sqlalchemy.swaps import SqlAlchemySwapRequests
from oncall.infrastructure.sqlalchemy.team_models import TeamMember
from tests.conftest import create_member, create_user, login

TODAY = business_today()


async def test_a_constraint_without_a_domain_answer_surfaces_as_the_database_error(db) -> None:
    """Only a login or personnel number lost to a concurrent request has a
    domain answer; any other constraint is not the adapter's to explain."""
    accounts = SqlAlchemyAccounts(db)
    nameless = AccountRecord(
        username="nowa",
        personnel_number="7",
        first_name=None,  # type: ignore[arg-type]
        last_name="Osoba",
        email=None,
        phone=None,
        role=UserRole.member,
    )

    with pytest.raises(IntegrityError, match="first_name"):
        await accounts.open_account(nameless)


async def test_an_account_that_created_a_share_link_cannot_be_closed(db) -> None:
    author = await create_user(db, "autor", role=UserRole.admin)
    author_id = author.id
    db.add(
        ShareLink(
            token_hash="a" * 64,
            label="Gość",
            starts_on=TODAY,
            ends_on=TODAY,
            expires_at=datetime.now(UTC) + timedelta(days=1),
            created_by_id=author_id,
        )
    )
    await db.commit()
    accounts = SqlAlchemyAccounts(db)

    with pytest.raises(errors.AccountStillReferenced) as refused:
        await accounts.close_account(author_id)

    assert refused.value.account_id == author_id
    await db.rollback()
    assert await db.scalar(select(func.count()).select_from(User)) == 1


async def test_an_account_enrolled_meanwhile_is_reported_as_in_the_rotation(db) -> None:
    user = await create_user(db, "ola", display_name="Ola Nowak")
    await create_member(db, user, display_name="Ola Nowak")
    account = await SqlAlchemyAccounts(db).account(user.id)
    assert account is not None
    rotation = SqlAlchemyRotation(db)

    with pytest.raises(errors.AccountAlreadyInRotation) as refused:
        await rotation.enrol(account, TODAY)

    assert refused.value.account_id == account.id
    await db.rollback()
    assert await db.scalar(select(func.count()).select_from(TeamMember)) == 1


async def test_the_audit_trail_filters_by_part_of_the_actors_name(client, db) -> None:
    admin = await create_user(db, "admin", role=UserRole.admin, display_name="Ada Admin")
    record_audit(db, actor=admin, action="swap.created", summary="od Ady")
    record_audit(db, actor=None, action="swap.created", summary="od systemu")
    await db.commit()
    await login(client, "admin")

    found = await client.get("/api/v1/admin/audit", params={"actor": "ada"})

    assert found.status_code == 200, found.text
    assert [(item["actor_label"], item["summary"]) for item in found.json()] == [
        ("Ada Admin", "od Ady")
    ]


async def test_availability_entries_are_bounded_by_the_end_of_the_range(db) -> None:
    user = await create_user(db, "ola", display_name="Ola Nowak")
    member = await create_member(db, user, display_name="Ola Nowak")
    for offset in (0, 10):
        day = TODAY + timedelta(days=offset)
        db.add(
            Availability(
                member_id=member.id,
                kind=AvailabilityKind.unavailable,
                starts_on=day,
                ends_on=day,
            )
        )
    await db.commit()
    ledger = SqlAlchemyAvailability(db, user)

    entries = await ledger.entries(member.id, None, TODAY + timedelta(days=5))

    assert [item.starts_on for item in entries] == [TODAY]


async def test_nothing_staged_cannot_be_read_back(db) -> None:
    user = await create_user(db, "koord", role=UserRole.coordinator)
    availability = SqlAlchemyAvailability(db, user)
    history = SqlAlchemyHistory(db, user)
    share_links = SqlAlchemyShareLinks(db, user)

    with pytest.raises(LookupError, match="no availability entry was recorded"):
        await availability.recorded_entry()
    with pytest.raises(LookupError, match="no history import was staged"):
        await history.staged_import_id()
    with pytest.raises(LookupError, match="no share link was staged"):
        await share_links.staged_link()


async def test_a_decision_on_a_request_that_is_not_stored_is_refused(db) -> None:
    missing = SwapRequest(
        id=uuid.uuid4(),
        schedule_id=uuid.uuid4(),
        service_date=TODAY,
        role=AssignmentRole.primary,
        requester_member_id=uuid.uuid4(),
        replacement_member_id=uuid.uuid4(),
        status=SwapStatus.cancelled,
        schedule_version=1,
        note=None,
        decision_note="nie",
        created_at=datetime.now(UTC),
        slots=((TODAY, AssignmentRole.primary),),
    )
    swap_requests = SqlAlchemySwapRequests(db)
    expected = str(missing.id)

    with pytest.raises(LookupError, match=expected):
        await swap_requests.record_decision(missing)


def test_a_blank_display_name_is_refused() -> None:
    user = User(username="x")
    user.display_name = "  Jan   Maria  Kowalski "
    assert (user.first_name, user.last_name) == ("Jan", "Maria Kowalski")

    with pytest.raises(ValueError, match="Imię nie może być puste"):
        user.display_name = "   "


async def test_a_directory_sync_of_an_account_outside_the_rotation_renames_only_it(db) -> None:
    user = await create_user(db, "jan", display_name="Jan Nowak")

    synced = await SqlAlchemyAccessAccounts(db).update_from_directory(
        user.id, {"last_name": "Kowalski", "email": "jan@example.com"}
    )
    await db.commit()

    assert (synced.display_name, synced.email) == ("Jan Kowalski", "jan@example.com")
    assert await db.scalar(select(func.count()).select_from(TeamMember)) == 0


async def test_deleting_an_account_never_in_the_rotation_records_no_pseudonym(client, db) -> None:
    await create_user(db, "admin", role=UserRole.admin)
    guest = await create_user(db, "gosc", display_name="Gość Konto")
    await login(client, "admin")

    response = await client.delete(f"/api/v1/admin/users/{guest.id}")

    assert response.status_code == 204, response.text
    deleted = await db.scalar(select(AuditEvent).where(AuditEvent.action == "admin.user_deleted"))
    assert deleted is not None
    assert deleted.details == {"display_name": "Gość Konto"}
