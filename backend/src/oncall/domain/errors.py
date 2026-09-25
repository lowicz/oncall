"""Errors every part of the rotation domain can raise."""

from oncall.i18n import translate


class DomainError(Exception):
    """Base class for business-rule failures.

    `key` names the sentence the person acting sees, in `oncall.i18n`'s
    catalogs, and `params` fill its placeholders; `str(error)` renders it in
    the language of the request being served (Polish outside a request, so
    the worker records Polish). Subclasses keep whatever else a caller needs
    to react (ids, dates, violations) as attributes. Translating any of this
    into a transport status happens only at the edge that owns the transport.
    """

    def __init__(self, key: str, /, **params: object) -> None:
        super().__init__(key)
        self.key = key
        self.params = params

    def __str__(self) -> str:
        return translate(self.key, **self.params)


class RecordedRefusal(DomainError):
    """A refusal that is itself part of the outcome.

    Whatever the use case recorded before refusing (a failed sign-in attempt,
    a directory outage) is kept: the caller completes the unit of work and
    only then reports the refusal. Every other `DomainError` leaves nothing
    behind.
    """


class NotATeamMember(DomainError):
    """The account passes the role gate but is not linked to a rotation
    member, so member-scoped operations have nothing to act on."""

    def __init__(self) -> None:
        super().__init__("domain.not_a_team_member")
