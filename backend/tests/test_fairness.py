import uuid
from datetime import date, timedelta

from oncall.fairness import (
    EligibilityPeriod,
    FairnessDuty,
    FairnessMemberInput,
    compute_fairness,
    day_weight,
    duty_points,
)
from oncall.models import AssignmentRole, UserRole
from tests.conftest import (
    create_member,
    create_published_schedule,
    create_user,
    login,
)

START = date(2026, 1, 1)
END = date(2026, 12, 31)
EPIPHANY = date(2026, 1, 6)  # Tuesday, Polish statutory holiday
HOLIDAYS = {EPIPHANY}


def member(
    name: str,
    *,
    active_from: date = START,
    active_until: date | None = None,
    eligibility: dict | None = None,
) -> FairnessMemberInput:
    if eligibility is None:
        eligibility = {role: [EligibilityPeriod(START, None)] for role in AssignmentRole}
    return FairnessMemberInput(
        id=uuid.uuid4(),
        display_name=name,
        active_from=active_from,
        active_until=active_until,
        eligibility=eligibility,
    )


def duty(day: date, role: AssignmentRole, name: str) -> FairnessDuty:
    return FairnessDuty(service_date=day, role=role, assignee_name=name)


def test_day_weight_counts_2x_without_cumulating() -> None:
    assert day_weight(date(2026, 1, 2), HOLIDAYS) == 1.0  # Friday
    assert day_weight(date(2026, 1, 3), HOLIDAYS) == 2.0  # Saturday
    assert day_weight(date(2026, 1, 4), HOLIDAYS) == 2.0  # Sunday
    assert day_weight(EPIPHANY, HOLIDAYS) == 2.0  # holiday on a weekday
    corpus_christi_weekend = date(2026, 8, 15)  # Saturday, Assumption
    assert day_weight(corpus_christi_weekend, {corpus_christi_weekend}) == 2.0


def test_balances_are_separate_per_category() -> None:
    anna = member("Anna")
    marek = member("Marek")
    duties = [
        duty(date(2026, 1, 2), AssignmentRole.primary, "Anna"),  # Fri, 1 pt
        duty(date(2026, 1, 3), AssignmentRole.primary, "Marek"),  # Sat, 2 pts + weekend
        duty(date(2026, 1, 4), AssignmentRole.secondary, "Anna"),  # Sun, 2 pts + weekend
        duty(EPIPHANY, AssignmentRole.primary, "Anna"),  # holiday, 2 pts + holiday
        duty(date(2026, 1, 5), AssignmentRole.late_shift, "Anna"),  # 1 late shift
    ]
    report = compute_fairness(
        [anna, marek], duties, holidays=HOLIDAYS, window_start=START, window_end=END
    )
    by_name = {row.display_name: row for row in report.members}
    assert by_name["Anna"].primary.actual == 3.0
    assert by_name["Anna"].secondary.actual == 2.0
    assert by_name["Anna"].late_shift.actual == 1.0
    assert by_name["Anna"].weekends.actual == 1.0
    assert by_name["Anna"].holidays.actual == 1.0
    assert by_name["Anna"].total_points == 6.0
    assert by_name["Marek"].primary.actual == 2.0
    assert by_name["Marek"].weekends.actual == 1.0
    assert by_name["Marek"].holidays.actual == 0.0
    assert report.totals == {
        "primary_points": 5.0,
        "secondary_points": 2.0,
        "late_shift_count": 1.0,
        "weekend_duties": 2.0,
        "holiday_duties": 1.0,
    }


def test_expected_share_is_proportional_to_eligibility() -> None:
    half = START + timedelta(days=(END - START).days // 2)
    anna = member("Anna")  # eligible the whole window
    marek = member(
        "Marek",
        eligibility={
            AssignmentRole.primary: [EligibilityPeriod(START, half)],
            AssignmentRole.secondary: [EligibilityPeriod(START, None)],
            AssignmentRole.late_shift: [EligibilityPeriod(START, None)],
        },
    )
    duties = [duty(date(2026, 6, 1), AssignmentRole.primary, "Anna")]
    report = compute_fairness(
        [anna, marek], duties, holidays=HOLIDAYS, window_start=START, window_end=END
    )
    by_name = {row.display_name: row for row in report.members}
    anna_days = by_name["Anna"].eligible_days["primary"]
    marek_days = by_name["Marek"].eligible_days["primary"]
    assert marek_days < anna_days
    assert by_name["Anna"].primary.expected > by_name["Marek"].primary.expected
    assert by_name["Anna"].primary.deviation == round(1 - by_name["Anna"].primary.expected, 2)


def test_member_without_eligibility_has_zero_expected() -> None:
    anna = member("Anna")
    marek = member(
        "Marek",
        eligibility={AssignmentRole.secondary: [EligibilityPeriod(START, None)]},
    )
    duties = [duty(date(2026, 3, 2), AssignmentRole.primary, "Marek")]
    report = compute_fairness(
        [anna, marek], duties, holidays=HOLIDAYS, window_start=START, window_end=END
    )
    by_name = {row.display_name: row for row in report.members}
    assert by_name["Marek"].primary.expected == 0.0
    assert by_name["Marek"].primary.deviation == 1.0
    # Anna covers 100% of the eligible pool but served nothing: deviation -1.
    assert by_name["Anna"].primary.deviation == -1.0


def test_window_clips_duties_and_eligibility() -> None:
    active_mid = START + timedelta(days=100)
    anna = member("Anna", active_from=active_mid)
    duties = [
        # Actual duties count whenever they happened; activity windows only
        # shape the expected share, never hide recorded history.
        duty(date(2026, 1, 2), AssignmentRole.primary, "Anna"),  # Friday, 1 pt
        duty(active_mid + timedelta(days=3), AssignmentRole.primary, "Anna"),  # Mon, 1 pt
        duty(START - timedelta(days=30), AssignmentRole.primary, "Anna"),  # outside window
    ]
    report = compute_fairness([anna], duties, holidays=HOLIDAYS, window_start=START, window_end=END)
    row = report.members[0]
    assert row.primary.actual == 2.0
    assert row.eligible_days["primary"] == (END - active_mid).days + 1


def test_member_active_until_mid_window_stops_eligibility() -> None:
    active_until = START + timedelta(days=99)
    anna = member("Anna", active_until=active_until)
    report = compute_fairness([anna], [], holidays=HOLIDAYS, window_start=START, window_end=END)
    assert report.members[0].eligible_days["primary"] == 100


def test_duty_points_drilldown() -> None:
    duties = [
        duty(date(2026, 1, 2), AssignmentRole.primary, "Anna"),
        duty(date(2026, 1, 3), AssignmentRole.primary, "Anna"),
        duty(date(2026, 1, 4), AssignmentRole.secondary, "Marek"),
    ]
    rows = duty_points(
        duties, assignee_name="Anna", holidays=HOLIDAYS, window_start=START, window_end=END
    )
    assert [row[0] for row in rows] == [date(2026, 1, 3), date(2026, 1, 2)]
    assert rows[0][2] == 2.0 and rows[0][3] is True
    assert rows[1][2] == 1.0 and rows[1][3] is False


async def _seed_fairness(db):
    today = date.today()
    anna = await create_user(db, "anna", email="a@x.com", display_name="Anna Kowalska")
    marek = await create_user(db, "marek", email="m@x.com", display_name="Marek Nowak")
    anna_member = await create_member(db, anna, display_name="Anna Kowalska")
    await create_member(db, marek, display_name="Marek Nowak")
    await create_published_schedule(
        db,
        starts_on=today - timedelta(days=6),
        days=7,
        primary=["Anna Kowalska", "Marek Nowak"],
        secondary=["Marek Nowak", "Anna Kowalska"],
        late_shift=["Anna Kowalska"],
    )
    return anna_member


async def test_coordinator_sees_all_members_member_sees_only_self(client, db) -> None:
    own = await _seed_fairness(db)
    await create_user(db, "admin", role=UserRole.admin)
    await login(client, "admin")
    report = (await client.get("/api/v1/fairness")).json()
    assert len(report["members"]) == 2
    assert report["totals"]["primary_points"] > 0
    names = {row["display_name"] for row in report["members"]}
    assert names == {"Anna Kowalska", "Marek Nowak"}

    guest = client.__class__(transport=client._transport, base_url="http://test")
    await login(guest, "anna")
    own_report = (await guest.get("/api/v1/fairness")).json()
    assert [row["display_name"] for row in own_report["members"]] == ["Anna Kowalska"]

    duties = (await guest.get("/api/v1/fairness/duties", params={"member_id": str(own.id)})).json()
    assert duties
    assert all(item["service_date"] for item in duties)


async def test_latest_publish_end_is_not_capped_to_the_90_day_publish_horizon(client, db) -> None:
    """QA7 par. 8, C2 review: `/schedules/published` caps `ends_on` at today +
    90 days by design (LOW6-08), so the fairness screen cannot use it to find
    the real end of a longer publication; the report carries it directly."""
    await _seed_fairness(db)
    today = date.today()
    far_end = today + timedelta(days=120)
    await create_published_schedule(
        db,
        starts_on=today + timedelta(days=100),
        days=1,
        primary=["Anna Kowalska"],
    )
    await create_published_schedule(
        db,
        starts_on=far_end,
        days=1,
        primary=["Anna Kowalska"],
    )
    await create_user(db, "admin", role=UserRole.admin)
    await login(client, "admin")
    report = (await client.get("/api/v1/fairness")).json()
    assert report["latest_publish_end"] == far_end.isoformat()


async def test_viewer_cannot_read_fairness(client, db) -> None:
    await _seed_fairness(db)
    await create_user(db, "viewer", role=UserRole.viewer)
    await login(client, "viewer")
    assert (await client.get("/api/v1/fairness")).status_code == 403


async def test_member_cannot_drill_into_someone_else(client, db) -> None:
    own = await _seed_fairness(db)
    await login(client, "anna")
    other = own.id  # Anna's own id is fine...
    response = await client.get("/api/v1/fairness/duties", params={"member_id": str(uuid.uuid4())})
    assert response.status_code == 403
    assert other is not None


async def test_drilldown_unknown_member_404_for_coordinator(client, db) -> None:
    await _seed_fairness(db)
    await create_user(db, "admin", role=UserRole.admin)
    await login(client, "admin")
    response = await client.get("/api/v1/fairness/duties", params={"member_id": str(uuid.uuid4())})
    assert response.status_code == 404
