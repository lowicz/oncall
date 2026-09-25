"""What the API says to a person, in the language the request asks for."""

import re
import uuid
from datetime import date

import pytest

from oncall.domain.scheduling.errors import ScheduleNotFound
from oncall.domain.vocabulary import UserRole
from oncall.i18n import CATALOGS, DEFAULT_LANGUAGE, language_scope, negotiate, translate
from oncall.rules import RuleViolation, describe
from oncall.workdays import polish_holiday_names
from tests.conftest import create_user, login

PLACEHOLDER = re.compile(r"\{(\w+)\}")

#: Independence Day: a fixed-date holiday, so the year does not matter.
HOLIDAY = date(2026, 11, 11)


def test_the_catalogs_have_the_same_keys_and_placeholders() -> None:
    polish, english = CATALOGS["pl"], CATALOGS["en"]
    assert set(polish) == set(english)
    assert [key for key, text in polish.items() if not text.strip()] == []
    assert [key for key, text in english.items() if not text.strip()] == []
    for key in polish:
        assert set(PLACEHOLDER.findall(polish[key])) == set(PLACEHOLDER.findall(english[key])), key


@pytest.mark.parametrize(
    ("header", "expected"),
    [
        (None, "pl"),
        ("", "pl"),
        ("pl", "pl"),
        ("en", "en"),
        ("EN-us", "en"),
        ("en-GB,en;q=0.9,pl;q=0.5", "en"),
        ("pl,en;q=0.8", "pl"),
        ("pl;q=0.3, en;q=0.7", "en"),
        ("en;q=0,pl;q=0.1", "pl"),
        ("de", "pl"),
        ("*", "pl"),
        ("de-DE, *;q=0.5", "pl"),
        ("en;q=abc", "pl"),
    ],
)
def test_negotiate_prefers_the_best_supported_language(header: str | None, expected: str) -> None:
    assert negotiate(header) == expected


def test_translate_fills_placeholders_and_rejects_unknown_keys() -> None:
    assert DEFAULT_LANGUAGE == "pl"
    assert (
        translate("swaps.no_balance_in_window", display_name="Anna")
        == "Brak bilansu dla osoby Anna w tym oknie"
    )
    assert (
        translate("swaps.no_balance_in_window", "en", display_name="Anna")
        == "No balance for Anna in this window"
    )
    with pytest.raises(KeyError):
        translate("no.such.key")


def test_domain_sentences_follow_the_language_in_scope() -> None:
    error = ScheduleNotFound(uuid.uuid4())
    violation = RuleViolation("three_in_seven", "Anna", (date(2026, 9, 7), date(2026, 9, 8)))

    assert str(error) == "Nie znaleziono grafiku"
    assert violation.message == "Więcej niż 3 dyżury on-call w okresie 7 dni."
    assert describe(violation) == (
        "Anna: Więcej niż 3 dyżury on-call w okresie 7 dni. Dni: 07-09-2026, 08-09-2026."
    )
    assert polish_holiday_names(HOLIDAY, HOLIDAY) == {HOLIDAY: "Narodowe Święto Niepodległości"}

    with language_scope("en"):
        assert str(error) == "Schedule not found"
        assert violation.message == "More than 3 on-call duties within 7 days."
        assert describe(violation) == (
            "Anna: More than 3 on-call duties within 7 days. Days: 07-09-2026, 08-09-2026."
        )
        assert polish_holiday_names(HOLIDAY, HOLIDAY) == {HOLIDAY: "National Independence Day"}

    # The scope is gone: the recorded language is back.
    assert str(error) == "Nie znaleziono grafiku"


async def test_http_answers_in_the_language_accept_language_prefers(client, db) -> None:
    await create_user(db, "koord", role=UserRole.coordinator)
    await login(client, "koord")
    missing_run = f"/api/v1/scheduling/runs/{uuid.uuid4()}"

    polish = await client.get(missing_run)
    assert polish.status_code == 404
    assert polish.json()["detail"] == "Nie znaleziono zadania generatora"
    assert polish.headers["content-language"] == "pl"

    english = await client.get(missing_run, headers={"Accept-Language": "en-GB,en;q=0.8"})
    assert english.status_code == 404
    assert english.json()["detail"] == "Generator run not found"
    assert english.headers["content-language"] == "en"

    # An unsupported preference gets the default, never a blank or a mix.
    german = await client.get(missing_run, headers={"Accept-Language": "de-DE"})
    assert german.json()["detail"] == "Nie znaleziono zadania generatora"
    assert german.headers["content-language"] == "pl"


async def test_validation_permission_and_holiday_names_are_translated_too(client, db) -> None:
    english = {"Accept-Language": "en"}

    invalid = await client.post("/api/v1/auth/login", json={}, headers=english)
    assert invalid.status_code == 422
    messages = {tuple(item["loc"]): item["msg"] for item in invalid.json()["detail"]}
    assert messages[("body", "username")] == "This field is required."

    await create_user(db, "anna")
    await login(client, "anna")
    forbidden = await client.get("/api/v1/admin/users", headers=english)
    assert forbidden.status_code == 403
    assert forbidden.json()["detail"] == "You are not allowed to do this"

    calendar = await client.get(
        f"/api/v1/calendar?starts_on={HOLIDAY}&ends_on={HOLIDAY}", headers=english
    )
    assert calendar.status_code == 200
    (day,) = calendar.json()["days"]
    assert (day["weekday"], day["holiday_name"]) == ("Wed", "National Independence Day")

    polish_calendar = await client.get(f"/api/v1/calendar?starts_on={HOLIDAY}&ends_on={HOLIDAY}")
    (polish_day,) = polish_calendar.json()["days"]
    assert (polish_day["weekday"], polish_day["holiday_name"]) == (
        "śr",
        "Narodowe Święto Niepodległości",
    )
