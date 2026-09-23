"""Polish subject/body builders for notification events.

Plain text on purpose: structured context travels alongside in the outbox
row, so future rich providers (e.g. MS Teams cards) can render the same
events differently without changing the business logic.
"""

from datetime import date

from oncall.domain.vocabulary import AssignmentRole

#: Role names as the team reads them, mirroring `frontend/src/lib/labels.ts`.
#: „late_shift" is an internal identifier and must never reach a reader.
ROLE_LABELS: dict[AssignmentRole, str] = {
    AssignmentRole.primary: "PRIMARY",
    AssignmentRole.secondary: "SECONDARY",
    AssignmentRole.late_shift: "11–19",
}


def swap_requested(
    *, service_date: date, role: AssignmentRole, requester_name: str, app_url: str
) -> tuple[str, str]:
    subject = f"Prośba o zamianę: {service_date} · {ROLE_LABELS[role]}"
    body = (
        f"{requester_name} prosi o przejęcie dyżuru {ROLE_LABELS[role]} "
        f"w dniu {service_date}.\n\n"
        f"Odpowiedz w aplikacji: {app_url}/#zamiany\n"
    )
    return subject, body


def swap_accepted(
    *, service_date: date, role: AssignmentRole, replacement_name: str, app_url: str
) -> tuple[str, str]:
    subject = f"Zamiana zaakceptowana przez zastępcę: {service_date} · {ROLE_LABELS[role]}"
    body = (
        f"{replacement_name} zaakceptował(a) Twoją prośbę o zamianę dyżuru "
        f"{ROLE_LABELS[role]} w dniu {service_date}.\n\n"
        f"Wniosek czeka teraz na akceptację koordynatora: {app_url}/#zamiany\n"
    )
    return subject, body


def swap_rejected(
    *,
    service_date: date,
    role: AssignmentRole,
    requester_name: str,
    replacement_name: str,
    reason: str | None,
    by_coordinator: bool,
    app_url: str,
) -> tuple[str, str]:
    who = "koordynator" if by_coordinator else replacement_name
    subject = f"Zamiana odrzucona: {service_date} · {ROLE_LABELS[role]}"
    body = (
        f"Prośba o zamianę dyżuru {ROLE_LABELS[role]} w dniu {service_date} "
        f"({requester_name} → {replacement_name}) została odrzucona przez: {who}.\n"
    )
    if reason:
        body += f"Powód: {reason}\n"
    body += f"\nSzczegóły: {app_url}/#zamiany\n"
    return subject, body


def swap_cancelled(
    *,
    service_date: date,
    role: AssignmentRole,
    requester_name: str,
    reason: str | None,
    app_url: str,
) -> tuple[str, str]:
    subject = f"Zamiana wycofana: {service_date} · {ROLE_LABELS[role]}"
    body = (
        f"{requester_name} wycofał(a) prośbę o zamianę dyżuru {ROLE_LABELS[role]} "
        f"w dniu {service_date}.\n"
    )
    if reason:
        body += f"Powód: {reason}\n"
    body += f"\nSzczegóły: {app_url}/#zamiany\n"
    return subject, body


def swap_approved(
    *,
    service_date: date,
    role: AssignmentRole,
    requester_name: str,
    replacement_name: str,
    app_url: str,
) -> tuple[str, str]:
    subject = f"Zamiana zatwierdzona: {service_date} · {ROLE_LABELS[role]}"
    body = (
        f"Koordynator zatwierdził zamianę dyżuru {ROLE_LABELS[role]} "
        f"w dniu {service_date}.\n"
        f"Dyżur przejmuje: {replacement_name} (zamiast: {requester_name}).\n\n"
        f"Pamiętaj o przełączeniu numeru on-call.\n"
        f"Aktualny grafik: {app_url}/\n"
    )
    return subject, body


def schedule_published(
    *,
    name: str,
    starts_on: date,
    ends_on: date,
    duties: list[tuple[date, AssignmentRole]],
    app_url: str,
) -> tuple[str, str]:
    """`duties` are the recipient's own, in order; nobody else's belong here."""
    subject = f"Opublikowano grafik: {starts_on} – {ends_on}"
    if duties:
        own = "Twoje dyżury w tym grafiku:\n" + "\n".join(
            f"- {day} · {ROLE_LABELS[role]}" for day, role in duties
        )
    else:
        own = "W tym grafiku nie masz żadnych dyżurów."
    body = (
        f"Nowy grafik „{name}” ({starts_on} – {ends_on}) jest opublikowany.\n\n"
        f"{own}\n\n"
        f"Moje dyżury: {app_url}/moje\n"
    )
    return subject, body


def availability_duty_conflict(
    *, member_name: str, duties: list[tuple[date, AssignmentRole]], app_url: str
) -> tuple[str, str]:
    subject = f"Niedostępność koliduje z dyżurem: {member_name}"
    slots = "\n".join(f"- {day} · {ROLE_LABELS[role]}" for day, role in duties)
    body = (
        f"{member_name} zgłosił(a) twardą niedostępność obejmującą istniejące dyżury:\n"
        f"{slots}\n\nSprawdź grafik i uzgodnij zmianę obsady: {app_url}/\n"
    )
    return subject, body


def availability_created_on_behalf(
    *,
    coordinator_name: str,
    kind_label: str,
    starts_on: date,
    ends_on: date,
    note: str | None,
    app_url: str,
) -> tuple[str, str]:
    subject = f"Zgłoszono dostępność w Twoim imieniu: {starts_on} – {ends_on}"
    body = (
        f"{coordinator_name} zapisał(a) w Twoim imieniu: „{kind_label}” "
        f"od {starts_on} do {ends_on}.\n"
    )
    if note:
        body += f"Powód: {note}\n"
    body += (
        "\nJeśli to nie zgadza się z Twoimi planami, otwórz „Moja dostępność” "
        f"i usuń wpis albo skontaktuj się z koordynatorem: {app_url}/#moje\n"
    )
    return subject, body


def assignment_overridden(
    *,
    service_date: date,
    role: AssignmentRole,
    previous_name: str,
    new_name: str,
    app_url: str,
) -> tuple[str, str]:
    subject = f"Zmiana przydziału: {service_date} · {ROLE_LABELS[role]}"
    body = (
        f"Koordynator zmienił przydział {ROLE_LABELS[role]} w dniu {service_date}.\n"
        f"Dyżur: {new_name} (poprzednio: {previous_name}).\n\n"
        f"Pamiętaj o przełączeniu numeru on-call.\n"
        f"Aktualny grafik: {app_url}/\n"
    )
    return subject, body


def assignments_changed_by_publication(
    *, changes: list[tuple[date, AssignmentRole, str, str]], app_url: str
) -> tuple[str, str]:
    subject = f"Zmiany przydziałów po publikacji ({len(changes)})"
    slots = "\n".join(
        f"- {service_date} · {ROLE_LABELS[role]}: {new_name} (poprzednio: {previous_name})"
        for service_date, role, previous_name, new_name in changes
    )
    body = (
        "Publikacja grafiku zmieniła następujące przydziały:\n"
        f"{slots}\n\n"
        "Pamiętaj o przełączeniu numeru on-call tam, gdzie jest to potrzebne.\n"
        f"Aktualny grafik: {app_url}/\n"
    )
    return subject, body


def handover_outgoing(*, service_date: date, incoming_name: str, app_url: str) -> tuple[str, str]:
    subject = f"Przekazanie numeru on-call: {service_date}"
    body = (
        f"Dziś ({service_date}) kończy się Twój dyżur PRIMARY.\n"
        f"Numer on-call przejmuje: {incoming_name}.\n\n"
        f"Pamiętaj o przełączeniu numeru.\n"
        f"Grafik: {app_url}/\n"
    )
    return subject, body


def handover_incoming(*, service_date: date, outgoing_name: str, app_url: str) -> tuple[str, str]:
    subject = f"Przejęcie numeru on-call: {service_date}"
    body = (
        f"Dziś ({service_date}) przejmujesz dyżur PRIMARY od: {outgoing_name}.\n\n"
        f"Pamiętaj o przełączeniu numeru.\n"
        f"Grafik: {app_url}/\n"
    )
    return subject, body
