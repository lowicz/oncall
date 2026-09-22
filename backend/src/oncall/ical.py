"""iCalendar (RFC 5545) generation for published on-call schedules."""

import uuid
from dataclasses import dataclass
from datetime import date, timedelta

from oncall.domain.clock import utc_now
from oncall.domain.vocabulary import AssignmentRole

#: Role names as the team reads them, mirroring `frontend/src/lib/labels.ts`.
#: „late_shift" is an internal identifier and must never reach a reader.
ROLE_LABELS: dict[AssignmentRole, str] = {
    AssignmentRole.primary: "PRIMARY",
    AssignmentRole.secondary: "SECONDARY",
    AssignmentRole.late_shift: "11–19",
}

PRODID = "-//On-call//PL"
FOLD_LIMIT = 75  # octets per RFC 5545 section 3.1


@dataclass
class IcsEvent:
    schedule_id: uuid.UUID
    service_date: date
    role: AssignmentRole
    assignee_name: str
    sequence: int
    is_override: bool = False


def _escape(value: str) -> str:
    # A bare CR must be escaped too, or it splits the content line for lenient
    # clients; CRLF, CR and LF all fold to a single escaped newline.
    return (
        value.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\r\n", "\\n")
        .replace("\r", "\\n")
        .replace("\n", "\\n")
    )


def _fold(line: str) -> list[str]:
    """Fold a content line to <=75 octets without splitting UTF-8 characters."""
    encoded = line.encode("utf-8")
    if len(encoded) <= FOLD_LIMIT:
        return [line]
    chunks: list[str] = []
    current = ""
    current_len = 0
    for char in line:
        char_len = len(char.encode("utf-8"))
        if current_len + char_len > FOLD_LIMIT:
            chunks.append(current)
            current = char
            current_len = char_len + 1  # continuation lines start with a space
        else:
            current += char
            current_len += char_len
    chunks.append(current)
    return [chunks[0], *(" " + chunk for chunk in chunks[1:])]


def build_ics(events: list[IcsEvent], *, calendar_name: str) -> str:
    """Render a VCALENDAR with one all-day VEVENT per assignment."""
    now = utc_now().strftime("%Y%m%dT%H%M%SZ")
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        f"PRODID:{PRODID}",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{_escape(calendar_name)}",
        "X-WR-TIMEZONE:Europe/Warsaw",
    ]
    for event in sorted(events, key=lambda item: (item.service_date, item.role.value)):
        start = event.service_date.strftime("%Y%m%d")
        end = (event.service_date + timedelta(days=1)).strftime("%Y%m%d")
        summary = f"{ROLE_LABELS[event.role]} · {event.assignee_name}"
        description = f"On-call · wersja grafiku {event.sequence}"
        if event.is_override:
            description += " · override"
        uid = f"{event.schedule_id}-{start}-{event.role.value}@oncall"
        lines.extend(
            [
                "BEGIN:VEVENT",
                f"UID:{uid}",
                f"DTSTAMP:{now}",
                f"DTSTART;VALUE=DATE:{start}",
                f"DTEND;VALUE=DATE:{end}",
                f"SUMMARY:{_escape(summary)}",
                f"DESCRIPTION:{_escape(description)}",
                f"SEQUENCE:{event.sequence}",
                "STATUS:CONFIRMED",
                "TRANSP:TRANSPARENT",
                "END:VEVENT",
            ]
        )
    lines.append("END:VCALENDAR")
    folded = [folded_line for line in lines for folded_line in _fold(line)]
    return "\r\n".join(folded) + "\r\n"
