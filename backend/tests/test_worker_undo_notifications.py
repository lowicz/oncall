import uuid

import pytest

from oncall import worker
from oncall.domain.clock import business_today
from oncall.domain.vocabulary import AssignmentRole
from oncall.notifications.service import UNDO_WINDOW
from oncall.notifications.triggers import (
    notify_assignment_overridden,
    notify_swap_cancelled,
    notify_swap_cancelled_by_publication,
    notify_swap_requested,
)
from tests.conftest import create_member, create_user
from tests.test_notifications import FakeProvider


async def _skip_scan(*_args, **_kwargs) -> int:
    return 0


async def _correct(db, previous_name: str, new_name: str) -> None:
    await notify_assignment_overridden(
        db, changes=[(business_today(), AssignmentRole.primary, previous_name, new_name)]
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


async def test_an_undo_reaching_the_server_after_the_window_still_cancels_unsent_mail(
    db, db_factory, frozen_clock, provider
) -> None:
    await _correct(db, "Anna Kowalska", "Marek Nowak")
    frozen_clock.advance(UNDO_WINDOW + UNDO_WINDOW / 20)
    await _correct(db, "Marek Nowak", "Anna Kowalska")

    assert (await worker.notification_cycle(db_factory))["sent"] == 0
    assert provider.sent == []


async def _ask_marek(db, swap_id: uuid.UUID) -> None:
    await notify_swap_requested(
        db,
        swap_id=swap_id,
        service_date=business_today(),
        role=AssignmentRole.primary,
        requester_name="Anna Kowalska",
        replacement_name="Marek Nowak",
        violations=[],
    )
    await db.commit()


async def _withdraw(db, swap_id: uuid.UUID) -> None:
    await notify_swap_cancelled(
        db,
        swap_id=swap_id,
        service_date=business_today(),
        role=AssignmentRole.primary,
        requester_name="Anna Kowalska",
        replacement_name="Marek Nowak",
        reason="cofnięte zaraz po wysłaniu",
    )
    await db.commit()


async def test_worker_delivers_a_swap_request_only_after_undo_expires(
    db, db_factory, frozen_clock, provider
) -> None:
    await _ask_marek(db, uuid.uuid4())

    assert (await worker.notification_cycle(db_factory))["sent"] == 0
    frozen_clock.advance(UNDO_WINDOW)
    assert (await worker.notification_cycle(db_factory))["sent"] == 1
    assert [message.recipient for message in provider.sent] == ["marek@example.com"]


async def test_a_request_withdrawn_in_its_window_reaches_the_replacement_not_at_all(
    db, db_factory, frozen_clock, provider
) -> None:
    swap_id = uuid.uuid4()
    await _ask_marek(db, swap_id)
    frozen_clock.advance(UNDO_WINDOW / 2)
    await _withdraw(db, swap_id)

    frozen_clock.advance(UNDO_WINDOW)
    assert (await worker.notification_cycle(db_factory))["sent"] == 0
    assert provider.sent == []


async def test_a_request_withdrawn_after_its_mail_went_tells_the_replacement(
    db, db_factory, frozen_clock, provider
) -> None:
    swap_id = uuid.uuid4()
    await _ask_marek(db, swap_id)
    frozen_clock.advance(UNDO_WINDOW)
    assert (await worker.notification_cycle(db_factory))["sent"] == 1
    await _withdraw(db, swap_id)

    assert (await worker.notification_cycle(db_factory))["sent"] == 1
    assert [message.subject.split(":")[0] for message in provider.sent] == [
        "Prośba o zamianę",
        "Zamiana wycofana",
    ]


async def _supersede(db, swap_id: uuid.UUID) -> None:
    await notify_swap_cancelled_by_publication(
        db,
        swap_id=swap_id,
        service_date=business_today(),
        role=AssignmentRole.primary,
        requester_name="Anna Kowalska",
        replacement_name="Marek Nowak",
    )
    await db.commit()


async def test_a_publication_in_the_window_tells_only_the_requester(
    db, db_factory, frozen_clock, provider
) -> None:
    swap_id = uuid.uuid4()
    await _ask_marek(db, swap_id)
    frozen_clock.advance(UNDO_WINDOW / 2)
    await _supersede(db, swap_id)

    frozen_clock.advance(UNDO_WINDOW)
    assert (await worker.notification_cycle(db_factory))["sent"] == 1
    assert [(message.recipient, message.subject.split(":")[0]) for message in provider.sent] == [
        ("anna@example.com", "Zamiana wycofana"),
    ]


async def test_a_publication_after_the_request_mail_went_tells_both(
    db, db_factory, frozen_clock, provider
) -> None:
    swap_id = uuid.uuid4()
    await _ask_marek(db, swap_id)
    frozen_clock.advance(UNDO_WINDOW)
    assert (await worker.notification_cycle(db_factory))["sent"] == 1
    await _supersede(db, swap_id)

    assert (await worker.notification_cycle(db_factory))["sent"] == 2
    assert sorted(
        (message.recipient, message.subject.split(":")[0]) for message in provider.sent[1:]
    ) == [("anna@example.com", "Zamiana wycofana"), ("marek@example.com", "Zamiana wycofana")]
