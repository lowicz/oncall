"""Who takes part in the rotation, and who is acting on it."""

import uuid
from dataclasses import dataclass
from datetime import date

from oncall.domain.vocabulary import AssignmentRole, AvailabilityKind, UserRole


@dataclass(frozen=True)
class Actor:
    """The signed-in account a use case acts on behalf of."""

    user_id: uuid.UUID
    display_name: str
    role: UserRole

    @property
    def coordinates(self) -> bool:
        """Coordinators and admins decide over the whole team's roster."""
        return self.role in (UserRole.coordinator, UserRole.admin)


@dataclass(frozen=True)
class RolePeriod:
    """A span in which a member may hold a role (eligibility)."""

    role: AssignmentRole
    starts_on: date
    ends_on: date | None


@dataclass(frozen=True)
class AvailabilityPeriod:
    kind: AvailabilityKind
    starts_on: date
    ends_on: date


@dataclass(frozen=True)
class Member:
    """A rotation member with the periods that decide what they may hold."""

    id: uuid.UUID
    display_name: str
    user_id: uuid.UUID | None
    active_from: date
    active_until: date | None
    eligibility: tuple[RolePeriod, ...] = ()
    availability: tuple[AvailabilityPeriod, ...] = ()

    @property
    def has_account(self) -> bool:
        return self.user_id is not None

    def is_eligible(self, role: AssignmentRole, day: date) -> bool:
        if self.active_from > day or (self.active_until and self.active_until < day):
            return False
        return any(
            item.role == role
            and item.starts_on <= day
            and (item.ends_on is None or item.ends_on >= day)
            for item in self.eligibility
        )

    def is_unavailable(self, day: date) -> bool:
        return any(
            item.kind == AvailabilityKind.unavailable and item.starts_on <= day <= item.ends_on
            for item in self.availability
        )

    def soft_preference(self, day: date) -> AvailabilityKind | None:
        """`prefer_not` / `prefer` for that day. Hard `unavailable` is never
        returned: nobody unavailable is offered as a replacement at all."""
        return next(
            (
                item.kind
                for item in self.availability
                if item.starts_on <= day <= item.ends_on
                and item.kind != AvailabilityKind.unavailable
            ),
            None,
        )
