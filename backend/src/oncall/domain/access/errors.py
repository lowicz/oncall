from oncall.domain.errors import DomainError, RecordedRefusal

IDENTITY_TAKEN = "Login lub numer pracownika jest już przypisany do innego konta"


class LoginThrottled(RecordedRefusal):
    def __init__(self, label: str, retry_after: int) -> None:
        super().__init__("Zbyt wiele prób logowania")
        self.label = label
        self.retry_after = retry_after


class LoginRejected(RecordedRefusal):
    """Wrong password, unknown login or inactive account: one public answer
    for all three, so none of them discloses that an account exists."""

    def __init__(self) -> None:
        super().__init__("Nieprawidłowy login lub hasło")


class DirectoryFailure(DomainError):
    """The directory could not safely complete authentication."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class DirectoryLoginUnavailable(RecordedRefusal):
    def __init__(self, reason: str) -> None:
        super().__init__("Logowanie katalogowe jest chwilowo niedostępne")
        self.reason = reason


class DirectoryIdentityTaken(DomainError):
    """The login or personnel number the directory vouches for belongs to
    another account here."""

    def __init__(self) -> None:
        super().__init__(IDENTITY_TAKEN)


class DirectoryIdentityConflict(RecordedRefusal):
    def __init__(self) -> None:
        super().__init__(IDENTITY_TAKEN)


class AccountLinkInvalid(DomainError):
    def __init__(self) -> None:
        super().__init__("Link jest nieprawidłowy lub wygasł")


class AccountAlreadyActivated(DomainError):
    def __init__(self) -> None:
        super().__init__("Konto zostało już aktywowane")


class PasswordSameAsLogin(DomainError):
    def __init__(self) -> None:
        super().__init__("Hasło nie może być takie jak login")


class ShareSessionHasNoAccount(DomainError):
    def __init__(self) -> None:
        super().__init__("Sesja linku nie ma konta do edycji")


class AccountGone(DomainError):
    """The signed-in account no longer exists; an administrator deleted it."""

    def __init__(self) -> None:
        super().__init__("Konto nie istnieje")
