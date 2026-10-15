"""The WCO forwarding worker, driven through its database and fake WCO."""

import logging
import uuid
from dataclasses import replace
from datetime import timedelta

import httpx
import pytest
from cryptography.fernet import Fernet
from pydantic import SecretStr
from sqlalchemy import select

from oncall import worker
from oncall.database import SqlAlchemyUnitOfWork
from oncall.domain.forwarding.job import ForwardingFailure, ForwardingTarget
from oncall.domain.forwarding.models import ForwardingMode, ForwardingOutcome, SettingsChange
from oncall.domain.forwarding.passwords import Passwords
from oncall.domain.handover import NoticeTiming, RotationNotice, Segment
from oncall.domain.vocabulary import AssignmentRole, UserRole
from oncall.infrastructure.sqlalchemy.audit_model import AuditEvent
from oncall.infrastructure.sqlalchemy.forwarding import (
    SqlAlchemyForwardingAttempts,
    SqlAlchemyForwardingConfiguration,
    SqlAlchemyForwardingSettings,
)
from oncall.infrastructure.sqlalchemy.forwarding_models import (
    CallForwardingSettings,
    CallForwardingState,
)
from oncall.infrastructure.sqlalchemy.notification_models import NotificationOutbox
from oncall.infrastructure.sqlalchemy.scheduling_models import Assignment
from oncall.notifications.triggers import enqueue_rotation_notice
from oncall.secrets import SettingsCipher, decrypt, encrypt
from oncall.wco import WcoClient
from tests.conftest import create_member, create_published_schedule, create_user
from tests.wco_fake import CHANGE_PASSWORD, PERFORM_LOGIN, USER, FakeWco


@pytest.fixture
def forwarding_key(monkeypatch) -> None:
    monkeypatch.setattr(
        worker.get_settings(), "secrets_key", SecretStr(Fernet.generate_key().decode())
    )


def _now(frozen_clock):
    return frozen_clock.instant.astimezone(worker.WARSAW)


async def _settings(db, fake: FakeWco, mode: ForwardingMode, *, password: str | None = None):
    settings = worker.get_settings()
    row = CallForwardingSettings(
        mode=mode,
        base_url=fake_url(fake),
        vpbx_number=fake.vpbx_number,
        username=fake.username,
        wco_user_id=fake.user_id,
        password_ciphertext=encrypt(settings, password or fake.password),
    )
    db.add(row)
    await db.commit()
    return row


def fake_url(_fake: FakeWco) -> str:
    return "https://wco.test"


async def _primary(db, frozen_clock, *, phone: str | None = "+48500500500"):
    user = await create_user(
        db,
        "primary",
        email="primary@example.com",
        phone=phone,
        display_name="Anna Kowalska",
    )
    member = await create_member(db, user, display_name="Anna Kowalska")
    day = _now(frozen_clock).date()
    await create_published_schedule(
        db,
        starts_on=day,
        days=2,
        primary=[member.display_name],
        secondary=[member.display_name],
        late_shift=[member.display_name],
    )
    rows = (
        await db.scalars(
            select(Assignment).where(
                Assignment.assignee_name == member.display_name,
                Assignment.role == AssignmentRole.primary,
            )
        )
    ).all()
    for row in rows:
        row.member_id = member.id
    await db.commit()
    return user, member


def _use_fake(monkeypatch, fake: FakeWco) -> None:
    monkeypatch.setattr(
        worker,
        "_open_wco",
        lambda account: WcoClient(account.base_url, transport=fake.transport()),
    )


async def _one(db_factory, model):
    async with db_factory() as db:
        return (await db.scalars(select(model))).one()


async def _all(db_factory, model):
    async with db_factory() as db:
        return (await db.scalars(select(model))).all()


async def test_notification_cycle_runs_forwarding_immediately_after_handover(
    db_factory, monkeypatch
) -> None:
    order: list[str] = []

    async def drain(*_args, **_kwargs):
        order.append("drain")
        return {"sent": 0}

    async def handover(_db, *, now_warsaw):
        order.append("handover")
        return 1

    async def forwarding(_factory, *, now_warsaw):
        order.append("forwarding")
        return 1

    async def digest(_db, *, now_warsaw):
        order.append("digest")
        return 1

    monkeypatch.setattr(worker, "drain_outbox", drain)
    monkeypatch.setattr(worker, "scan_handover", handover)
    monkeypatch.setattr(worker, "scan_forwarding", forwarding)
    monkeypatch.setattr(worker, "scan_digest", digest)

    stats = await worker.notification_cycle(db_factory)

    assert order == ["drain", "handover", "forwarding", "digest"]
    assert stats == {"sent": 0, "handover": 1, "forwarding": 1, "digest": 1}


async def test_mode_off_never_opens_wco(db_factory, frozen_clock, monkeypatch) -> None:
    opened = 0

    def must_not_open(_account):
        nonlocal opened
        opened += 1
        raise AssertionError("WCO was opened while forwarding was off")

    monkeypatch.setattr(worker, "_open_wco", must_not_open)

    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 0
    assert opened == 0


async def test_live_pass_updates_wco_once_and_records_audit_and_metrics(
    db, db_factory, frozen_clock, forwarding_key, monkeypatch, caplog
) -> None:
    fake = FakeWco()
    _use_fake(monkeypatch, fake)
    user, member = await _primary(db, frozen_clock)
    await _settings(db, fake, ForwardingMode.live)
    caplog.set_level(logging.INFO, logger="oncall.metrics")

    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 1

    assert fake.user["number"] == user.phone
    assert fake.bodies(USER)[0]["number"] == "+48500500500"
    state = await _one(db_factory, CallForwardingState)
    assert state.last_outcome is ForwardingOutcome.applied
    assert state.applied_member_id == member.id
    assert state.applied_number == "+48500500500"
    assert state.lease_until is None
    events = await _all(db_factory, AuditEvent)
    assert [event.action for event in events] == ["forwarding.applied"]
    assert any(
        record.getMessage().startswith("event=forwarding outcome=applied rotated=0")
        for record in caplog.records
    )

    calls = list(fake.calls)
    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 0
    assert fake.calls == calls


async def test_dry_run_reads_without_updating_and_runs_once_per_target(
    db, db_factory, frozen_clock, forwarding_key, monkeypatch
) -> None:
    fake = FakeWco()
    _use_fake(monkeypatch, fake)
    await _primary(db, frozen_clock)
    await _settings(db, fake, ForwardingMode.dry_run)

    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 1

    assert fake.user["number"] == "+48600600600"
    assert not any(call.startswith("PUT ") for call in fake.calls)
    state = await _one(db_factory, CallForwardingState)
    assert state.last_outcome is ForwardingOutcome.dry_run
    assert state.desired_number == "+48500500500"
    assert state.applied_number == "+48600600600"
    events = await _all(db_factory, AuditEvent)
    assert [event.action for event in events] == ["forwarding.test"]
    calls = list(fake.calls)
    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 0
    assert fake.calls == calls


async def test_missing_phone_alerts_operators_and_primary_then_recovery_alerts_operators(
    db, db_factory, frozen_clock, forwarding_key, monkeypatch
) -> None:
    fake = FakeWco()
    _use_fake(monkeypatch, fake)
    primary, _member = await _primary(db, frozen_clock, phone=None)
    await create_user(
        db,
        "coordinator",
        role=UserRole.coordinator,
        email="coordinator@example.com",
    )
    await create_user(db, "admin", role=UserRole.admin, email="admin@example.com")
    await _settings(db, fake, ForwardingMode.live)

    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 1
    assert fake.calls == []
    alerts = await _all(db_factory, NotificationOutbox)
    assert {row.recipient for row in alerts} == {
        "primary@example.com",
        "coordinator@example.com",
        "admin@example.com",
    }
    assert all(row.context["cause"] == ForwardingFailure.no_phone for row in alerts)
    assert all("uzupełnić numer" in row.body for row in alerts)
    state = await _one(db_factory, CallForwardingState)
    assert state.last_outcome is ForwardingOutcome.skipped_no_phone
    assert state.alerted_for is not None

    primary.phone = "+48500500500"
    await db.commit()
    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 1

    rows = await _all(db_factory, NotificationOutbox)
    recovered = [row for row in rows if row.context["event"] == "forwarding_recovered"]
    assert {row.recipient for row in recovered} == {
        "coordinator@example.com",
        "admin@example.com",
    }
    assert all("+48500500500" not in row.body for row in rows)
    assert all("number" not in row.context for row in rows)


async def test_no_primary_alert_is_deduplicated_for_the_day(
    db, db_factory, frozen_clock, forwarding_key, monkeypatch
) -> None:
    fake = FakeWco()
    _use_fake(monkeypatch, fake)
    await create_user(db, "admin", role=UserRole.admin, email="admin@example.com")
    await _settings(db, fake, ForwardingMode.live)

    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 1
    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 0

    (alert,) = await _all(db_factory, NotificationOutbox)
    assert alert.context == {
        "event": "forwarding_failed",
        "day": _now(frozen_clock).date().isoformat(),
        "cause": "no_primary",
    }
    state = await _one(db_factory, CallForwardingState)
    assert state.last_outcome is ForwardingOutcome.skipped_no_primary


async def test_transient_failure_backs_off_alerts_after_ten_minutes_and_recovers(
    db, db_factory, frozen_clock, forwarding_key, monkeypatch
) -> None:
    fake = FakeWco(faults={USER: httpx.ConnectError("network down")})
    _use_fake(monkeypatch, fake)
    await _primary(db, frozen_clock)
    await create_user(db, "admin", role=UserRole.admin, email="admin@example.com")
    await _settings(db, fake, ForwardingMode.live)

    for wait in (timedelta(0), timedelta(minutes=2), timedelta(minutes=4)):
        frozen_clock.advance(wait)
        assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 1
    assert await _all(db_factory, NotificationOutbox) == []

    frozen_clock.advance(timedelta(minutes=8))
    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 1
    alerts = await _all(db_factory, NotificationOutbox)
    assert {alert.recipient for alert in alerts} == {
        "admin@example.com",
        "primary@example.com",
    }
    assert all(alert.context["cause"] == "connection" for alert in alerts)
    state = await _one(db_factory, CallForwardingState)
    assert state.attempts == 4
    assert state.failing_since is not None

    fake.faults.clear()
    frozen_clock.advance(timedelta(minutes=16))
    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 1
    rows = await _all(db_factory, NotificationOutbox)
    assert [row.context["event"] for row in rows] == [
        "forwarding_failed",
        "forwarding_failed",
        "forwarding_recovered",
    ]


async def test_refused_login_stops_further_logins_until_an_admin_changes_password(
    db, db_factory, frozen_clock, forwarding_key, monkeypatch
) -> None:
    fake = FakeWco()
    _use_fake(monkeypatch, fake)
    await _primary(db, frozen_clock)
    await _settings(db, fake, ForwardingMode.live, password="Wrong-Passw0rd!")

    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 1
    first_calls = list(fake.calls)
    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 0
    assert fake.calls == first_calls
    stored = await _one(db_factory, CallForwardingSettings)
    assert stored.credentials_invalid_since is not None
    state = await _one(db_factory, CallForwardingState)
    assert state.last_outcome is ForwardingOutcome.failed
    assert state.next_attempt_at is None
    assert "Wrong-Passw0rd!" not in (state.last_error or "")


async def test_expired_password_is_persisted_promoted_and_update_continues(
    db, db_factory, frozen_clock, forwarding_key, monkeypatch
) -> None:
    fake = FakeWco(password_expired=True)
    old = fake.password
    _use_fake(monkeypatch, fake)
    await _primary(db, frozen_clock)
    await _settings(db, fake, ForwardingMode.live)

    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 1

    stored = await _one(db_factory, CallForwardingSettings)
    assert decrypt(worker.get_settings(), stored.password_ciphertext or "") == fake.password
    assert fake.password != old
    assert stored.pending_password_ciphertext is None
    assert fake.user["number"] == "+48500500500"
    assert fake.calls.count(f"POST {CHANGE_PASSWORD}") == 1
    events = await _all(db_factory, AuditEvent)
    assert [event.action for event in events] == [
        "forwarding.password_rotated",
        "forwarding.applied",
    ]


async def test_a_rejected_generated_password_is_replaced_before_retry(
    db, db_factory, frozen_clock, forwarding_key, monkeypatch
) -> None:
    fake = FakeWco(password_expired=True, faults={CHANGE_PASSWORD: [400, None]})
    _use_fake(monkeypatch, fake)
    await _primary(db, frozen_clock)
    await _settings(db, fake, ForwardingMode.live)

    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 1

    bodies = fake.bodies(CHANGE_PASSWORD)
    assert len(bodies) == 2
    assert bodies[0]["newPassword"] != bodies[1]["newPassword"]
    assert fake.user["number"] == "+48500500500"


async def test_a_crash_after_wco_changed_the_password_recovers_from_pending(
    db, db_factory, frozen_clock, forwarding_key, monkeypatch
) -> None:
    fake = FakeWco(password_expired=True)
    _use_fake(monkeypatch, fake)
    await _primary(db, frozen_clock)
    await _settings(db, fake, ForwardingMode.live)
    promote = worker._promote_pending

    async def crash_before_promotion(*_args):
        raise RuntimeError("worker stopped")

    monkeypatch.setattr(worker, "_promote_pending", crash_before_promotion)
    with pytest.raises(RuntimeError, match="worker stopped"):
        await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock))
    stored = await _one(db_factory, CallForwardingSettings)
    assert stored.pending_password_ciphertext is not None
    changed_password = fake.password

    monkeypatch.setattr(worker, "_promote_pending", promote)
    frozen_clock.advance(worker.FORWARDING_LEASE + timedelta(seconds=1))
    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 1

    stored = await _one(db_factory, CallForwardingSettings)
    assert decrypt(worker.get_settings(), stored.password_ciphertext or "") == changed_password
    assert stored.pending_password_ciphertext is None
    assert fake.calls.count(f"POST {CHANGE_PASSWORD}") == 1


async def test_live_rotation_notice_says_the_number_is_automatic(
    db, frozen_clock, forwarding_key
) -> None:
    fake = FakeWco()
    _user, member = await _primary(db, frozen_clock)
    await _settings(db, fake, ForwardingMode.live)
    day = _now(frozen_clock).date()

    assert (
        await enqueue_rotation_notice(
            db,
            RotationNotice(
                NoticeTiming.same_day,
                day,
                member.display_name,
                (Segment(AssignmentRole.primary, day, day),),
            ),
        )
        == 1
    )
    await db.commit()

    (row,) = (await db.scalars(select(NotificationOutbox))).all()
    assert "przełączany automatycznie o 09:00" in row.body
    assert "Pamiętaj o przełączeniu" not in row.body


async def test_unchanged_wco_number_is_confirmed_without_a_put_or_audit(
    db, db_factory, frozen_clock, forwarding_key, monkeypatch
) -> None:
    fake = FakeWco()
    fake.user["number"] = "+48500500500"
    _use_fake(monkeypatch, fake)
    await _primary(db, frozen_clock)
    await _settings(db, fake, ForwardingMode.live)

    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 1

    assert not any(call.startswith("PUT ") for call in fake.calls)
    state = await _one(db_factory, CallForwardingState)
    assert state.last_outcome is ForwardingOutcome.unchanged
    assert await _all(db_factory, AuditEvent) == []


async def test_an_incomplete_active_configuration_fails_safely_and_backs_off(
    db, db_factory, frozen_clock, forwarding_key, monkeypatch
) -> None:
    fake = FakeWco()
    _use_fake(monkeypatch, fake)
    primary, _member = await _primary(db, frozen_clock)
    primary.email = None
    db.add(
        CallForwardingSettings(
            mode=ForwardingMode.live,
            base_url="https://wco.test",
            vpbx_number=fake.vpbx_number,
            username=None,
            wco_user_id=fake.user_id,
            password_ciphertext=encrypt(worker.get_settings(), fake.password),
        )
    )
    await db.commit()

    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 1
    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 0

    assert fake.calls == []
    assert await _all(db_factory, NotificationOutbox) == []
    state = await _one(db_factory, CallForwardingState)
    assert state.last_outcome is ForwardingOutcome.failed
    assert state.next_attempt_at is not None


async def test_a_live_lease_keeps_a_second_worker_out(
    db, db_factory, frozen_clock, forwarding_key, monkeypatch
) -> None:
    fake = FakeWco()
    _use_fake(monkeypatch, fake)
    await _primary(db, frozen_clock)
    await _settings(db, fake, ForwardingMode.live)
    db.add(CallForwardingState(lease_until=frozen_clock.instant + timedelta(minutes=1)))
    await db.commit()

    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 0
    assert fake.calls == []


@pytest.mark.parametrize(
    "fault",
    [500, httpx.ConnectError("login network down")],
    ids=["server", "network"],
)
async def test_login_transport_failures_are_retried_without_invalidating_credentials(
    db, db_factory, frozen_clock, forwarding_key, monkeypatch, fault
) -> None:
    fake = FakeWco(faults={PERFORM_LOGIN: fault})
    _use_fake(monkeypatch, fake)
    await _primary(db, frozen_clock)
    await _settings(db, fake, ForwardingMode.live)

    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 1

    settings = await _one(db_factory, CallForwardingSettings)
    state = await _one(db_factory, CallForwardingState)
    assert settings.credentials_invalid_since is None
    assert state.next_attempt_at is not None


@pytest.mark.parametrize(
    "second_login",
    [401, httpx.ConnectError("new login failed")],
    ids=["refused", "network"],
)
async def test_rotation_failure_keeps_both_passwords_for_recovery(
    db, db_factory, frozen_clock, forwarding_key, monkeypatch, second_login
) -> None:
    fake = FakeWco(
        password_expired=True,
        faults={PERFORM_LOGIN: [None, second_login]},
    )
    _use_fake(monkeypatch, fake)
    await _primary(db, frozen_clock)
    await _settings(db, fake, ForwardingMode.live)

    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 1

    settings = await _one(db_factory, CallForwardingSettings)
    state = await _one(db_factory, CallForwardingState)
    assert settings.pending_password_ciphertext is not None
    assert settings.password_ciphertext is not None
    assert settings.credentials_invalid_since is None
    assert state.last_outcome is ForwardingOutcome.failed


async def test_password_policy_rejection_stops_after_three_candidates(
    db, db_factory, frozen_clock, forwarding_key, monkeypatch
) -> None:
    fake = FakeWco(
        password_expired=True,
        faults={CHANGE_PASSWORD: [400, 400, 400]},
    )
    _use_fake(monkeypatch, fake)
    await _primary(db, frozen_clock)
    await _settings(db, fake, ForwardingMode.live)

    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 1

    assert fake.calls.count(f"POST {CHANGE_PASSWORD}") == 3
    state = await _one(db_factory, CallForwardingState)
    assert state.last_outcome is ForwardingOutcome.failed
    assert state.next_attempt_at == frozen_clock.instant.replace(tzinfo=None) + timedelta(hours=1)


async def test_pending_password_whose_change_never_ran_is_reused(
    db, db_factory, frozen_clock, forwarding_key, monkeypatch
) -> None:
    fake = FakeWco(password_expired=True)
    _use_fake(monkeypatch, fake)
    await _primary(db, frozen_clock)
    await _settings(db, fake, ForwardingMode.live)
    change = worker._change_pending_password

    async def stop_before_change(*_args):
        raise RuntimeError("stopped before change")

    monkeypatch.setattr(worker, "_change_pending_password", stop_before_change)
    with pytest.raises(RuntimeError, match="stopped before change"):
        await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock))
    pending = (await _one(db_factory, CallForwardingSettings)).pending_password_ciphertext
    assert pending is not None
    assert fake.password_expired

    monkeypatch.setattr(worker, "_change_pending_password", change)
    frozen_clock.advance(worker.FORWARDING_LEASE + timedelta(seconds=1))
    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 1
    assert fake.calls.count(f"POST {CHANGE_PASSWORD}") == 1


async def test_bad_user_responses_and_read_failures_are_permanent(
    db, db_factory, frozen_clock, forwarding_key, monkeypatch
) -> None:
    fake = FakeWco()
    fake.user["number"] = None
    _use_fake(monkeypatch, fake)
    await _primary(db, frozen_clock)
    await _settings(db, fake, ForwardingMode.live)

    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 1
    state = await _one(db_factory, CallForwardingState)
    assert "answered no number" in (state.last_error or "")


async def test_get_user_server_failure_is_transient(
    db, db_factory, frozen_clock, forwarding_key, monkeypatch
) -> None:
    fake = FakeWco(faults={f"{USER}/1001": 500})
    _use_fake(monkeypatch, fake)
    await _primary(db, frozen_clock)
    await _settings(db, fake, ForwardingMode.live)

    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 1
    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 0

    state = await _one(db_factory, CallForwardingState)
    assert state.next_attempt_at == frozen_clock.instant.replace(tzinfo=None) + timedelta(minutes=2)


async def test_password_expiring_twice_while_reading_stops_the_pass(
    db, db_factory, frozen_clock, forwarding_key, monkeypatch
) -> None:
    fake = FakeWco(faults={f"{USER}/1001": [403, 403]})
    _use_fake(monkeypatch, fake)
    await _primary(db, frozen_clock)
    await _settings(db, fake, ForwardingMode.live)

    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 1

    state = await _one(db_factory, CallForwardingState)
    assert state.last_outcome is ForwardingOutcome.failed
    assert fake.calls.count(f"POST {CHANGE_PASSWORD}") == 1


async def test_password_expiry_during_update_rotates_and_repeats_the_update(
    db, db_factory, frozen_clock, forwarding_key, monkeypatch
) -> None:
    fake = FakeWco(faults={USER: [403, None]})
    _use_fake(monkeypatch, fake)
    await _primary(db, frozen_clock)
    await _settings(db, fake, ForwardingMode.live)

    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 1

    assert fake.calls.count(f"POST {CHANGE_PASSWORD}") == 1
    assert fake.user["number"] == "+48500500500"


async def test_a_second_expiry_in_one_pass_stops_rotation(
    db, db_factory, frozen_clock, forwarding_key, monkeypatch
) -> None:
    fake = FakeWco(faults={USER: [403, 403]})
    _use_fake(monkeypatch, fake)
    await _primary(db, frozen_clock)
    await _settings(db, fake, ForwardingMode.live)

    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 1

    state = await _one(db_factory, CallForwardingState)
    assert state.last_outcome is ForwardingOutcome.failed
    assert fake.calls.count(f"POST {CHANGE_PASSWORD}") == 1


async def test_an_update_not_confirmed_by_readback_is_a_permanent_failure(
    db, db_factory, frozen_clock, forwarding_key, monkeypatch
) -> None:
    class NotConfirmingWco(FakeWco):
        def handle(self, request):
            before = dict(self.user)
            response = super().handle(request)
            if request.method == "PUT" and request.url.path == USER:
                self.user = before
            return response

    fake = NotConfirmingWco()
    _use_fake(monkeypatch, fake)
    await _primary(db, frozen_clock)
    await _settings(db, fake, ForwardingMode.live)

    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 1

    state = await _one(db_factory, CallForwardingState)
    assert "not confirmed" in (state.last_error or "")
    assert state.next_attempt_at == frozen_clock.instant.replace(tzinfo=None) + timedelta(hours=1)


async def test_unreadable_ca_is_recorded_without_opening_a_network_connection(
    db, db_factory, frozen_clock, forwarding_key, monkeypatch
) -> None:
    fake = FakeWco()
    await _primary(db, frozen_clock)
    await _settings(db, fake, ForwardingMode.live)
    monkeypatch.setattr(worker.get_settings(), "wco_ca_file", "/missing/wco-ca.pem")

    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 1

    state = await _one(db_factory, CallForwardingState)
    assert state.last_outcome is ForwardingOutcome.failed
    assert "CA file is unreadable" in (state.last_error or "")


async def test_a_lost_lease_discards_both_success_and_failure_results(
    db, db_factory, frozen_clock, forwarding_key, monkeypatch
) -> None:
    fake = FakeWco()
    _use_fake(monkeypatch, fake)
    await _primary(db, frozen_clock)
    await _settings(db, fake, ForwardingMode.live)

    async def lose_lease(factory, attempt):
        async with SqlAlchemyUnitOfWork(factory) as session:
            state = await session.scalar(select(CallForwardingState))
            assert state is not None
            state.lease_until = attempt.lease_until + timedelta(seconds=1)
        return attempt, "+48500500500", ForwardingOutcome.applied, False

    monkeypatch.setattr(worker, "_reconcile_wco", lose_lease)
    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 0

    frozen_clock.advance(worker.FORWARDING_LEASE + timedelta(seconds=2))

    async def lose_then_fail(factory, attempt):
        await lose_lease(factory, attempt)
        raise worker._ForwardingAttemptFailed(ForwardingFailure.connection, "lost", permanent=False)

    monkeypatch.setattr(worker, "_reconcile_wco", lose_then_fail)
    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 0


async def test_configuration_rotation_guards_missing_rows(db, frozen_clock, forwarding_key) -> None:
    fake = FakeWco()
    await _settings(db, fake, ForwardingMode.live)
    configuration = SqlAlchemyForwardingConfiguration(db)
    account = await configuration.account(SettingsCipher(worker.get_settings()))
    target = ForwardingTarget(frozen_clock.instant.date(), None, "Anna", "+48500500500")
    attempt = worker.ForwardingAttempt(
        account,
        target,
        frozen_clock.instant + worker.FORWARDING_LEASE,
        0,
    )
    state = CallForwardingState(lease_until=attempt.lease_until)
    db.add(state)
    await db.commit()

    with pytest.raises(RuntimeError, match="pending WCO password disappeared"):
        await configuration.promote_pending(attempt, now=frozen_clock.instant)

    state.lease_until = None
    await db.commit()
    with pytest.raises(worker.ForwardingClaimLost, match="superseded"):
        await configuration.stage_pending(
            attempt,
            "New-Dummy2!",
            SettingsCipher(worker.get_settings()),
            now=frozen_clock.instant,
        )


async def test_attempt_recorders_ignore_a_foreign_lease(db, frozen_clock, forwarding_key) -> None:
    fake = FakeWco()
    await _settings(db, fake, ForwardingMode.live)
    configuration = SqlAlchemyForwardingConfiguration(db)
    account = await configuration.account(SettingsCipher(worker.get_settings()))
    target = ForwardingTarget(
        frozen_clock.instant.date(), uuid.uuid4(), "Anna Kowalska", "+48500500500"
    )
    attempts = SqlAlchemyForwardingAttempts(db)
    attempt = await attempts.claim(
        account,
        target,
        now=frozen_clock.instant,
        lease_until=frozen_clock.instant + worker.FORWARDING_LEASE,
    )
    assert attempt is not None
    foreign = replace(attempt, lease_until=attempt.lease_until + timedelta(seconds=1))

    assert (
        await attempts.record_success(
            foreign,
            "+48600600600",
            ForwardingOutcome.dry_run,
            rotated=False,
            now=frozen_clock.instant,
        )
        is None
    )


async def test_change_requires_a_pending_password(db_factory, frozen_clock) -> None:
    account = worker.ForwardingAccount(
        ForwardingMode.live,
        "https://wco.test",
        "221234567",
        "oncall",
        "1001",
        Passwords("Dummy-Passw0rd!"),
    )
    fake = FakeWco()
    async with WcoClient("https://wco.test", transport=fake.transport()) as wco:
        attempt = worker.ForwardingAttempt(
            account,
            ForwardingTarget(frozen_clock.instant.date(), None, "Anna", "+48500500500"),
            frozen_clock.instant + worker.FORWARDING_LEASE,
            0,
        )
        with pytest.raises(RuntimeError, match="without a pending password"):
            await worker._change_pending_password(db_factory, wco, attempt)


async def test_admin_credentials_saved_during_rotation_are_never_overwritten(
    db, db_factory, frozen_clock, forwarding_key, monkeypatch
) -> None:
    fake = FakeWco(password_expired=True)
    _use_fake(monkeypatch, fake)
    admin, _member = await _primary(db, frozen_clock)
    await _settings(db, fake, ForwardingMode.live)
    promote = worker._promote_pending
    replacement = "Admin-Replacement9!"

    async def admin_changes_account_before_promotion(factory, attempt):
        async with SqlAlchemyUnitOfWork(factory) as session:
            await SqlAlchemyForwardingSettings(session).change(
                SettingsChange(
                    ForwardingMode.live,
                    "https://wco.test",
                    fake.vpbx_number,
                    "replacement-login",
                    fake.user_id,
                    admin.id,
                ),
                encrypt(worker.get_settings(), replacement),
            )
        return await promote(factory, attempt)

    monkeypatch.setattr(worker, "_promote_pending", admin_changes_account_before_promotion)

    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 0

    stored = await _one(db_factory, CallForwardingSettings)
    assert stored.username == "replacement-login"
    assert decrypt(worker.get_settings(), stored.password_ciphertext or "") == replacement
    assert stored.pending_password_ciphertext is None


async def test_lease_is_renewed_during_a_rotation_longer_than_the_initial_lease(
    db, db_factory, frozen_clock, forwarding_key, monkeypatch
) -> None:
    class AdvancingWco(FakeWco):
        def handle(self, request):
            frozen_clock.advance(timedelta(seconds=15))
            return super().handle(request)

    fake = AdvancingWco(password_expired=True)
    _use_fake(monkeypatch, fake)
    await _primary(db, frozen_clock)
    await _settings(db, fake, ForwardingMode.live)
    started = frozen_clock.instant

    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 1

    assert frozen_clock.instant - started > worker.FORWARDING_LEASE
    assert fake.user["number"] == "+48500500500"
    stored = await _one(db_factory, CallForwardingSettings)
    assert decrypt(worker.get_settings(), stored.password_ciphertext or "") == fake.password


async def test_renew_rejects_a_lease_revoked_by_a_settings_change_or_expired(
    db, db_factory, frozen_clock, forwarding_key, monkeypatch
) -> None:
    fake = FakeWco()
    _use_fake(monkeypatch, fake)
    admin, _member = await _primary(db, frozen_clock)
    await _settings(db, fake, ForwardingMode.live)
    attempt = await worker._prepare_forwarding(db_factory, now_warsaw=_now(frozen_clock))
    assert isinstance(attempt, worker.ForwardingAttempt)

    async with SqlAlchemyUnitOfWork(db_factory) as session:
        await SqlAlchemyForwardingSettings(session).change(
            SettingsChange(
                ForwardingMode.live,
                "https://wco.test",
                fake.vpbx_number,
                "replacement-login",
                fake.user_id,
                admin.id,
            ),
            None,
        )
        with pytest.raises(worker.ForwardingClaimLost, match="replaced"):
            await SqlAlchemyForwardingAttempts(session).renew(
                attempt,
                now=frozen_clock.instant,
                lease_until=frozen_clock.instant + worker.FORWARDING_LEASE,
            )
        await session.rollback()

    frozen_clock.advance(worker.FORWARDING_LEASE + timedelta(seconds=1))
    async with SqlAlchemyUnitOfWork(db_factory) as session:
        with pytest.raises(worker.ForwardingClaimLost, match="lease expired"):
            await SqlAlchemyForwardingAttempts(session).renew(
                attempt,
                now=frozen_clock.instant,
                lease_until=frozen_clock.instant + worker.FORWARDING_LEASE,
            )


async def test_unclaimed_failure_does_not_revoke_an_active_lease(
    db, db_factory, frozen_clock, forwarding_key, monkeypatch
) -> None:
    fake = FakeWco()
    _use_fake(monkeypatch, fake)
    await _primary(db, frozen_clock)
    settings = await _settings(db, fake, ForwardingMode.live)
    attempt = await worker._prepare_forwarding(db_factory, now_warsaw=_now(frozen_clock))
    assert isinstance(attempt, worker.ForwardingAttempt)

    settings.password_ciphertext = "not-a-valid-token"
    await db.commit()
    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 0

    state = await _one(db_factory, CallForwardingState)
    assert state.lease_until == attempt.lease_until.replace(tzinfo=None)


async def test_skipped_target_does_not_revoke_an_active_lease(
    db, db_factory, frozen_clock, forwarding_key, monkeypatch
) -> None:
    fake = FakeWco()
    _use_fake(monkeypatch, fake)
    primary, _member = await _primary(db, frozen_clock)
    await _settings(db, fake, ForwardingMode.live)
    attempt = await worker._prepare_forwarding(db_factory, now_warsaw=_now(frozen_clock))
    assert isinstance(attempt, worker.ForwardingAttempt)

    primary.phone = None
    await db.commit()
    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 0

    state = await _one(db_factory, CallForwardingState)
    assert state.lease_until == attempt.lease_until.replace(tzinfo=None)


async def test_changing_wco_user_invalidates_a_cached_success(
    db, db_factory, frozen_clock, forwarding_key, monkeypatch
) -> None:
    fake = FakeWco()
    _use_fake(monkeypatch, fake)
    admin, _member = await _primary(db, frozen_clock)
    await _settings(db, fake, ForwardingMode.live)
    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 1
    first_calls = len(fake.calls)

    fake.user_id = "2002"
    fake.user["number"] = "+48600600600"
    async with SqlAlchemyUnitOfWork(db_factory) as session:
        await SqlAlchemyForwardingSettings(session).change(
            SettingsChange(
                ForwardingMode.live,
                "https://wco.test",
                fake.vpbx_number,
                fake.username,
                fake.user_id,
                admin.id,
            ),
            None,
        )

    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 1
    assert len(fake.calls) > first_calls
    assert fake.user["number"] == "+48500500500"


async def test_a_corrected_target_does_not_inherit_obsolete_backoff(
    db, db_factory, frozen_clock, forwarding_key, monkeypatch
) -> None:
    fake = FakeWco(faults={f"{USER}/1001": 500})
    _use_fake(monkeypatch, fake)
    primary, _member = await _primary(db, frozen_clock)
    await _settings(db, fake, ForwardingMode.live)
    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 1

    primary.phone = "+48700700700"
    await db.commit()
    fake.faults.clear()
    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 1

    assert fake.user["number"] == "+48700700700"


async def test_dry_run_does_not_finish_a_pending_remote_password_change(
    db, db_factory, frozen_clock, forwarding_key, monkeypatch
) -> None:
    fake = FakeWco()
    _use_fake(monkeypatch, fake)
    await _primary(db, frozen_clock)
    settings = await _settings(db, fake, ForwardingMode.dry_run)
    settings.pending_password_ciphertext = encrypt(worker.get_settings(), "Pending-Dummy2!")
    await db.commit()

    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 1

    assert fake.password == "Dummy-Passw0rd!"
    assert f"POST {CHANGE_PASSWORD}" not in fake.calls
    assert await _all(db_factory, NotificationOutbox) == []
    stored = await _one(db_factory, CallForwardingSettings)
    assert stored.pending_password_ciphertext is not None


async def test_dry_run_never_rotates_an_expired_password_or_sends_an_alert(
    db, db_factory, frozen_clock, forwarding_key, monkeypatch
) -> None:
    fake = FakeWco(password_expired=True)
    _use_fake(monkeypatch, fake)
    await _primary(db, frozen_clock)
    await _settings(db, fake, ForwardingMode.dry_run)
    old = fake.password

    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 1

    assert fake.password == old
    assert f"POST {CHANGE_PASSWORD}" not in fake.calls
    assert await _all(db_factory, NotificationOutbox) == []
    stored = await _one(db_factory, CallForwardingSettings)
    assert stored.pending_password_ciphertext is None


async def test_dry_run_records_a_missing_phone_and_a_refused_login_without_an_alert(
    db, db_factory, frozen_clock, forwarding_key, monkeypatch
) -> None:
    fake = FakeWco()
    _use_fake(monkeypatch, fake)
    primary, _member = await _primary(db, frozen_clock, phone=None)
    await create_user(db, "admin", role=UserRole.admin, email="admin@example.com")
    await _settings(db, fake, ForwardingMode.dry_run)

    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 1
    state = await _one(db_factory, CallForwardingState)
    assert state.last_outcome is ForwardingOutcome.skipped_no_phone
    assert state.alerted_for is None

    primary.phone = "+48500500500"
    await db.commit()
    fake.faults[PERFORM_LOGIN] = 401
    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 1
    assert (await _one(db_factory, CallForwardingState)).last_outcome is ForwardingOutcome.failed
    assert await _all(db_factory, NotificationOutbox) == []
    events = await _all(db_factory, AuditEvent)
    assert [event.action for event in events] == ["forwarding.skipped", "forwarding.failed"]


async def test_transient_failure_after_an_alert_keeps_the_recovery_notification(
    db, db_factory, frozen_clock, forwarding_key, monkeypatch
) -> None:
    fake = FakeWco()
    _use_fake(monkeypatch, fake)
    primary, _member = await _primary(db, frozen_clock, phone=None)
    await create_user(db, "admin", role=UserRole.admin, email="admin@example.com")
    await _settings(db, fake, ForwardingMode.live)
    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 1
    alerted_for = (await _one(db_factory, CallForwardingState)).alerted_for
    assert alerted_for is not None

    primary.phone = "+48500500500"
    await db.commit()
    fake.faults[f"{USER}/1001"] = 500
    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 1
    assert (await _one(db_factory, CallForwardingState)).alerted_for == alerted_for

    fake.faults.clear()
    frozen_clock.advance(timedelta(minutes=2))
    assert await worker.scan_forwarding(db_factory, now_warsaw=_now(frozen_clock)) == 1
    rows = await _all(db_factory, NotificationOutbox)
    assert any(row.context["event"] == "forwarding_recovered" for row in rows)


async def test_missing_primary_recipient_is_ignored(db, frozen_clock) -> None:
    await create_user(db, "admin", role=UserRole.admin, email="admin@example.com")
    target = ForwardingTarget(
        frozen_clock.instant.date(), uuid.uuid4(), "Nieistniejąca Osoba", None
    )

    from oncall.notifications.triggers import enqueue_forwarding_alert

    assert (
        await enqueue_forwarding_alert(
            db,
            target,
            cause=ForwardingFailure.no_phone,
            applied_number=None,
            applied_at=None,
            dedup_prefix="missing-primary",
        )
        == 1
    )
