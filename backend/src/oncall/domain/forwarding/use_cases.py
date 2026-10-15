"""Reading and changing the forwarding settings, and reading its state."""

from oncall.domain.forwarding import errors
from oncall.domain.forwarding.models import (
    ForwardingMode,
    ForwardingSettings,
    ForwardingState,
    SettingsChange,
)
from oncall.domain.forwarding.ports import CurrentSettings, CurrentState, SettingsPorts


async def current_settings(settings: CurrentSettings) -> ForwardingSettings:
    return await settings.current()


async def change_settings(
    change: SettingsChange, password: str | None, ports: SettingsPorts
) -> ForwardingSettings:
    """Save the settings; `password` replaces the stored one, None keeps it.

    A password is stored only encrypted, and forwarding is turned on only
    with a key to decrypt it and everything a login to WCO needs.
    """
    enabling = change.mode is not ForwardingMode.off
    if (password is not None or enabling) and not ports.cipher.available():
        raise errors.SecretsKeyMissing()
    if enabling and not (
        change.complete and (password is not None or (await ports.settings.current()).password_set)
    ):
        raise errors.SettingsIncomplete()
    token = None if password is None else ports.cipher.encrypt(password)
    settings = await ports.settings.change(change, token)
    await ports.journal.settings_updated(settings, password_changed=token is not None)
    return settings


async def current_state(state: CurrentState) -> ForwardingState:
    return await state.current()
