from oncall.domain.errors import DomainError


class SecretsKeyMissing(DomainError):
    """A WCO password is to be stored, or forwarding turned on, while the
    process has no key to encrypt the password with."""

    def __init__(self) -> None:
        super().__init__("forwarding.secrets_key_missing")


class StoredPasswordUnreadable(DomainError):
    """No key the process holds opens the stored WCO password: the key it was
    encrypted under was removed from the environment."""

    def __init__(self) -> None:
        super().__init__("forwarding.stored_password_unreadable")


class PasswordNotSet(DomainError):
    """A reveal is asked for while no WCO password is stored."""

    def __init__(self) -> None:
        super().__init__("forwarding.password_not_set")


class SettingsIncomplete(DomainError):
    """Forwarding is turned on without everything a login to WCO needs."""

    def __init__(self) -> None:
        super().__init__("forwarding.settings_incomplete")


class NewAddressNeedsPassword(DomainError):
    """The WCO address changes while a stored password would be kept, which
    would send that password to a host it was not entered for."""

    def __init__(self) -> None:
        super().__init__("forwarding.new_address_needs_password")


class CredentialsRefused(DomainError):
    """A connection test is asked for while WCO has refused every stored
    password: another refused login could lock the WCO account."""

    def __init__(self) -> None:
        super().__init__("forwarding.credentials_refused")
