"""HTML layout of a notification e-mail, in the interface's own light theme.

One layout for every notification: brand line, a card with an eyebrow, a
title, a lead sentence, an optional key/value list, an optional list of duty
slots, an optional highlighted note, one call to action, and a footer. The
event templates in :mod:`oncall.notifications.templates` only choose the
words; everything about how the mail looks lives here.

Written for Outlook 365 first, because that is the one client the team reads
mail in. Its desktop build renders HTML with the Word engine, which drops most
of what a browser takes for granted, so the markup keeps to what Word honours:

- nested ``<table>`` elements for layout, never ``div`` floats, flex or grid;
- every style inline on the element that needs it, because Word does not
  inherit ``font-family`` or ``color`` into a table cell reliably and web
  Outlook rewrites the ``<style>`` block;
- solid hex colours only: ``rgba()`` is unsupported, so the interface's
  translucent tokens are written here as the colour they produce on white;
- a fixed 560px width behind an ``mso`` conditional, because Word ignores
  ``max-width``; other clients get the fluid table;
- text that must be upper case is written in upper case, since Word ignores
  ``text-transform``; badges are table cells, since Word ignores padding on
  inline elements;
- the button is a table cell with a background, the one shape of "button"
  every Outlook build draws the same way.

Colours are the light values of ``frontend/src/tokens.css``; the type ramp
follows ``frontend/src/styles.css`` (``.ph-eyebrow``, ``.ph-title``,
``.field-label``, ``.tag``, ``.btn-pri``). Web fonts are not loaded on
purpose: Outlook falls back to ``Segoe UI``, which is what the interface's own
font stack falls back to on Windows.

Every value that comes from data goes through :func:`text`, which escapes it.
Builders accept and return :class:`Html`, a marker for a fragment that is
already safe to embed, so a caller cannot pass a raw name where markup goes.
"""

from dataclasses import dataclass
from enum import StrEnum
from html import escape

from oncall.domain.vocabulary import AssignmentRole

# Light-theme tokens from `frontend/src/tokens.css`. The translucent ones are
# flattened onto white, because Outlook has no alpha channel.
BG = "#eef1f5"
SURFACE = "#ffffff"
SURFACE_2 = "#f6f8fa"
SURFACE_3 = "#e9edf2"
LINE = "#e7e9ec"
LINE_2 = "#c5c9d0"
FG = "#0f172a"
MUTED = "#55637a"
DIM = "#8593a6"
SIG = "#1d4ed8"
SIG_INK = "#ffffff"

FONT = "'Segoe UI', Arial, Helvetica, sans-serif"
MONO = "Consolas, 'Courier New', monospace"

#: The width of the card, the width of the interface's side panel plus its
#: padding, and narrow enough for the Outlook reading pane.
WIDTH = 560


class Html(str):
    """A fragment that is safe to embed as it is: it was escaped or built here."""

    __slots__ = ()


def text(value: object) -> Html:
    """Escape one data value for embedding in markup."""
    return Html(escape(str(value), quote=True))


def join(*parts: Html) -> Html:
    return Html("".join(parts))


class Tone(StrEnum):
    """The interface's status colours (`--ok`, `--warn`, `--bad`, `--sig`)."""

    ok = "ok"
    warn = "warn"
    bad = "bad"
    sig = "sig"


_TONES: dict[Tone, tuple[str, str]] = {
    Tone.ok: ("#15803d", "#dcfce7"),
    Tone.warn: ("#b45309", "#fef3c7"),
    Tone.bad: ("#b91c1c", "#fee2e2"),
    Tone.sig: (SIG, "#e8eefb"),
}

#: Role colours (`--p`, `--sec`, `--late` and their backgrounds).
_ROLE_COLOURS: dict[AssignmentRole, tuple[str, str]] = {
    AssignmentRole.primary: ("#0f766e", "#ccf1ea"),
    AssignmentRole.secondary: ("#6d28d9", "#ede9fe"),
    AssignmentRole.late_shift: ("#b45309", "#fef3c7"),
}


def _tag(label: str, *, fg: str, bg: str) -> Html:
    """A `.tag`: mono, small, on a tinted background. A table cell, so the
    padding survives Word."""
    return Html(
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
        'style="display:inline-table;"><tr>'
        f'<td bgcolor="{bg}" style="background-color:{bg};color:{fg};'
        f"font-family:{MONO};font-size:11px;line-height:14px;font-weight:700;"
        'letter-spacing:1px;padding:3px 6px;border-radius:4px;white-space:nowrap;">'
        f"{text(label)}</td></tr></table>"
    )


def role_tag(role: AssignmentRole, label: str) -> Html:
    fg, bg = _ROLE_COLOURS[role]
    return _tag(label, fg=fg, bg=bg)


def status_tag(label: str, tone: Tone) -> Html:
    """A `.st` status pill: the interface writes these in upper case."""
    fg, bg = _TONES[tone]
    return _tag(label.upper(), fg=fg, bg=bg)


def strong(value: object) -> Html:
    return Html(f'<b style="font-weight:700;color:{FG};">{text(value)}</b>')


def mono(value: object) -> Html:
    """A date or another value the interface prints in the mono face."""
    return Html(f'<span style="font-family:{MONO};font-size:13px;">{text(value)}</span>')


@dataclass(frozen=True)
class Fact:
    """One row of the key/value list under the lead: a `.field-label` and a value."""

    label: str
    value: Html


@dataclass(frozen=True)
class Slot:
    """One duty slot in a list: a day, a role tag and, optionally, who has it."""

    day: str
    role: AssignmentRole
    role_label: str
    detail: Html | None = None


@dataclass(frozen=True)
class Note:
    """A highlighted line, the interface's `.banner`."""

    body: str
    tone: Tone = Tone.warn


@dataclass(frozen=True)
class Action:
    """The one button of the mail."""

    label: str
    url: str


@dataclass(frozen=True)
class Brand:
    name: str
    subtitle: str
    url: str


def _cell(inner: Html, *, style: str) -> Html:
    return Html(f'<tr><td class="pad" style="{style}">{inner}</td></tr>')


_BODY_TEXT = f"font-family:{FONT};font-size:14px;line-height:21px;color:{FG};"


def _brand_row(brand: Brand) -> Html:
    """`.brand`: the mark, the name and the subtitle in mono upper case."""
    subtitle = (
        f'<span style="display:block;font-family:{MONO};font-size:10px;line-height:12px;'
        f'letter-spacing:1px;color:{DIM};padding-top:3px;">{text(brand.subtitle.upper())}</span>'
        if brand.subtitle
        else ""
    )
    return Html(
        '<tr><td style="padding:0 4px 12px;">'
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>'
        f'<td width="26" height="26" align="center" valign="middle" bgcolor="{SIG}" '
        f'style="width:26px;height:26px;background-color:{SIG};border-radius:6px;'
        f"font-family:{MONO};font-size:12px;line-height:26px;font-weight:700;"
        f'color:{SIG_INK};">E/</td>'
        f'<td valign="middle" style="padding-left:9px;font-family:{FONT};">'
        f'<a href="{text(brand.url)}" style="text-decoration:none;color:{FG};">'
        f'<span style="display:block;font-size:13px;line-height:16px;font-weight:700;'
        f'color:{FG};">{text(brand.name)}</span>{subtitle}</a></td>'
        "</tr></table></td></tr>"
    )


def _heading(eyebrow: str, title: str) -> Html:
    return _cell(
        Html(
            f'<div style="font-family:{MONO};font-size:10px;line-height:12px;font-weight:700;'
            f'letter-spacing:1px;color:{DIM};">{text(eyebrow.upper())}</div>'
            f'<h1 style="margin:8px 0 0;font-family:{FONT};font-size:22px;line-height:28px;'
            f'font-weight:700;color:{FG};">{text(title)}</h1>'
        ),
        style=f"padding:22px 24px 0;font-family:{FONT};",
    )


def _paragraph(body: Html, *, top: int = 14) -> Html:
    return _cell(body, style=f"padding:{top}px 24px 0;{_BODY_TEXT}")


def _facts(facts: list[Fact]) -> Html:
    rows = "".join(
        "<tr>"
        f'<td valign="top" width="128" style="width:128px;padding:7px 12px 7px 0;'
        f"font-family:{MONO};font-size:10px;line-height:20px;font-weight:700;"
        f'letter-spacing:1px;color:{MUTED};white-space:nowrap;">{text(fact.label.upper())}</td>'
        f'<td valign="top" style="padding:7px 0;{_BODY_TEXT}">{fact.value}</td>'
        "</tr>"
        for fact in facts
    )
    return _cell(
        Html(
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
            f'style="border-top:1px solid {LINE};border-bottom:1px solid {LINE};">{rows}</table>'
        ),
        style="padding:16px 24px 0;",
    )


def _slots(heading: str | None, slots: list[Slot]) -> Html:
    """The interface's `.role-row` list: one bordered row per slot."""
    head = (
        f'<div style="font-family:{MONO};font-size:10px;line-height:12px;font-weight:700;'
        f'letter-spacing:1px;color:{MUTED};padding-bottom:8px;">{text(heading.upper())}</div>'
        if heading
        else ""
    )
    rows = "".join(
        f'<tr><td style="padding:0 0 6px;">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        f'bgcolor="{SURFACE_2}" style="background-color:{SURFACE_2};border:1px solid {LINE};'
        'border-radius:7px;"><tr>'
        f'<td valign="middle" width="140" style="width:140px;padding:8px 10px;{_BODY_TEXT}'
        f'font-family:{MONO};font-size:13px;line-height:20px;white-space:nowrap;">{text(slot.day)}</td>'
        f'<td valign="middle" width="96" style="width:96px;padding:6px 10px 6px 0;">'
        f"{role_tag(slot.role, slot.role_label)}</td>"
        f'<td valign="middle" style="padding:8px 10px 8px 0;{_BODY_TEXT}">{slot.detail or ""}</td>'
        "</tr></table></td></tr>"
        for slot in slots
    )
    return _cell(
        Html(
            f"{head}"
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
            f"{rows}</table>"
        ),
        style="padding:16px 24px 0;",
    )


def _note(note: Note) -> Html:
    fg, bg = _TONES[note.tone]
    return _cell(
        Html(
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
            f'<tr><td bgcolor="{bg}" style="background-color:{bg};border-left:3px solid {fg};'
            f'border-radius:4px;padding:10px 12px;{_BODY_TEXT}font-size:13px;line-height:19px;">'
            f"{text(note.body)}</td></tr></table>"
        ),
        style="padding:16px 24px 0;",
    )


def _action(action: Action) -> Html:
    """`.btn-pri` as a table cell, plus the address in clear for a client that
    strips links or a reader who wants to see where the button goes."""
    url = text(action.url)
    return _cell(
        Html(
            '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>'
            f'<td align="center" bgcolor="{SIG}" style="background-color:{SIG};border-radius:7px;">'
            f'<a href="{url}" style="display:inline-block;padding:11px 18px;font-family:{FONT};'
            f"font-size:14px;line-height:18px;font-weight:600;color:{SIG_INK};"
            f'text-decoration:none;border:1px solid {SIG};border-radius:7px;">'
            f"{text(action.label)}</a></td></tr></table>"
            f'<div style="padding-top:10px;font-family:{FONT};font-size:12px;line-height:17px;'
            f'color:{MUTED};word-break:break-all;">'
            f'<a href="{url}" style="color:{SIG};text-decoration:underline;">{url}</a></div>'
        ),
        style="padding:22px 24px 24px;",
    )


def _footer(brand: Brand) -> Html:
    return _cell(
        Html(f"Wiadomość wysłana automatycznie przez {text(brand.name)}. Nie odpowiadaj na nią."),
        style=f"padding:14px 4px 0;font-family:{FONT};font-size:11px;line-height:16px;color:{DIM};",
    )


def render(
    *,
    brand: Brand,
    subject: str,
    preheader: str,
    eyebrow: str,
    title: str,
    lead: Html,
    facts: list[Fact] | None = None,
    slots: list[Slot] | None = None,
    slots_heading: str | None = None,
    body: list[Html] | None = None,
    note: Note | None = None,
    action: Action,
) -> str:
    """One complete e-mail document.

    `preheader` is the line a client shows next to the subject in the list; it
    is in the document but not on the page.
    """
    card = join(
        _heading(eyebrow, title),
        _paragraph(lead),
        _facts(facts) if facts else Html(""),
        _slots(slots_heading, slots) if slots else Html(""),
        *(_paragraph(paragraph) for paragraph in body or []),
        _note(note) if note else Html(""),
        _action(action),
    )
    return (
        '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" '
        '"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">\n'
        '<html xmlns="http://www.w3.org/1999/xhtml" '
        'xmlns:o="urn:schemas-microsoft-com:office:office" lang="pl">\n'
        "<head>\n"
        '<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        '<meta name="color-scheme" content="light">\n'
        '<meta name="supported-color-schemes" content="light">\n'
        "<!--[if mso]><xml><o:OfficeDocumentSettings>"
        "<o:PixelsPerInch>96</o:PixelsPerInch>"
        "</o:OfficeDocumentSettings></xml><![endif]-->\n"
        f"<title>{text(subject)}</title>\n"
        "<style>\n"
        "body{margin:0;padding:0;}\n"
        "table{border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;}\n"
        "td{mso-line-height-rule:exactly;}\n"
        f"@media only screen and (max-width:{WIDTH + 40}px){{"
        ".wrap{width:100% !important;}"
        ".card td.pad{padding-left:16px !important;padding-right:16px !important;}}\n"
        "</style>\n"
        "</head>\n"
        f'<body style="margin:0;padding:0;background-color:{BG};">\n'
        f'<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;'
        f'opacity:0;overflow:hidden;mso-hide:all;">{text(preheader)}</div>\n'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        f'bgcolor="{BG}" style="background-color:{BG};">\n'
        '<tr><td align="center" style="padding:24px 12px 32px;">\n'
        f'<!--[if mso]><table role="presentation" width="{WIDTH}" cellpadding="0" '
        'cellspacing="0" border="0"><tr><td><![endif]-->\n'
        '<table role="presentation" class="wrap" width="100%" cellpadding="0" cellspacing="0" '
        f'border="0" style="max-width:{WIDTH}px;">\n'
        f"{_brand_row(brand)}\n"
        f'<tr><td bgcolor="{SURFACE}" style="background-color:{SURFACE};border:1px solid {LINE};'
        'border-radius:10px;">\n'
        '<table role="presentation" class="card" width="100%" cellpadding="0" cellspacing="0" '
        'border="0">\n'
        f"{card}\n"
        "</table>\n"
        "</td></tr>\n"
        f"{_footer(brand)}\n"
        "</table>\n"
        "<!--[if mso]></td></tr></table><![endif]-->\n"
        "</td></tr>\n"
        "</table>\n"
        "</body>\n"
        "</html>\n"
    )
