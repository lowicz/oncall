"""The small roster and team value rules the swap, override and publication
use cases lean on."""

import uuid
from dataclasses import replace
from datetime import date, timedelta

from oncall.domain.hard_rules import batch_substitution_check, substitution_check
from oncall.domain.roster import SlotOrigin, anchor_role
from oncall.domain.vocabulary import AssignmentRole, LateShiftAnchor
from tests.domain.fakes import member

DAY = date(2030, 3, 4)


class _Untouchable:
    """A roster or policy that fails the test if anything is asked of it."""

    def __getattr__(self, name: str):
        raise AssertionError(f"{name} must not be called for no moves")


async def test_no_moves_break_no_rules_and_read_nothing() -> None:
    untouchable = _Untouchable()

    assert await substitution_check(untouchable, untouchable, [], "Anna", "Bartek") == []
    assert await batch_substitution_check(untouchable, untouchable, []) == []


def test_the_original_holder_is_told_by_id_when_both_sides_have_one() -> None:
    anna = uuid.uuid4()
    origin = SlotOrigin(anna, "Anna")

    # Renamed, same person.
    assert origin.is_holder(anna, "Anna Nowak")
    # Same label, a different person.
    assert not origin.is_holder(uuid.uuid4(), "Anna")


def test_the_original_holder_is_told_by_label_when_either_side_has_no_id() -> None:
    assert SlotOrigin(None, "Anna").is_holder(uuid.uuid4(), "Anna")
    assert SlotOrigin(uuid.uuid4(), "Anna").is_holder(None, "Anna")
    assert not SlotOrigin(None, "Anna").is_holder(None, "Bartek")


def test_the_late_shift_travels_with_its_anchor_role_or_with_none() -> None:
    assert anchor_role(LateShiftAnchor.primary) == AssignmentRole.primary
    assert anchor_role(LateShiftAnchor.secondary) == AssignmentRole.secondary
    assert anchor_role(LateShiftAnchor.independent) is None


def test_nobody_is_eligible_outside_their_membership() -> None:
    joined = replace(member("Anna"), active_from=DAY, active_until=DAY + timedelta(days=30))

    assert joined.is_eligible(AssignmentRole.primary, DAY)
    assert not joined.is_eligible(AssignmentRole.primary, DAY - timedelta(days=1))
    assert not joined.is_eligible(AssignmentRole.primary, DAY + timedelta(days=31))
