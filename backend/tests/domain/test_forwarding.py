"""The WCO password rules: what a generated password holds and which step of
the rotation follows a login."""

import uuid
from dataclasses import replace
from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

from oncall.domain.forwarding.job import (
    ForwardingFailure,
    ForwardingTarget,
    desired_target,
    forwarding_day,
    wco_number,
)
from oncall.domain.forwarding.passwords import (
    PASSWORD_CLASS_MINIMUM,
    PASSWORD_CLASSES,
    PASSWORD_LENGTH,
    AfterLogin,
    Passwords,
    generate_password,
)
from oncall.domain.roster import Duty
from oncall.domain.vocabulary import AssignmentRole


def test_a_generated_password_holds_every_class_from_the_unambiguous_alphabet() -> None:
    every = set("".join(PASSWORD_CLASSES))
    passwords = [generate_password() for _ in range(200)]

    for password in passwords:
        assert len(password) == PASSWORD_LENGTH
        assert set(password) <= every
        for alphabet in PASSWORD_CLASSES:
            assert sum(char in alphabet for char in password) >= PASSWORD_CLASS_MINIMUM
    assert len(set(passwords)) == len(passwords)
    assert not every & set("lIO01")


def test_without_a_pending_password_the_current_one_is_tried_alone() -> None:
    stored = Passwords(current="old")

    assert stored.login_order() == ("old",)
    assert stored.after_login("old") is AfterLogin.proceed
    assert stored.after_login(None) is AfterLogin.refused


def test_a_pending_password_is_tried_first_and_decides_the_next_step() -> None:
    stored = Passwords(current="old", pending="new")

    assert stored.login_order() == ("new", "old")
    assert stored.after_login("new") is AfterLogin.promote
    assert stored.after_login("old") is AfterLogin.change
    assert stored.after_login(None) is AfterLogin.refused


def test_a_pending_password_is_stored_beside_the_current_one_until_promoted() -> None:
    stored = replace(Passwords(current="old"), pending="second")

    assert stored.promoted() == Passwords(current="second")
    unchanged = Passwords(current="old")
    with pytest.raises(ValueError, match="no pending password"):
        unchanged.promoted()


def test_the_forwarding_day_changes_at_the_reminder_hour_across_dst() -> None:
    warsaw = ZoneInfo("Europe/Warsaw")
    day = date(2026, 10, 25)  # the autumn clock change

    assert forwarding_day(datetime(2026, 10, 25, 8, 59, tzinfo=warsaw), 9) == day.replace(day=24)
    assert forwarding_day(datetime(2026, 10, 25, 9, 0, tzinfo=warsaw), 9) == day


class _Roster:
    def __init__(self, duty: Duty | None) -> None:
        self.duty = duty

    async def duties_in_force(self, starts_on: date, ends_on: date):
        assert starts_on == ends_on
        return {} if self.duty is None else {(starts_on, AssignmentRole.primary): self.duty}


class _Contacts:
    def __init__(self, number: str | None) -> None:
        self.number = number
        self.asked: list[uuid.UUID] = []

    async def phone(self, member_id: uuid.UUID) -> str | None:
        self.asked.append(member_id)
        return self.number


async def test_the_desired_target_maps_the_primary_phone_to_wco_unchanged() -> None:
    day = date(2026, 9, 15)
    member_id = uuid.uuid4()
    duty = Duty(
        day,
        AssignmentRole.primary,
        member_id,
        "Anna Kowalska",
        False,
        uuid.uuid4(),
    )
    contacts = _Contacts("+48500500500")

    target = await desired_target(
        datetime(2026, 9, 15, 9, 0, tzinfo=ZoneInfo("Europe/Warsaw")),
        9,
        _Roster(duty),
        contacts,
    )

    assert target == ForwardingTarget(day, member_id, "Anna Kowalska", "+48500500500")
    assert target.missing is None
    assert target.alert_token == f"{day.isoformat()}:+48500500500"
    assert wco_number(target) == "+48500500500"
    assert contacts.asked == [member_id]


async def test_a_missing_or_imported_primary_has_no_target_number() -> None:
    now = datetime(2026, 9, 15, 12, 0, tzinfo=ZoneInfo("Europe/Warsaw"))
    no_primary = await desired_target(now, 9, _Roster(None), _Contacts("unused"))
    imported = Duty(
        now.date(),
        AssignmentRole.primary,
        None,
        "Osoba z importu",
        False,
        uuid.uuid4(),
    )
    no_account = await desired_target(now, 9, _Roster(imported), _Contacts("unused"))

    assert no_primary.missing is ForwardingFailure.no_primary
    assert no_primary.alert_token.endswith(":none")
    assert no_account.missing is ForwardingFailure.no_phone
    assert "Osoba z importu" not in no_account.alert_token
    with pytest.raises(ValueError, match="no number"):
        wco_number(no_account)
