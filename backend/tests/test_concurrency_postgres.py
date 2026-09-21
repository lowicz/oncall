"""Concurrent writes against a real PostgreSQL.

SQLite serialises writers, so the in-memory suite cannot show what two
simultaneous requests do to shared state. These tests run the ASGI app against
PostgreSQL and hold the first request inside its transaction (a slowed-down
notification enqueue, just before the commit) while the second one runs.

Skipped unless ``ONCALL_TEST_POSTGRES_URL`` points at a disposable database,
e.g. ``postgresql+asyncpg://test:test@127.0.0.1:55432/oncall_test``. The
schema in that database is dropped and recreated.
"""

import asyncio
import os
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, date, datetime, timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select, text, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from oncall import effective
from oncall.auth import token_hash
from oncall.config import get_settings
from oncall.database import SqlAlchemyUnitOfWork, get_db
from oncall.domain.scheduling.generation import (
    ABANDONED_RUN_ERROR,
    queue_health,
    recover_abandoned_runs,
)
from oncall.domain.scheduling.models import RunState
from oncall.domain.vocabulary import (
    AccountTokenKind,
    AssignmentRole,
    ScheduleStatus,
    SwapStatus,
    UserRole,
)
from oncall.infrastructure.sqlalchemy.access_models import AccountToken, User
from oncall.infrastructure.sqlalchemy.audit_model import AuditEvent
from oncall.infrastructure.sqlalchemy.availability_model import Availability
from oncall.infrastructure.sqlalchemy.base import Base
from oncall.infrastructure.sqlalchemy.notification_models import (
    NotificationOutbox,
    NotificationStatus,
)
from oncall.infrastructure.sqlalchemy.scheduling_generation import (
    SqlAlchemyGenerationQueue,
    SqlAlchemyRunClaims,
)
from oncall.infrastructure.sqlalchemy.scheduling_models import Assignment, Schedule, ScheduleRun
from oncall.infrastructure.sqlalchemy.sharing_models import ShareLink
from oncall.infrastructure.sqlalchemy.swap_models import SwapRequest
from oncall.infrastructure.sqlalchemy.team_models import Eligibility, TeamMember
from oncall.main import app
from oncall.notifications import triggers
from oncall.notifications.base import NotificationMessage
from oncall.notifications.service import drain_outbox, enqueue_notification, outbox_health
from oncall.policy import load_policy
from oncall.workdays import is_working_day, polish_holidays
from oncall.worker import CLAIMED_PROGRESS, _claim_run, process_schedule_run
from tests.conftest import (
    create_member,
    create_published_schedule,
    create_user,
    login,
    staged_draft,
)

POSTGRES_URL = os.environ.get("ONCALL_TEST_POSTGRES_URL")
pytestmark = pytest.mark.skipif(not POSTGRES_URL, reason="ONCALL_TEST_POSTGRES_URL is not set")

#: How long the first request stays inside its transaction.
HOLD_SECONDS = 0.5


@pytest.fixture
async def pg_factory(monkeypatch) -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(POSTGRES_URL, pool_size=10)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.drop_all)
        await connection.run_sync(Base.metadata.create_all)
    # Every read must see the database as it is, not a cached resolution.
    monkeypatch.setattr(get_settings(), "effective_assignments_cache_seconds", 0)
    effective._effective_cache.clear()
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def override_get_db() -> AsyncIterator[AsyncSession]:
        async with SqlAlchemyUnitOfWork(factory) as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    yield factory
    app.dependency_overrides.clear()
    await engine.dispose()


@pytest.fixture
async def pg(pg_factory) -> AsyncIterator[AsyncSession]:
    async with pg_factory() as session:
        yield session


async def _client(username: str) -> AsyncClient:
    client = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    await login(client, username)
    return client


def _hold(monkeypatch, name: str) -> None:
    """Slow down one trigger so the request calling it stays mid-transaction."""
    original = getattr(triggers, name)

    async def held(*args, **kwargs):
        await asyncio.sleep(HOLD_SECONDS)
        return await original(*args, **kwargs)

    monkeypatch.setattr(triggers, name, held)


def _hold_commits(monkeypatch) -> None:
    """Hold every commit, for code paths that notify nobody: both requests
    finish their checks before either one writes, unless a lock makes the
    second wait for the first."""
    original = AsyncSession.commit

    async def held(self):
        await asyncio.sleep(HOLD_SECONDS)
        return await original(self)

    monkeypatch.setattr(AsyncSession, "commit", held)


class _RecordingProvider:
    """Remembers what it was handed, so two lanes can be compared."""

    channel = "email"

    def __init__(self) -> None:
        self.sent: list[NotificationMessage] = []

    async def send(self, message: NotificationMessage) -> None:
        self.sent.append(message)


def _first_weekday(offset_days: int) -> date:
    day = date.today() + timedelta(days=offset_days)
    while day.weekday() >= 5:
        day += timedelta(days=1)
    return day


async def _roster(pg: AsyncSession) -> dict:
    """Three people carry a published fortnight; two colleagues hold nothing,
    so taking one extra duty breaks no rule for either of them."""
    names = {}
    for username, display_name, role in (
        ("anna", "Anna", UserRole.member),
        ("bartek", "Bartek", UserRole.member),
        ("celina", "Celina", UserRole.member),
        ("dawid", "Dawid", UserRole.member),
        ("ewa", "Ewa", UserRole.member),
        ("koord1", "Koordynator Jeden", UserRole.coordinator),
        ("koord2", "Koordynator Dwa", UserRole.coordinator),
    ):
        user = await create_user(pg, username, role=role, display_name=display_name)
        if role == UserRole.member:
            names[username] = await create_member(pg, user, display_name=display_name)
    starts_on = _first_weekday(7)
    schedule = await create_published_schedule(
        pg,
        starts_on=starts_on,
        days=14,
        primary=["Anna", "Bartek", "Celina"],
        secondary=["Bartek", "Celina", "Anna"],
    )
    return {"members": names, "schedule": schedule, "day": starts_on}


async def _swap_waiting_for_coordinator(roster: dict) -> str:
    anna = await _client("anna")
    dawid = await _client("dawid")
    try:
        created = await anna.post(
            "/api/v1/swaps",
            json={
                "schedule_id": str(roster["schedule"].id),
                "service_date": roster["day"].isoformat(),
                "role": "primary",
                "replacement_member_id": str(roster["members"]["dawid"].id),
            },
        )
        assert created.status_code == 201, created.text
        swap_id = created.json()["id"]
        accepted = await dawid.post(f"/api/v1/swaps/{swap_id}/accept")
        assert accepted.status_code == 200, accepted.text
        return swap_id
    finally:
        await anna.aclose()
        await dawid.aclose()


async def test_two_coordinators_approving_one_swap_approve_it_once(pg, monkeypatch) -> None:
    roster = await _roster(pg)
    swap_id = await _swap_waiting_for_coordinator(roster)
    _hold(monkeypatch, "notify_swap_approved")
    first, second = await _client("koord1"), await _client("koord2")
    try:
        responses = await asyncio.gather(
            first.post(f"/api/v1/swaps/{swap_id}/approve"),
            second.post(f"/api/v1/swaps/{swap_id}/approve"),
        )
    finally:
        await first.aclose()
        await second.aclose()

    assert sorted(item.status_code for item in responses) == [200, 409], [
        item.text for item in responses
    ]
    refused = next(item for item in responses if item.status_code == 409)
    assert refused.json()["detail"] == "Zamiana nie oczekuje na koordynatora"
    approvals = await pg.scalar(
        select(func.count()).select_from(AuditEvent).where(AuditEvent.action == "swap.approved")
    )
    assert approvals == 1
    version = await pg.scalar(select(Schedule.version).where(Schedule.id == roster["schedule"].id))
    assert version == 2


async def test_two_requests_for_one_slot_leave_one_active_swap(pg, monkeypatch) -> None:
    roster = await _roster(pg)
    _hold(monkeypatch, "notify_swap_requested")
    anna = await _client("anna")
    try:
        responses = await asyncio.gather(
            *(
                anna.post(
                    "/api/v1/swaps",
                    json={
                        "schedule_id": str(roster["schedule"].id),
                        "service_date": roster["day"].isoformat(),
                        "role": "primary",
                        "replacement_member_id": str(roster["members"][name].id),
                    },
                )
                for name in ("dawid", "ewa")
            )
        )
    finally:
        await anna.aclose()

    assert sorted(item.status_code for item in responses) == [201, 409], [
        item.text for item in responses
    ]
    refused = next(item for item in responses if item.status_code == 409)
    assert refused.json()["detail"] == "Dla tego slotu istnieje aktywna zamiana"
    active = await pg.scalar(
        select(func.count())
        .select_from(SwapRequest)
        .where(SwapRequest.status == SwapStatus.pending_replacement)
    )
    assert active == 1


async def test_two_overlapping_declarations_store_one_entry(pg, monkeypatch) -> None:
    roster = await _roster(pg)
    ewa = roster["members"]["ewa"]
    _hold(monkeypatch, "notify_availability_created_on_behalf")
    first, second = await _client("koord1"), await _client("koord2")
    day = date.today() + timedelta(days=30)
    try:
        responses = await asyncio.gather(
            *(
                client.post(
                    f"/api/v1/availability/members/{ewa.id}",
                    json={
                        "kind": "prefer_not",
                        "starts_on": (day + timedelta(days=shift)).isoformat(),
                        "ends_on": (day + timedelta(days=shift + 3)).isoformat(),
                    },
                )
                for client, shift in ((first, 0), (second, 1))
            )
        )
    finally:
        await first.aclose()
        await second.aclose()

    assert sorted(item.status_code for item in responses) == [201, 409], [
        item.text for item in responses
    ]
    refused = next(item for item in responses if item.status_code == 409)
    assert refused.json()["detail"] == "Zakres nakłada się na istniejący wpis dostępności"
    entries = await pg.scalar(
        select(func.count()).select_from(Availability).where(Availability.member_id == ewa.id)
    )
    assert entries == 1


async def _proposal_over(pg: AsyncSession, roster: dict) -> Schedule:
    """A complete proposal for the published fortnight, same rotation."""
    starts_on = roster["day"]
    ends_on = starts_on + timedelta(days=13)
    holidays = polish_holidays(starts_on, ends_on)
    proposal = Schedule(
        name="Szkic wyścigu",
        starts_on=starts_on,
        ends_on=ends_on,
        status=ScheduleStatus.proposed,
    )
    rotation = ["Anna", "Bartek", "Celina"]
    for offset in range(14):
        day = starts_on + timedelta(days=offset)
        holders = {
            AssignmentRole.primary: rotation[offset % 3],
            AssignmentRole.secondary: rotation[(offset + 1) % 3],
        }
        if is_working_day(day, holidays):
            holders[AssignmentRole.late_shift] = holders[AssignmentRole.secondary]
        for role, name in holders.items():
            proposal.assignments.append(Assignment(service_date=day, role=role, assignee_name=name))
    pg.add(proposal)
    await pg.commit()
    return proposal


@pytest.mark.parametrize("held", ["approval", "publication"])
async def test_approval_and_publication_of_the_same_days_never_deadlock(
    pg, monkeypatch, held
) -> None:
    """Both take the swap row before the published schedule row, so whichever
    holds its transaction open, the other waits instead of deadlocking."""
    roster = await _roster(pg)
    swap_id = await _swap_waiting_for_coordinator(roster)
    proposal = await _proposal_over(pg, roster)
    _hold(
        monkeypatch, "notify_swap_approved" if held == "approval" else "notify_schedule_published"
    )
    first, second = await _client("koord1"), await _client("koord2")

    async def approve():
        if held == "publication":
            await asyncio.sleep(HOLD_SECONDS / 3)
        return await first.post(f"/api/v1/swaps/{swap_id}/approve")

    async def publish():
        if held == "approval":
            await asyncio.sleep(HOLD_SECONDS / 3)
        return await second.post(
            f"/api/v1/scheduling/{proposal.id}/publish",
            json={
                "expected_version": 1,
                "acknowledge_lost_changes": True,
                "acknowledge_gap": True,
                "acknowledge_rest_violations": True,
            },
        )

    try:
        approval, publication = await asyncio.gather(approve(), publish())
    finally:
        await first.aclose()
        await second.aclose()

    assert publication.status_code == 200, publication.text
    if held == "publication":
        # The publication cancelled the pending request before approval read it.
        assert approval.status_code == 409, approval.text
        assert approval.json()["detail"] == "Zamiana nie oczekuje na koordynatora"
    else:
        # Known and unchanged by the domain refactor: `publish_schedule` builds
        # its preview before it locks the pending swaps, so it still cancels the
        # request approved meanwhile and publishes the draft's holder over it.
        # Only the absence of a deadlock is asserted here.
        assert approval.status_code == 200, approval.text
    retired = await pg.scalar(select(Schedule.status).where(Schedule.id == roster["schedule"].id))
    assert retired == ScheduleStatus.superseded


async def test_approval_racing_an_override_never_undoes_the_override(pg, monkeypatch) -> None:
    roster = await _roster(pg)
    swap_id = await _swap_waiting_for_coordinator(roster)
    schedule_id = roster["schedule"].id
    version = await pg.scalar(select(Schedule.version).where(Schedule.id == schedule_id))
    ewa = roster["members"]["ewa"]
    _hold(monkeypatch, "notify_assignment_overridden")
    first, second = await _client("koord1"), await _client("koord2")

    async def approve_after_override_started():
        await asyncio.sleep(HOLD_SECONDS / 3)
        return await second.post(f"/api/v1/swaps/{swap_id}/approve")

    try:
        override, approval = await asyncio.gather(
            first.post(
                "/api/v1/calendar/override",
                json={
                    "schedule_id": str(schedule_id),
                    "expected_version": version,
                    "service_date": roster["day"].isoformat(),
                    "role": "primary",
                    "replacement_member_id": str(ewa.id),
                    "reason": "Korekta w trakcie zatwierdzania zamiany",
                },
            ),
            approve_after_override_started(),
        )
    finally:
        await first.aclose()
        await second.aclose()

    assert override.status_code == 200, override.text
    assert approval.status_code == 409, approval.text
    assert approval.json()["detail"] == (
        "Slot zmienił właściciela; prośba została automatycznie anulowana"
    )
    holder = await pg.scalar(
        select(TeamMember.display_name)
        .join(Assignment, Assignment.member_id == TeamMember.id)
        .where(
            Assignment.schedule_id == schedule_id,
            Assignment.service_date == roster["day"],
            Assignment.role == AssignmentRole.primary,
        )
    )
    assert holder == "Ewa"
    swap_status = await pg.scalar(select(SwapRequest.status).where(SwapRequest.id == swap_id))
    assert swap_status == SwapStatus.cancelled


async def test_two_admins_demoting_each_other_leave_one_active_admin(pg, monkeypatch) -> None:
    for username in ("admin1", "admin2"):
        await create_user(pg, username, role=UserRole.admin)
    ids = dict((await pg.execute(select(User.username, User.id))).all())
    first, second = await _client("admin1"), await _client("admin2")
    _hold_commits(monkeypatch)
    try:
        responses = await asyncio.gather(
            first.patch(f"/api/v1/admin/users/{ids['admin2']}", json={"role": "member"}),
            second.patch(f"/api/v1/admin/users/{ids['admin1']}", json={"is_active": False}),
        )
    finally:
        await first.aclose()
        await second.aclose()

    assert sorted(item.status_code for item in responses) == [200, 409], [
        item.text for item in responses
    ]
    refused = next(item for item in responses if item.status_code == 409)
    assert refused.json()["detail"] == (
        "Nie można wyłączyć ani zdegradować ostatniego aktywnego administratora"
    )
    active_admins = await pg.scalar(
        select(func.count())
        .select_from(User)
        .where(User.role == UserRole.admin, User.is_active.is_(True))
    )
    assert active_admins == 1


async def test_two_overlapping_eligibility_grants_store_one_period(pg, monkeypatch) -> None:
    for username in ("admin1", "admin2"):
        await create_user(pg, username, role=UserRole.admin)
    person = await create_user(pg, "osoba", display_name="Ola Nowak")
    member = TeamMember(user_id=person.id, display_name="Ola Nowak", active_from=date.today())
    pg.add(member)
    await pg.commit()
    first, second = await _client("admin1"), await _client("admin2")
    _hold_commits(monkeypatch)
    url = f"/api/v1/admin/team-members/{member.id}/eligibility"
    try:
        responses = await asyncio.gather(
            *(
                client.post(
                    url,
                    json={
                        "role": "primary",
                        "starts_on": (date.today() + timedelta(days=shift)).isoformat(),
                    },
                )
                for client, shift in ((first, 0), (second, 5))
            )
        )
    finally:
        await first.aclose()
        await second.aclose()

    assert sorted(item.status_code for item in responses) == [201, 409], [
        item.text for item in responses
    ]
    refused = next(item for item in responses if item.status_code == 409)
    assert refused.json()["detail"] == "Okres eligibility nakłada się na istniejący okres tej roli"
    periods = await pg.scalar(
        select(func.count()).select_from(Eligibility).where(Eligibility.member_id == member.id)
    )
    assert periods == 1


async def test_deleting_an_account_other_rows_point_at_is_refused(pg) -> None:
    """Foreign keys hold only on PostgreSQL, so this answer is pinned here."""
    from datetime import UTC, datetime

    await create_user(pg, "admin1", role=UserRole.admin)
    linked = await create_user(pg, "powiazany")
    pg.add(
        ShareLink(
            token_hash="x" * 64,
            label="link",
            starts_on=date.today(),
            ends_on=date.today(),
            expires_at=datetime.now(UTC) + timedelta(days=1),
            created_by_id=linked.id,
        )
    )
    await pg.commit()
    admin = await _client("admin1")
    try:
        response = await admin.delete(f"/api/v1/admin/users/{linked.id}")
    finally:
        await admin.aclose()

    assert (response.status_code, response.json()["detail"]) == (
        409,
        "Nie można usunąć konta, bo jest powiązane z innymi danymi. "
        "Dezaktywuj konto albo usuń powiązania.",
    )
    assert await pg.scalar(select(User.id).where(User.id == linked.id)) == linked.id
    deletions = await pg.scalar(
        select(func.count())
        .select_from(AuditEvent)
        .where(AuditEvent.action == "admin.user_deleted")
    )
    assert deletions == 0


async def test_one_share_link_exchanged_twice_at_once_starts_one_session(pg, monkeypatch) -> None:
    from datetime import UTC, datetime

    from oncall.auth import token_hash
    from oncall.infrastructure.sqlalchemy.access_models import Session

    admin = await create_user(pg, "admin1", role=UserRole.admin)
    link = ShareLink(
        token_hash=token_hash("s" * 40),
        label="Piotr",
        starts_on=date.today(),
        ends_on=date.today(),
        expires_at=datetime.now(UTC) + timedelta(days=1),
        created_by_id=admin.id,
    )
    pg.add(link)
    await pg.commit()
    _hold_commits(monkeypatch)
    first = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    second = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    try:
        responses = await asyncio.gather(
            *(
                client.post("/api/v1/share/exchange", json={"token": "s" * 40})
                for client in (first, second)
            )
        )
    finally:
        await first.aclose()
        await second.aclose()

    assert sorted(item.status_code for item in responses) == [200, 410], [
        item.text for item in responses
    ]
    refused = next(item for item in responses if item.status_code == 410)
    assert refused.json()["detail"] == "Link został już użyty"
    sessions = await pg.scalar(select(func.count()).select_from(Session))
    assert sessions == 1


async def test_one_activation_link_used_twice_at_once_sets_one_password(pg, monkeypatch) -> None:
    from datetime import UTC, datetime

    from oncall.auth import token_hash
    from oncall.domain.vocabulary import AccountTokenKind
    from oncall.infrastructure.sqlalchemy.access_models import AccountToken

    user = await create_user(pg, "nowa")
    user.password_hash = None
    pg.add(
        AccountToken(
            user_id=user.id,
            kind=AccountTokenKind.activation,
            token_hash=token_hash("a" * 40),
            expires_at=datetime.now(UTC) + timedelta(hours=1),
        )
    )
    await pg.commit()
    _hold_commits(monkeypatch)
    first = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    second = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    try:
        responses = await asyncio.gather(
            first.post(
                "/api/v1/auth/activate", json={"token": "a" * 40, "password": "Pierwsze-Haslo-17"}
            ),
            second.post(
                "/api/v1/auth/activate", json={"token": "a" * 40, "password": "Drugie-Haslo-2029"}
            ),
        )
    finally:
        await first.aclose()
        await second.aclose()

    assert sorted(item.status_code for item in responses) == [204, 400], [
        item.text for item in responses
    ]
    activations = await pg.scalar(
        select(func.count()).select_from(AuditEvent).where(AuditEvent.action == "auth.activation")
    )
    assert activations == 1


async def test_editing_own_phone_right_after_another_request_is_saved(pg) -> None:
    """Two requests on one session in quick succession: the phone must be
    written through the second request's own database session."""
    user = await create_user(pg, "ola")
    client = await _client("ola")
    try:
        assert (await client.get("/api/v1/auth/me")).status_code == 200
        changed = await client.patch("/api/v1/auth/me", json={"phone": "+48 600 100 200"})
    finally:
        await client.aclose()

    assert changed.status_code == 200, changed.text
    assert changed.json()["phone"] == "+48600100200"
    await pg.refresh(user)
    assert user.phone == "+48600100200"


def _publish_body(version: int) -> dict:
    return {
        "expected_version": version,
        "acknowledge_lost_changes": True,
        "acknowledge_gap": True,
        "acknowledge_rest_violations": True,
    }


async def test_one_proposal_published_twice_at_once_is_published_once(pg, monkeypatch) -> None:
    roster = await _roster(pg)
    proposal = await _proposal_over(pg, roster)
    _hold(monkeypatch, "notify_schedule_published")
    first, second = await _client("koord1"), await _client("koord2")
    try:
        responses = await asyncio.gather(
            *(
                client.post(f"/api/v1/scheduling/{proposal.id}/publish", json=_publish_body(1))
                for client in (first, second)
            )
        )
    finally:
        await first.aclose()
        await second.aclose()

    assert sorted(item.status_code for item in responses) == [200, 409], [
        item.text for item in responses
    ]
    refused = next(item for item in responses if item.status_code == 409)
    assert refused.json()["detail"] == "Propozycja zmieniła stan lub wersję; odśwież generator"
    published = await pg.scalar(
        select(func.count())
        .select_from(AuditEvent)
        .where(AuditEvent.action == "schedule.published")
    )
    assert published == 1
    version = await pg.scalar(select(Schedule.version).where(Schedule.id == proposal.id))
    assert version == 2


async def test_two_proposals_of_one_range_published_at_once_leave_one_in_force(
    pg, monkeypatch
) -> None:
    roster = await _roster(pg)
    proposals = [await _proposal_over(pg, roster), await _proposal_over(pg, roster)]
    _hold(monkeypatch, "notify_schedule_published")
    first, second = await _client("koord1"), await _client("koord2")
    try:
        responses = await asyncio.gather(
            *(
                client.post(f"/api/v1/scheduling/{proposal.id}/publish", json=_publish_body(1))
                for client, proposal in zip((first, second), proposals, strict=True)
            )
        )
    finally:
        await first.aclose()
        await second.aclose()

    assert [item.status_code for item in responses] == [200, 200], [item.text for item in responses]
    statuses = (
        await pg.execute(
            select(Schedule.status).where(
                Schedule.id.in_([roster["schedule"].id, *(item.id for item in proposals)])
            )
        )
    ).scalars()
    assert sorted(statuses) == sorted(
        [ScheduleStatus.published, ScheduleStatus.superseded, ScheduleStatus.superseded]
    )


async def _draft_over(pg: AsyncSession, roster: dict) -> Schedule:
    draft = await _proposal_over(pg, roster)
    draft.status = ScheduleStatus.draft
    await pg.commit()
    return draft


async def test_one_draft_corrected_twice_at_once_takes_one_correction(pg, monkeypatch) -> None:
    roster = await _roster(pg)
    draft = await _draft_over(pg, roster)
    _hold_commits(monkeypatch)
    first, second = await _client("koord1"), await _client("koord2")
    try:
        responses = await asyncio.gather(
            *(
                client.post(
                    f"/api/v1/scheduling/{draft.id}/override",
                    json={
                        "expected_version": 1,
                        "service_date": roster["day"].isoformat(),
                        "role": "primary",
                        "replacement_member_id": str(roster["members"][name].id),
                    },
                )
                for client, name in ((first, "dawid"), (second, "ewa"))
            )
        )
    finally:
        await first.aclose()
        await second.aclose()

    assert sorted(item.status_code for item in responses) == [200, 409], [
        item.text for item in responses
    ]
    refused = next(item for item in responses if item.status_code == 409)
    assert refused.json()["detail"] == "Szkic zmienił się; odśwież generator"
    winner = next(item for item in responses if item.status_code == 200).json()
    assert winner["version"] == 2
    corrections = await pg.scalar(
        select(func.count())
        .select_from(AuditEvent)
        .where(AuditEvent.action == "schedule.draft_override")
    )
    assert corrections == 1


async def test_one_draft_proposed_twice_at_once_is_proposed_once(pg, monkeypatch) -> None:
    roster = await _roster(pg)
    draft = await _draft_over(pg, roster)
    _hold_commits(monkeypatch)
    first, second = await _client("koord1"), await _client("koord2")
    try:
        responses = await asyncio.gather(
            *(
                client.post(f"/api/v1/scheduling/{draft.id}/propose", json={"expected_version": 1})
                for client in (first, second)
            )
        )
    finally:
        await first.aclose()
        await second.aclose()

    assert sorted(item.status_code for item in responses) == [200, 409], [
        item.text for item in responses
    ]
    refused = next(item for item in responses if item.status_code == 409)
    assert refused.json()["detail"] == "Szkic zmienił stan lub wersję; odśwież generator"
    proposals = await pg.scalar(
        select(func.count()).select_from(AuditEvent).where(AuditEvent.action == "schedule.proposed")
    )
    assert proposals == 1


async def test_a_password_reset_ends_other_sessions_at_once(pg) -> None:
    """Decision D-02: revocation takes effect immediately. Whoever knew the old
    password is signed out with no window in which one more request still
    answers."""
    user = await create_user(pg, "reset")
    client = await _client("reset")
    try:
        # One authenticated request first: whatever the session path keeps
        # between requests is warm before the password changes.
        assert (await client.get("/api/v1/auth/me")).status_code == 200
        pg.add(
            AccountToken(
                user_id=user.id,
                kind=AccountTokenKind.password_reset,
                token_hash=token_hash("r" * 30),
                expires_at=datetime.now(UTC) + timedelta(hours=1),
            )
        )
        await pg.commit()
        changed = await client.post(
            "/api/v1/auth/reset", json={"token": "r" * 30, "password": "Bardzo-Dobre-Haslo-9"}
        )
        reused = await client.get("/api/v1/auth/me")
    finally:
        await client.aclose()

    assert changed.status_code == 204, changed.text
    assert reused.status_code == 401, reused.text


async def test_a_dead_worker_stops_blocking_the_range_it_was_solving(pg, pg_factory) -> None:
    """Finding A13's recovery half, driven the way a coordinator meets it.

    They ask for the same fortnight again and are handed the run that died,
    complete with the 30% it reached, because `running` counts as active. Only
    after the run is reclaimed does a request for that range start a new one.

    Driven on PostgreSQL because that is where the whole guard exists: the
    partial unique index over active runs from migration 0028 has a raw SQL
    predicate and is absent from every SQLite test database.
    """
    await create_user(pg, "koord.stale", role=UserRole.coordinator)
    await pg.commit()
    client = await _client("koord.stale")
    try:
        starts = _first_weekday(21)
        body = {
            "starts_on": starts.isoformat(),
            "ends_on": (starts + timedelta(days=6)).isoformat(),
        }
        queued = await client.post("/api/v1/scheduling/runs", json=body)
        assert queued.status_code == 202, queued.text
        dead_run_id = queued.json()["id"]

        # The worker claims it and its process is killed.
        async with pg_factory() as db:
            await db.execute(
                update(ScheduleRun)
                .where(ScheduleRun.id == uuid.UUID(dead_run_id))
                .values(
                    status="running",
                    progress=30,
                    updated_at=datetime.now(UTC) - timedelta(hours=3),
                )
                .execution_options(synchronize_session=False)
            )
            await db.commit()

        blocked = await client.post("/api/v1/scheduling/runs", json=body)
        assert blocked.json()["id"] == dead_run_id, "the range was expected to be blocked"

        async with pg_factory() as db:
            assert (
                await recover_abandoned_runs(
                    SqlAlchemyGenerationQueue(db), stale_after=120.0, now=datetime.now(UTC)
                )
                == 1
            )
            await db.commit()

        retried = await client.post("/api/v1/scheduling/runs", json=body)
        dead = await client.get(f"/api/v1/scheduling/runs/{dead_run_id}")
    finally:
        await client.aclose()

    assert retried.status_code == 202, retried.text
    assert retried.json()["id"] != dead_run_id
    assert retried.json()["status"] == "queued"
    assert dead.json()["status"] == "failed"
    assert dead.json()["error"] == ABANDONED_RUN_ERROR


async def test_two_workers_reclaiming_at_once_reclaim_it_once(pg, pg_factory) -> None:
    """The recovery is one conditional statement, so the loser matches no rows
    and no run is failed twice."""
    user = await create_user(pg, "koord.race", role=UserRole.coordinator)
    starts = _first_weekday(40)
    pg.add(
        ScheduleRun(
            starts_on=starts,
            ends_on=starts + timedelta(days=6),
            requested_by_id=user.id,
            status="running",
            progress=30,
            updated_at=datetime.now(UTC) - timedelta(hours=3),
        )
    )
    await pg.commit()

    async def lane() -> int:
        async with pg_factory() as db:
            reclaimed = await recover_abandoned_runs(
                SqlAlchemyGenerationQueue(db), stale_after=120.0, now=datetime.now(UTC)
            )
            await db.commit()
            return reclaimed

    first, second = await asyncio.gather(lane(), lane())

    assert sorted((first, second)) == [0, 1], (first, second)


async def test_a_lane_does_not_queue_behind_another_lane_s_row(pg, pg_factory) -> None:
    """`SKIP LOCKED` is what makes generation lanes independent.

    Without it a lane that finds the head of the queue locked waits for the
    lock rather than moving on, so `generation_concurrency` buys nothing while
    any lane is mid-claim. The difference is invisible on SQLite, which has no
    row locks at all, and invisible in the result on PostgreSQL too - both
    spellings end up claiming the same run. Only the waiting differs, so that
    is what this measures: the second lane finishes while the first still holds
    its lock, which it could not do if it were queueing for it.
    """
    user = await create_user(pg, "koord.lanes", role=UserRole.coordinator)
    starts = _first_weekday(60)
    for offset in (0, 30):
        pg.add(
            ScheduleRun(
                starts_on=starts + timedelta(days=offset),
                ends_on=starts + timedelta(days=offset + 6),
                requested_by_id=user.id,
                status=RunState.queued,
                progress=0,
                created_at=datetime.now(UTC) + timedelta(seconds=offset),
            )
        )
    await pg.commit()

    async with pg_factory() as holding:
        # The first lane's claim, held open at the point its unit of work has
        # not yet committed: the claim itself only flushes, so the lock stays.
        held = await SqlAlchemyRunClaims(holding).claim_oldest(progress=CLAIMED_PROGRESS)
        assert held is not None

        # Generous: the claim is a single indexed statement. The point is that
        # it returns at all rather than blocking until the rollback below, not
        # how fast it is.
        claimed = await asyncio.wait_for(_claim_run(pg_factory), timeout=5)

        assert claimed is not None
        assert claimed.id != held.id
        await holding.rollback()


async def test_two_workers_draining_at_once_each_take_different_messages(
    pg, pg_factory, monkeypatch
) -> None:
    """The claim's `SKIP LOCKED`, which SQLite cannot show.

    Delivery is at-least-once, so a duplicate is survivable - but a duplicate
    caused by two live workers picking the same row every cycle would not be a
    rare crash artifact, it would be the steady state. Each message must leave
    exactly once here.

    The commits are held so both lanes have run their claim query before either
    one writes. Without that the two lanes simply take turns and the test
    passes whatever the claim locks - verified by mutation: dropping
    `FOR UPDATE SKIP LOCKED` entirely left the unheld version green.
    """
    for who in ("anna@example.com", "bartek@example.com", "celina@example.com"):
        await enqueue_notification(
            pg,
            NotificationMessage(channel="email", recipient=who, subject="Temat", body="Treść"),
        )
    await pg.commit()
    _hold_commits(monkeypatch)

    async def lane() -> list[str]:
        provider = _RecordingProvider()
        await drain_outbox(pg_factory, {"email": provider}, batch_size=2)
        return [item.recipient for item in provider.sent]

    first, second = await asyncio.gather(lane(), lane())

    delivered = first + second
    assert sorted(delivered) == sorted(set(delivered)), delivered
    assert len(delivered) == 3, delivered

    async with pg_factory() as reader:
        statuses = (await reader.scalars(select(NotificationOutbox.status))).all()
    assert list(statuses) == [NotificationStatus.sent] * 3


async def test_the_operational_readings_measure_the_same_thing_on_postgres(pg) -> None:
    """Both samples are conditional aggregates, and both come back wrong in a
    different way if the database disagrees with SQLite about them.

    `sum(case ...)` is the portable spelling of a filtered count, and `min` over
    a conditional timestamp has to survive the round trip: PostgreSQL hands
    back an aware `timestamptz` where SQLite hands back a naive value, and an
    age computed from the wrong one is either wrong by the UTC offset or raises
    (the crash phase 5g had to fix in the recovery statement).
    """
    now = datetime(2027, 5, 1, 12, 0, tzinfo=UTC)
    for day, status, created, updated in (
        (1, RunState.queued, now - timedelta(seconds=300), now - timedelta(seconds=300)),
        (2, RunState.queued, now - timedelta(seconds=60), now - timedelta(seconds=60)),
        (3, RunState.running, now - timedelta(seconds=900), now - timedelta(seconds=30)),
        (4, RunState.completed, now - timedelta(days=9), now - timedelta(days=9)),
    ):
        pg.add(
            ScheduleRun(
                starts_on=date(2027, 6, day),
                ends_on=date(2027, 6, day),
                status=status,
                progress=0,
                created_at=created,
                updated_at=updated,
            )
        )
    for status, attempts, created, due in (
        (NotificationStatus.pending, 0, now - timedelta(seconds=120), now - timedelta(seconds=10)),
        (NotificationStatus.pending, 3, now - timedelta(seconds=90), now - timedelta(seconds=5)),
        (NotificationStatus.skipped, 0, now - timedelta(seconds=40), now + timedelta(days=1)),
        (NotificationStatus.failed, 5, now - timedelta(seconds=500), now - timedelta(seconds=400)),
    ):
        pg.add(
            NotificationOutbox(
                channel="email",
                recipient="anna@example.com",
                subject="Temat",
                body="Treść",
                status=status,
                attempts=attempts,
                created_at=created,
                next_attempt_at=due,
            )
        )
    await pg.commit()

    queue = await queue_health(SqlAlchemyGenerationQueue(pg), now=now)
    outbox = await outbox_health(pg, now=now)

    assert (queue.queued, queue.running) == (2, 1)
    assert queue.oldest_queued_seconds == 300.0
    assert queue.stalest_running_seconds == 30.0
    assert (outbox.eligible, outbox.waiting, outbox.dead) == (2, 1, 1)
    assert outbox.oldest_eligible_seconds == 120.0
    assert (outbox.retrying, outbox.attempts_max) == (1, 3)


async def _lock_is_free(pg_factory, table: str, row_id: uuid.UUID) -> bool:
    """Whether another connection could lock this row right now, without
    waiting: `NOWAIT` answers at once instead of queueing behind a holder."""
    async with pg_factory() as probe:
        try:
            await probe.execute(
                text(f"SELECT id FROM {table} WHERE id = :id FOR UPDATE NOWAIT"), {"id": row_id}
            )
        except DBAPIError:
            return False
        finally:
            await probe.rollback()
    return True


async def test_a_lane_holds_no_lock_on_its_run_while_it_solves(pg, pg_factory, monkeypatch) -> None:
    """The claim commits before the solve starts, so the row lock `SKIP LOCKED`
    took is gone by the time the solver runs - however long it runs, recovery,
    the heartbeat and a coordinator's request can all reach that row."""
    user = await create_user(pg, "koord.lock", role=UserRole.coordinator)
    starts = _first_weekday(90)
    run = ScheduleRun(
        starts_on=starts,
        ends_on=starts + timedelta(days=6),
        requested_by_id=user.id,
        status=RunState.queued,
        progress=0,
    )
    pg.add(run)
    await pg.commit()
    probed: list[bool] = []

    async def fake_generate(_request, _user, session, progress=None):
        # Before the progress loop's first beat, whose own short unit of work
        # would take the lock for a moment.
        probed.append(await _lock_is_free(pg_factory, "schedule_runs", run.id))
        return await staged_draft(session, starts_on=starts)

    monkeypatch.setattr("oncall.worker.generate_draft", fake_generate)

    assert await process_schedule_run(pg_factory) == 1

    assert probed == [True], "the run's row was still locked while the solver ran"
    async with pg_factory() as reader:
        assert (await reader.get(ScheduleRun, run.id)).status == RunState.completed


async def test_a_provider_call_holds_no_lock_on_its_message(pg, pg_factory) -> None:
    """The claim's unit of work is over before the provider is called, so a
    slow mail server cannot hold the row it is being handed."""
    await enqueue_notification(
        pg,
        NotificationMessage(
            channel="email", recipient="anna@example.com", subject="Temat", body="Treść"
        ),
    )
    await pg.commit()
    probed: list[bool] = []

    class _Probing(_RecordingProvider):
        async def send(self, message: NotificationMessage) -> None:
            key = uuid.UUID(message.idempotency_key)
            probed.append(await _lock_is_free(pg_factory, "notification_outbox", key))
            await super().send(message)

    stats = await drain_outbox(pg_factory, {"email": _Probing()})

    assert stats["sent"] == 1
    assert probed == [True], "the message's row was still locked during the provider call"


async def test_two_coordinators_queueing_one_range_at_once_share_one_run(
    pg, pg_factory, monkeypatch
) -> None:
    """The partial unique index is the backstop behind the check-then-insert.

    Both requests find no active run and both insert; the second insert waits
    on the index for the first transaction and then conflicts. Only PostgreSQL
    has the index, so only here does that branch run at all.
    """
    for username in ("koord1", "koord2"):
        await create_user(pg, username, role=UserRole.coordinator)
    # The policy exists already, as it does after the first request ever made:
    # the test is about the run, not about two requests creating the policy.
    await load_policy(pg)
    await pg.commit()
    first, second = await _client("koord1"), await _client("koord2")
    starts = _first_weekday(120)
    body = {"starts_on": starts.isoformat(), "ends_on": (starts + timedelta(days=6)).isoformat()}
    _hold_commits(monkeypatch)
    try:
        answers = await asyncio.gather(
            first.post("/api/v1/scheduling/runs", json=body),
            second.post("/api/v1/scheduling/runs", json=body),
        )
    finally:
        await first.aclose()
        await second.aclose()

    assert [answer.status_code for answer in answers] == [202, 202], [a.text for a in answers]
    assert answers[0].json()["id"] == answers[1].json()["id"]
    async with pg_factory() as reader:
        runs = await reader.scalar(
            select(func.count()).select_from(ScheduleRun).where(ScheduleRun.starts_on == starts)
        )
    assert runs == 1


async def test_a_lost_enqueue_race_keeps_the_rest_of_the_request(pg, pg_factory) -> None:
    """Losing the race for a range undoes the losing insert, not the request.

    The insert runs under a savepoint. It used to be followed by a rollback of
    the whole session, which threw away everything the request had staged
    before it - on the very first request that is the policy row, created on
    first read and written by the request's own unit of work.
    """
    user = await create_user(pg, "koord.race", role=UserRole.coordinator)
    starts = _first_weekday(150)
    ends = starts + timedelta(days=6)
    pg.add(
        ScheduleRun(
            starts_on=starts,
            ends_on=ends,
            requested_by_id=user.id,
            status=RunState.queued,
            progress=0,
        )
    )
    await pg.commit()

    async with SqlAlchemyUnitOfWork(pg_factory) as request:
        policy = await load_policy(request)
        run = await SqlAlchemyGenerationQueue(request).enqueue(starts, ends, user.id)

    assert run.status == RunState.queued
    async with pg_factory() as reader:
        assert await reader.get(type(policy), policy.id) is not None, "the request was rolled back"
        assert await reader.scalar(select(func.count()).select_from(ScheduleRun)) == 1
