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


class ForwardingOff(DomainError):
    """A handover is asked for while forwarding is off: nothing would switch
    the number, and the application cannot tell where it rings."""

    def __init__(self) -> None:
        super().__init__("forwarding.handover_forwarding_off")


class NotInThePair(DomainError):
    """Somebody who is neither the day's PRIMARY or SECONDARY nor a
    coordinator starts or ends a handover."""

    def __init__(self) -> None:
        super().__init__("forwarding.handover_not_in_pair")


class HandoverNeedsPair(DomainError):
    """The duty day has no PRIMARY or no SECONDARY to hand the number between."""

    def __init__(self) -> None:
        super().__init__("forwarding.handover_needs_pair")


class HandoverActive(DomainError):
    """A second handover is asked for while one holds."""

    def __init__(self, receiver: str) -> None:
        super().__init__("forwarding.handover_active", name=receiver)


class HandoverUntilOutOfRange(DomainError):
    """The end is not after now, or after the end of the duty day, when the
    number passes to the next PRIMARY anyway."""

    def __init__(self, latest: str) -> None:
        super().__init__("forwarding.handover_until_out_of_range", latest=latest)


class ReceiverHasNoPhone(DomainError):
    """The SECONDARY has no phone number to forward to."""

    def __init__(self, receiver: str) -> None:
        super().__init__("forwarding.handover_receiver_has_no_phone", name=receiver)


class HandoverNotFound(DomainError):
    """No open handover has this id: it ended, or never existed."""

    def __init__(self) -> None:
        super().__init__("forwarding.handover_not_found")
