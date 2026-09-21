"""Renaming a person must not detach them from their history.

Before `Assignment.member_id` existed, a duty was linked to a person only by the
denormalised `assignee_name`, so changing a surname silently emptied that
person's balance, monthly report and calendar feed. With AD as the source of
truth for names (decision E4), renames arrive on their own.
"""

from datetime import date, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.domain.vocabulary import AssignmentRole, UserRole
from oncall.fairness import FairnessDuty, FairnessMemberInput, compute_fairness
from oncall.infrastructure.sqlalchemy.scheduling_models import Assignment
from oncall.infrastructure.sqlalchemy.team_models import TeamMember
from tests.conftest import create_member, create_published_schedule, create_user, login

START = date.today() - timedelta(days=10)


async def _team(db: AsyncSession) -> None:
    for username, name in (
        ("anna", "Anna Kowalska"),
        ("marek", "Marek Nowak"),
        ("ola", "Ola Wiśniewska"),
    ):
        user = await create_user(db, username, display_name=name)
        await create_member(db, user, display_name=name)
    await create_user(db, "koord", role=UserRole.coordinator)


async def _link_assignments_to_members(db: AsyncSession) -> None:
    """What migration 0012 does on a real database."""
    members = {m.display_name: m.id for m in (await db.scalars(select(TeamMember))).all()}
    for assignment in (await db.scalars(select(Assignment))).all():
        assignment.member_id = members.get(assignment.assignee_name)
    await db.commit()


@pytest.mark.anyio
async def test_balance_survives_a_rename(client: AsyncClient, db: AsyncSession) -> None:
    await _team(db)
    await create_published_schedule(
        db,
        starts_on=START,
        days=8,
        primary=["Anna Kowalska"],
        secondary=["Marek Nowak"],
        late_shift=["Ola Wiśniewska"],
    )
    await _link_assignments_to_members(db)

    await login(client, "koord")
    before = (await client.get("/api/v1/fairness")).json()
    anna_before = next(m for m in before["members"] if m["display_name"] == "Anna Kowalska")
    assert anna_before["primary"]["actual"] > 0

    # She marries; AD sends the new surname.
    member = await db.scalar(select(TeamMember).where(TeamMember.display_name == "Anna Kowalska"))
    assert member is not None
    member.display_name = "Anna Nowak-Kowalska"
    await db.commit()

    after = (await client.get("/api/v1/fairness")).json()
    anna_after = next(m for m in after["members"] if m["display_name"] == "Anna Nowak-Kowalska")
    assert anna_after["primary"]["actual"] == anna_before["primary"]["actual"]
    assert anna_after["total_points"] == anna_before["total_points"]


@pytest.mark.anyio
async def test_monthly_report_survives_a_rename(client: AsyncClient, db: AsyncSession) -> None:
    await _team(db)
    await create_published_schedule(
        db,
        starts_on=date.today().replace(day=1),
        days=5,
        primary=["Anna Kowalska"],
        secondary=["Marek Nowak"],
        late_shift=["Ola Wiśniewska"],
    )
    await _link_assignments_to_members(db)
    await login(client, "koord")
    month = date.today().strftime("%Y-%m")

    before = (await client.get(f"/api/v1/reports/monthly.csv?month={month}")).text
    anna_row_before = next(line for line in before.splitlines() if "Anna Kowalska" in line)

    member = await db.scalar(select(TeamMember).where(TeamMember.display_name == "Anna Kowalska"))
    assert member is not None
    member.display_name = "Anna Nowak-Kowalska"
    await db.commit()

    after = (await client.get(f"/api/v1/reports/monthly.csv?month={month}")).text
    anna_row_after = next(line for line in after.splitlines() if "Anna Nowak-Kowalska" in line)
    # Same counts, only the label differs. Column 0 is the month, 1 the name.
    assert anna_row_after.split(",")[2:] == anna_row_before.split(",")[2:]
    assert any(int(value) > 0 for value in anna_row_after.split(",")[2:])


def test_duties_without_an_id_still_count_by_name() -> None:
    """Imported history names people who never had an account."""
    member = FairnessMemberInput(
        id=__import__("uuid").uuid4(),
        display_name="Anna Kowalska",
        active_from=date(2026, 1, 1),
        active_until=None,
        eligibility={role: [] for role in AssignmentRole},
    )
    duties = [
        # No member_id, as an imported row has.
        FairnessDuty(date(2026, 6, 1), AssignmentRole.primary, "Anna Kowalska"),
    ]
    report = compute_fairness(
        [member],
        duties,
        holidays=set(),
        window_start=date(2026, 1, 1),
        window_end=date(2026, 12, 31),
    )
    assert report.members[0].primary.actual == 1.0
