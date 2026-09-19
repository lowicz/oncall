from datetime import date, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.models import UserRole
from tests.conftest import create_member, create_user, login


@pytest.mark.anyio
async def test_cannot_create_swap_for_past_duty(client: AsyncClient, db: AsyncSession) -> None:
    user = await create_user(db, "anna", display_name="Anna Wróbel")
    await create_member(db, user, display_name="Anna Wróbel")
    replacement_user = await create_user(db, "ola", display_name="Ola Nowak")
    replacement = await create_member(db, replacement_user, display_name="Ola Nowak")
    await login(client, "anna")

    response = await client.post(
        "/api/v1/swaps",
        json={
            "schedule_id": "00000000-0000-0000-0000-000000000001",
            "service_date": (date.today() - timedelta(days=1)).isoformat(),
            "role": "primary",
            "replacement_member_id": str(replacement.id),
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Nie można zamienić dyżuru, który już się odbył"


@pytest.mark.anyio
async def test_past_options_are_empty(client: AsyncClient, db: AsyncSession) -> None:
    user = await create_user(db, "koord", role=UserRole.coordinator)
    await login(client, user.username)
    response = await client.get(
        "/api/v1/swaps/options",
        params={
            "service_date": (date.today() - timedelta(days=1)).isoformat(),
            "role": "primary",
        },
    )
    assert response.status_code == 200
    assert response.json() == []
