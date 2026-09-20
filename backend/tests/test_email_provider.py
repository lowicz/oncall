from dataclasses import replace

import aiosmtplib
import pytest

from oncall.config import Settings
from oncall.notifications.base import (
    NotificationDisabled,
    NotificationError,
    NotificationMessage,
    TemporaryNotificationError,
)
from oncall.notifications.email import SmtpEmailProvider


def settings_with(**overrides) -> Settings:
    values = {
        "smtp_host": "smtp.example.com",
        "smtp_port": 587,
        "smtp_username": "oncall",
        "smtp_password": "secret",
        "smtp_local_hostname": "oncall.internal.example.com",
        "smtp_use_tls": False,
        "smtp_starttls": True,
        "email_from": "On-call <oncall@example.com>",
    }
    values.update(overrides)
    return Settings(**values)


def message() -> NotificationMessage:
    return NotificationMessage(
        channel="email",
        recipient="anna@example.com",
        subject="Prośba o zamianę",
        body="Treść wiadomości",
    )


async def test_send_passes_full_smtp_configuration(monkeypatch) -> None:
    captured = {}

    async def fake_send(email_message, **kwargs):
        captured["message"] = email_message
        captured.update(kwargs)

    monkeypatch.setattr(aiosmtplib, "send", fake_send)
    provider = SmtpEmailProvider(settings_with())
    await provider.send(message())

    assert captured["hostname"] == "smtp.example.com"
    assert captured["port"] == 587
    assert captured["username"] == "oncall"
    assert captured["password"] == "secret"
    assert captured["local_hostname"] == "oncall.internal.example.com"
    assert captured["use_tls"] is False
    assert captured["start_tls"] is True
    email = captured["message"]
    assert email["From"] == "On-call <oncall@example.com>"
    assert email["To"] == "anna@example.com"
    assert email["Subject"] == "Prośba o zamianę"
    assert "Treść wiadomości" in email.get_content()


async def test_local_hostname_is_optional(monkeypatch) -> None:
    captured = {}

    async def fake_send(email_message, **kwargs):
        captured.update(kwargs)

    monkeypatch.setattr(aiosmtplib, "send", fake_send)
    provider = SmtpEmailProvider(settings_with(smtp_local_hostname=None))
    await provider.send(message())
    assert captured["local_hostname"] is None


async def test_missing_host_disables_provider() -> None:
    provider = SmtpEmailProvider(settings_with(smtp_host=None))
    with pytest.raises(NotificationDisabled):
        await provider.send(message())


async def test_authentication_error_is_permanent(monkeypatch) -> None:
    async def fake_send(email_message, **kwargs):
        raise aiosmtplib.SMTPAuthenticationError(535, "auth failed")

    monkeypatch.setattr(aiosmtplib, "send", fake_send)
    provider = SmtpEmailProvider(settings_with())
    with pytest.raises(NotificationError):
        await provider.send(message())


async def test_recipients_refused_is_permanent(monkeypatch) -> None:
    async def fake_send(email_message, **kwargs):
        raise aiosmtplib.SMTPRecipientsRefused(["anna@example.com"])

    monkeypatch.setattr(aiosmtplib, "send", fake_send)
    provider = SmtpEmailProvider(settings_with())
    with pytest.raises(NotificationError):
        await provider.send(message())


async def test_connection_error_is_temporary(monkeypatch) -> None:
    async def fake_send(email_message, **kwargs):
        raise aiosmtplib.SMTPConnectError("connection refused")

    monkeypatch.setattr(aiosmtplib, "send", fake_send)
    provider = SmtpEmailProvider(settings_with())
    with pytest.raises(TemporaryNotificationError):
        await provider.send(message())


async def test_os_error_is_temporary(monkeypatch) -> None:
    async def fake_send(email_message, **kwargs):
        raise OSError("network unreachable")

    monkeypatch.setattr(aiosmtplib, "send", fake_send)
    provider = SmtpEmailProvider(settings_with())
    with pytest.raises(TemporaryNotificationError):
        await provider.send(message())


def test_a_retry_carries_the_message_id_of_the_original() -> None:
    """Delivery is at-least-once (decision D-03), so the same outbox row can
    reach the server twice. A `Message-ID` derived from the row rather than
    generated per send is what makes the second copy recognisable as a repeat -
    to a deduplicating relay, to a client threading it, and to whoever is
    reading the logs. It does not by itself stop the copy arriving.
    """
    provider = SmtpEmailProvider(settings_with())
    row_id = "7b1b0f1e-0000-4000-8000-000000000001"

    first = provider.build_message(replace(message(), idempotency_key=row_id))
    retry = provider.build_message(replace(message(), idempotency_key=row_id))
    other_row = provider.build_message(
        replace(message(), idempotency_key="7b1b0f1e-0000-4000-8000-000000000002")
    )

    assert first["Message-ID"] == retry["Message-ID"]
    assert first["Message-ID"] != other_row["Message-ID"]
    # The domain comes from the configured sender, so the header is well formed
    # for the server that will actually relay it.
    assert first["Message-ID"] == f"<{row_id}@example.com>"


def test_a_message_with_no_key_still_gets_a_well_formed_header() -> None:
    """Nothing in production sends one - `_deliver` always fills the key in -
    but a header the mail server would reject is not the right way to find out
    about a caller that forgot."""
    provider = SmtpEmailProvider(settings_with())

    built = provider.build_message(message())

    assert built["Message-ID"].startswith("<")
    assert built["Message-ID"].endswith("@example.com>")


def test_a_sender_without_a_domain_still_gets_a_well_formed_header() -> None:
    provider = SmtpEmailProvider(settings_with(email_from="oncall"))

    built = provider.build_message(replace(message(), idempotency_key="abc"))

    assert built["Message-ID"] == "<abc@oncall.invalid>"
