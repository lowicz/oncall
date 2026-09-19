"""The on-call rotation's own words, free of any framework.

These enums used to be declared in `oncall.models`, next to the SQLAlchemy
tables, so every pure module that needed a role name (`rules`, `fairness`)
dragged the ORM in with it. They are declared here and re-exported by
`oncall.models`, so the tables and the domain speak the same vocabulary
without the domain depending on the database.
"""

from enum import StrEnum


class UserRole(StrEnum):
    viewer = "viewer"
    member = "member"
    coordinator = "coordinator"
    admin = "admin"


class AssignmentRole(StrEnum):
    primary = "primary"
    secondary = "secondary"
    late_shift = "late_shift"


#: How each role is named wherever people read it.
ROLE_LABELS = {
    AssignmentRole.primary: "PRIMARY",
    AssignmentRole.secondary: "SECONDARY",
    AssignmentRole.late_shift: "11–19",
}


class ScheduleStatus(StrEnum):
    draft = "draft"
    proposed = "proposed"
    published = "published"
    superseded = "superseded"


class AvailabilityKind(StrEnum):
    unavailable = "unavailable"
    prefer_not = "prefer_not"
    prefer = "prefer"


class RotationMode(StrEnum):
    hybrid = "hybrid"
    daily = "daily"
    weekly = "weekly"


class LateShiftAnchor(StrEnum):
    secondary = "secondary"
    primary = "primary"
    independent = "independent"


class SwapStatus(StrEnum):
    pending_replacement = "pending_replacement"
    pending_coordinator = "pending_coordinator"
    approved = "approved"
    rejected = "rejected"
    cancelled = "cancelled"


class AuthSource(StrEnum):
    local = "local"
    ldap = "ldap"


class AccountTokenKind(StrEnum):
    activation = "activation"
    password_reset = "password_reset"


class FeedTokenKind(StrEnum):
    member = "member"
    share_link = "share_link"


class CalendarEventColor(StrEnum):
    blue = "blue"
    green = "green"
    amber = "amber"
    red = "red"
    violet = "violet"
    teal = "teal"
