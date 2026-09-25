from typing import Literal

from oncall.domain.errors import DomainError, RecordedRefusal

#: Why a sign-in was rejected, for the operator's log only: the person gets
#: the same answer for both.
RejectionCause = Literal["credentials_rejected", "account_inactive"]

#: Why a directory identity could not be given an account here.
#: `personnel_number_mismatch`: the login belongs to an account whose
#: personnel number is another one or none; `login_taken`: the account with
#: this personnel number exists, but its directory login belongs to another
#: account; `auth_source_mismatch`: the account signs in some other way.
IdentityConflictCause = Literal["personnel_number_mismatch", "login_taken", "auth_source_mismatch"]


class LoginThrottled(RecordedRefusal):
    def __init__(self, label: str, retry_after: int) -> None:
        super().__init__("access.login_throttled")
        self.label = label
        self.retry_after = retry_after


class LoginRejected(RecordedRefusal):
    """Wrong password, unknown login or inactive account: one public answer
    for all three, so none of them discloses that an account exists. `cause`
    tells them apart in the server's log."""

    def __init__(self, cause: RejectionCause) -> None:
        super().__init__("access.login_rejected")
        self.cause: RejectionCause = cause


class DirectoryFailure(DomainError):
    """The directory could not safely complete authentication."""

    def __init__(self, reason: str) -> None:
        super().__init__("access.directory_failure", reason=reason)
        self.reason = reason


class DirectoryLoginUnavailable(RecordedRefusal):
    def __init__(self, reason: str) -> None:
        super().__init__("access.directory_login_unavailable")
        self.reason = reason


class DirectoryUnavailable(DomainError):
    """The directory could not answer for the signed-in person's own data."""

    def __init__(self, reason: str) -> None:
        super().__init__("access.directory_unavailable")
        self.reason = reason


class DirectoryIdentityTaken(DomainError):
    """The login or personnel number the directory vouches for belongs to
    another account here."""

    def __init__(self, cause: IdentityConflictCause) -> None:
        super().__init__("access.identity_taken")
        self.cause: IdentityConflictCause = cause


class DirectoryIdentityConflict(RecordedRefusal):
    def __init__(self, cause: IdentityConflictCause) -> None:
        super().__init__("access.identity_taken")
        self.cause: IdentityConflictCause = cause


class AccountLinkInvalid(DomainError):
    def __init__(self) -> None:
        super().__init__("access.account_link_invalid")


class AccountAlreadyActivated(DomainError):
    def __init__(self) -> None:
        super().__init__("access.account_already_activated")


class PasswordSameAsLogin(DomainError):
    def __init__(self) -> None:
        super().__init__("access.password_same_as_login")


class ShareSessionHasNoAccount(DomainError):
    def __init__(self) -> None:
        super().__init__("access.share_session_has_no_account")


class AccountGone(DomainError):
    """The signed-in account no longer exists; an administrator deleted it."""

    def __init__(self) -> None:
        super().__init__("access.account_gone")
