"""One request owns one transaction (target architecture rule 2, finding A05).

Authentication and the route it guards read through the same session, so an
authenticated request holds one pooled connection and stages its work in one
transaction. A probe route is the only way to observe that from outside.
"""

from typing import Annotated

import pytest
from fastapi import Depends
from httpx import AsyncClient
from sqlalchemy import inspect
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.auth import CurrentPrincipal
from oncall.database import get_db
from oncall.main import app
from tests.conftest import create_user, login

PROBE_PATH = "/__unit_of_work_probe"


@app.get(PROBE_PATH, include_in_schema=False)
async def _probe(
    principal: CurrentPrincipal,
    route_db: Annotated[AsyncSession, Depends(get_db, scope="function")],
) -> dict[str, bool]:
    # What loaded the principal is the sync session behind the route's
    # AsyncSession. Comparing against the AsyncSession itself always reports a
    # difference that is not there.
    return {"shared": inspect(principal.session).session is route_db.sync_session}


@pytest.mark.anyio
async def test_authentication_and_the_route_share_one_session(
    client: AsyncClient, db: AsyncSession
) -> None:
    await create_user(db, "sonda")
    await login(client, "sonda")

    body = (await client.get(PROBE_PATH)).json()

    assert body["shared"] is True
