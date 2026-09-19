"""SMTP e-mail provider for the notification outbox.

Connects to an external SMTP service configured through environment
variables. No mail server is hosted by this project.
"""

import logging
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
        email.set_content(message.body)
        return email

    def message_id(self, message: NotificationMessage) -> str:
        """`Message-ID` for one outbox row, stable for the life of that row."""
        _, address = parseaddr(self._settings.email_from)
        _, _, domain = address.partition("@")
        return f"<{message.idempotency_key or uuid4()}@{domain or 'oncall.invalid'}>"

    async def send(self, message: NotificationMessage) -> None:
        settings = self._settings
        if not settings.smtp_host:
            raise NotificationDisabled("SMTP nie jest skonfigurowany (brak ONCALL_SMTP_HOST)")
        try:
            await aiosmtplib.send(
                self.build_message(message),
                hostname=settings.smtp_host,
                port=settings.smtp_port,
                username=settings.smtp_username,
                password=settings.smtp_password,
                local_hostname=settings.smtp_local_hostname,
                use_tls=settings.smtp_use_tls,
                start_tls=settings.smtp_starttls,
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
