import pytest
from cryptography.fernet import Fernet

from oncall import secrets
from oncall.config import Settings

OLD_KEY = Fernet.generate_key().decode()
NEW_KEY = Fernet.generate_key().decode()


def keyed(*keys: str) -> Settings:
    return Settings(secrets_key=",".join(keys))


def test_a_secret_round_trips_and_its_token_does_not_carry_it() -> None:
    settings = keyed(NEW_KEY)

    token = secrets.encrypt(settings, "Haslo-WCO!1")

    assert "Haslo-WCO" not in token
    assert secrets.decrypt(settings, token) == "Haslo-WCO!1"


def test_every_key_decrypts_and_the_first_one_encrypts() -> None:
    """Rotation: with the new key put first, a token under the old key still
    opens, and saving it again encrypts it under the new key alone."""
    old_token = secrets.encrypt(keyed(OLD_KEY), "sekret")
    rotating = keyed(NEW_KEY, OLD_KEY)

    plaintext = secrets.decrypt(rotating, old_token)
    new_token = secrets.encrypt(rotating, plaintext)

    assert secrets.decrypt(keyed(NEW_KEY), new_token) == "sekret"


def test_without_a_key_nothing_is_encrypted_or_decrypted() -> None:
    settings = Settings(secrets_key=None)

    with pytest.raises(secrets.SecretsUnavailable, match="ONCALL_SECRETS_KEY is not set"):
        secrets.encrypt(settings, "sekret")
    with pytest.raises(secrets.SecretsUnavailable, match="ONCALL_SECRETS_KEY is not set"):
        secrets.decrypt(settings, "token")


def test_a_token_no_key_opens_is_refused_without_echoing_it() -> None:
    """The old key dropped too early: the error names the variable, never the
    token or the keys."""
    token = secrets.encrypt(keyed(OLD_KEY), "sekret")
    rotated = keyed(NEW_KEY)

    with pytest.raises(secrets.SecretsUnavailable) as refused:
        secrets.decrypt(rotated, token)

    assert "ONCALL_SECRETS_KEY" in str(refused.value)
    assert token not in str(refused.value)
    assert NEW_KEY not in str(refused.value)
