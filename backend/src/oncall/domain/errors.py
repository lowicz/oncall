"""Errors every part of the rotation domain can raise."""


class DomainError(Exception):
    """Base class for business-rule failures.

    The message is the Polish sentence the person acting sees; subclasses keep
    whatever else a caller needs to react (ids, dates, violations) as
    attributes. Translating any of this into a transport status happens only
    at the edge that owns the transport.
    """


class RecordedRefusal(DomainError):
    """A refusal that is itself part of the outcome.

    Whatever the use case recorded before refusing (a failed sign-in attempt,
    a directory outage) is kept: the caller completes the unit of work and
    only then reports the refusal. Every other `DomainError` leaves nothing
    behind.
    """


#: One message for one cause: the account passes the role gate but is not
#: linked to a rotation member, so member-scoped operations have nothing to act
#: on.
NOT_A_TEAM_MEMBER = "Konto nie jest powiązane z członkiem zespołu"


class NotATeamMember(DomainError):
    def __init__(self) -> None:
        super().__init__(NOT_A_TEAM_MEMBER)
