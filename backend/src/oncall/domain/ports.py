"""What the rotation use cases need from the world around them.

Every method that reaches storage is a coroutine: the application is
asynchronous end to end and the use cases await their ports. Implementations
stage their writes in the caller's unit of work; they never commit, so an
audit entry or a queued notification is stored together with the change it
describes or not at all.
"""

import uuid
from collections.abc import Iterable
from datetime import date
from typing import Protocol

from oncall.domain.roster import Duty, ScheduleRef, Slot
from oncall.domain.team import Member
from oncall.domain.vocabulary import LateShiftAnchor, RotationMode
from oncall.fairness import FairnessDuty, FairnessMemberInput


class TeamDirectory(Protocol):
    """The rotation members, each with eligibility and availability."""

    async def member_for_account(self, user_id: uuid.UUID) -> Member | None: ...

    async def member(self, member_id: uuid.UUID) -> Member | None: ...

    async def member_named(self, display_name: str) -> Member | None: ...

    async def members(self, member_ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, Member]: ...

    async def colleagues_of(self, member_id: uuid.UUID) -> list[Member]:
        """Everyone except this member, by display name."""
        ...

    async def display_names(self, member_ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, str]: ...

    async def another_active_approver_exists(self, user_id: uuid.UUID) -> bool:
        """Whether an active coordinator or admin other than this account exists."""
        ...


class PublishedRoster(Protocol):
    async def duties_in_force(self, starts_on: date, ends_on: date) -> dict[Slot, Duty]:
        """The duty in force for every covered slot, resolved across every
        published (and superseded) schedule, newest publication winning."""
        ...

    async def schedule(self, schedule_id: uuid.UUID) -> ScheduleRef | None: ...

    async def latest_publication_covering(self, day: date) -> ScheduleRef | None:
        """The most recently published schedule whose range contains the day."""
        ...

    async def duty(self, schedule_id: uuid.UUID, slot: Slot) -> Duty | None:
        """The slot as this one schedule has it, whether or not it is in force."""
        ...

    async def duty_for_handover(self, schedule_id: uuid.UUID, slot: Slot) -> Duty | None:
        """Like `duty`, read for a hand-over that will advance the schedule's
        version: a concurrent change to the same schedule is either already
        visible here or waits until this unit of work ends."""
        ...

    async def advance_version(
        self,
        schedule_id: uuid.UUID,
        *,
        expected_version: int | None,
        only_if_published: bool,
    ) -> bool:
        """Move the schedule to its next version if it is still as expected.

        Atomic: of two concurrent callers expecting the same version, one
        wins and the other gets False.
        """
        ...

    async def hand_over(self, schedule_id: uuid.UUID, slots: Iterable[Slot], to: Member) -> None:
        """Give these slots to a member as a manual change, creating any slot
        the schedule does not have yet."""
        ...


class RosterPolicy(Protocol):
    async def late_shift_anchor(self) -> LateShiftAnchor: ...

    async def rotation_mode(self) -> RotationMode:
        """The rotation the roster is being run under. Decides whether the
        rolling rest rules apply at all - weekly rotation states none."""
        ...


class FairnessHistory(Protocol):
    async def balance_inputs(
        self, window_start: date, window_end: date
    ) -> tuple[list[FairnessMemberInput], list[FairnessDuty]]:
        """The members active in the window and the duties in force in it."""
        ...
