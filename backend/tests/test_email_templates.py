"""The rendered notification e-mails: subject, plain text and the HTML twin.

The HTML is written for Outlook 365, whose desktop build renders mail with the
Word engine. `test_the_html_keeps_to_what_outlook_renders` is the list of
constructs that engine drops or mangles, checked against every template, so a
future template cannot quietly pick up a `div` layout or an `rgba()` colour
that looks fine in a browser and falls apart in the one client the team uses.

`tests/snapshots/email_swap_requested.html` is one complete rendering kept in
Git. When a layout change is intended, regenerate it with
`UPDATE_EMAIL_SNAPSHOTS=1 pytest tests/test_email_templates.py` and review the
diff like any other change to what a reader sees.
"""

import os
import re
from collections.abc import Callable
from datetime import date
from pathlib import Path

import pytest

from oncall.domain.vocabulary import AssignmentRole
from oncall.notifications import templates
from oncall.notifications.layout import Brand
from oncall.notifications.templates import RenderedEmail, format_day, format_range

SNAPSHOT = Path(__file__).parent / "snapshots" / "email_swap_requested.html"

APP = Brand(name="On-call", subtitle="Zespół wsparcia", url="https://oncall.example.com")
#: A Thursday, so the weekday abbreviation is visibly not the ISO date.
DAY = date(2026, 9, 24)
NEXT = date(2026, 9, 26)
END = date(2026, 10, 21)

#: Every template, with data that exercises its optional parts.
RENDERINGS: dict[str, Callable[[], RenderedEmail]] = {
    "swap_requested": lambda: templates.swap_requested(
        service_date=DAY, role=AssignmentRole.primary, requester_name="Anna Kowalska", app=APP
    ),
    "swap_accepted": lambda: templates.swap_accepted(
        service_date=DAY, role=AssignmentRole.secondary, replacement_name="Marek Nowak", app=APP
    ),
    "swap_pending_coordinator": lambda: templates.swap_pending_coordinator(
        service_date=DAY,
        role=AssignmentRole.secondary,
        requester_name="Anna Kowalska",
        replacement_name="Marek Nowak",
        app=APP,
    ),
    "swap_rejected": lambda: templates.swap_rejected(
        service_date=DAY,
        role=AssignmentRole.late_shift,
        requester_name="Anna Kowalska",
        replacement_name="Marek Nowak",
        reason="Nie mogę tego dnia",
        by_coordinator=False,
        app=APP,
    ),
    "swap_rejected_by_coordinator": lambda: templates.swap_rejected(
        service_date=DAY,
        role=AssignmentRole.primary,
        requester_name="Anna Kowalska",
        replacement_name="Marek Nowak",
        reason=None,
        by_coordinator=True,
        app=APP,
    ),
    "swap_cancelled": lambda: templates.swap_cancelled(
        service_date=DAY,
        role=AssignmentRole.primary,
        requester_name="Anna Kowalska",
        reason="Grafik zastąpiony nową publikacją",
        app=APP,
    ),
    "swap_approved": lambda: templates.swap_approved(
        service_date=DAY,
        role=AssignmentRole.primary,
        requester_name="Anna Kowalska",
        replacement_name="Marek Nowak",
        app=APP,
    ),
    "swap_recorded": lambda: templates.swap_recorded(
        service_date=DAY,
        role=AssignmentRole.primary,
        requester_name="Anna Kowalska",
        replacement_name="Marek Nowak",
        app=APP,
    ),
    "swap_recorded_for_coordinator": lambda: templates.swap_recorded_for_coordinator(
        service_date=DAY,
        role=AssignmentRole.primary,
        requester_name="Anna Kowalska",
        replacement_name="Marek Nowak",
        app=APP,
    ),
    "schedule_published": lambda: templates.schedule_published(
        name="Październik 2026",
        starts_on=DAY,
        ends_on=END,
        duties=[(DAY, AssignmentRole.secondary), (NEXT, AssignmentRole.late_shift)],
        app=APP,
    ),
    "schedule_published_without_duties": lambda: templates.schedule_published(
        name="Październik 2026", starts_on=DAY, ends_on=END, duties=[], app=APP
    ),
    "availability_duty_conflict": lambda: templates.availability_duty_conflict(
        member_name="Ola Wiśniewska",
        duties=[(DAY, AssignmentRole.primary), (NEXT, AssignmentRole.primary)],
        app=APP,
    ),
    "availability_created_on_behalf": lambda: templates.availability_created_on_behalf(
        coordinator_name="Jan Koordynator",
        kind_label="Nie mogę",
        starts_on=DAY,
        ends_on=NEXT,
        note="Urlop",
        app=APP,
    ),
    "assignment_overridden": lambda: templates.assignment_overridden(
        service_date=DAY,
        role=AssignmentRole.primary,
        previous_name="Anna Kowalska",
        new_name="Marek Nowak",
        app=APP,
    ),
    "assignments_changed_by_publication": lambda: templates.assignments_changed_by_publication(
        changes=[
            (DAY, AssignmentRole.primary, "Anna Kowalska", "Marek Nowak"),
            (NEXT, AssignmentRole.late_shift, "Marek Nowak", "Ola Wiśniewska"),
        ],
        app=APP,
    ),
    "assignments_overridden_in_batch": lambda: templates.assignments_overridden_in_batch(
        changes=[
            (DAY, AssignmentRole.primary, "Anna Kowalska", "Marek Nowak"),
            (NEXT, AssignmentRole.secondary, "Anna Kowalska", "Ola Wiśniewska"),
        ],
        reason="Odejście z zespołu",
        app=APP,
    ),
    "handover_outgoing": lambda: templates.handover_outgoing(
        service_date=DAY, incoming_name="Marek Nowak", app=APP
    ),
    "handover_incoming": lambda: templates.handover_incoming(
        service_date=DAY, outgoing_name="Anna Kowalska", app=APP
    ),
}


@pytest.fixture(params=sorted(RENDERINGS), ids=sorted(RENDERINGS))
def rendered(request) -> RenderedEmail:
    return RENDERINGS[request.param]()


def test_dates_read_as_the_screens_print_them() -> None:
    """`frontend/src/lib/dates.ts`: DD-MM-RRRR, the weekday in front of one day."""
    assert format_day(DAY) == "czw 24-09-2026"
    assert format_day(date(2026, 9, 27)) == "niedz 27-09-2026"
    assert format_range(DAY, END) == "24-09-2026 – 21-10-2026"


def test_the_swap_request_html_matches_the_snapshot() -> None:
    html = RENDERINGS["swap_requested"]().html
    if os.environ.get("UPDATE_EMAIL_SNAPSHOTS"):
        SNAPSHOT.parent.mkdir(exist_ok=True)
        SNAPSHOT.write_text(html)
    assert SNAPSHOT.exists(), f"missing {SNAPSHOT}; run with UPDATE_EMAIL_SNAPSHOTS=1"
    assert html == SNAPSHOT.read_text(), (
        "The rendered e-mail changed. If that is intended, regenerate the snapshot "
        "with UPDATE_EMAIL_SNAPSHOTS=1 and review the diff."
    )


def test_the_html_and_the_text_say_the_same_thing(rendered: RenderedEmail) -> None:
    """The HTML is an alternative, not an addition: the link, the date and the
    subject the plain text carries are all in it, and the preview line a
    client shows under the subject is the text's own first line."""
    links = re.findall(r"https://\S+", rendered.text)
    assert links, "every mail leads somewhere"
    for link in links:
        assert f'href="{link}"' in rendered.html
    assert f"<title>{rendered.subject}</title>" in rendered.html
    assert rendered.text.strip().splitlines()[0] in rendered.html
    assert "24-09-2026" in rendered.text
    assert "24-09-2026" in rendered.html
    # Internal identifiers never reach a reader in either body.
    for body in (rendered.subject, rendered.text, rendered.html):
        assert "late_shift" not in body


def test_the_html_brands_the_mail_like_the_interface(rendered: RenderedEmail) -> None:
    assert "On-call" in rendered.html
    assert "ZESPÓŁ WSPARCIA" in rendered.html, "the subtitle, upper case like `.brand-sub`"
    assert 'href="https://oncall.example.com"' in rendered.html
    assert "Nie odpowiadaj na nią." in rendered.html
    # The light theme's signal colour, page background and ink.
    for token in ("#1d4ed8", "#eef1f5", "#0f172a"):
        assert token in rendered.html


OUTLOOK_HOSTILE = (
    # Word lays out nothing with these; the layout is tables or it is not there.
    r"display\s*:\s*(flex|grid)",
    r"float\s*:",
    r"position\s*:\s*(absolute|fixed)",
    # No alpha channel, no gradients, no background images.
    r"rgba\(",
    r"hsla?\(",
    r"gradient\(",
    r"background-image",
    r"url\(",
    # Ignored by Word, so the words themselves must already be what is shown.
    r"text-transform",
    # No inline images: the mark is a coloured cell, not an SVG or a data URI.
    r"<svg",
    r"<img",
    r"data:",
    # Lists as tables; Word's own bullets look like Word, not like the interface.
    r"<ul\b",
    r"<ol\b",
    # A web font would be requested and blocked; the fallback stack is the design.
    r"@import",
    r"@font-face",
    r"fonts\.googleapis",
)


def test_the_html_keeps_to_what_outlook_renders(rendered: RenderedEmail) -> None:
    html = rendered.html
    for pattern in OUTLOOK_HOSTILE:
        assert re.search(pattern, html, re.IGNORECASE) is None, pattern
    # Every table is layout, never data, so screen readers skip its structure.
    assert all('role="presentation"' in tag for tag in re.findall(r"<table[^>]*>", html))
    # Word ignores `max-width`; the fixed width it needs is behind the mso guard.
    assert 'width="560"' in html
    assert "<!--[if mso]>" in html
    # Every text cell names its font, since Word does not inherit it reliably.
    for cell in re.findall(r"<td[^>]*>\s*[^<\s]", html):
        assert "font-family" in cell, cell


def test_data_is_escaped_in_the_html() -> None:
    hostile = 'Anna <script>alert("x")</script> & Co'
    rendered = templates.swap_rejected(
        service_date=DAY,
        role=AssignmentRole.primary,
        requester_name=hostile,
        replacement_name="Marek Nowak",
        reason='<img src=x onerror="alert(1)">',
        by_coordinator=False,
        app=Brand(name='On-call "<b>"', subtitle="<i>", url="https://oncall.example.com"),
    )
    assert "<script>" not in rendered.html
    assert "<img" not in rendered.html
    assert "&lt;script&gt;" in rendered.html
    assert "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;" in rendered.html
    assert "On-call &quot;&lt;b&gt;&quot;" in rendered.html
    # The plain text is not markup and is left as the reader wrote it.
    assert hostile in rendered.text


def test_the_recorded_swap_asks_nobody_for_a_decision() -> None:
    """With the approval switched off, the coordinator's copy is for their
    information: it names the swap as already in force and never as pending."""
    for rendered in (RENDERINGS["swap_recorded"](), RENDERINGS["swap_recorded_for_coordinator"]()):
        for body in (rendered.subject, rendered.text, rendered.html):
            assert "zatwierdzenia" not in body.lower() or "nie wymaga" in body.lower()
            assert "Oczekuje na koordynatora" not in body
            assert "Podejmij decyzję" not in body
            assert "Do zatwierdzenia" not in body
    fyi = RENDERINGS["swap_recorded_for_coordinator"]()
    assert fyi.subject.startswith("Do wiadomości:")
    assert "tylko informacyjna" in fyi.text
    assert "tylko informacyjna" in fyi.html


def test_the_coordinator_copy_wraps_the_accepted_mail() -> None:
    accepted = RENDERINGS["swap_accepted"]()
    pending = RENDERINGS["swap_pending_coordinator"]()
    assert pending.subject == f"Do zatwierdzenia: {accepted.subject}"
    assert pending.text.startswith(
        "Anna Kowalska i Marek Nowak uzgodnili zamianę. "
        "Otwórz zakładkę Zamiany, aby podjąć decyzję.\n\n"
    )
    assert pending.text.endswith(accepted.text)
    assert "Podejmij decyzję" in pending.html


def test_a_published_schedule_lists_only_the_given_duties() -> None:
    with_duties = RENDERINGS["schedule_published"]()
    assert (
        "Twoje dyżury w tym grafiku:\n- czw 24-09-2026 · SECONDARY\n- sob 26-09-2026 · 11–19"
        in with_duties.text
    )
    assert "TWOJE DYŻURY W TYM GRAFIKU" in with_duties.html
    assert with_duties.html.count(">SECONDARY<") == 1
    assert with_duties.html.count(">11–19<") == 1
    assert ">PRIMARY<" not in with_duties.html

    without = RENDERINGS["schedule_published_without_duties"]()
    assert "W tym grafiku nie masz żadnych dyżurów." in without.text
    assert "W tym grafiku nie masz żadnych dyżurów." in without.html
    assert "TWOJE DYŻURY" not in without.html


def test_a_batch_correction_lists_every_change_with_its_reason() -> None:
    rendered = RENDERINGS["assignments_overridden_in_batch"]()
    assert rendered.subject == "Zmiana przydziałów: korekta koordynatora (2)"
    assert (
        "Koordynator zmienił następujące przydziały:\n"
        "- czw 24-09-2026 · PRIMARY: Marek Nowak (poprzednio: Anna Kowalska)\n"
        "- sob 26-09-2026 · SECONDARY: Ola Wiśniewska (poprzednio: Anna Kowalska)\n"
        "Powód: Odejście z zespołu\n"
    ) in rendered.text
    assert rendered.html.count("(poprzednio: Anna Kowalska)") == 2
    assert "Odejście z zespołu" in rendered.html
    assert ">PRIMARY<" in rendered.html and ">SECONDARY<" in rendered.html


def test_optional_reasons_appear_only_when_given() -> None:
    with_reason = RENDERINGS["swap_rejected"]()
    assert "Powód: Nie mogę tego dnia\n" in with_reason.text
    assert ">POWÓD<" in with_reason.html
    assert "Nie mogę tego dnia" in with_reason.html

    without = RENDERINGS["swap_rejected_by_coordinator"]()
    assert "Powód" not in without.text
    assert "POWÓD" not in without.html
    assert "koordynator" in without.text
