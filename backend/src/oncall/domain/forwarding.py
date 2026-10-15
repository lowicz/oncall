"""Forwarding the on-call number through Orange WCO: the password rules.

WCO lets a password expire without saying when: the login still succeeds and
the next call answers 403. The forwarding pass then changes the password
itself, and it must never end up with WCO holding a password that is written
down nowhere. So the new password is stored as *pending* before WCO is asked
to take it, and only a login with it promotes it to *current*:

1. After a 403, generate a new password and store it as pending.
2. Ask WCO to change the current password to the pending one.
3. Log in again with the pending one.
4. Store it as current and forget the pending one.

A pass stopped anywhere in between leaves both passwords stored, and the next
pass logs in with the pending one first (`Passwords.login_order`); what it
learns from which one WCO accepted is `Passwords.after_login`.
"""

import secrets
from dataclasses import dataclass
from enum import StrEnum

#: The four character classes WCO requires, without the look-alikes (l, I, O,
#: 0, 1), so a password read off the admin screen can be typed back. The
#: specials keep their meaning in JSON and in a URL-encoded value.
PASSWORD_CLASSES = (
    "abcdefghijkmnpqrstuvwxyz",
    "ABCDEFGHJKLMNPQRSTUVWXYZ",
    "23456789",
    "!$%&*+-=?@_",
)
PASSWORD_LENGTH = 20
#: How many characters of each class a generated password holds at least.
PASSWORD_CLASS_MINIMUM = 2


def generate_password() -> str:
    """A new WCO password: `PASSWORD_LENGTH` characters from the system's
    random source, at least `PASSWORD_CLASS_MINIMUM` of every class."""
    chars = [
        secrets.choice(alphabet)
        for alphabet in PASSWORD_CLASSES
        for _ in range(PASSWORD_CLASS_MINIMUM)
    ]
    every = "".join(PASSWORD_CLASSES)
    chars += [secrets.choice(every) for _ in range(PASSWORD_LENGTH - len(chars))]
    secrets.SystemRandom().shuffle(chars)
    return "".join(chars)


class AfterLogin(StrEnum):
    """What the pass does once it knows which stored password WCO accepted."""

    #: The current password, with nothing pending: carry on.
    proceed = "proceed"
    #: The pending one: WCO took the change, so store it as current (step 4).
    promote = "promote"
    #: The current one while one is pending: the change never reached WCO, so
    #: ask for it again with the same pending password (step 2).
    change = "change"
    #: Neither: stop logging in until an administrator enters a password, or
    #: repeated refusals lock the WCO account.
    refused = "refused"


@dataclass(frozen=True)
class Passwords:
    """The WCO passwords stored for the forwarding account."""

    #: The one WCO accepted last.
    current: str
    #: A new one stored before WCO was asked to change to it.
    pending: str | None = None

    def login_order(self) -> tuple[str, ...]:
        """The passwords to log in with, one after another until WCO accepts
        one: the pending one first, which WCO holds once it took the change."""
        return (self.current,) if self.pending is None else (self.pending, self.current)

    def after_login(self, accepted: str | None) -> AfterLogin:
        """What to do after logging in with `login_order`: `accepted` is the
        password WCO took, None when it refused every one."""
        if accepted is None:
            return AfterLogin.refused
        if self.pending is None:
            return AfterLogin.proceed
        return AfterLogin.promote if accepted == self.pending else AfterLogin.change

    def promoted(self) -> Passwords:
        """Step 4: the pending password, now held by WCO, becomes current."""
        if self.pending is None:
            raise ValueError("no pending password to promote")
        return Passwords(current=self.pending)
