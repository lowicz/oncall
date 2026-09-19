"""Synchroniczny `POST /scheduling/generate` już nie istnieje (D4, HGH5-04).

Budżet solvera równał się `proxy_read_timeout` nginx, więc żądanie zawsze
kończyło się 504, zostawiając w bazie gotowy, ale osierocony szkic. Interfejs
korzysta z `/scheduling/runs`; sama funkcja żyje dalej dla workera i testów.
"""

from datetime import date, timedelta

from oncall.main import app
from oncall.models import UserRole
from tests.conftest import create_member, create_user, generate_draft_directly, login


async def test_the_synchronous_generate_endpoint_is_gone(client, db) -> None:
    await create_user(db, "koord.sync", role=UserRole.coordinator)
    await login(client, "koord.sync")
    start = date.today() + timedelta(days=1)
    response = await client.post(
        "/api/v1/scheduling/generate",
        json={"starts_on": start.isoformat(), "ends_on": (start + timedelta(days=6)).isoformat()},
    )
    assert response.status_code in (404, 405), response.text
    paths = {getattr(route, "path", None) for route in app.router.routes}
    assert "/api/v1/scheduling/generate" not in paths, sorted(
        path for path in paths if path and "scheduling" in path
    )


async def test_the_function_behind_it_still_produces_a_draft(client, db) -> None:
    for username, name in (
        ("anna.sync", "Anna Sync"),
        ("marek.sync", "Marek Sync"),
        ("julia.sync", "Julia Sync"),
        ("piotr.sync", "Piotr Sync"),
    ):
        user = await create_user(db, username, display_name=name)
        await create_member(db, user, display_name=name)
    await create_user(db, "koord.sync", role=UserRole.coordinator)

    start = date.today() + timedelta(days=1)
    draft = await generate_draft_directly(db, "koord.sync", start, start + timedelta(days=6))
    assert draft["assignments"], draft
    assert draft["status"] == "draft"

    await login(client, "koord.sync")
    reloaded = await client.get(f"/api/v1/scheduling/{draft['id']}")
    assert reloaded.status_code == 200, reloaded.text
