"""Polish subject, plain-text and HTML builders for notification events.

Every event renders once into a :class:`RenderedEmail`: the subject, a plain
text that says everything on its own, and an HTML document in the interface's
light theme (:mod:`oncall.notifications.layout`). The two bodies travel
together as one ``multipart/alternative`` mail, so a client that shows no HTML
loses nothing but the styling. Structured context still goes alongside in the
outbox row for providers that render events their own way.

Dates are written the way the screens write them (``frontend/src/lib/dates.ts``):
``DD-MM-RRRR`` with the weekday in front of a single day, and a plain
``DD-MM-RRRR – DD-MM-RRRR`` for a range.
"""

from dataclasses import dataclass
from datetime import date

from oncall.domain.calendar.models import WEEKDAYS
from oncall.domain.vocabulary import AssignmentRole
from oncall.notifications import layout
from oncall.notifications.layout import (
    Action,
    Brand,
    Fact,
    Html,
    Note,
    Slot,
    Tone,
    join,
    mono,
    role_tag,
    status_tag,
    strong,
    text,
)

#: Role names as the team reads them, mirroring `frontend/src/lib/labels.ts`.
#: „late_shift" is an internal identifier and must never reach a reader.
ROLE_LABELS: dict[AssignmentRole, str] = {
    AssignmentRole.primary: "PRIMARY",
    AssignmentRole.secondary: "SECONDARY",
    AssignmentRole.late_shift: "11–19",
}

#: The advice every mail about a PRIMARY hand-over repeats, in the interface's
#: warning colour.
_SWITCH_NUMBER = "Pamiętaj o przełączeniu numeru on-call."


@dataclass(frozen=True)
class RenderedEmail:
    subject: str
    text: str
    html: str


def format_date(day: date) -> str:
    """`24-09-2026`, the one date shape the screens print."""
    return day.strftime("%d-%m-%Y")


def format_day(day: date) -> str:
    """`czw 24-09-2026`: the weekday in the API's own abbreviation, then the date."""
    return f"{WEEKDAYS[day.weekday()]} {format_date(day)}"


def format_range(starts_on: date, ends_on: date) -> str:
    return f"{format_date(starts_on)} – {format_date(ends_on)}"


def _slot_line(day: date, role: AssignmentRole) -> str:
    return f"- {format_day(day)} · {ROLE_LABELS[role]}"


def _change_lines(changes: list[tuple[date, AssignmentRole, str, str]]) -> str:
    """The plain-text list of slots that changed hands."""
    return "\n".join(
        f"{_slot_line(service_date, role)}: {new_name} (poprzednio: {previous_name})"
        for service_date, role, previous_name, new_name in changes
    )


def _change_slots(changes: list[tuple[date, AssignmentRole, str, str]]) -> list[Slot]:
    """The same list as slot rows: the new holder in front, the previous one after."""
    return [
        _slot(service_date, role, join(strong(new_name), text(f" (poprzednio: {previous_name})")))
        for service_date, role, previous_name, new_name in changes
    ]


def _role(role: AssignmentRole) -> Html:
    return role_tag(role, ROLE_LABELS[role])


def _day(day: date) -> Html:
    return mono(format_day(day))


def _slot(day: date, role: AssignmentRole, detail: Html | None = None) -> Slot:
    return Slot(day=format_day(day), role=role, role_label=ROLE_LABELS[role], detail=detail)


def _render(
    *,
    app: Brand,
    subject: str,
    body: str,
    eyebrow: str,
    title: str,
    lead: Html,
    facts: list[Fact] | None = None,
    slots: list[Slot] | None = None,
    slots_heading: str | None = None,
    paragraphs: list[Html] | None = None,
    note: Note | None = None,
    action: Action,
) -> RenderedEmail:
    """Pair the plain text with its HTML twin; the text's first line is the
    preview line a client shows under the subject."""
    html = layout.render(
        brand=app,
        subject=subject,
        preheader=body.strip().splitlines()[0],
        eyebrow=eyebrow,
        title=title,
        lead=lead,
        facts=facts,
        slots=slots,
        slots_heading=slots_heading,
        body=paragraphs,
        note=note,
        action=action,
    )
    return RenderedEmail(subject=subject, text=body, html=html)


def _swaps_action(app: Brand, label: str = "Zobacz zamiany") -> Action:
    return Action(label=label, url=f"{app.url}/#zamiany")


def _schedule_action(app: Brand) -> Action:
    return Action(label="Aktualny grafik", url=f"{app.url}/")


def swap_requested(
    *, service_date: date, role: AssignmentRole, requester_name: str, app: Brand
) -> RenderedEmail:
    day = format_day(service_date)
    subject = f"Prośba o zamianę: {day} · {ROLE_LABELS[role]}"
    body = (
        f"{requester_name} prosi o przejęcie dyżuru {ROLE_LABELS[role]} w dniu {day}.\n\n"
        f"Odpowiedz w aplikacji: {app.url}/#zamiany\n"
    )
    return _render(
        app=app,
        subject=subject,
        body=body,
        eyebrow="Zamiany",
        title="Prośba o zamianę dyżuru",
        lead=join(
            strong(requester_name),
            text(" prosi Cię o przejęcie dyżuru "),
            strong(ROLE_LABELS[role]),
            text(" w dniu "),
            _day(service_date),
            text("."),
        ),
        facts=[
            Fact("Dzień", _day(service_date)),
            Fact("Rola", _role(role)),
            Fact("Prosi", text(requester_name)),
        ],
        action=_swaps_action(app, "Odpowiedz w aplikacji"),
    )


def swap_accepted(
    *, service_date: date, role: AssignmentRole, replacement_name: str, app: Brand
) -> RenderedEmail:
    day = format_day(service_date)
    subject = f"Zamiana zaakceptowana przez zastępcę: {day} · {ROLE_LABELS[role]}"
    body = (
        f"{replacement_name} zaakceptował(a) Twoją prośbę o zamianę dyżuru "
        f"{ROLE_LABELS[role]} w dniu {day}.\n\n"
        f"Wniosek czeka teraz na akceptację koordynatora: {app.url}/#zamiany\n"
    )
    return _render(
        app=app,
        subject=subject,
        body=body,
        eyebrow="Zamiany",
        title="Zastępca zaakceptował zamianę",
        lead=join(
            strong(replacement_name),
            text(" zaakceptował(a) Twoją prośbę o zamianę dyżuru "),
            strong(ROLE_LABELS[role]),
            text(" w dniu "),
            _day(service_date),
            text("."),
        ),
        facts=[
            Fact("Dzień", _day(service_date)),
            Fact("Rola", _role(role)),
            Fact("Zastępca", text(replacement_name)),
            Fact("Status", status_tag("Oczekuje na koordynatora", Tone.sig)),
        ],
        note=Note("Wniosek czeka teraz na akceptację koordynatora.", Tone.sig),
        action=_swaps_action(app),
    )


def swap_pending_coordinator(
    *,
    service_date: date,
    role: AssignmentRole,
    requester_name: str,
    replacement_name: str,
    app: Brand,
) -> RenderedEmail:
    """The coordinator's copy of an accepted swap: the same facts, with the
    decision it now waits for in front."""
    accepted = swap_accepted(
        service_date=service_date, role=role, replacement_name=replacement_name, app=app
    )
    body = (
        f"{requester_name} i {replacement_name} uzgodnili zamianę. "
        "Otwórz zakładkę Zamiany, aby podjąć decyzję.\n\n" + accepted.text
    )
    return _render(
        app=app,
        subject=f"Do zatwierdzenia: {accepted.subject}",
        body=body,
        eyebrow="Zamiany · do zatwierdzenia",
        title="Zamiana czeka na Twoją decyzję",
        lead=join(
            strong(requester_name),
            text(" i "),
            strong(replacement_name),
            text(" uzgodnili zamianę dyżuru "),
            strong(ROLE_LABELS[role]),
            text(" w dniu "),
            _day(service_date),
            text("."),
        ),
        facts=[
            Fact("Dzień", _day(service_date)),
            Fact("Rola", _role(role)),
            Fact("Oddaje", text(requester_name)),
            Fact("Przejmuje", text(replacement_name)),
            Fact("Status", status_tag("Oczekuje na koordynatora", Tone.sig)),
        ],
        action=_swaps_action(app, "Podejmij decyzję"),
    )


def swap_rejected(
    *,
    service_date: date,
    role: AssignmentRole,
    requester_name: str,
    replacement_name: str,
    reason: str | None,
    by_coordinator: bool,
    app: Brand,
) -> RenderedEmail:
    who = "koordynator" if by_coordinator else replacement_name
    day = format_day(service_date)
    subject = f"Zamiana odrzucona: {day} · {ROLE_LABELS[role]}"
    body = (
        f"Prośba o zamianę dyżuru {ROLE_LABELS[role]} w dniu {day} "
        f"({requester_name} → {replacement_name}) została odrzucona przez: {who}.\n"
    )
    if reason:
        body += f"Powód: {reason}\n"
    body += f"\nSzczegóły: {app.url}/#zamiany\n"
    facts = [
        Fact("Dzień", _day(service_date)),
        Fact("Rola", _role(role)),
        Fact("Oddaje", text(requester_name)),
        Fact("Przejmuje", text(replacement_name)),
        Fact("Odrzucił(a)", text(who)),
        Fact("Status", status_tag("Odrzucona", Tone.bad)),
    ]
    if reason:
        facts.append(Fact("Powód", text(reason)))
    return _render(
        app=app,
        subject=subject,
        body=body,
        eyebrow="Zamiany",
        title="Zamiana odrzucona",
        lead=join(
            text("Prośba o zamianę dyżuru "),
            strong(ROLE_LABELS[role]),
            text(" w dniu "),
            _day(service_date),
            text(" została odrzucona przez: "),
            strong(who),
            text("."),
        ),
        facts=facts,
        action=_swaps_action(app, "Szczegóły"),
    )


def swap_cancelled(
    *,
    service_date: date,
    role: AssignmentRole,
    requester_name: str,
    reason: str | None,
    app: Brand,
) -> RenderedEmail:
    day = format_day(service_date)
    subject = f"Zamiana wycofana: {day} · {ROLE_LABELS[role]}"
    body = (
        f"{requester_name} wycofał(a) prośbę o zamianę dyżuru {ROLE_LABELS[role]} w dniu {day}.\n"
    )
    if reason:
        body += f"Powód: {reason}\n"
    body += f"\nSzczegóły: {app.url}/#zamiany\n"
    facts = [
        Fact("Dzień", _day(service_date)),
        Fact("Rola", _role(role)),
        Fact("Wycofał(a)", text(requester_name)),
        Fact("Status", status_tag("Wycofana", Tone.warn)),
    ]
    if reason:
        facts.append(Fact("Powód", text(reason)))
    return _render(
        app=app,
        subject=subject,
        body=body,
        eyebrow="Zamiany",
        title="Zamiana wycofana",
        lead=join(
            strong(requester_name),
            text(" wycofał(a) prośbę o zamianę dyżuru "),
            strong(ROLE_LABELS[role]),
            text(" w dniu "),
            _day(service_date),
            text("."),
        ),
        facts=facts,
        action=_swaps_action(app, "Szczegóły"),
    )


def swap_approved(
    *,
    service_date: date,
    role: AssignmentRole,
    requester_name: str,
    replacement_name: str,
    app: Brand,
) -> RenderedEmail:
    day = format_day(service_date)
    subject = f"Zamiana zatwierdzona: {day} · {ROLE_LABELS[role]}"
    body = (
        f"Koordynator zatwierdził zamianę dyżuru {ROLE_LABELS[role]} w dniu {day}.\n"
        f"Dyżur przejmuje: {replacement_name} (zamiast: {requester_name}).\n\n"
        f"{_SWITCH_NUMBER}\n"
        f"Aktualny grafik: {app.url}/\n"
    )
    return _render(
        app=app,
        subject=subject,
        body=body,
        eyebrow="Zamiany",
        title="Zamiana zatwierdzona",
        lead=join(
            text("Koordynator zatwierdził zamianę dyżuru "),
            strong(ROLE_LABELS[role]),
            text(" w dniu "),
            _day(service_date),
            text("."),
        ),
        facts=[
            Fact("Dzień", _day(service_date)),
            Fact("Rola", _role(role)),
            Fact("Dyżur przejmuje", strong(replacement_name)),
            Fact("Zamiast", text(requester_name)),
            Fact("Status", status_tag("Zatwierdzona", Tone.ok)),
        ],
        note=Note(_SWITCH_NUMBER),
        action=_schedule_action(app),
    )


def swap_recorded(
    *,
    service_date: date,
    role: AssignmentRole,
    requester_name: str,
    replacement_name: str,
    app: Brand,
) -> RenderedEmail:
    """Both parties' copy of a swap the replacement's acceptance alone wrote
    into the schedule: the same facts as an approval, with nobody's decision
    in front of it."""
    day = format_day(service_date)
    subject = f"Zamiana wpisana do grafiku: {day} · {ROLE_LABELS[role]}"
    body = (
        f"{replacement_name} przyjął(ęła) dyżur {ROLE_LABELS[role]} w dniu {day} "
        f"(zamiast: {requester_name}). Zamiana jest już w grafiku i nie wymaga "
        "zatwierdzenia koordynatora.\n\n"
        f"{_SWITCH_NUMBER}\n"
        f"Aktualny grafik: {app.url}/\n"
    )
    return _render(
        app=app,
        subject=subject,
        body=body,
        eyebrow="Zamiany",
        title="Zamiana wpisana do grafiku",
        lead=join(
            strong(replacement_name),
            text(" przyjął(ęła) dyżur "),
            strong(ROLE_LABELS[role]),
            text(" w dniu "),
            _day(service_date),
            text(". Zamiana jest już w grafiku i nie wymaga zatwierdzenia koordynatora."),
        ),
        facts=[
            Fact("Dzień", _day(service_date)),
            Fact("Rola", _role(role)),
            Fact("Dyżur przejmuje", strong(replacement_name)),
            Fact("Zamiast", text(requester_name)),
            Fact("Status", status_tag("W grafiku", Tone.ok)),
        ],
        note=Note(_SWITCH_NUMBER),
        action=_schedule_action(app),
    )


def swap_recorded_for_coordinator(
    *,
    service_date: date,
    role: AssignmentRole,
    requester_name: str,
    replacement_name: str,
    app: Brand,
) -> RenderedEmail:
    """The coordinator's copy of the same swap: for their information only,
    with nothing to decide."""
    day = format_day(service_date)
    subject = f"Do wiadomości: zamiana wpisana do grafiku {day} · {ROLE_LABELS[role]}"
    body = (
        f"{requester_name} i {replacement_name} zamienili się dyżurem {ROLE_LABELS[role]} "
        f"w dniu {day}. Dyżur przejmuje: {replacement_name}.\n\n"
        "Zamiana jest już w grafiku; zgodnie z ustawieniami nie wymaga Twojego "
        "zatwierdzenia. Ta wiadomość jest tylko informacyjna.\n\n"
        f"Aktualny grafik: {app.url}/\n"
    )
    return _render(
        app=app,
        subject=subject,
        body=body,
        eyebrow="Zamiany · do wiadomości",
        title="Zamiana wpisana do grafiku",
        lead=join(
            strong(requester_name),
            text(" i "),
            strong(replacement_name),
            text(" zamienili się dyżurem "),
            strong(ROLE_LABELS[role]),
            text(" w dniu "),
            _day(service_date),
            text("."),
        ),
        facts=[
            Fact("Dzień", _day(service_date)),
            Fact("Rola", _role(role)),
            Fact("Oddaje", text(requester_name)),
            Fact("Przejmuje", text(replacement_name)),
            Fact("Status", status_tag("W grafiku", Tone.ok)),
        ],
        note=Note(
            "Zamiana jest już w grafiku; zgodnie z ustawieniami nie wymaga Twojego "
            "zatwierdzenia. Ta wiadomość jest tylko informacyjna."
        ),
        action=_schedule_action(app),
    )


def schedule_published(
    *,
    name: str,
    starts_on: date,
    ends_on: date,
    duties: list[tuple[date, AssignmentRole]],
    app: Brand,
) -> RenderedEmail:
    """`duties` are the recipient's own, in order; nobody else's belong here."""
    span = format_range(starts_on, ends_on)
    subject = f"Opublikowano grafik: {span}"
    if duties:
        own = "Twoje dyżury w tym grafiku:\n" + "\n".join(
            _slot_line(day, role) for day, role in duties
        )
    else:
        own = "W tym grafiku nie masz żadnych dyżurów."
    body = (
        f"Nowy grafik „{name}” ({span}) jest opublikowany.\n\n"
        f"{own}\n\n"
        f"Moje dyżury: {app.url}/moje\n"
    )
    return _render(
        app=app,
        subject=subject,
        body=body,
        eyebrow="Grafik",
        title=f"Opublikowano grafik „{name}”",
        lead=join(
            text("Nowy grafik "),
            strong(f"„{name}”"),
            text(" ("),
            mono(span),
            text(") jest opublikowany."),
        ),
        slots=[_slot(day, role) for day, role in duties],
        slots_heading="Twoje dyżury w tym grafiku",
        paragraphs=[] if duties else [text("W tym grafiku nie masz żadnych dyżurów.")],
        action=Action("Moje dyżury", f"{app.url}/moje"),
    )


def availability_duty_conflict(
    *, member_name: str, duties: list[tuple[date, AssignmentRole]], app: Brand
) -> RenderedEmail:
    subject = f"Niedostępność koliduje z dyżurem: {member_name}"
    slots = "\n".join(_slot_line(day, role) for day, role in duties)
    body = (
        f"{member_name} zgłosił(a) twardą niedostępność obejmującą istniejące dyżury:\n"
        f"{slots}\n\nSprawdź grafik i uzgodnij zmianę obsady: {app.url}/\n"
    )
    return _render(
        app=app,
        subject=subject,
        body=body,
        eyebrow="Dostępność",
        title="Niedostępność koliduje z dyżurem",
        lead=join(
            strong(member_name),
            text(" zgłosił(a) twardą niedostępność obejmującą istniejące dyżury:"),
        ),
        slots=[_slot(day, role) for day, role in duties],
        note=Note("Sprawdź grafik i uzgodnij zmianę obsady.", Tone.bad),
        action=Action("Otwórz grafik", f"{app.url}/"),
    )


def availability_created_on_behalf(
    *,
    coordinator_name: str,
    kind_label: str,
    starts_on: date,
    ends_on: date,
    note: str | None,
    app: Brand,
) -> RenderedEmail:
    subject = f"Zgłoszono dostępność w Twoim imieniu: {format_range(starts_on, ends_on)}"
    body = (
        f"{coordinator_name} zapisał(a) w Twoim imieniu: „{kind_label}” "
        f"od {format_date(starts_on)} do {format_date(ends_on)}.\n"
    )
    if note:
        body += f"Powód: {note}\n"
    body += (
        "\nJeśli to nie zgadza się z Twoimi planami, otwórz „Moja dostępność” "
        f"i usuń wpis albo skontaktuj się z koordynatorem: {app.url}/#moje\n"
    )
    facts = [
        Fact("Rodzaj", strong(kind_label)),
        Fact("Od", _day(starts_on)),
        Fact("Do", _day(ends_on)),
        Fact("Zapisał(a)", text(coordinator_name)),
    ]
    if note:
        facts.append(Fact("Powód", text(note)))
    return _render(
        app=app,
        subject=subject,
        body=body,
        eyebrow="Dostępność",
        title="Zgłoszono dostępność w Twoim imieniu",
        lead=join(
            strong(coordinator_name),
            text(" zapisał(a) w Twoim imieniu: "),
            strong(f"„{kind_label}”"),
            text(" od "),
            mono(format_date(starts_on)),
            text(" do "),
            mono(format_date(ends_on)),
            text("."),
        ),
        facts=facts,
        paragraphs=[
            text(
                "Jeśli to nie zgadza się z Twoimi planami, otwórz „Moja dostępność” "
                "i usuń wpis albo skontaktuj się z koordynatorem."
            )
        ],
        action=Action("Moja dostępność", f"{app.url}/#moje"),
    )


def assignment_overridden(
    *,
    service_date: date,
    role: AssignmentRole,
    previous_name: str,
    new_name: str,
    app: Brand,
) -> RenderedEmail:
    day = format_day(service_date)
    subject = f"Zmiana przydziału: {day} · {ROLE_LABELS[role]}"
    body = (
        f"Koordynator zmienił przydział {ROLE_LABELS[role]} w dniu {day}.\n"
        f"Dyżur: {new_name} (poprzednio: {previous_name}).\n\n"
        f"{_SWITCH_NUMBER}\n"
        f"Aktualny grafik: {app.url}/\n"
    )
    return _render(
        app=app,
        subject=subject,
        body=body,
        eyebrow="Korekta grafiku",
        title="Zmiana przydziału",
        lead=join(
            text("Koordynator zmienił przydział "),
            strong(ROLE_LABELS[role]),
            text(" w dniu "),
            _day(service_date),
            text("."),
        ),
        facts=[
            Fact("Dzień", _day(service_date)),
            Fact("Rola", _role(role)),
            Fact("Dyżur", strong(new_name)),
            Fact("Poprzednio", text(previous_name)),
        ],
        note=Note(_SWITCH_NUMBER),
        action=_schedule_action(app),
    )


def assignments_changed_by_publication(
    *, changes: list[tuple[date, AssignmentRole, str, str]], app: Brand
) -> RenderedEmail:
    subject = f"Zmiany przydziałów po publikacji ({len(changes)})"
    body = (
        "Publikacja grafiku zmieniła następujące przydziały:\n"
        f"{_change_lines(changes)}\n\n"
        "Pamiętaj o przełączeniu numeru on-call tam, gdzie jest to potrzebne.\n"
        f"Aktualny grafik: {app.url}/\n"
    )
    return _render(
        app=app,
        subject=subject,
        body=body,
        eyebrow="Grafik",
        title="Zmiany przydziałów po publikacji",
        lead=text("Publikacja grafiku zmieniła następujące przydziały:"),
        slots=_change_slots(changes),
        note=Note("Pamiętaj o przełączeniu numeru on-call tam, gdzie jest to potrzebne."),
        action=_schedule_action(app),
    )


def assignments_overridden_in_batch(
    *, changes: list[tuple[date, AssignmentRole, str, str]], reason: str, app: Brand
) -> RenderedEmail:
    """`changes` are the ones that involve the recipient, as the previous or
    the new holder; a batch correction of somebody else's slots is not theirs
    to read."""
    subject = f"Zmiana przydziałów: korekta koordynatora ({len(changes)})"
    body = (
        "Koordynator zmienił następujące przydziały:\n"
        f"{_change_lines(changes)}\n"
        f"Powód: {reason}\n\n"
        "Pamiętaj o przełączeniu numeru on-call tam, gdzie jest to potrzebne.\n"
        f"Aktualny grafik: {app.url}/\n"
    )
    return _render(
        app=app,
        subject=subject,
        body=body,
        eyebrow="Korekta grafiku",
        title="Zmiana przydziałów",
        lead=text("Koordynator zmienił następujące przydziały:"),
        slots=_change_slots(changes),
        paragraphs=[join(strong("Powód: "), text(reason))],
        note=Note("Pamiętaj o przełączeniu numeru on-call tam, gdzie jest to potrzebne."),
        action=_schedule_action(app),
    )


def handover_outgoing(*, service_date: date, incoming_name: str, app: Brand) -> RenderedEmail:
    day = format_day(service_date)
    subject = f"Przekazanie numeru on-call: {day}"
    body = (
        f"Dziś ({day}) kończy się Twój dyżur PRIMARY.\n"
        f"Numer on-call przejmuje: {incoming_name}.\n\n"
        f"Pamiętaj o przełączeniu numeru.\n"
        f"Grafik: {app.url}/\n"
    )
    return _render(
        app=app,
        subject=subject,
        body=body,
        eyebrow="Numer on-call",
        title="Przekazanie numeru on-call",
        lead=join(
            text("Dziś ("),
            _day(service_date),
            text(") kończy się Twój dyżur "),
            strong("PRIMARY"),
            text("."),
        ),
        facts=[
            Fact("Dzień", _day(service_date)),
            Fact("Rola", _role(AssignmentRole.primary)),
            Fact("Numer przejmuje", strong(incoming_name)),
        ],
        note=Note("Pamiętaj o przełączeniu numeru."),
        action=Action("Grafik", f"{app.url}/"),
    )


def handover_incoming(*, service_date: date, outgoing_name: str, app: Brand) -> RenderedEmail:
    day = format_day(service_date)
    subject = f"Przejęcie numeru on-call: {day}"
    body = (
        f"Dziś ({day}) przejmujesz dyżur PRIMARY od: {outgoing_name}.\n\n"
        f"Pamiętaj o przełączeniu numeru.\n"
        f"Grafik: {app.url}/\n"
    )
    return _render(
        app=app,
        subject=subject,
        body=body,
        eyebrow="Numer on-call",
        title="Przejęcie numeru on-call",
        lead=join(
            text("Dziś ("),
            _day(service_date),
            text(") przejmujesz dyżur "),
            strong("PRIMARY"),
            text(" od: "),
            strong(outgoing_name),
            text("."),
        ),
        facts=[
            Fact("Dzień", _day(service_date)),
            Fact("Rola", _role(AssignmentRole.primary)),
            Fact("Przejmujesz od", strong(outgoing_name)),
        ],
        note=Note("Pamiętaj o przełączeniu numeru."),
        action=Action("Grafik", f"{app.url}/"),
    )
