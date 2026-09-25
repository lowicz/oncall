"""The language of what the API says to a person.

Every sentence a request can answer with - a refused business rule, a
validation message, a rule violation, a holiday's name - is written in one
catalog per language (`pl.py`, `en.py`) under an English key. Polish is the
default and the language of everything recorded (audit summaries, decision
notes, run errors) and logged; English is served when the request asks for it
with `Accept-Language`. The middleware in `oncall.bootstrap.http` reads that
header once per request into a context variable, and `translate()` reads the
variable, so nothing in between has to pass the language along.

The two catalogs are kept in step by `tests/test_i18n.py`: the same keys, the
same placeholders.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar, Token
from typing import Literal, get_args

from oncall.i18n import en, pl

Language = Literal["pl", "en"]

DEFAULT_LANGUAGE: Language = "pl"
SUPPORTED_LANGUAGES: tuple[Language, ...] = get_args(Language)

CATALOGS: dict[Language, dict[str, str]] = {"pl": pl.MESSAGES, "en": en.MESSAGES}

_request_language: ContextVar[Language] = ContextVar("request_language", default=DEFAULT_LANGUAGE)


def request_language() -> Language:
    """The language of the request being served; the default outside one."""
    return _request_language.get()


def set_request_language(language: Language) -> Token[Language]:
    return _request_language.set(language)


def reset_request_language(token: Token[Language]) -> None:
    _request_language.reset(token)


@contextmanager
def language_scope(language: Language) -> Iterator[None]:
    """Serve everything inside the block in `language` (tests, one-off calls)."""
    token = set_request_language(language)
    try:
        yield
    finally:
        reset_request_language(token)


def negotiate(accept_language: str | None) -> Language:
    """The supported language an `Accept-Language` header prefers.

    The header lists tags with optional weights (`en-GB,en;q=0.9,pl;q=0.5`);
    the first supported primary tag in order of weight wins, and a missing,
    empty or unsupported header falls back to the default. `*` counts for
    nothing on purpose: a browser that expresses no preference gets Polish.
    """
    if not accept_language:
        return DEFAULT_LANGUAGE
    ranked: list[tuple[float, int, Language]] = []
    for position, item in enumerate(accept_language.split(",")):
        tag, _, parameters = item.strip().partition(";")
        primary = tag.strip().split("-")[0].lower()
        if primary not in SUPPORTED_LANGUAGES:
            continue
        weight = 1.0
        for parameter in parameters.split(";"):
            name, _, value = parameter.strip().partition("=")
            if name.strip().lower() == "q":
                try:
                    weight = float(value)
                except ValueError:
                    weight = 0.0
        if weight > 0:
            ranked.append((-weight, position, primary))
    if not ranked:
        return DEFAULT_LANGUAGE
    return min(ranked)[2]


def translate(key: str, language: Language | None = None, /, **params: object) -> str:
    """The sentence `key` names, in `language` or the request's, with `params` filled in.

    An unknown key is a programming error and raises, so a typo cannot ship a
    blank sentence.
    """
    catalog = CATALOGS[language or request_language()]
    template = catalog[key]
    return template.format(**params) if params else template


__all__ = [
    "CATALOGS",
    "DEFAULT_LANGUAGE",
    "SUPPORTED_LANGUAGES",
    "Language",
    "language_scope",
    "negotiate",
    "request_language",
    "reset_request_language",
    "set_request_language",
    "translate",
]
