import pytest

from oncall import worker
from oncall.domain.clock import business_today
from oncall.domain.vocabulary import AssignmentRole
from oncall.notifications.service import UNDO_WINDOW
from oncall.notifications.triggers import notify_assignment_overridden
from tests.conftest import create_member, create_user
from tests.test_notifications import FakeProvider


async def _skip_scan(*_args, **_kwargs) -> int:
    return 0


async def _correct(db, previous_name: str, new_name: str) -> None:
    await notify_assignment_overridden(
        db,
        service_date=business_today(),
        role=AssignmentRole.primary,
        previous_name=previous_name,
        new_name=new_name,
    )
    await db.commit()


@pytest.fixture
async def provider(db, monkeypatch) -> FakeProvider:
    for username, display_name in (
        ("anna", "Anna Kowalska"),
        ("marek", "Marek Nowak"),
    ):
        user = await create_user(
            db,
            username,
            email=f"{username}@example.com",
            display_name=display_name,
        )
        await create_member(db, user, display_name=display_name)
    provider = FakeProvider()
    monkeypatch.setattr(worker, "default_providers", lambda _settings: {"email": provider})
    monkeypatch.setattr(worker, "scan_forwarding", _skip_scan)
    monkeypatch.setattr(worker, "scan_handover", _skip_scan)
    monkeypatch.setattr(worker, "scan_digest", _skip_scan)
    return provider


async def test_worker_delivers_a_correction_only_after_undo_expires(
    db, db_factory, frozen_clock, provider
) -> None:
    await _correct(db, "Anna Kowalska", "Marek Nowak")

    assert (await worker.notification_cycle(db_factory))["sent"] == 0
    frozen_clock.advance(UNDO_WINDOW)
    assert (await worker.notification_cycle(db_factory))["sent"] == 2
    assert {message.recipient for message in provider.sent} == {
        "anna@example.com",
        "marek@example.com",
    }
    assert all(message.subject.startswith("Zmiana przydziału") for message in provider.sent)


async def test_worker_sends_nothing_for_a_correction_undone_in_its_window(
    db, db_factory, frozen_clock, provider
) -> None:
    await _correct(db, "Anna Kowalska", "Marek Nowak")
    frozen_clock.advance(UNDO_WINDOW / 2)
    await _correct(db, "Marek Nowak", "Anna Kowalska")

    frozen_clock.advance(UNDO_WINDOW)
    assert (await worker.notification_cycle(db_factory))["sent"] == 0
    assert provider.sent == []
