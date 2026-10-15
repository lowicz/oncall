"""The WCO password rules: what a generated password holds and which step of
the rotation follows a login."""

from dataclasses import replace

import pytest

from oncall.domain.forwarding.passwords import (
    PASSWORD_CLASS_MINIMUM,
    PASSWORD_CLASSES,
    PASSWORD_LENGTH,
    AfterLogin,
    Passwords,
    generate_password,
)


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
