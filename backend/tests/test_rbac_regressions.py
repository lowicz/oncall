from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.models import UserRole

from .conftest import create_user, login


async def test_viewer_is_rejected_by_entire_swaps_router_before_body_validation(
    client: AsyncClient, db: AsyncSession
) -> None:
    await create_user(db, "viewer-swaps", role=UserRole.viewer)
    await login(client, "viewer-swaps")

    assert (await client.get("/api/v1/swaps")).status_code == 403
    # An invalid body used to produce 422 before the accidental membership
    # check. The router-level role guard must win consistently (SEC-01).
    assert (await client.post("/api/v1/swaps", json={})).status_code == 403


async def test_viewer_is_rejected_by_availability_router(
    client: AsyncClient, db: AsyncSession
) -> None:
    await create_user(db, "viewer-availability", role=UserRole.viewer)
    await login(client, "viewer-availability")

    assert (await client.get("/api/v1/availability/me")).status_code == 403
