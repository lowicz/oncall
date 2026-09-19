"""Notification provider contract.

Providers deliver outbox messages through a single channel (``email`` today,
MS Teams or others in the future). The worker resolves the provider by
``message.channel``; adding a new channel means registering another provider
in :func:`oncall.notifications.email.default_providers` without touching the
outbox, worker or business logic.
"""

from dataclasses import dataclass, field
from typing import Protocol


@dataclass
class NotificationMessage:
    channel: str
    recipient: str
    subject: str
    body: str
    context: dict = field(default_factory=dict)
    #: Stable across every retry of the same outbox row, so a provider can tell
    #: a repeat of one message from a second message. Delivery is at-least-once
    #: (decision D-03); this is what makes the duplicate recognisable.
    idempotency_key: str = ""


class NotificationError(Exception):
    """Permanent delivery failure; the message will not be retried."""


class TemporaryNotificationError(NotificationError):
    """Transient failure; the worker retries with exponential backoff."""


class NotificationDisabled(NotificationError):
    """The channel is not configured; the message is marked as skipped."""


class NotificationProvider(Protocol):
    channel: str

    async def send(self, message: NotificationMessage) -> None:
        """Deliver the message or raise one of the NotificationError types."""
        ...
