"""The WCO client against the fake WCO in `tests/wco_fake.py`, and the
password rotation driven through both as the forwarding pass will drive it.
"""

import logging
import ssl
from dataclasses import replace
from urllib.parse import quote

import httpx
import pytest

from oncall.domain.forwarding.passwords import AfterLogin, Passwords, generate_password
from oncall.wco import (
    MAX_REDIRECTS,
    WcoClient,
    WcoError,
    WcoLoginRefused,
    WcoPasswordExpired,
)
from tests.wco_fake import (
    BASE_URL,
    CHANGE_PASSWORD,
    LOGIN,
    PERFORM_LOGIN,
    USER,
    FakeWco,
)

TARGET = "+48500500500"


def client(fake: FakeWco) -> WcoClient:
    return WcoClient(BASE_URL, verify=ssl.create_default_context(), transport=fake.transport())


async def signed_in(wco: WcoClient, fake: FakeWco, password: str | None = None) -> None:
    await wco.login(fake.vpbx_number, fake.username, password or fake.password)


async def test_the_number_is_forwarded_through_a_session_carrying_the_xsrf_token() -> None:
    fake = FakeWco()
    async with client(fake) as wco:
        await signed_in(wco, fake)
        user = await wco.get_user(fake.user_id)
        await wco.update_user({**user, "number": TARGET})
        after = await wco.get_user(fake.user_id)

    assert after == {**user, "number": TARGET}
    assert fake.calls == [
        f"GET {LOGIN}",
        f"POST {PERFORM_LOGIN}",
        f"GET {USER}/1001",
        f"PUT {USER}",
        f"GET {USER}/1001",
    ]
    assert fake.bodies(PERFORM_LOGIN) == [
        {
            "vpbxNumber": "221234567",
            "username": "oncall",
            "password": fake.password,
            "language": None,
        }
    ]
    assert fake.bodies(USER) == [{**user, "number": TARGET}]
    assert "x-xsrf-token" not in fake.requests[0].headers
    for request in fake.requests[1:]:
        token = request.headers["x-xsrf-token"]
        assert f"XSRF-TOKEN={token}" in request.headers["cookie"]
        assert request.headers["content-type"] == "application/json;charset=UTF-8"


async def test_a_redirect_on_the_configured_origin_is_followed_with_the_session() -> None:
    fake = FakeWco(redirects={PERFORM_LOGIN: [f"{BASE_URL}{PERFORM_LOGIN}"], USER: [USER]})
    async with client(fake) as wco:
        await signed_in(wco, fake)
        user = await wco.get_user(fake.user_id)
        await wco.update_user({**user, "number": TARGET})

    assert fake.user["number"] == TARGET
    assert fake.calls == [
        f"GET {LOGIN}",
        f"POST {PERFORM_LOGIN}",
        f"POST {PERFORM_LOGIN}",
        f"GET {USER}/1001",
        f"PUT {USER}",
        f"PUT {USER}",
    ]
    assert len(fake.bodies(PERFORM_LOGIN)) == 2


@pytest.mark.parametrize(
    "location",
    [
        "https://attacker.invalid/capture",
        f"http://wco.test{PERFORM_LOGIN}",
        "https://wco.test:8443/",
    ],
)
async def test_a_redirect_to_another_origin_never_receives_the_password(location: str) -> None:
    fake = FakeWco(redirects={PERFORM_LOGIN: [location]})
    async with client(fake) as wco:
        with pytest.raises(WcoError, match="redirected to another host") as refused:
            await signed_in(wco, fake)

    assert refused.value.status == 307
    assert fake.calls == [f"GET {LOGIN}", f"POST {PERFORM_LOGIN}"]


async def test_a_redirect_loop_stops_at_the_hop_limit() -> None:
    fake = FakeWco(redirects={LOGIN: [LOGIN] * (MAX_REDIRECTS + 3)})
    async with client(fake) as wco:
        with pytest.raises(WcoError, match="HTTP 307") as looped:
            await signed_in(wco, fake)

    assert looped.value.status == 307
    assert fake.calls == [f"GET {LOGIN}"] * (MAX_REDIRECTS + 1)


async def test_a_second_login_opens_a_new_session() -> None:
    fake = FakeWco()
    async with client(fake) as wco:
        await signed_in(wco, fake)
        await signed_in(wco, fake)
        await wco.get_user(fake.user_id)

    first, second = fake.requests[1], fake.requests[3]
    assert first.headers["x-xsrf-token"] != second.headers["x-xsrf-token"]
    assert "Authorization" not in second.headers["cookie"]
    assert len(fake.sessions) == 2


async def test_a_refused_login_is_told_apart() -> None:
    fake = FakeWco()
    async with client(fake) as wco:
        with pytest.raises(WcoLoginRefused, match=f"POST {PERFORM_LOGIN} answered HTTP 401"):
            await signed_in(wco, fake, "Wrong-Passw0rd!")


async def test_an_expired_password_lets_the_login_in_and_refuses_the_user_calls() -> None:
    fake = FakeWco(password_expired=True)
    async with client(fake) as wco:
        await signed_in(wco, fake)
        with pytest.raises(WcoPasswordExpired) as read:
            await wco.get_user(fake.user_id)
        with pytest.raises(WcoPasswordExpired):
            await wco.update_user(fake.user)

    assert read.value.status == 403


async def test_the_password_change_sends_both_values_url_encoded_and_ends_the_session() -> None:
    fake = FakeWco(password_expired=True)
    old, new = fake.password, "N3w&Pass=word?+%x"
    async with client(fake) as wco:
        await signed_in(wco, fake)
        await wco.change_password(old, new)
        with pytest.raises(WcoError, match="answered HTTP 401"):
            await wco.get_user(fake.user_id)
        with pytest.raises(WcoLoginRefused):
            await signed_in(wco, fake, old)
        await signed_in(wco, fake, new)
        assert (await wco.get_user(fake.user_id))["number"] == "+48600600600"

    assert fake.bodies(CHANGE_PASSWORD) == [
        {"oldPassword": quote(old, safe=""), "newPassword": quote(new, safe="")}
    ]
    assert fake.password == new


async def test_a_new_password_wco_refuses_is_an_error_and_changes_nothing() -> None:
    fake = FakeWco(password_expired=True)
    old = fake.password
    async with client(fake) as wco:
        await signed_in(wco, fake)
        with pytest.raises(WcoError, match=f"POST {CHANGE_PASSWORD} answered HTTP 400") as refused:
            await wco.change_password(old, "weak")

    assert type(refused.value) is WcoError
    assert refused.value.status == 400
    assert fake.password == old


async def test_an_error_answer_names_the_call_and_status_and_never_the_body() -> None:
    fake = FakeWco(faults={f"{USER}/1001": 503})
    async with client(fake) as wco:
        await signed_in(wco, fake)
        with pytest.raises(WcoError) as failed:
            await wco.get_user(fake.user_id)

    assert str(failed.value) == f"GET {USER}/1001 answered HTTP 503"
    assert failed.value.status == 503


async def test_a_user_answer_that_is_no_json_object_is_an_error() -> None:
    fake = FakeWco(faults={f"{USER}/1001": 200})
    async with client(fake) as wco:
        await signed_in(wco, fake)
        with pytest.raises(WcoError, match="answered no user object") as failed:
            await wco.get_user(fake.user_id)

    assert failed.value.status == 200
    assert fake.password not in str(failed.value)


async def test_a_login_page_without_the_xsrf_cookie_stops_before_the_credentials() -> None:
    fake = FakeWco(faults={LOGIN: 200})
    async with client(fake) as wco:
        with pytest.raises(WcoError, match=f"GET {LOGIN} set no XSRF-TOKEN cookie"):
            await signed_in(wco, fake)

    assert fake.calls == [f"GET {LOGIN}"]


@pytest.mark.parametrize(
    "failure",
    [httpx.ConnectError("connection refused"), httpx.ReadTimeout("timed out")],
    ids=["connection", "timeout"],
)
async def test_a_network_failure_is_an_error_without_a_status(failure: Exception) -> None:
    fake = FakeWco(faults={PERFORM_LOGIN: failure})
    async with client(fake) as wco:
        with pytest.raises(
            WcoError, match=f"POST {PERFORM_LOGIN} failed: {type(failure).__name__}"
        ) as failed:
            await signed_in(wco, fake)

    assert failed.value.status is None


class Crash(Exception):
    """The worker stopping between two steps of the rotation."""


async def forwarding_pass(fake: FakeWco, disk: list[Passwords], crash: str = "") -> str | None:
    """The rotation protocol as the forwarding pass runs it: `disk` holds what
    each unit of work committed, the last entry what is stored now. Returns
    the number WCO forwards to, or None when every login was refused."""

    async def change(stored: Passwords) -> None:
        assert stored.pending is not None
        await wco.change_password(stored.current, stored.pending)
        if crash == "before promote":
            raise Crash
        await signed_in(wco, fake, stored.pending)
        disk.append(stored.promoted())

    async with client(fake) as wco:
        stored, accepted = disk[-1], None
        for password in stored.login_order():
            try:
                await signed_in(wco, fake, password)
            except WcoLoginRefused:
                continue
            accepted = password
            break
        step = stored.after_login(accepted)
        if step is AfterLogin.refused:
            return None
        if step is AfterLogin.promote:
            disk.append(stored.promoted())
        if step is AfterLogin.change:
            await change(stored)
        try:
            user = await wco.get_user(fake.user_id)
        except WcoPasswordExpired:
            stored = replace(disk[-1], pending=generate_password())
            disk.append(stored)
            if crash == "before change":
                raise Crash from None
            await change(stored)
            user = await wco.get_user(fake.user_id)
        return str(user["number"])


async def test_an_expired_password_is_rotated_and_the_pass_goes_on() -> None:
    fake = FakeWco(password_expired=True)
    old = fake.password
    disk = [Passwords(current=old)]

    assert await forwarding_pass(fake, disk) == "+48600600600"

    new = disk[1].pending
    assert disk == [Passwords(old), Passwords(old, new), Passwords(str(new))]
    assert fake.password == new
    assert fake.calls.count(f"POST {CHANGE_PASSWORD}") == 1


async def test_a_pass_stopped_after_the_change_promotes_the_pending_password_next_time() -> None:
    fake = FakeWco(password_expired=True)
    disk = [Passwords(current=fake.password)]
    with pytest.raises(Crash):
        await forwarding_pass(fake, disk, crash="before promote")
    new = disk[-1].pending
    assert fake.password == new

    assert await forwarding_pass(fake, disk) == "+48600600600"

    assert disk[-1] == Passwords(str(new))
    assert fake.calls.count(f"POST {CHANGE_PASSWORD}") == 1


async def test_a_pass_stopped_before_the_change_asks_for_it_again_with_the_same_password() -> None:
    fake = FakeWco(password_expired=True)
    old = fake.password
    disk = [Passwords(current=old)]
    with pytest.raises(Crash):
        await forwarding_pass(fake, disk, crash="before change")
    new = disk[-1].pending
    assert fake.password == old

    assert await forwarding_pass(fake, disk) == "+48600600600"

    assert disk[-1] == Passwords(str(new))
    assert fake.password == new
    assert fake.bodies(CHANGE_PASSWORD) == [
        {"oldPassword": quote(old, safe=""), "newPassword": quote(str(new), safe="")}
    ]


async def test_a_pass_refused_with_every_stored_password_logs_in_no_further() -> None:
    fake = FakeWco()
    disk = [Passwords(current="Stale-Passw0rd!", pending="Lost-Passw0rd!")]

    assert await forwarding_pass(fake, disk) is None

    assert fake.calls.count(f"POST {PERFORM_LOGIN}") == 2
    assert len(disk) == 1


async def test_no_secret_reaches_a_log_record_or_an_error(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    fake = FakeWco(password_expired=True)
    old = fake.password
    disk = [Passwords(current=old)]
    await forwarding_pass(fake, disk)
    errors: list[str] = []
    for faults in ({PERFORM_LOGIN: 500}, {CHANGE_PASSWORD: 400}):
        failing = FakeWco(password=str(disk[-1].current), faults=faults)
        async with client(failing) as wco:
            try:
                await signed_in(wco, failing)
                await wco.change_password(failing.password, "X")
            except WcoError as exc:
                errors.append(str(exc))

    secrets = {old, str(disk[-1].current), *fake.sessions}
    secrets |= {r.headers["x-xsrf-token"] for r in fake.requests if r.url.path != LOGIN}
    written = [record.getMessage() for record in caplog.records] + errors
    assert len(errors) == 2
    assert [secret for secret in secrets for line in written if secret in line] == []
