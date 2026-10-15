"""Secrets the database keeps encrypted, under ``ONCALL_SECRETS_KEY``.

Fernet (AES-128-CBC with HMAC-SHA256) through ``MultiFernet``: the first key
encrypts, every key decrypts. Rotating the key is putting a new one first,
saving each secret once so it is encrypted again under it, and then dropping
the old one. The tokens protect the database and its backups; whoever also
holds the environment holds the key, the same boundary the SMTP and LDAP
passwords sit on.
"""

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from oncall.config import Settings


class SecretsUnavailable(RuntimeError):
    """No key is set, or none of the keys opens the token. The message names
    the variable for the operator and never carries the key or the token."""


def _cipher(settings: Settings) -> MultiFernet:
    if settings.secrets_key is None:
        raise SecretsUnavailable("ONCALL_SECRETS_KEY is not set")
    keys = settings.secrets_key.get_secret_value().split(",")
    return MultiFernet([Fernet(key) for key in keys])


def encrypt(settings: Settings, plaintext: str) -> str:
    """The token for ``plaintext`` under the first key."""
    return _cipher(settings).encrypt(plaintext.encode()).decode()


def decrypt(settings: Settings, token: str) -> str:
    """The plaintext of ``token``, under whichever key encrypted it."""
    try:
        return _cipher(settings).decrypt(token.encode()).decode()
    except InvalidToken:
        raise SecretsUnavailable(
            "No key in ONCALL_SECRETS_KEY decrypts the stored secret; "
            "was the key it was encrypted under removed?"
        ) from None


class SettingsCipher:
    """`encrypt` under the process's settings, as a port takes it."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def available(self) -> bool:
        return self._settings.secrets_key is not None

    def encrypt(self, plaintext: str) -> str:
        return encrypt(self._settings, plaintext)
