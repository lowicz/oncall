import pytest
from sqlalchemy.exc import IntegrityError

from oncall.auth import verify_password
from oncall.domain.vocabulary import AuthSource, UserRole
from oncall.infrastructure.sqlalchemy.access_models import User
from tests.conftest import create_user, login


def test_display_name_is_derived_from_separate_name_fields() -> None:
    user = User(
        username="anna",
        first_name="Anna Maria",
        last_name="Kowalska",
        password_hash=None,
        role=UserRole.member,
    )
    assert user.display_name == "Anna Maria Kowalska"

    user.display_name = "  Jan   Nowak-Kowalski  "
    assert user.first_name == "Jan"
    assert user.last_name == "Nowak-Kowalski"
    assert user.display_name == "Jan Nowak-Kowalski"


def test_personnel_number_accepts_leading_zeroes_and_rejects_non_digits() -> None:
    user = User(
        username="anna",
        display_name="Anna Kowalska",
        password_hash=None,
        role=UserRole.member,
        personnel_number="004512",
    )
    assert user.personnel_number == "004512"

    with pytest.raises(ValueError, match="wyłącznie cyfry"):
        user.personnel_number = "45A12"


async def test_personnel_number_is_unique(db) -> None:
    first = await create_user(db, "anna")
    first.personnel_number = "004512"
    await db.commit()

    second = await create_user(db, "marek")
    second.personnel_number = "004512"
    with pytest.raises(IntegrityError):
        await db.commit()


async def test_admin_users_expose_split_identity_and_auth_source(client, db) -> None:
    admin = await create_user(db, "admin", role=UserRole.admin, display_name="Jan Kowalski")
    admin.personnel_number = "000007"
    admin.auth_source = AuthSource.local
    await db.commit()
    await login(client, "admin")

    response = await client.get("/api/v1/admin/users")
    assert response.status_code == 200
    body = response.json()
    assert body[0].pop("created_at").startswith("20")
    assert body == [
        {
            "id": str(admin.id),
            "username": "admin",
            "personnel_number": "000007",
            "first_name": "Jan",
            "last_name": "Kowalski",
            "display_name": "Jan Kowalski",
            "auth_source": "local",
            "role": "admin",
            "email": None,
            "phone": None,
            "is_active": True,
            "pending_activation": None,
        }
    ]


def test_account_without_local_password_cannot_use_local_verifier() -> None:
    assert verify_password(None, "any-password") is False
    assert verify_password("", "any-password") is False
