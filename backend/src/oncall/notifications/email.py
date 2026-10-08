"""SMTP e-mail provider for the notification outbox.

Connects to an external SMTP service configured through environment
variables. No mail server is hosted by this project.
"""

import logging
import ssl
from email.message import EmailMessage
from email.utils import parseaddr
from uuid import uuid4

import aiosmtplib

from oncall.config import Settings
from oncall.notifications.base import (
    NotificationDisabled,
    NotificationError,
    NotificationMessage,
    NotificationProvider,
    TemporaryNotificationError,
)

logger = logging.getLogger(__name__)


class SmtpEmailProvider:
    channel = "email"

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def build_message(self, message: NotificationMessage) -> EmailMessage:
        email = EmailMessage()
        email["From"] = self._settings.email_from
        email["To"] = message.recipient
        email["Subject"] = message.subject
        # Derived from the outbox row rather than generated per send, so the
        # retry of a message carries the identity of the original. Delivery is
        # at-least-once (decision D-03) and this does not by itself stop a
        # second copy arriving; what it does is make the second copy
        # recognisable as the same message - to a deduplicating relay, to a
        # mail client threading it, and to whoever is reading the logs.
        email["Message-ID"] = self.message_id(message)
        # The plain text first, so a client that renders no HTML - and a row
        # enqueued before the HTML rendering existed - still reads the whole
        # message; the HTML part is the alternative a client prefers when it can.
        email.set_content(message.body)
        if message.html_body:
            email.add_alternative(message.html_body, subtype="html")
        return email

    def message_id(self, message: NotificationMessage) -> str:
        """`Message-ID` for one outbox row, stable for the life of that row."""
        _, address = parseaddr(self._settings.email_from)
        _, _, domain = address.partition("@")
        return f"<{message.idempotency_key or uuid4()}@{domain or 'oncall.invalid'}>"

    def tls_context(self) -> ssl.SSLContext:
        """The image's public roots, plus the CAs of `smtp_ca_file` when one
        is set: an internal CA is added to them, not put in their place, so
        the same bundle serves a relay on the internal PKI and a public one."""
        context = ssl.create_default_context()
        ca_file = self._settings.smtp_ca_file
        if ca_file is not None:
            try:
                context.load_verify_locations(cafile=ca_file)
            except OSError as exc:
                raise TemporaryNotificationError(
                    f"Plik CA serwera SMTP jest niedostępny ({ca_file}): {exc}"
                ) from exc
        return context

    async def send(self, message: NotificationMessage) -> None:
        settings = self._settings
        if not settings.smtp_host:
            raise NotificationDisabled("SMTP nie jest skonfigurowany (brak ONCALL_SMTP_HOST)")
        tls_context = self.tls_context()
        try:
            await aiosmtplib.send(
                self.build_message(message),
                hostname=settings.smtp_host,
                port=settings.smtp_port,
                # Settings turns a blank value into None and refuses a lone
                # credential: both None sends without logging in, to a relay
                # that trusts the EHLO name; both set logs in first.
                username=settings.smtp_username,
                password=settings.smtp_password,
                local_hostname=settings.smtp_local_hostname,
                use_tls=settings.smtp_use_tls,
                start_tls=settings.smtp_starttls,
                tls_context=tls_context,
            )
        except aiosmtplib.SMTPAuthenticationError as exc:
            raise NotificationError(f"Odmowa uwierzytelnienia SMTP: {exc}") from exc
        except aiosmtplib.SMTPRecipientsRefused as exc:
            raise NotificationError(f"Odbiorca odrzucony przez SMTP: {exc}") from exc
        except (aiosmtplib.SMTPException, OSError) as exc:
            raise TemporaryNotificationError(f"Chwilowy błąd SMTP: {exc}") from exc


def default_providers(settings: Settings) -> dict[str, NotificationProvider]:
    """Registry of notification providers keyed by outbox channel."""
    return {
        SmtpEmailProvider.channel: SmtpEmailProvider(settings),
    }
