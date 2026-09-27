"""The edges of who holds a session: a deactivated account, a principal with
neither an account nor a link, the proxy list an operator mistyped, and the
member lookup behind member-scoped endpoints."""

import logging
from datetime import UTC, date, datetime

import pytest
from fastapi import HTTPException
from sqlalchemy import update

from oncall.auth import Principal
from oncall.config import get_settings
from oncall.domain.access import errors
from oncall.domain.vocabulary import UserRole
from oncall.i18n import translate
from oncall.infrastructure.sqlalchemy.access_models import Session, User
from oncall.infrastructure.sqlalchemy.sharing_models import ShareLink
from oncall.routes.access import _log_refusal, _peer_is_trusted, share_principal_response
from tests.conftest import create_user, login


async def test_a_session_of_an_account_deactivated_since_sign_in_is_refused(client, db) -> None:
    """Deactivating an account ends what it can do at once, not when its
    session cookie runs out."""
    user = await create_user(db, "ewa.n")
    await login(client, "ewa.n")
    assert (await client.get("/api/v1/auth/me")).status_code == 200

    await db.execute(update(User).where(User.id == user.id).values(is_active=False))
    await db.commit()
    response = await client.get("/api/v1/auth/me")

    assert response.status_code == 401
    assert response.json()["detail"] == translate("access.account_inactive")


def _link(label: str) -> ShareLink:
    return ShareLink(
        label=label,
        starts_on=date(2027, 1, 1),
        ends_on=date(2027, 1, 31),
        expires_at=datetime(2027, 2, 1, tzinfo=UTC),
    )


def test_a_principal_is_named_after_its_account_or_else_its_link() -> None:
    account = User(username="ewa.n", display_name="Ewa Nowak", role=UserRole.coordinator)

    by_account = Principal(Session(user=account))
    by_link = Principal(Session(share_link=_link("Dyżury na styczeń")))
    by_nothing = Principal(Session())

    assert (by_account.display_name, by_account.role) == ("Ewa Nowak", UserRole.coordinator)
    assert (by_link.display_name, by_link.role) == ("Dyżury na styczeń", UserRole.viewer)
    assert (by_nothing.display_name, by_nothing.role) == ("", UserRole.viewer)


def test_a_share_session_without_its_link_is_a_server_error_not_a_viewer() -> None:
    """The schema forbids a session with no owner; should one appear, the
    answer must not invent a viewer with no date range."""
    orphan = Principal(Session())

    with pytest.raises(HTTPException) as refused:
        share_principal_response(orphan)

    assert refused.value.status_code == 500
    assert refused.value.detail == translate("access.session_link_missing")


def test_a_mistyped_trusted_proxy_trusts_nothing_rather_than_everything(monkeypatch) -> None:
    monkeypatch.setattr(get_settings(), "trusted_proxies", ["10.0.0.0/8", "nginx", "::1/999"])

    assert _peer_is_trusted("10.20.30.40") is True
    assert _peer_is_trusted("192.168.1.1") is False
    assert _peer_is_trusted("::1") is False


def test_a_refusal_of_an_unexpected_kind_is_logged_by_its_type(caplog) -> None:
    caplog.set_level(logging.INFO, logger="oncall.login")

    _log_refusal("ewa.n", errors.AccountLinkInvalid())

    record = caplog.records[-1]
    assert record.name == "oncall.login"
    assert record.levelno == logging.INFO
    assert record.getMessage().endswith("login=ewa.n outcome=AccountLinkInvalid")
