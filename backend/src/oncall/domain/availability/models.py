import uuid
from dataclasses import dataclass
from datetime import date, datetime

from oncall.domain.roster import Duty
from oncall.domain.team import Actor, Member
from oncall.domain.vocabulary import AvailabilityKind

#: The longest span a single entry may cover.
MAX_ENTRY_DAYS = 366

KIND_LABELS = {
    AvailabilityKind.unavailable: "nie mogę",
    AvailabilityKind.prefer_not: "wolę nie",
    AvailabilityKind.prefer: "chętnie wezmę",
}


@dataclass(frozen=True)
class OwnMember:
    """The actor's own rotation member."""


@dataclass(frozen=True)
class MemberById:
    """A member a coordinator acts for."""

    member_id: uuid.UUID


#: Whose availability an operation is about.
MemberRef = OwnMember | MemberById


@dataclass(frozen=True)
class AvailabilityDeclaration:
    actor: Actor
    member: MemberRef
    kind: AvailabilityKind
    starts_on: date
    ends_on: date
    note: str | None = None


@dataclass(frozen=True)
class AvailabilityWithdrawal:
    actor: Actor
    member: MemberRef
    entry_id: uuid.UUID


@dataclass(frozen=True)
class AvailabilityQuery:
    actor: Actor
    member: MemberRef
    starts_on: date | None = None
    ends_on: date | None = None


@dataclass(frozen=True)
class NewAvailabilityEntry:
    member_id: uuid.UUID
    created_by_user_id: uuid.UUID
    kind: AvailabilityKind
    starts_on: date
    ends_on: date
    note: str | None


@dataclass(frozen=True)
class AvailabilityEntry:
    id: uuid.UUID
    member_id: uuid.UUID
    kind: AvailabilityKind
    starts_on: date
    ends_on: date
    note: str | None
    created_at: datetime
    created_by_user_id: uuid.UUID | None
    #: Display name of `created_by_user_id`, when that account still exists.
    created_by_name: str | None

    def filed_for(self, member: Member) -> str | None:
        """Who filed the entry, named only when it was not the member's own
        account (a coordinator filing on their behalf)."""
        if self.created_by_user_id is None or self.created_by_user_id == member.user_id:
            return None
        return self.created_by_name


@dataclass(frozen=True)
class AvailabilityDeclared:
    entry: AvailabilityEntry
    member: Member
    on_behalf: bool
    #: Duties the member holds inside a hard „nie mogę"; the entry does not
    #: remove them.
    duty_conflicts: tuple[Duty, ...]
    warning: str | None


@dataclass(frozen=True)
class MemberAvailability:
    member: Member
    entries: tuple[AvailabilityEntry, ...]
