"""Reading and changing the forwarding settings, revealing the stored
password to an administrator, checking the connection to WCO, and reading
the state."""

from datetime import datetime

from oncall.domain.access.models import SignInRequest
from oncall.domain.access.use_cases import verify_own_password
from oncall.domain.accounts import Account
from oncall.domain.forwarding import errors
from oncall.domain.forwarding.models import (
    ConnectionTest,
    ForwardingMode,
    ForwardingSettings,
    ForwardingState,
    RevealedPasswords,
    SettingsChange,
    WcoAccount,
)
from oncall.domain.forwarding.passwords import Passwords
from oncall.domain.forwarding.ports import (
    ConnectionTestPorts,
    CurrentSettings,
    CurrentState,
    PasswordReader,
    RevealPorts,
    SettingsPorts,
)


async def current_settings(settings: CurrentSettings) -> ForwardingSettings:
    return await settings.current()


async def change_settings(
    change: SettingsChange, password: str | None, ports: SettingsPorts
) -> ForwardingSettings:
    """Save the settings; `password` replaces the stored one, None keeps it.

    A password is stored only encrypted, a stored one is kept only for the
    address it was entered for, and forwarding is turned on only with a key
    to decrypt it and everything a login to WCO needs.
    """
    enabling = change.mode is not ForwardingMode.off
    if (password is not None or enabling) and not ports.cipher.available():
        raise errors.SecretsKeyMissing()
    current = await ports.settings.current()
    keeps_password = password is None and current.password_set
    if keeps_password and change.base_url != current.base_url:
        raise errors.NewAddressNeedsPassword()
    if enabling and not (change.complete and (password is not None or current.password_set)):
        raise errors.SettingsIncomplete()
    token = None if password is None else ports.cipher.encrypt(password)
    settings = await ports.settings.change(change, token)
    ports.journal.settings_updated(settings, password_changed=token is not None)
    return settings


async def reveal_password(
    administrator: Account, confirmation: SignInRequest, ports: RevealPorts, *, now: datetime
) -> RevealedPasswords:
    """The stored WCO passwords in the clear, so the administrator can switch
    the number by hand when the forwarding pass cannot.

    The administrator first confirms it is them with their own sign-in
    password (`confirmation`), and every reveal is audited without the value.
    During a half-done rotation both passwords come back, the pending one
    first, because nobody knows for sure which one WCO holds.
    """
    await verify_own_password(administrator, confirmation, ports.confirm, now=now)
    settings = await ports.settings.current()
    tokens = await ports.settings.tokens()
    if tokens is None:
        raise errors.PasswordNotSet()
    if not ports.cipher.available():
        raise errors.SecretsKeyMissing()
    pending = None if tokens.pending is None else _read(tokens.pending, ports.cipher)
    revealed = RevealedPasswords(
        current=_read(tokens.current, ports.cipher),
        pending=pending,
        pending_since=settings.rotation_pending_since,
        credentials_invalid_since=settings.credentials_invalid_since,
        password_changed_at=settings.password_changed_at,
    )
    ports.journal.password_revealed(settings, pending_included=pending is not None)
    return revealed


async def test_connection(ports: ConnectionTestPorts) -> ConnectionTest:
    """Log in to WCO with the stored settings and read the number it forwards
    to, writing nothing there, so an administrator learns before turning
    forwarding on whether the settings work. Every test is audited.

    Once WCO has refused every stored password nothing is tried, as the
    worker does, until a new password is entered."""
    settings = await ports.settings.current()
    tokens = await ports.settings.tokens()
    if tokens is None or not (settings.vpbx_number and settings.username and settings.wco_user_id):
        raise errors.SettingsIncomplete()
    if settings.credentials_invalid_since is not None:
        raise errors.CredentialsRefused()
    if not ports.cipher.available():
        raise errors.SecretsKeyMissing()
    pending = None if tokens.pending is None else _read(tokens.pending, ports.cipher)
    account = WcoAccount(
        base_url=settings.base_url,
        vpbx_number=settings.vpbx_number,
        username=settings.username,
        wco_user_id=settings.wco_user_id,
        passwords=Passwords(_read(tokens.current, ports.cipher), pending),
    )
    result = await ports.probe(account)
    ports.journal.connection_tested(settings, result)
    return result


def _read(token: str, cipher: PasswordReader) -> str:
    plaintext = cipher.read(token)
    if plaintext is None:
        raise errors.StoredPasswordUnreadable()
    return plaintext


async def current_state(state: CurrentState) -> ForwardingState:
    return await state.current()
