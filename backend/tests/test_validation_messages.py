"""QA7-L18: FastAPI's default 422 body is English next to a Polish interface."""

from oncall.models import UserRole
from tests.conftest import create_user, login


async def test_missing_field_message_is_polish(client, db) -> None:
    await create_user(db, "anna", role=UserRole.member)
    await login(client, "anna")
    response = await client.post("/api/v1/availability/me", json={"kind": "unavailable"})
    assert response.status_code == 422, response.text
    errors = {tuple(error["loc"]): error["msg"] for error in response.json()["detail"]}
    assert errors[("body", "starts_on")] == "To pole jest wymagane."


async def test_note_too_long_message_is_polish(client, db) -> None:
    await create_user(db, "anna", role=UserRole.member)
    await login(client, "anna")
    response = await client.post(
        "/api/v1/availability/me",
        json={
            "kind": "unavailable",
            "starts_on": "2026-09-14",
            "ends_on": "2026-09-14",
            "note": "x" * 600,
        },
    )
    assert response.status_code == 422, response.text
    error = response.json()["detail"][0]
    assert error["loc"] == ["body", "note"]
    assert error["msg"] == "Wartość jest za długa (maksimum 500 znaków)."


async def test_invalid_enum_message_is_polish(client, db) -> None:
    await create_user(db, "anna", role=UserRole.member)
    await login(client, "anna")
    response = await client.post(
        "/api/v1/availability/me",
        json={"kind": "nie-taka-wartosc", "starts_on": "2026-09-14", "ends_on": "2026-09-14"},
    )
    assert response.status_code == 422, response.text
    error = response.json()["detail"][0]
    assert error["loc"] == ["body", "kind"]
    assert error["msg"].startswith("Nieprawidłowa wartość. Dozwolone:")
