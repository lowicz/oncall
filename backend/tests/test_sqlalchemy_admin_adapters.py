"""The administration adapters on their own."""

from datetime import date, timedelta

import pytest
from sqlalchemy import func, select, update

from oncall.domain.admin import errors
from oncall.domain.admin.models import AccountRecord, NewEligibilityPeriod
from oncall.domain.vocabulary import AccountTokenKind
from oncall.infrastructure.sqlalchemy.admin import SqlAlchemyAccounts, SqlAlchemyRotation
from oncall.models import AccountToken, Assignment, AssignmentRole, User, UserRole
from tests.conftest import create_member, create_published_schedule, create_user

TODAY = date.today()


def _record(**changes) -> AccountRecord:
    values = {
        "username": "nowa",
        "personnel_number": None,
        "first_name": "Nowa",
        "last_name": "Osoba",
        "email": None,
        "phone": None,
        "role": UserRole.member,
    }
    return AccountRecord(**(values | changes))


async def test_a_login_stored_meanwhile_is_reported_as_taken(db) -> None:
    await create_user(db, "nowa")
    with pytest.raises(errors.UsernameTaken):
        await SqlAlchemyAccounts(db).open_account(_record())


async def test_a_personnel_number_stored_meanwhile_is_reported_as_taken(db) -> None:
    owner = await create_user(db, "inna")
    owner.personnel_number = "42"
    await db.commit()
    with pytest.raises(errors.PersonnelNumberTaken):
        await SqlAlchemyAccounts(db).open_account(_record(personnel_number="42"))


async def test_accounts_are_opened_and_tokens_issued_without_committing(db) -> None:
    accounts = SqlAlchemyAccounts(db)
    account = await accounts.open_account(_record())
    first = await accounts.issue_token(account.id, AccountTokenKind.activation, timedelta(hours=1))
    await accounts.issue_token(account.id, AccountTokenKind.activation, timedelta(hours=1))

    used = (await db.scalars(select(AccountToken.used_at).order_by(AccountToken.created_at))).all()
    assert [value is None for value in used] == [False, True]
    assert first.raw and first.kind == AccountTokenKind.activation
    await db.rollback()
    assert await db.scalar(select(func.count()).select_from(User)) == 0


async def test_admin_count_counts_only_active_admins(db) -> None:
    await create_user(db, "a1", role=UserRole.admin)
    retired = await create_user(db, "a2", role=UserRole.admin)
    retired.is_active = False
    await create_user(db, "k", role=UserRole.coordinator)
    await db.commit()
    assert await SqlAlchemyAccounts(db).active_admin_count() == 1


async def test_rotation_reads_duties_outside_a_span_and_renames_labels(db) -> None:
    user = await create_user(db, "ola", display_name="Ola Nowak")
    member = await create_member(db, user, display_name="Ola Nowak")
    await create_published_schedule(db, starts_on=TODAY, days=3, primary=["Ola Nowak"])
    await db.execute(update(Assignment).values(member_id=member.id))
    await db.commit()
    rotation = SqlAlchemyRotation(db)

    assert await rotation.published_duties(member.id) == []
    after = await rotation.published_duties(member.id, after=TODAY, limit=2)
    assert [day for day, _ in after] == [TODAY + timedelta(days=1)] * 2
    around = await rotation.published_duties(
        member.id,
        role=AssignmentRole.late_shift,
        before=TODAY + timedelta(days=1),
        after=TODAY + timedelta(days=1),
    )
    assert [day for day, _ in around] == [TODAY, TODAY + timedelta(days=2)]

    await rotation.rename_member(member.id, "Aleksandra Nowak")
    await db.commit()
    labels = set((await db.scalars(select(Assignment.assignee_name))).all())
    assert labels == {"Aleksandra Nowak"}


async def test_rotation_grants_and_changes_periods(db) -> None:
    user = await create_user(db, "ola", display_name="Ola Nowak")
    member = await create_member(db, user, display_name="Ola Nowak", active_from=TODAY)
    rotation = SqlAlchemyRotation(db)
    later = TODAY + timedelta(days=400)

    assert await rotation.overlapping_period_exists(member.id, AssignmentRole.primary, later, None)
    period = await rotation.grant(
        NewEligibilityPeriod(member.id, AssignmentRole.primary, TODAY - timedelta(days=9), TODAY)
    )
    assert await rotation.overlapping_period_exists(
        member.id, AssignmentRole.primary, TODAY - timedelta(days=9), TODAY - timedelta(days=1)
    )
    assert not await rotation.overlapping_period_exists(
        member.id,
        AssignmentRole.primary,
        TODAY - timedelta(days=9),
        TODAY - timedelta(days=1),
        other_than=period.id,
    )
    changed = await rotation.change_period(period.id, {"ends_on": TODAY - timedelta(days=1)})
    await db.commit()
    assert (await rotation.period(period.id)).ends_on == changed.ends_on
    held = await rotation.member_for_change(member.id)
    assert len(held.eligibility) == len(AssignmentRole) + 1
    await rotation.revoke(period.id)
    await db.commit()
    assert await rotation.period(period.id) is None
