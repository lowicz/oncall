import base64
import ssl
from dataclasses import replace
from pathlib import Path

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
from tests.smtp_relay import Relay, private_ca, serving


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


@pytest.mark.parametrize("blank", ["", "   "], ids=["empty", "spaces"])
async def test_empty_local_hostname_is_normalized_to_none(monkeypatch, blank) -> None:
    """#35: the documented empty default (and how compose passes an unset value)
    resolves to "", which aiosmtplib rejects; it must reach the library as None
    so every notification is not silently dropped."""
    captured = {}

    async def fake_send(email_message, **kwargs):
        captured.update(kwargs)

    monkeypatch.setattr(aiosmtplib, "send", fake_send)
    provider = SmtpEmailProvider(settings_with(smtp_local_hostname=blank))
    await provider.send(message())
    assert captured["local_hostname"] is None


@pytest.mark.parametrize("blank", ["", "   "], ids=["empty", "spaces"])
async def test_empty_credentials_send_without_logging_in(monkeypatch, blank) -> None:
    """`.env.example` leaves ONCALL_SMTP_USERNAME and ONCALL_SMTP_PASSWORD empty
    for a relay without authentication, and compose passes them as "". aiosmtplib
    logs in whenever a username is not None, which such a relay refuses ("The
    SMTP AUTH extension is not supported"), so "" must reach it as None."""
    captured = {}

    async def fake_send(email_message, **kwargs):
        captured.update(kwargs)

    monkeypatch.setattr(aiosmtplib, "send", fake_send)
    provider = SmtpEmailProvider(settings_with(smtp_username=blank, smtp_password=blank))
    await provider.send(message())
    assert captured["username"] is None
    assert captured["password"] is None


@pytest.mark.parametrize(("use_tls", "starttls"), [(False, True), (True, False), (False, False)])
async def test_the_transport_reaches_the_library_as_configured(
    monkeypatch, use_tls, starttls
) -> None:
    """STARTTLS on 587, TLS from the first byte on 465, a plain connection to
    a relay on 25: each goes to aiosmtplib unchanged."""
    captured = {}

    async def fake_send(email_message, **kwargs):
        captured.update(kwargs)

    monkeypatch.setattr(aiosmtplib, "send", fake_send)
    provider = SmtpEmailProvider(settings_with(smtp_use_tls=use_tls, smtp_starttls=starttls))
    await provider.send(message())
    assert (captured["use_tls"], captured["start_tls"]) == (use_tls, starttls)


@pytest.mark.parametrize("host", [None, "", "   "])
async def test_missing_host_disables_provider(host) -> None:
    provider = SmtpEmailProvider(settings_with(smtp_host=host))
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


def test_an_html_body_goes_out_as_an_alternative_to_the_text() -> None:
    """One `multipart/alternative` mail: the plain text first, for a client
    that renders no HTML, and the HTML for one that does. Either part reads
    on its own."""
    provider = SmtpEmailProvider(settings_with())
    html = "<html><body><p>Treść <b>wiadomości</b></p></body></html>"

    built = provider.build_message(replace(message(), html_body=html))

    assert built.get_content_type() == "multipart/alternative"
    parts = {part.get_content_type(): part.get_content() for part in built.iter_parts()}
    assert list(parts) == ["text/plain", "text/html"]
    assert parts["text/plain"].strip() == "Treść wiadomości"
    assert parts["text/html"].strip() == html
    assert built.get_body(("html",)).get_content().strip() == html


def test_a_message_without_html_stays_plain_text() -> None:
    """A row enqueued before the HTML rendering existed still goes out as it
    was composed."""
    provider = SmtpEmailProvider(settings_with())

    built = provider.build_message(message())

    assert built.get_content_type() == "text/plain"
    assert built.get_content().strip() == "Treść wiadomości"


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


def through(relay: Relay, **overrides) -> SmtpEmailProvider:
    """The provider pointed at `relay` over a plain connection, as at a relay
    on port 25, without credentials unless the test gives them."""
    values = {
        "smtp_host": "127.0.0.1",
        "smtp_port": relay.port,
        "smtp_starttls": False,
        "smtp_username": "",
        "smtp_password": "",
    }
    return SmtpEmailProvider(settings_with(**(values | overrides)))


@pytest.mark.parametrize("blank", ["", "   "], ids=["empty", "spaces"])
async def test_a_relay_that_trusts_the_application_gets_the_mail_without_a_login(blank) -> None:
    """A relay that takes no login decides by the name the application gives
    in EHLO whether it may send. The application must not try AUTH, which
    such a relay does not offer, and hands the message over with its
    envelope."""
    with serving(Relay(trusted_client="oncall.internal.example.com")) as relay:
        await through(relay, smtp_username=blank, smtp_password=blank).send(message())

    assert relay.commands[0] == "EHLO oncall.internal.example.com"
    assert relay.verbs == ["EHLO", "MAIL", "RCPT", "DATA", "QUIT"]
    assert relay.commands[1].startswith("MAIL FROM:<oncall@example.com>")
    assert relay.commands[2] == "RCPT TO:<anna@example.com>"
    [delivered] = relay.messages
    assert b"To: anna@example.com" in delivered


async def test_a_relay_that_does_not_trust_the_application_refuses_it_for_good() -> None:
    """The relay's refusal is its decision, not a hiccup: the message fails
    without a retry, with the relay's answer as the reason."""
    with serving(Relay(trusted_client="someone-else.example.com")) as relay:
        provider = through(relay)
        with pytest.raises(NotificationError, match="Relaying denied") as refused:
            await provider.send(message())

    assert not isinstance(refused.value, TemporaryNotificationError)
    assert "AUTH" not in relay.verbs
    assert relay.messages == []


async def test_a_server_that_wants_a_login_gets_it_before_the_mail() -> None:
    with serving(Relay(credentials=("oncall", "secret"))) as relay:
        await through(relay, smtp_username="oncall", smtp_password="secret").send(message())

    assert relay.verbs == ["EHLO", "AUTH", "MAIL", "RCPT", "DATA", "QUIT"]
    assert relay.commands[1] == "AUTH PLAIN " + base64.b64encode(b"\0oncall\0secret").decode()
    assert len(relay.messages) == 1


async def test_a_refused_login_is_permanent() -> None:
    with serving(Relay(credentials=("oncall", "secret"))) as relay:
        provider = through(relay, smtp_username="oncall", smtp_password="wrong")
        with pytest.raises(NotificationError, match="Odmowa uwierzytelnienia SMTP") as refused:
            await provider.send(message())

    assert not isinstance(refused.value, TemporaryNotificationError)
    assert relay.messages == []


async def test_a_server_on_an_internal_pki_is_trusted_through_its_ca_file(tmp_path: Path) -> None:
    """A certificate from an internal CA fails verification against the
    image's public roots, as the deployment that reported it saw; with that
    CA in `smtp_ca_file` the same STARTTLS session carries the message."""
    ca_file, server_tls = private_ca(tmp_path)
    with serving(Relay(tls=server_tls)) as relay:
        with pytest.raises(
            TemporaryNotificationError, match="self-signed certificate in certificate chain"
        ):
            await through(relay, smtp_starttls=True).send(message())
        assert relay.messages == []

        await through(relay, smtp_starttls=True, smtp_ca_file=str(ca_file)).send(message())

    refused, delivered = ["EHLO", "STARTTLS"], ["EHLO", "MAIL", "RCPT", "DATA", "QUIT"]
    assert relay.verbs == refused + refused + delivered
    assert len(relay.messages) == 1


def test_the_ca_file_is_added_to_the_public_roots(tmp_path: Path) -> None:
    ca_file, _ = private_ca(tmp_path)
    public = SmtpEmailProvider(settings_with()).tls_context().cert_store_stats()["x509_ca"]

    context = SmtpEmailProvider(settings_with(smtp_ca_file=str(ca_file))).tls_context()

    assert context.cert_store_stats()["x509_ca"] == public + 1
    assert context.verify_mode is ssl.CERT_REQUIRED and context.check_hostname


@pytest.mark.parametrize("blank", ["", "   "], ids=["empty", "spaces"])
def test_a_blank_ca_file_leaves_the_public_roots_alone(blank) -> None:
    assert settings_with(smtp_ca_file=blank).smtp_ca_file is None


async def test_an_unreadable_ca_file_is_a_temporary_failure_naming_it(tmp_path: Path) -> None:
    """Compose creates a missing bind source as an empty directory; the
    message waits for the operator to mount the file instead of being lost."""
    provider = SmtpEmailProvider(settings_with(smtp_ca_file=str(tmp_path)))
    with pytest.raises(TemporaryNotificationError, match=f"Plik CA serwera SMTP.*{tmp_path}"):
        await provider.send(message())
