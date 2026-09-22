"""#32: the per-IP login throttle and the security log must trust `X-Real-IP`
only from a trusted reverse proxy, so a caller reaching the API directly cannot
spoof or rotate its throttle bucket."""

from httpx import ASGITransport, AsyncClient
from starlette.requests import Request

from oncall.database import SqlAlchemyUnitOfWork, get_db
from oncall.domain.access.models import LOGIN_ATTEMPTS_PER_IP
from oncall.main import app
from oncall.routes.access import _client_ip, _peer_is_trusted


def _request(peer: str | None, headers: dict[str, str] | None = None) -> Request:
    raw = [(key.lower().encode(), value.encode()) for key, value in (headers or {}).items()]
    scope = {
        "type": "http",
        "headers": raw,
        "client": (peer, 12345) if peer is not None else None,
    }
    return Request(scope)


def test_x_real_ip_is_honoured_from_a_trusted_proxy() -> None:
    request = _request("127.0.0.1", {"X-Real-IP": "203.0.113.9"})
    assert _client_ip(request) == "203.0.113.9"


def test_x_real_ip_is_ignored_from_an_untrusted_peer() -> None:
    request = _request("203.0.113.9", {"X-Real-IP": "10.0.0.5"})
    assert _client_ip(request) == "203.0.113.9"


def test_missing_x_real_ip_falls_back_to_the_socket_peer() -> None:
    assert _client_ip(_request("172.16.0.4")) == "172.16.0.4"


def test_a_request_without_a_client_is_unknown() -> None:
    assert _client_ip(_request(None, {"X-Real-IP": "10.0.0.1"})) == "unknown"


def test_private_ranges_are_trusted_and_public_ones_are_not() -> None:
    assert _peer_is_trusted("172.16.0.4") is True
    assert _peer_is_trusted("192.168.1.1") is True
    assert _peer_is_trusted("203.0.113.9") is False
    assert _peer_is_trusted("not-an-ip") is False
    assert _peer_is_trusted(None) is False


async def test_rotating_x_real_ip_from_a_direct_caller_cannot_bypass_the_ip_throttle(
    db_factory,
) -> None:
    """A direct caller (untrusted socket peer) rotating `X-Real-IP` on every
    request stays in one throttle bucket - its real socket address - so the
    per-IP limit still trips."""

    async def override_get_db():
        async with SqlAlchemyUnitOfWork(db_factory) as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app, client=("203.0.113.9", 5555))
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            for index in range(LOGIN_ATTEMPTS_PER_IP):
                response = await client.post(
                    "/api/v1/auth/login",
                    json={"username": f"nobody-{index}", "password": "wrong-password"},
                    headers={"X-Real-IP": f"10.0.0.{index}"},
                )
                assert response.status_code == 401

            blocked = await client.post(
                "/api/v1/auth/login",
                json={"username": "one-more-nobody", "password": "wrong-password"},
                headers={"X-Real-IP": "10.0.0.250"},
            )
            assert blocked.status_code == 429
    finally:
        app.dependency_overrides.clear()
