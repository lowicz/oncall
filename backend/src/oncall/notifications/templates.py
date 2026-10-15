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

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime

from oncall.domain.calendar.models import WEEKDAYS
from oncall.domain.clock import BUSINESS_TIMEZONE
from oncall.domain.digest import Gap
from oncall.domain.forwarding.job import ForwardingFailure, ForwardingTarget
from oncall.domain.vocabulary import ONCALL_ROLES, ROLE_LABELS, AssignmentRole
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
    link,
    mono,
    role_tag,
    status_tag,
    strong,
    text,
)
from oncall.rules import RuleViolation, summarise

#: The advice every mail about a PRIMARY hand-over repeats, in the interface's
#: warning colour.
_SWITCH_NUMBER = "Pamiętaj o przełączeniu numeru on-call."


def _automatic_switch(reminder_hour: int) -> str:
    """What a PRIMARY reads instead of `_SWITCH_NUMBER` while the worker
    switches the number."""
    return (
        f"Numer on-call jest przełączany automatycznie o {reminder_hour:02d}:00. "
        "Jeśli połączenia nie docierają, skontaktuj się z koordynatorem."
    )


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
    paragraphs: list[Html | Note] | None = None,
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


def _broken_rules(violations: Sequence[RuleViolation]) -> list[str]:
    """One sentence per person and hard rule a swap breaks knowingly: in the
    language e-mails are written in, whatever the request that sends them."""
    return summarise(list(violations), "pl")


def _broken_rules_text(violations: Sequence[RuleViolation]) -> str:
    """The plain-text paragraph naming those rules; nothing for the ordinary
    swap that breaks none."""
    lines = _broken_rules(violations)
    if not lines:
        return ""
    return "Zamiana łamie reguły grafiku:\n" + "".join(f"- {line}\n" for line in lines) + "\n"


def _broken_rules_facts(violations: Sequence[RuleViolation]) -> list[Fact]:
    return [Fact("Łamie regułę", text(line)) for line in _broken_rules(violations)]


#: The heading over the list of every slot a swap moves.
_MOVED_SLOTS = "Zamiana obejmuje"

#: A roster position as the domain has it; `Slot` here is a row of the mail.
Duty = tuple[date, AssignmentRole]


@dataclass(frozen=True)
class _SwapDuties:
    """How a swap's mail names its duties beyond the one in its first
    sentence: the 11-19 slot that travels with a role and, in an exchange,
    the duty taken in return."""

    #: The day and role of the subject line; both duties of an exchange.
    headline: str
    #: The plain-text list of every slot, empty while only one moves.
    text: str
    slots: list[Slot] | None
    facts: list[Fact]
    #: The advice to switch the on-call number, naming the days of an
    #: exchange; none when no on-call role moves.
    switch_number: str | None


def _swap_duties(
    service_date: date, role: AssignmentRole, slots: Sequence[Duty], return_slots: Sequence[Duty]
) -> _SwapDuties:
    headline = f"{format_day(service_date)} · {ROLE_LABELS[role]}"
    facts: list[Fact] = []
    oncall_days = sorted(
        {
            day
            for day, slot_role in [*(slots or [(service_date, role)]), *return_slots]
            if slot_role in ONCALL_ROLES
        }
    )
    switch_number = None
    if oncall_days:
        switch_number = (
            f"{_SWITCH_NUMBER.removesuffix('.')}: {' i '.join(map(format_day, oncall_days))}."
            if return_slots
            else _SWITCH_NUMBER
        )
    if return_slots:
        return_date, return_role = return_slots[0]
        headline += f" ⇄ {format_day(return_date)} · {ROLE_LABELS[return_role]}"
        facts = [Fact("W zamian", join(_day(return_date), text(" · "), _role(return_role)))]
    if len(slots) + len(return_slots) < 2:
        return _SwapDuties(headline, "", None, facts, switch_number)
    lines = [_slot_line(*slot) for slot in slots] + [
        f"{_slot_line(*slot)} (w zamian)" for slot in return_slots
    ]
    rows = [_slot(*slot) for slot in slots] + [
        _slot(*slot, text("w zamian")) for slot in return_slots
    ]
    return _SwapDuties(
        headline, f"{_MOVED_SLOTS}:\n" + "\n".join(lines) + "\n\n", rows, facts, switch_number
    )


def _swaps_action(app: Brand, label: str = "Zobacz zamiany") -> Action:
    return Action(label=label, url=f"{app.url}/#zamiany")


def _schedule_action(app: Brand) -> Action:
    return Action(label="Aktualny grafik", url=f"{app.url}/")


def swap_requested(
    *,
    service_date: date,
    role: AssignmentRole,
    slots: Sequence[Duty] = (),
    return_slots: Sequence[Duty] = (),
    requester_name: str,
    violations: Sequence[RuleViolation],
    app: Brand,
) -> RenderedEmail:
    day = format_day(service_date)
    duties = _swap_duties(service_date, role, slots, return_slots)
    subject = f"Prośba o zamianę: {duties.headline}"
    body = (
        f"{requester_name} prosi o przejęcie dyżuru {ROLE_LABELS[role]} w dniu {day}.\n\n"
        + duties.text
        + _broken_rules_text(violations)
        + f"Odpowiedz w aplikacji: {app.url}/#zamiany\n"
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
            *duties.facts,
            *_broken_rules_facts(violations),
        ],
        slots=duties.slots,
        slots_heading=_MOVED_SLOTS,
        action=_swaps_action(app, "Odpowiedz w aplikacji"),
    )


def swap_accepted(
    *,
    service_date: date,
    role: AssignmentRole,
    slots: Sequence[Duty] = (),
    return_slots: Sequence[Duty] = (),
    replacement_name: str,
    app: Brand,
) -> RenderedEmail:
    day = format_day(service_date)
    duties = _swap_duties(service_date, role, slots, return_slots)
    subject = f"Zamiana zaakceptowana przez zastępcę: {duties.headline}"
    body = (
        f"{replacement_name} zaakceptował(a) Twoją prośbę o zamianę dyżuru "
        f"{ROLE_LABELS[role]} w dniu {day}.\n\n"
        + duties.text
        + f"Wniosek czeka teraz na akceptację koordynatora: {app.url}/#zamiany\n"
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
            *duties.facts,
            Fact("Status", status_tag("Oczekuje na koordynatora", Tone.sig)),
        ],
        slots=duties.slots,
        slots_heading=_MOVED_SLOTS,
        note=Note("Wniosek czeka teraz na akceptację koordynatora.", Tone.sig),
        action=_swaps_action(app),
    )


def swap_pending_coordinator(
    *,
    service_date: date,
    role: AssignmentRole,
    slots: Sequence[Duty] = (),
    return_slots: Sequence[Duty] = (),
    requester_name: str,
    replacement_name: str,
    violations: Sequence[RuleViolation],
    app: Brand,
) -> RenderedEmail:
    """The coordinator's copy of an accepted swap: the same facts, with the
    decision it now waits for in front."""
    duties = _swap_duties(service_date, role, slots, return_slots)
    accepted = swap_accepted(
        service_date=service_date,
        role=role,
        slots=slots,
        return_slots=return_slots,
        replacement_name=replacement_name,
        app=app,
    )
    body = (
        f"{requester_name} i {replacement_name} uzgodnili zamianę. "
        "Otwórz zakładkę Zamiany, aby podjąć decyzję.\n\n"
        + _broken_rules_text(violations)
        + accepted.text
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
            *duties.facts,
            Fact("Status", status_tag("Oczekuje na koordynatora", Tone.sig)),
            *_broken_rules_facts(violations),
        ],
        slots=duties.slots,
        slots_heading=_MOVED_SLOTS,
        action=_swaps_action(app, "Podejmij decyzję"),
    )


def swap_rejected(
    *,
    service_date: date,
    role: AssignmentRole,
    slots: Sequence[Duty] = (),
    return_slots: Sequence[Duty] = (),
    requester_name: str,
    replacement_name: str,
    reason: str | None,
    by_coordinator: bool,
    app: Brand,
) -> RenderedEmail:
    who = "koordynator" if by_coordinator else replacement_name
    day = format_day(service_date)
    duties = _swap_duties(service_date, role, slots, return_slots)
    subject = f"Zamiana odrzucona: {duties.headline}"
    body = (
        f"Prośba o zamianę dyżuru {ROLE_LABELS[role]} w dniu {day} "
        f"({requester_name} → {replacement_name}) została odrzucona przez: {who}.\n"
    )
    if reason:
        body += f"Powód: {reason}\n"
    body += f"\n{duties.text}Szczegóły: {app.url}/#zamiany\n"
    facts = [
        Fact("Dzień", _day(service_date)),
        Fact("Rola", _role(role)),
        Fact("Oddaje", text(requester_name)),
        Fact("Przejmuje", text(replacement_name)),
        *duties.facts,
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
        slots=duties.slots,
        slots_heading=_MOVED_SLOTS,
        action=_swaps_action(app, "Szczegóły"),
    )


def swap_cancelled(
    *,
    service_date: date,
    role: AssignmentRole,
    slots: Sequence[Duty] = (),
    return_slots: Sequence[Duty] = (),
    requester_name: str,
    reason: str | None,
    app: Brand,
) -> RenderedEmail:
    day = format_day(service_date)
    duties = _swap_duties(service_date, role, slots, return_slots)
    subject = f"Zamiana wycofana: {duties.headline}"
    body = (
        f"{requester_name} wycofał(a) prośbę o zamianę dyżuru {ROLE_LABELS[role]} w dniu {day}.\n"
    )
    if reason:
        body += f"Powód: {reason}\n"
    body += f"\n{duties.text}Szczegóły: {app.url}/#zamiany\n"
    facts = [
        Fact("Dzień", _day(service_date)),
        Fact("Rola", _role(role)),
        Fact("Wycofał(a)", text(requester_name)),
        *duties.facts,
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
        slots=duties.slots,
        slots_heading=_MOVED_SLOTS,
        action=_swaps_action(app, "Szczegóły"),
    )


def swap_approved(
    *,
    service_date: date,
    role: AssignmentRole,
    slots: Sequence[Duty] = (),
    return_slots: Sequence[Duty] = (),
    requester_name: str,
    replacement_name: str,
    violations: Sequence[RuleViolation],
    app: Brand,
) -> RenderedEmail:
    day = format_day(service_date)
    duties = _swap_duties(service_date, role, slots, return_slots)
    subject = f"Zamiana zatwierdzona: {duties.headline}"
    body = (
        f"Koordynator zatwierdził zamianę dyżuru {ROLE_LABELS[role]} w dniu {day}.\n"
        f"Dyżur przejmuje: {replacement_name} (zamiast: {requester_name}).\n\n"
        + duties.text
        + _broken_rules_text(violations)
        + (f"{duties.switch_number}\n" if duties.switch_number else "")
        + f"Aktualny grafik: {app.url}/\n"
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
            *duties.facts,
            Fact("Status", status_tag("Zatwierdzona", Tone.ok)),
            *_broken_rules_facts(violations),
        ],
        slots=duties.slots,
        slots_heading=_MOVED_SLOTS,
        note=Note(duties.switch_number) if duties.switch_number else None,
        action=_schedule_action(app),
    )


def swap_recorded(
    *,
    service_date: date,
    role: AssignmentRole,
    slots: Sequence[Duty] = (),
    return_slots: Sequence[Duty] = (),
    requester_name: str,
    replacement_name: str,
    violations: Sequence[RuleViolation],
    app: Brand,
) -> RenderedEmail:
    """Both parties' copy of a swap the replacement's acceptance alone wrote
    into the schedule: the same facts as an approval, with nobody's decision
    in front of it."""
    day = format_day(service_date)
    duties = _swap_duties(service_date, role, slots, return_slots)
    subject = f"Zamiana wpisana do grafiku: {duties.headline}"
    body = (
        f"{replacement_name} przyjął(ęła) dyżur {ROLE_LABELS[role]} w dniu {day} "
        f"(zamiast: {requester_name}). Zamiana jest już w grafiku i nie wymaga "
        "zatwierdzenia koordynatora.\n\n"
        + duties.text
        + _broken_rules_text(violations)
        + (f"{duties.switch_number}\n" if duties.switch_number else "")
        + f"Aktualny grafik: {app.url}/\n"
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
            *duties.facts,
            Fact("Status", status_tag("W grafiku", Tone.ok)),
            *_broken_rules_facts(violations),
        ],
        slots=duties.slots,
        slots_heading=_MOVED_SLOTS,
        note=Note(duties.switch_number) if duties.switch_number else None,
        action=_schedule_action(app),
    )


def swap_recorded_for_coordinator(
    *,
    service_date: date,
    role: AssignmentRole,
    slots: Sequence[Duty] = (),
    return_slots: Sequence[Duty] = (),
    requester_name: str,
    replacement_name: str,
    violations: Sequence[RuleViolation],
    app: Brand,
) -> RenderedEmail:
    """The coordinator's copy of the same swap: for their information only,
    with nothing to decide. It is also how a coordinator learns that two
    members broke a hard rule between themselves."""
    day = format_day(service_date)
    duties = _swap_duties(service_date, role, slots, return_slots)
    subject = f"Do wiadomości: zamiana wpisana do grafiku {duties.headline}"
    body = (
        f"{requester_name} i {replacement_name} zamienili się dyżurem {ROLE_LABELS[role]} "
        f"w dniu {day}. Dyżur przejmuje: {replacement_name}.\n\n"
        + duties.text
        + _broken_rules_text(violations)
        + "Zamiana jest już w grafiku; zgodnie z ustawieniami nie wymaga Twojego "
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
            *duties.facts,
            Fact("Status", status_tag("W grafiku", Tone.ok)),
            *_broken_rules_facts(violations),
        ],
        slots=duties.slots,
        slots_heading=_MOVED_SLOTS,
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
    automatic: bool = False,
    reminder_hour: int = 9,
) -> RenderedEmail:
    """`automatic` while the worker switches the number: a changed PRIMARY is
    then told so rather than asked to switch it."""
    day = format_day(service_date)
    subject = f"Zmiana przydziału: {day} · {ROLE_LABELS[role]}"
    advice = (
        _automatic_switch(reminder_hour)
        if automatic and role is AssignmentRole.primary
        else _SWITCH_NUMBER
    )
    body = (
        f"Koordynator zmienił przydział {ROLE_LABELS[role]} w dniu {day}.\n"
        f"Dyżur: {new_name} (poprzednio: {previous_name}).\n\n"
        f"{advice}\n"
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
        note=Note(advice),
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


def _segment_line(role: AssignmentRole, starts_on: date, ends_on: date) -> str:
    return f"{_slot_line(starts_on, role)} · ostatni dzień: {format_day(ends_on)}"


def _segment_slot(role: AssignmentRole, starts_on: date, ends_on: date) -> Slot:
    return _slot(starts_on, role, join(text("ostatni dzień: "), _day(ends_on)))


def _rotation(
    *,
    starts_on: date,
    segments: list[tuple[AssignmentRole, date]],
    title: str,
    opening: tuple[str, str],
    note: Note | None,
    action: Action,
    app: Brand,
) -> RenderedEmail:
    """The two rotation notices share everything but their words: which roles
    start, each with the last day of its segment, then the note and the link.
    `opening` is the lead sentence around the first day."""
    before, after = opening
    roles = ", ".join(ROLE_LABELS[role] for role, _ in segments)
    lines = "\n".join(_segment_line(role, starts_on, ends_on) for role, ends_on in segments)
    reminder = f"{note.body}\n" if note else ""
    return _render(
        app=app,
        subject=f"{title}: {format_day(starts_on)} · {roles}",
        body=(
            f"{before}{format_day(starts_on)}{after}\n{lines}\n\n"
            f"{reminder}{action.label}: {action.url}\n"
        ),
        eyebrow="Dyżur",
        title=title,
        lead=join(text(before), _day(starts_on), text(after)),
        slots=[_segment_slot(role, starts_on, ends_on) for role, ends_on in segments],
        note=note,
        action=action,
    )


def _duties_noun(segments: list[tuple[AssignmentRole, date]]) -> str:
    return "dyżur" if len(segments) == 1 else "dyżury"


def _my_duties(app: Brand) -> Action:
    return Action("Moje dyżury", f"{app.url}/moje")


def rotation_ahead(
    *, starts_on: date, segments: list[tuple[AssignmentRole, date]], app: Brand
) -> RenderedEmail:
    """Sent on the last working day before `starts_on`. `segments` are the
    roles the recipient starts that day, in role order, each with the last day
    of its segment."""
    return _rotation(
        starts_on=starts_on,
        segments=segments,
        title="Zapowiedź dyżuru",
        opening=("W dniu ", f" zaczynasz {_duties_noun(segments)}:"),
        note=None,
        action=_my_duties(app),
        app=app,
    )


def rotation_same_day(
    *,
    starts_on: date,
    segments: list[tuple[AssignmentRole, date]],
    switch_url: str | None,
    app: Brand,
    automatic: bool = False,
    reminder_hour: int = 9,
) -> RenderedEmail:
    """Sent on `starts_on` itself, with the same `segments` as the notice
    ahead. A PRIMARY is told whether the worker or the person switches the
    number; the manual link is shown only in manual mode."""
    noun = _duties_noun(segments)
    primary = any(role is AssignmentRole.primary for role, _ in segments)
    action = (
        Action("Przełącz numer on-call", switch_url)
        if primary and switch_url and not automatic
        else _my_duties(app)
    )
    if primary and automatic:
        note = Note(_automatic_switch(reminder_hour))
    else:
        note = Note(_SWITCH_NUMBER) if primary else None
    return _rotation(
        starts_on=starts_on,
        segments=segments,
        title=f"Dziś zaczynasz {noun}",
        opening=("Dziś (", f") zaczynasz {noun}:"),
        note=note,
        action=action,
        app=app,
    )


#: The months as a date names them: "11 października".
_MONTHS = (
    "stycznia",
    "lutego",
    "marca",
    "kwietnia",
    "maja",
    "czerwca",
    "lipca",
    "sierpnia",
    "września",
    "października",
    "listopada",
    "grudnia",
)


def _holder(holder: str | Gap) -> Html:
    """Who holds a role on a day. Nobody where somebody should be is a status
    in the interface's alarm colour; no shift on a day off is only said."""
    if holder is Gap.unstaffed:
        return status_tag(holder, Tone.bad)
    return text(holder) if holder is Gap.day_off else strong(holder)


def _day_of_month(day: date) -> str:
    return f"{day.day} {_MONTHS[day.month - 1]}"


def duty_digest(
    *,
    days: Sequence[tuple[date, Sequence[tuple[AssignmentRole, str | Gap]]]],
    app: Brand,
) -> RenderedEmail:
    """Sent to every coordinator and admin on a working day. `days` are that
    day and the days off that follow it, in date order, each with who holds
    every role, in role order, or why nobody does. With nobody at all, no
    schedule in force reaches these days, and the mail says so."""
    first, last = days[0][0], days[-1][0]
    series = len(days) > 1
    if series:
        since = str(first.day) if first.month == last.month else _day_of_month(first)
        title = f"Dyżury od {since} do {_day_of_month(last)}"
        subject = title
        lead = f"Dyżury od {format_day(first)} do {format_day(last)}:"
    else:
        title = "Dyżury na dziś"
        subject = f"{title}, {_day_of_month(first)}"
        lead = f"Dziś ({format_day(first)}) na dyżurze:"
    # One block per day; a single day needs no heading over its own.
    blocks = "\n\n".join(
        (f"{format_day(day)}:\n" if series else "")
        + "\n".join(f"- {ROLE_LABELS[role]}: {holder}" for role, holder in holders)
        for day, holders in days
    )
    may_change = "Grafik na kolejne dni może się jeszcze zmienić." if series else None
    everybody = [holder for _, holders in days for _, holder in holders]
    note = None
    if all(isinstance(holder, Gap) for holder in everybody):
        when = "te dni" if series else "dziś"
        note = Note(f"Na {when} nie ma opublikowanego grafiku.", Tone.bad)
    elif any(holder is Gap.unstaffed for holder in everybody):
        note = Note("Nie wszystkie dyżury są obsadzone.", Tone.bad)
    closing = "".join(f"{line}\n" for line in (may_change, note and note.body) if line)
    action = _schedule_action(app)
    return _render(
        app=app,
        subject=subject,
        body=(
            f"{lead}\n{'\n' if series else ''}{blocks}\n\n{closing}{action.label}: {action.url}\n"
        ),
        eyebrow="Dyżury",
        title=title,
        lead=text(lead),
        slots=[
            _slot(day, role, _holder(holder)) for day, holders in days for role, holder in holders
        ],
        paragraphs=[text(may_change)] if may_change else None,
        note=note,
        action=action,
    )


#: One sentence per failure, the same in the alert mail, the recorded state
#: and the audit trail. Never the body WCO answered with.
FORWARDING_FAILURES = {
    ForwardingFailure.connection: "Nie udało się połączyć z WCO",
    ForwardingFailure.login_refused: "WCO odrzuciło dane logowania",
    ForwardingFailure.password_rotation_failed: (
        "Hasło WCO wygasło, a jego automatyczna zmiana nie powiodła się"
    ),
    ForwardingFailure.update_refused: "WCO odrzuciło zmianę numeru",
    ForwardingFailure.settings_invalid: "Konfiguracja WCO jest niekompletna lub niedostępna",
    ForwardingFailure.no_primary: "W grafiku nie ma osoby na dyżurze PRIMARY",
    ForwardingFailure.no_phone: "Osoba na dyżurze PRIMARY nie ma zapisanego numeru telefonu",
}


def masked_phone(number: str | None) -> str:
    """A Polish E.164 number with its middle digits hidden for e-mail."""
    if number is None:
        return "brak"
    if len(number) == 12 and number.startswith("+48") and number[1:].isdigit():
        return f"+48 {number[3:6]} *** {number[-3:]}"
    return "numer ukryty"


def forwarding_failed(
    *,
    target: ForwardingTarget,
    cause: ForwardingFailure,
    applied_number: str | None,
    applied_at: datetime | None,
    switch_url: str | None,
    app: Brand,
) -> RenderedEmail:
    """A critical alert that carries no unmasked phone or WCO response."""
    subject = "Pilne: numer on-call nie został przełączony"
    lead_text = "Automatyczne przełączenie numeru on-call nie powiodło się."
    desired = masked_phone(target.number)
    current = masked_phone(applied_number)
    local = applied_at.astimezone(BUSINESS_TIMEZONE) if applied_at is not None else None
    when = (
        f"{format_date(local.date())} {local:%H:%M}" if local is not None else "brak potwierdzenia"
    )
    reason = FORWARDING_FAILURES[cause]
    fill_phone = (
        " Osoba pełniąca PRIMARY powinna uzupełnić numer w zakładce Moje."
        if cause is ForwardingFailure.no_phone
        else ""
    )
    status = Action("Sprawdź przełączanie", f"{app.url}/przelaczanie")
    action = Action("Przełącz numer ręcznie", switch_url) if switch_url else status
    instruction = "Przełącz numer ręcznie i sprawdź ustawienia przełączania."
    paragraphs: list[Html | Note] = [text(fill_phone.strip())] if fill_phone else []
    paragraphs.append(Note(instruction, Tone.bad))
    if action is not status:
        paragraphs.append(join(text(f"{status.label}: "), link(status.url)))
    links = "".join(f"{each.label}: {each.url}\n" for each in dict.fromkeys((action, status)))
    primary = f"{target.member_name} ({desired})" if target.member_name else "brak"
    body = (
        f"{lead_text}\n"
        f"Dyżur PRIMARY: {primary}.\n"
        f"Ostatni potwierdzony numer WCO: {current}; {when}.\n"
        f"Przyczyna: {reason}.{fill_phone}\n\n"
        f"{instruction}\n"
        f"{links}"
    )
    return _render(
        app=app,
        subject=subject,
        body=body,
        eyebrow="Numer on-call",
        title="Numer on-call wymaga pilnej interwencji",
        lead=text(lead_text),
        facts=[
            Fact("Dzień dyżuru", _day(target.day)),
            Fact("PRIMARY", strong(target.member_name or "brak")),
            Fact("Numer docelowy", mono(desired)),
            Fact("Ostatni numer WCO", mono(current)),
            Fact("Potwierdzony", text(when)),
            Fact("Przyczyna", text(reason)),
        ],
        paragraphs=paragraphs,
        action=action,
    )


def forwarding_recovered(*, target: ForwardingTarget, app: Brand) -> RenderedEmail:
    """The short all-clear after a critical forwarding alert."""
    subject = "Numer on-call został przełączony po awarii"
    lead_text = "Automatyczne przełączanie numeru on-call znów działa."
    number = masked_phone(target.number)
    action = Action("Sprawdź przełączanie", f"{app.url}/przelaczanie")
    body = (
        f"{lead_text}\n"
        f"Dyżur PRIMARY: {target.member_name or 'brak'} ({number}), {format_day(target.day)}.\n\n"
        f"{action.label}: {action.url}\n"
    )
    return _render(
        app=app,
        subject=subject,
        body=body,
        eyebrow="Numer on-call",
        title="Przełączanie działa ponownie",
        lead=text(lead_text),
        facts=[
            Fact("Dzień dyżuru", _day(target.day)),
            Fact("PRIMARY", strong(target.member_name or "brak")),
            Fact("Numer", mono(number)),
            Fact("Status", status_tag("Przełączony", Tone.ok)),
        ],
        action=action,
    )


#: Where the operator's guide to backups is served, next to the application.
BACKUP_GUIDE = "/docs/wdrozenie/kopie-zapasowe.html"

#: The steps of `deploy/backup/oncall-backup.sh`, as the alert names them.
BACKUP_STEPS = {
    "preflight": "przygotowanie",
    "dump": "zrzut bazy",
    "verify": "test odtworzenia",
    "save": "zapis kopii",
    "prune": "usuwanie starych kopii",
    "test": "test powiadomienia",
}


def backup_failed(
    *,
    host: str,
    failed_at: datetime,
    step: str,
    details: list[str],
    app: Brand,
    test: bool = False,
) -> RenderedEmail:
    """The database backup on `host` failed at `step` (or, with `test`, the
    operator checks that this alert reaches them). `details` are the lines the
    backup script recorded, shown verbatim."""
    when = f"{format_date(failed_at.date())} {failed_at:%H:%M}"
    step_label = BACKUP_STEPS.get(step, step)
    guide = f"{app.url}{BACKUP_GUIDE}"
    if test:
        subject = f"Test powiadomienia o kopii zapasowej: {host}"
        lead_text = f"To jest próbne powiadomienie z hosta {host} ({when})."
        note = Note("Nic się nie stało. Tak wygląda alarm, gdy kopia bazy się nie uda.", Tone.ok)
        title = "Test powiadomienia o kopii zapasowej"
    else:
        subject = f"Kopia zapasowa bazy nie powiodła się: {host}"
        lead_text = f"Kopia zapasowa bazy na hoście {host} nie powiodła się ({when})."
        note = Note(
            "Poprzednie kopie pozostały nienaruszone. Sprawdź przyczynę i uruchom kopię "
            "ponownie, zanim minie kolejna doba.",
            Tone.bad,
        )
        title = "Kopia zapasowa bazy nie powiodła się"
    detail_text = "".join(f"  {line}\n" for line in details) or "  (brak szczegółów)\n"
    detail_html = Html("<br>".join(mono(line) for line in details)) if details else None
    body = (
        f"{lead_text}\n"
        f"Krok: {step_label}\n\n"
        f"Szczegóły:\n{detail_text}\n"
        f"{note.body}\n"
        f"Instrukcja: {guide}\n"
    )
    return _render(
        app=app,
        subject=subject,
        body=body,
        eyebrow="Kopia zapasowa",
        title=title,
        lead=text(lead_text),
        facts=[
            Fact("Host", strong(host)),
            Fact("Czas", mono(when)),
            Fact("Krok", strong(step_label)),
        ],
        paragraphs=[detail_html or text("(brak szczegółów)")],
        note=note,
        action=Action("Instrukcja kopii zapasowych", guide),
    )
