from oncall.domain.errors import DomainError


class SecretsKeyMissing(DomainError):
    """A WCO password is to be stored, or forwarding turned on, while the
    process has no key to encrypt the password with."""

    def __init__(self) -> None:
        super().__init__("forwarding.secrets_key_missing")


class SettingsIncomplete(DomainError):
    """Forwarding is turned on without everything a login to WCO needs."""

    def __init__(self) -> None:
        super().__init__("forwarding.settings_incomplete")
