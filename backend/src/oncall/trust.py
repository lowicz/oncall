"""What this deployment trusts: the image's public roots plus `ONCALL_CA_FILE`.

SMTP and Orange WCO verify their servers against both; the LDAP client hands
the file alone to ldap3, which cannot take a context. Every caller reads the
file when it connects, so an unreadable one fails that connection only and
never stops local sign-in.
"""

import os
import ssl
from pathlib import Path

from oncall.config import Settings


class CaFileUnreadable(Exception):
    """`ONCALL_CA_FILE` names no readable PEM bundle; `path` is what it names."""

    def __init__(self, path: str, reason: str) -> None:
        super().__init__(f"ONCALL_CA_FILE is unreadable ({path}): {reason}")
        self.path = path


def ca_file(settings: Settings) -> str | None:
    """`ONCALL_CA_FILE` when it is set and readable. Checked here because
    ldap3 silently drops a path that does not exist, and a missing bind
    source reaches the container as an empty directory."""
    path = settings.ca_file
    if path is not None and not (Path(path).is_file() and os.access(path, os.R_OK)):
        raise CaFileUnreadable(path, "not a readable file")
    return path


def tls_context(settings: Settings) -> ssl.SSLContext:
    """The image's public roots, plus `ONCALL_CA_FILE` when it is set: added
    to them, not put in their place, so one bundle serves a server on the
    internal PKI and a public one."""
    context = ssl.create_default_context()
    path = ca_file(settings)
    if path is not None:
        try:
            context.load_verify_locations(cafile=path)
        except ssl.SSLError as exc:
            raise CaFileUnreadable(path, str(exc)) from exc
    return context
