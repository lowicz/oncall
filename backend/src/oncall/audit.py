"""Audit log for significant operations.

Events are written inside the same transaction as the business change, so
the audit trail never records rolled-back data. ``actor_label`` is
denormalized on purpose: it survives account deletion and can describe
non-user actors (system, share links).
"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from oncall.infrastructure.sqlalchemy.access_models import User
from oncall.infrastructure.sqlalchemy.audit_model import AuditEvent


def record_audit(
    db: AsyncSession,
    *,
    actor: User | None,
    action: str,
    summary: str,
    entity_type: str | None = None,
    entity_id: uuid.UUID | str | None = None,
    details: dict | None = None,
    actor_label: str | None = None,
) -> None:
    label = actor_label or (actor.display_name if actor is not None else "system")
    db.add(
        AuditEvent(
            actor_user_id=actor.id if actor is not None else None,
            actor_label=label[:160],
            action=action[:60],
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id is not None else None,
            summary=summary[:300],
            details=details,
        )
    )
