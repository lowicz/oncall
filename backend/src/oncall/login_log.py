"""What an operator reads when a sign-in fails.

A sign-in crosses the HTTP edge, the domain and, for a directory account, an
LDAP conversation run on a worker thread. The browser is told as little as
possible on purpose - one answer for every rejected password, one for every
directory outage - so the reason has to be somewhere else, and this is it: a
logfmt line per outcome in the API log, `event=login` for how the attempt
ended and `event=ldap_auth` for where a directory attempt stopped. Reading
the signed-in person's photo takes the same road: `event=ldap_photo` records
where that read stopped when it does not yield an image.

Every record of one attempt carries the same random `attempt=` id, set by the
login endpoint and carried to the LDAP thread by the context, so the lines of
one attempt can be picked out of concurrent traffic.

Nothing here writes a password, a session token or cookie, the service
account's DN or password, an entry's DN or attribute values, or the text a
directory sends back with an error; callers pass codes and names, and a value
that is not a plain word is quoted so it cannot forge a second record.
"""

import json
import logging
import re
import secrets
from contextvars import ContextVar

#: Its own logger, so sign-in diagnostics can be routed or silenced apart from
#: the rest of the application's log.
logger = logging.getLogger("oncall.login")

_ATTEMPT: ContextVar[str | None] = ContextVar("oncall_login_attempt", default=None)
_BARE = re.compile(r"[A-Za-z0-9._:/@,+-]+")
_MAX_VALUE = 120


def begin_attempt() -> str:
    """Name the sign-in the current request is making."""
    attempt = secrets.token_hex(4)
    _ATTEMPT.set(attempt)
    return attempt


def emit(event: str, *, level: int = logging.INFO, **fields: object) -> None:
    """One record: the event, the attempt id, then the fields as given.

    A field whose value is None is left out, so callers can pass optional
    details without branching.
    """
    parts = [f"event={event}"]
    attempt = _ATTEMPT.get()
    if attempt is not None:
        parts.append(f"attempt={attempt}")
    parts.extend(
        f"{name}={_rendered(value)}" for name, value in fields.items() if value is not None
    )
    logger.log(level, "%s", " ".join(parts))


def _rendered(value: object) -> str:
    text = str(value)[:_MAX_VALUE]
    return text if _BARE.fullmatch(text) else json.dumps(text)


__all__ = ["begin_attempt", "emit", "logger"]
