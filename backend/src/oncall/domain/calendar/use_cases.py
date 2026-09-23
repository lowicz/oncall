"""The calendar matrix, its events and the dashboard.

Every read resolves duties the same way (the duties in force, newest
publication per slot), so the calendar, the dashboard, the reports and the
feeds can never disagree about who is on duty. A share link reads no further
than its own date range. Nothing here commits.
"""

import uuid
from collections.abc import Iterable
from datetime import date, timedelta

from oncall.coverage import coverage_window, is_day_off
from oncall.domain.calendar import errors
from oncall.domain.calendar.models import (
    DASHBOARD_HORIZON_DAYS,
    MAX_RANGE_DAYS,
    WEEKDAYS,
    Audience,
    AvailabilityNote,
    CalendarDay,
    CalendarDuty,
    CalendarEvent,
    CalendarEventChange,
    CalendarMatrix,
    CurrentDuty,
    Dashboard,
    MemberAvailability,
    NewCalendarEvent,
)
from oncall.domain.calendar.ports import CalendarPorts
from oncall.domain.roster import Duty
from oncall.domain.vocabulary import AssignmentRole
from oncall.workdays import polish_holiday_names, polish_holidays


def _sorted(duties: Iterable[Duty]) -> list[Duty]:
    return sorted(duties, key=lambda duty: (duty.service_date, duty.role.value))


async def list_events(
    audience: Audience, starts_on: date, ends_on: date, ports: CalendarPorts
) -> list[CalendarEvent]:
    if ends_on < starts_on:
        raise errors.RangeEndsBeforeStart()
    if (ends_on - starts_on).days > MAX_RANGE_DAYS - 1:
        raise errors.EventRangeTooLong()
    if audience.share_range is not None:
        starts_on = max(starts_on, audience.share_range[0])
        ends_on = min(ends_on, audience.share_range[1])
        if ends_on < starts_on:
            raise errors.RangeEndsBeforeStart()
    return await ports.events.events_between(starts_on, ends_on, by_start=True)


async def create_event(new: NewCalendarEvent, ports: CalendarPorts) -> CalendarEvent:
    event = await ports.events.add(
        NewCalendarEvent(
            actor=new.actor,
            starts_on=new.starts_on,
            ends_on=new.ends_on,
            title=new.title.strip(),
            color=new.color,
        )
    )
    await ports.journal.event_created(event)
    return event


async def change_event(change: CalendarEventChange, ports: CalendarPorts) -> CalendarEvent:
    event = await ports.events.event(change.event_id)
    if event is None:
        raise errors.CalendarEventNotFound(change.event_id)
    starts_on = change.changes.get("starts_on") or event.starts_on
    ends_on = change.changes.get("ends_on") or event.ends_on
    if ends_on < starts_on:
        raise errors.RangeEndsBeforeStart()
    changed = await ports.events.change(
        event.id,
        {
            field: value.strip() if field == "title" else value
            for field, value in change.changes.items()
        },
    )
    await ports.journal.event_updated(changed, changes=change.changes)
    return changed


async def delete_event(event_id: uuid.UUID, ports: CalendarPorts) -> None:
    event = await ports.events.event(event_id)
    if event is None:
        raise errors.CalendarEventNotFound(event_id)
    await ports.journal.event_deleted(event)
    await ports.events.remove(event.id)


async def calendar_matrix(
    audience: Audience, starts_on: date, ends_on: date, ports: CalendarPorts
) -> CalendarMatrix:
    duration = (ends_on - starts_on).days
    if duration < 0 or duration > MAX_RANGE_DAYS - 1:
        raise errors.CalendarRangeInvalid()
    if audience.share_range is not None:
        starts_on = max(starts_on, audience.share_range[0])
        ends_on = min(ends_on, audience.share_range[1])
        if ends_on < starts_on:
            raise errors.OutsideShareRange()
        duration = (ends_on - starts_on).days
    in_force = await ports.roster.duties_in_force(starts_on, ends_on)
    holding = {duty.member_id for duty in in_force.values() if duty.member_id is not None}
    members = await ports.calendar.members_for_range(starts_on, ends_on, holding)
    team_has_members = bool(members) or await ports.calendar.has_any_members()
    swapped = await ports.calendar.approved_swap_slots(starts_on, ends_on)
    duties = [
        CalendarDuty(
            duty=duty,
            change_kind=(
                "swap"
                if (duty.schedule_id, duty.service_date, duty.role) in swapped
                else "manual_override"
                if duty.is_override
                else None
            ),
        )
        for duty in in_force.values()
    ]
    holidays = polish_holiday_names(starts_on, ends_on)
    events = await ports.events.events_between(starts_on, ends_on, by_start=False)
    published = await ports.calendar.published_ranges(starts_on, ends_on)
    coordinates = audience.coordinates
    own_member_id = None
    if audience.account_id is not None:
        own_member_id = next(
            (member.id for member in members if member.user_id == audience.account_id), None
        )
    availability = [
        MemberAvailability(
            member_id=member.id,
            entry=AvailabilityNote(
                kind=entry.kind,
                starts_on=max(entry.starts_on, starts_on),
                ends_on=min(entry.ends_on, ends_on),
                # Notes are the member's own; coordinators read everyone's.
                note=entry.note if coordinates or member.id == own_member_id else None,
            ),
        )
        for member in members
        if coordinates or member.id == own_member_id
        for entry in member.availability
        if entry.starts_on <= ends_on and entry.ends_on >= starts_on
    ]
    days = [starts_on + timedelta(days=offset) for offset in range(duration + 1)]
    return CalendarMatrix(
        starts_on=starts_on,
        ends_on=ends_on,
        days=[
            CalendarDay(
                service_date=day,
                weekday=WEEKDAYS[day.weekday()],
                is_day_off=day.weekday() >= 5 or day in holidays,
                holiday_name=holidays.get(day),
                published=any(first <= day <= last for first, last in published),
                events=[event for event in events if event.starts_on <= day <= event.ends_on],
            )
            for day in days
        ],
        members=members,
        team_has_members=team_has_members,
        shows_eligibility=coordinates,
        duties=duties,
        availability=availability,
    )


async def dashboard(
    audience: Audience,
    starts_on: date | None,
    ends_on: date | None,
    ports: CalendarPorts,
    *,
    today: date,
) -> Dashboard:
    """The published schedule ahead, and who is on duty today.

    The range can only narrow the default window: `starts_on` moves
    the start forward from today, `ends_on` pulls the end in from the 90-day
    horizon. Everything anchored to today is resolved from today regardless of
    the window, so a windowed call never blanks out who is on call.
    """
    if starts_on is not None and ends_on is not None and ends_on < starts_on:
        raise errors.DashboardRangeReversed()
    window_start = max(today, starts_on) if starts_on is not None else today
    horizon = window_start + timedelta(days=DASHBOARD_HORIZON_DAYS)
    window_end = min(ends_on, horizon) if ends_on is not None else horizon
    if audience.share_range is not None:
        window_start = max(window_start, audience.share_range[0])
        window_end = min(window_end, audience.share_range[1])
    # Resolution starts at today so the current-duty block is unaffected by
    # `starts_on`; an inverted range (a link wholly in the past) resolves to
    # nothing.
    resolved = _sorted(
        (await ports.roster.duties_in_force(min(today, window_start), window_end)).values()
    )
    holiday_names = polish_holiday_names(today, today)
    return Dashboard(
        duties=[duty for duty in resolved if duty.service_date >= window_start],
        current=await _current_duties(audience, resolved, today, ports),
        today_is_day_off=is_day_off(today, set(holiday_names)),
        today_holiday_name=holiday_names.get(today),
    )


async def _current_duties(
    audience: Audience, visible: list[Duty], today: date, ports: CalendarPorts
) -> list[CurrentDuty]:
    """Today's duties: who, until when, who is next and how to reach them."""
    # A link scoped to a future or past window must not leak who is on call
    # today when today falls outside it.
    if audience.share_range is not None and not (
        audience.share_range[0] <= today <= audience.share_range[1]
    ):
        return []
    todays = [duty for duty in visible if duty.service_date == today]
    if not todays:
        return []
    contacts = await ports.calendar.contacts()
    by_id = {contact.member_id: contact for contact in contacts}
    by_name = {contact.display_name: contact for contact in contacts}
    holidays = polish_holidays(today, today)
    result = []
    for duty in todays:
        contact = (
            by_id.get(duty.member_id)
            if duty.member_id is not None
            else by_name.get(duty.assignee_name)
        )
        starts_at, ends_at = coverage_window(duty.service_date, holidays, duty.role)
        # The next different person to hold this role.
        upcoming = next(
            (
                other
                for other in visible
                if other.role == duty.role
                and other.service_date > today
                and (other.member_id or other.assignee_name)
                != (duty.member_id or duty.assignee_name)
            ),
            None,
        )
        result.append(
            CurrentDuty(
                duty=duty,
                member_id=contact.member_id if contact else None,
                contact_email=contact.email if contact and audience.sees_contact_email else None,
                contact_phone=contact.phone if contact else None,
                coverage_starts_at=starts_at,
                coverage_ends_at=ends_at,
                is_day_off=is_day_off(duty.service_date, holidays)
                and duty.role != AssignmentRole.late_shift,
                next_assignee_name=upcoming.assignee_name if upcoming else None,
                next_service_date=upcoming.service_date if upcoming else None,
            )
        )
    return result
