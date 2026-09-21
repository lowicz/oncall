from datetime import timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from oncall import auth
from oncall.domain.access.models import LOGIN_ATTEMPTS_PER_IP
from oncall.domain.clock import as_utc
from oncall.infrastructure.sqlalchemy.audit_model import AuditEvent
from tests.conftest import TEST_PASSWORD, create_user


@pytest.mark.anyio
async def test_login_normalizes_username_and_throttles_sixth_failure(
    client: AsyncClient, db: AsyncSession
) -> None:
    await create_user(db, "ewa.maj")

    normalized = await client.post(
        "/api/v1/auth/login",
        json={"username": " EWA.MAJ ", "password": TEST_PASSWORD},
    )
    assert normalized.status_code == 200
    await client.post(
        "/api/v1/auth/logout",
        headers={"X-CSRF-Token": normalized.headers["x-csrf-token"]},
    )

    for _ in range(5):
        failed = await client.post(
            "/api/v1/auth/login",
            json={"username": "ewa.maj", "password": "wrong-password"},
        )
        assert failed.status_code == 401

    throttled = await client.post(
        "/api/v1/auth/login",
        json={"username": "ewa.maj", "password": "wrong-password"},
    )
    assert throttled.status_code == 429
    assert throttled.headers["retry-after"] == "60"


@pytest.mark.anyio
async def test_unknown_user_has_the_same_public_error(
    client: AsyncClient, db: AsyncSession
) -> None:
    response = await client.post(
        "/api/v1/auth/login",
        json={"username": "does-not-exist", "password": "wrong-password"},
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "Nieprawidłowy login lub hasło"


@pytest.mark.anyio
async def test_a_shared_office_ip_does_not_lock_out_the_whole_team(
    client: AsyncClient, db: AsyncSession
) -> None:
    """QA7 par. 8, E1 review: after failing `julia.nowak` five times, `admin`
    logging in correctly from the same address used to get 429 too."""
    await create_user(db, "julia.nowak")
    await create_user(db, "admin")

    for _ in range(5):
        failed = await client.post(
            "/api/v1/auth/login",
            json={"username": "julia.nowak", "password": "wrong-password"},
        )
        assert failed.status_code == 401

    blocked_user = await client.post(
        "/api/v1/auth/login",
        json={"username": "julia.nowak", "password": "wrong-password"},
    )
    assert blocked_user.status_code == 429

    other_user = await client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": TEST_PASSWORD},
    )
    assert other_user.status_code == 200


@pytest.mark.anyio
async def test_a_forged_x_forwarded_for_header_does_not_change_the_ip_bucket(
    client: AsyncClient, db: AsyncSession
) -> None:
    """QA7 par. 8, E1 review: `X-Forwarded-For` is client-supplied through
    nginx (`$proxy_add_x_forwarded_for` only appends to it), so a script that
    relabelled itself with a fresh `X-Forwarded-For` on every request evaded
    the per-IP limit entirely. Only `X-Real-IP`, which nginx sets from
    `$remote_addr` and a client cannot influence, is trusted for the IP
    bucket."""
    for index in range(LOGIN_ATTEMPTS_PER_IP):
        response = await client.post(
            "/api/v1/auth/login",
            json={"username": f"nobody-{index}", "password": "wrong-password"},
            headers={"X-Forwarded-For": f"10.0.0.{index}"},
        )
        assert response.status_code == 401

    blocked = await client.post(
        "/api/v1/auth/login",
        json={"username": "yet-another-nobody", "password": "wrong-password"},
        headers={"X-Forwarded-For": "10.0.0.250"},
    )
    assert blocked.status_code == 429


@pytest.mark.anyio
async def test_a_volume_flood_of_distinct_logins_still_trips_the_ip_limit(
    client: AsyncClient, db: AsyncSession
) -> None:
    """The attack `X-Forwarded-For` cannot defeat any more: many different
    logins, one real IP, none of them individually reaching the per-account
    limit (QA7 par. 8, E1 review)."""
    for index in range(LOGIN_ATTEMPTS_PER_IP):
        response = await client.post(
            "/api/v1/auth/login",
            json={"username": f"random-login-{index}", "password": "wrong-password"},
        )
        assert response.status_code == 401

    blocked = await client.post(
        "/api/v1/auth/login",
        json={"username": "one-more-random-login", "password": "wrong-password"},
    )
    assert blocked.status_code == 429


@pytest.mark.anyio
async def test_x_real_ip_still_separates_genuinely_different_clients(
    client: AsyncClient, db: AsyncSession
) -> None:
    for index in range(LOGIN_ATTEMPTS_PER_IP):
        response = await client.post(
            "/api/v1/auth/login",
            json={"username": f"random-login-{index}", "password": "wrong-password"},
            headers={"X-Real-IP": "192.168.1.50"},
        )
        assert response.status_code == 401

    from_a_different_real_client = await client.post(
        "/api/v1/auth/login",
        json={"username": "someone-else", "password": "wrong-password"},
        headers={"X-Real-IP": "192.168.1.99"},
    )
    assert from_a_different_real_client.status_code == 401


@pytest.mark.anyio
async def test_an_existing_account_with_the_wrong_password_hashes_only_once(
    client: AsyncClient, db: AsyncSession, monkeypatch
) -> None:
    """QA7 par. 8, E1 review: a wrong password for a real account ran a real
    Argon2 verification *and then* the dummy one on the directory fallback,
    costing roughly twice what a nonexistent account costs (measured 81.5 ms
    vs 44.5 ms) - itself a timing side channel disclosing the account
    exists. Call-count is asserted directly instead of wall-clock time, which
    would be flaky under test-suite load."""
    await create_user(db, "existing.user")
    calls = 0
    real_verify = auth.verify_password_async

    async def counting_verify(password_hash, password):
        nonlocal calls
        calls += 1
        return await real_verify(password_hash, password)

    monkeypatch.setattr(auth, "verify_password_async", counting_verify)

    calls = 0
    await client.post(
        "/api/v1/auth/login",
        json={"username": "existing.user", "password": "wrong-password"},
    )
    existing_account_calls = calls

    calls = 0
    await client.post(
        "/api/v1/auth/login",
        json={"username": "does-not-exist-either", "password": "wrong-password"},
    )
    nonexistent_account_calls = calls

    assert existing_account_calls == nonexistent_account_calls == 1


@pytest.mark.anyio
async def test_throttled_requests_write_one_aggregated_audit_row(
    client: AsyncClient, db: AsyncSession, frozen_clock
) -> None:
    """QA7 par. 8, E1 review: one flood against a single login wrote 13 422
    `auth.throttled` rows in 30 s; each rejected request must instead update
    the same rolling row, the way `auth.login_failed` already does."""
    await create_user(db, "flooded.user")

    for _ in range(5):
        frozen_clock.advance(timedelta(seconds=1))
        await client.post(
            "/api/v1/auth/login",
            json={"username": "flooded.user", "password": "wrong-password"},
        )
    last_failure_at = frozen_clock.instant
    for _ in range(4):
        frozen_clock.advance(timedelta(seconds=1))
        response = await client.post(
            "/api/v1/auth/login",
            json={"username": "flooded.user", "password": "wrong-password"},
        )
        assert response.status_code == 429

    rows = (
        await db.scalars(
            select(AuditEvent).where(
                AuditEvent.action == "auth.throttled",
                AuditEvent.actor_label == "flooded.user",
            )
        )
    ).all()
    assert len(rows) == 1
    assert rows[0].details["count"] == 4
    # The rolling rows move to the clock's instant of their latest request.
    assert as_utc(rows[0].occurred_at) == frozen_clock.instant
    failures = (
        await db.scalars(
            select(AuditEvent).where(
                AuditEvent.action == "auth.login_failed",
                AuditEvent.actor_label == "flooded.user",
            )
        )
    ).all()
    assert len(failures) == 1
    assert as_utc(failures[0].occurred_at) == last_failure_at

    total = await db.scalar(
        select(func.count()).select_from(AuditEvent).where(AuditEvent.action == "auth.throttled")
    )
    assert total == 1


@pytest.mark.anyio
async def test_retry_after_grows_with_repeated_throttling(
    client: AsyncClient, db: AsyncSession
) -> None:
    await create_user(db, "persistent.attacker")
    for _ in range(5):
        await client.post(
            "/api/v1/auth/login",
            json={"username": "persistent.attacker", "password": "wrong-password"},
        )

    first = await client.post(
        "/api/v1/auth/login",
        json={"username": "persistent.attacker", "password": "wrong-password"},
    )
    second = await client.post(
        "/api/v1/auth/login",
        json={"username": "persistent.attacker", "password": "wrong-password"},
    )
    assert int(first.headers["retry-after"]) < int(second.headers["retry-after"])
