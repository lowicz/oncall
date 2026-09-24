"""Business-event triggers that enqueue notifications in the caller's transaction."""

import logging
import uuid
from collections.abc import Iterable
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.config import Settings, get_settings
from oncall.domain.scheduling.models import ScheduledDuty
from oncall.domain.vocabulary import AssignmentRole, UserRole
from oncall.infrastructure.sqlalchemy.access_models import User
from oncall.infrastructure.sqlalchemy.team_models import TeamMember
from oncall.notifications import templates
from oncall.notifications.base import NotificationMessage
from oncall.notifications.layout import Brand
from oncall.notifications.service import enqueue_notification
from oncall.notifications.templates import RenderedEmail

logger = logging.getLogger(__name__)

#: The order a day's roles are read in: PRIMARY, SECONDARY, 11–19.
_ROLE_ORDER = {role: index for index, role in enumerate(AssignmentRole)}


def _brand(settings: Settings) -> Brand:
    """What every mail says about the application: its name, subtitle and address."""
    return Brand(
        name=settings.app_name,
        subtitle=settings.app_subtitle,
        url=settings.public_base_url,
    )


def _message(recipient: str, rendered: RenderedEmail, context: dict) -> NotificationMessage:
    return NotificationMessage(
        channel="email",
        recipient=recipient,
        subject=rendered.subject,
        body=rendered.text,
        html_body=rendered.html,
        context=context,
    )


async def _emails_for_names(db: AsyncSession, names: Iterable[str]) -> dict[str, str]:
    """Resolve team-member display names to active user e-mail addresses."""
    unique_names = {name for name in names if name}
    if not unique_names:
        return {}
    rows = (
        await db.execute(
            select(TeamMember.display_name, User.email)
            .join(User, TeamMember.user_id == User.id)
            .where(
                TeamMember.display_name.in_(unique_names),
                User.is_active.is_(True),
                User.email.is_not(None),
            )
        )
    ).all()
    return {display_name: email for display_name, email in rows if email}


async def _enqueue_for(
    db: AsyncSession,
    emails: dict[str, str],
    *,
    names: Iterable[str],
    build,
    dedup_key: str | None = None,
    context: dict | None = None,
) -> int:
    """Enqueue one message per recipient that has a known e-mail address."""
    sent = 0
    for name in dict.fromkeys(names):
        recipient = emails.get(name)
        if recipient is None:
            logger.info("No e-mail for %s; notification skipped", name)
            continue
        key = f"{dedup_key}:{name}" if dedup_key else None
        enqueued_id = await enqueue_notification(
            db,
            _message(recipient, build(), {**(context or {}), "member": name}),
            dedup_key=key,
        )
        if enqueued_id is not None:
            sent += 1
    return sent


async def notify_swap_requested(
    db: AsyncSession,
    *,
    service_date: date,
    role: AssignmentRole,
    requester_name: str,
    replacement_name: str,
) -> None:
    settings = get_settings()
    emails = await _emails_for_names(db, [replacement_name])
    await _enqueue_for(
        db,
        emails,
        names=[replacement_name],
        build=lambda: templates.swap_requested(
            service_date=service_date,
            role=role,
            requester_name=requester_name,
            app=_brand(settings),
        ),
        context={"event": "swap_requested", "service_date": service_date.isoformat()},
    )


async def notify_swap_accepted(
    db: AsyncSession,
    *,
    service_date: date,
    role: AssignmentRole,
    requester_name: str,
    replacement_name: str,
) -> None:
    settings = get_settings()
    emails = await _emails_for_names(db, [requester_name])
    await _enqueue_for(
        db,
        emails,
        names=[requester_name],
        build=lambda: templates.swap_accepted(
            service_date=service_date,
            role=role,
            replacement_name=replacement_name,
            app=_brand(settings),
        ),
        context={"event": "swap_accepted", "service_date": service_date.isoformat()},
    )
    coordinators = (
        await db.scalars(
            select(User).where(
                User.role.in_((UserRole.coordinator, UserRole.admin)),
                User.is_active.is_(True),
                User.email.is_not(None),
            )
        )
    ).all()
    pending = templates.swap_pending_coordinator(
        service_date=service_date,
        role=role,
        requester_name=requester_name,
        replacement_name=replacement_name,
        app=_brand(settings),
    )
    for coordinator in coordinators:
        if coordinator.display_name in (requester_name, replacement_name):
            continue
        await enqueue_notification(
            db,
            _message(
                coordinator.email or "",
                pending,
                {"event": "swap_pending_coordinator", "service_date": service_date.isoformat()},
            ),
            dedup_key=(f"swap-pending:{service_date.isoformat()}:{role.value}:{coordinator.id}"),
        )


async def notify_swap_rejected(
    db: AsyncSession,
    *,
    service_date: date,
    role: AssignmentRole,
    requester_name: str,
    replacement_name: str,
    reason: str | None,
    by_coordinator: bool,
) -> None:
    settings = get_settings()
    recipients = [requester_name] + ([replacement_name] if by_coordinator else [])
    emails = await _emails_for_names(db, recipients)
    await _enqueue_for(
        db,
        emails,
        names=recipients,
        build=lambda: templates.swap_rejected(
            service_date=service_date,
            role=role,
            requester_name=requester_name,
            replacement_name=replacement_name,
            reason=reason,
            by_coordinator=by_coordinator,
            app=_brand(settings),
        ),
        context={"event": "swap_rejected", "service_date": service_date.isoformat()},
    )


async def notify_swap_cancelled(
    db: AsyncSession,
    *,
    service_date: date,
    role: AssignmentRole,
    requester_name: str,
    replacement_name: str,
    reason: str | None,
) -> None:
    settings = get_settings()
    emails = await _emails_for_names(db, [replacement_name])
    await _enqueue_for(
        db,
        emails,
        names=[replacement_name],
        build=lambda: templates.swap_cancelled(
            service_date=service_date,
            role=role,
            requester_name=requester_name,
            reason=reason,
            app=_brand(settings),
        ),
        context={"event": "swap_cancelled", "service_date": service_date.isoformat()},
    )


async def notify_swap_cancelled_by_publication(
    db: AsyncSession,
    *,
    service_date: date,
    role: AssignmentRole,
    requester_name: str,
    replacement_name: str,
    swap_id: uuid.UUID,
) -> None:
    """Tell both participants when a publication makes their request obsolete."""
    settings = get_settings()
    names = [requester_name, replacement_name]
    emails = await _emails_for_names(db, names)
    await _enqueue_for(
        db,
        emails,
        names=names,
        build=lambda: templates.swap_cancelled(
            service_date=service_date,
            role=role,
            requester_name=requester_name,
            reason="Grafik zastąpiony nową publikacją",
            app=_brand(settings),
        ),
        dedup_key=f"swap-publication-cancelled:{swap_id}",
        context={
            "event": "swap_cancelled_by_publication",
            "service_date": service_date.isoformat(),
        },
    )


async def notify_swap_approved(
    db: AsyncSession,
    *,
    service_date: date,
    role: AssignmentRole,
    requester_name: str,
    replacement_name: str,
) -> None:
    settings = get_settings()
    emails = await _emails_for_names(db, [requester_name, replacement_name])
    await _enqueue_for(
        db,
        emails,
        names=[requester_name, replacement_name],
        build=lambda: templates.swap_approved(
            service_date=service_date,
            role=role,
            requester_name=requester_name,
            replacement_name=replacement_name,
            app=_brand(settings),
        ),
        context={"event": "swap_approved", "service_date": service_date.isoformat()},
    )


async def notify_schedule_published(
    db: AsyncSession,
    *,
    name: str,
    starts_on: date,
    ends_on: date,
    duties: Iterable[ScheduledDuty],
) -> None:
    """One e-mail per team member active in the range, listing only their own
    duties from `duties` (the published slots)."""
    settings = get_settings()
    rows = (
        await db.execute(
            select(TeamMember.id, TeamMember.display_name, User.email)
            .join(User, TeamMember.user_id == User.id)
            .where(
                TeamMember.active_from <= ends_on,
                (TeamMember.active_until.is_(None)) | (TeamMember.active_until >= starts_on),
                User.is_active.is_(True),
                User.email.is_not(None),
            )
        )
    ).all()
    in_order = sorted(duties, key=lambda duty: (duty.service_date, _ROLE_ORDER[duty.role]))
    for member_id, display_name, email in rows:
        if not email:
            continue
        own = [
            (duty.service_date, duty.role)
            for duty in in_order
            if (
                duty.member_id == member_id
                if duty.member_id is not None
                else duty.assignee_name == display_name
            )
        ]
        await _enqueue_for(
            db,
            {display_name: email},
            names=[display_name],
            build=lambda own=own: templates.schedule_published(
                name=name,
                starts_on=starts_on,
                ends_on=ends_on,
                duties=own,
                app=_brand(settings),
            ),
            context={"event": "schedule_published", "starts_on": starts_on.isoformat()},
        )


async def notify_availability_duty_conflict(
    db: AsyncSession,
    *,
    member_name: str,
    duties: list[tuple[date, AssignmentRole]],
) -> None:
    settings = get_settings()
    coordinators = (
        await db.scalars(
            select(User).where(
                User.role.in_((UserRole.coordinator, UserRole.admin)),
                User.is_active.is_(True),
                User.email.is_not(None),
            )
        )
    ).all()
    conflict = templates.availability_duty_conflict(
        member_name=member_name,
        duties=duties,
        app=_brand(settings),
    )
    first_day = min(day for day, _ in duties)
    for coordinator in coordinators:
        await enqueue_notification(
            db,
            _message(
                coordinator.email or "",
                conflict,
                {
                    "event": "availability_duty_conflict",
                    "member": member_name,
                    "starts_on": first_day.isoformat(),
                },
            ),
            dedup_key=f"availability-duty:{member_name}:{first_day}:{coordinator.id}",
        )


async def notify_availability_created_on_behalf(
    db: AsyncSession,
    *,
    coordinator_name: str,
    member_name: str,
    kind_label: str,
    starts_on: date,
    ends_on: date,
    note: str | None,
) -> None:
    """Tell the member that a coordinator filed availability in their name."""
    settings = get_settings()
    emails = await _emails_for_names(db, [member_name])
    await _enqueue_for(
        db,
        emails,
        names=[member_name],
        build=lambda: templates.availability_created_on_behalf(
            coordinator_name=coordinator_name,
            kind_label=kind_label,
            starts_on=starts_on,
            ends_on=ends_on,
            note=note,
            app=_brand(settings),
        ),
        context={
            "event": "availability_created_on_behalf",
            "starts_on": starts_on.isoformat(),
        },
    )


async def notify_assignment_overridden(
    db: AsyncSession,
    *,
    service_date: date,
    role: AssignmentRole,
    previous_name: str,
    new_name: str,
) -> None:
    settings = get_settings()
    emails = await _emails_for_names(db, [previous_name, new_name])
    await _enqueue_for(
        db,
        emails,
        names=[previous_name, new_name],
        build=lambda: templates.assignment_overridden(
            service_date=service_date,
            role=role,
            previous_name=previous_name,
            new_name=new_name,
            app=_brand(settings),
        ),
        context={"event": "assignment_overridden", "service_date": service_date.isoformat()},
    )


async def notify_assignments_changed_by_publication(
    db: AsyncSession,
    *,
    changes: list[tuple[date, AssignmentRole, str, str]],
    schedule_id: uuid.UUID,
) -> None:
    if not changes:
        return
    settings = get_settings()
    names = list(
        dict.fromkeys(
            name for _, _, previous_name, new_name in changes for name in (previous_name, new_name)
        )
    )
    emails = await _emails_for_names(db, names)
    await _enqueue_for(
        db,
        emails,
        names=names,
        build=lambda: templates.assignments_changed_by_publication(
            changes=changes,
            app=_brand(settings),
        ),
        dedup_key=f"publication-assignments:{schedule_id}",
        context={
            "event": "assignment_changed_by_publication",
            "changes": [
                {
                    "service_date": service_date.isoformat(),
                    "role": role.value,
                    "previous_name": previous_name,
                    "new_name": new_name,
                }
                for service_date, role, previous_name, new_name in changes
            ],
        },
    )


async def enqueue_handover_reminders(
    db: AsyncSession,
    *,
    service_date: date,
    schedule_id: uuid.UUID,
    outgoing_name: str,
    incoming_name: str,
) -> int:
    """Enqueue number-handover reminders exactly once per date and schedule."""
    settings = get_settings()
    emails = await _emails_for_names(db, [outgoing_name, incoming_name])
    dedup_base = f"handover:{service_date.isoformat()}:{schedule_id}"
    sent = await _enqueue_for(
        db,
        emails,
        names=[outgoing_name],
        build=lambda: templates.handover_outgoing(
            service_date=service_date,
            incoming_name=incoming_name,
            app=_brand(settings),
        ),
        dedup_key=f"{dedup_base}:outgoing",
        context={"event": "number_handover", "service_date": service_date.isoformat()},
    )
    sent += await _enqueue_for(
        db,
        emails,
        names=[incoming_name],
        build=lambda: templates.handover_incoming(
            service_date=service_date,
            outgoing_name=outgoing_name,
            app=_brand(settings),
        ),
        dedup_key=f"{dedup_base}:incoming",
        context={"event": "number_handover", "service_date": service_date.isoformat()},
    )
    return sent
