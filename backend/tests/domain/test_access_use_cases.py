"""Signing in and account links against in-memory ports: no database, no HTTP."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from oncall.domain.access import errors, use_cases
from oncall.domain.access.models import DirectoryIdentity, PasswordChoice, SignInRequest
from oncall.domain.admin.errors import DirectoryPasswordReadOnly
from oncall.domain.errors import RecordedRefusal
from oncall.domain.vocabulary import AccountTokenKind, AuthSource, UserRole
from tests.domain.access_fakes import AccessWorld, FakeDirectory, account

NOW = datetime(2030, 3, 1, 12, tzinfo=UTC)
LIFETIME = timedelta(hours=8)


def request(username: str = "ola", password: str = "secret", ip: str = "10.0.0.1"):
    return SignInRequest(username, password, ip)


async def sign_in(world: AccessWorld, **kwargs):
    return await use_cases.sign_in(
        request(**kwargs), world.sign_in, now=NOW, session_lifetime=LIFETIME
    )


def identity(**changes) -> DirectoryIdentity:
    values = {
        "username": "Ola",
        "personnel_number": "42",
        "first_name": "Ola",
        "last_name": "Nowak",
        "email": "ola@example.com",
    }
    return DirectoryIdentity(**(values | changes))


@pytest.fixture
def world() -> AccessWorld:
    world = AccessWorld()
    world.links.clock = NOW
    return world


async def test_a_local_account_signs_in_with_a_normalized_login(world) -> None:
    ola = world.accounts.put(account("ola"))
    world.accounts.members.add(ola.id)

    signed_in = await sign_in(world, username="  OLA ")

    assert signed_in.account == ola
    assert signed_in.has_team_member is True
    assert world.sessions.opened == [("account", ola.id, NOW + LIFETIME)]
    assert world.journal.names == ["signed_in"]
    assert (world.passwords.verifications, world.directory.calls) == (1, 0)


@pytest.mark.parametrize(
    "setup",
    ["unknown", "wrong_password", "inactive_local", "inactive_directory", "directory_refuses"],
)
async def test_every_refusal_is_one_public_answer_at_the_cost_of_one_hash(world, setup) -> None:
    """A refusal must not disclose whether the account exists: the same error
    and one password verification, real or decoy, whatever the reason -
    except for inactive accounts, which have always been refused before any
    verification."""
    if setup == "wrong_password":
        world.accounts.put(account("ola"))
    elif setup == "inactive_local":
        world.accounts.put(account("ola", is_active=False))
    elif setup == "inactive_directory":
        world.accounts.put(account("ola", is_active=False, auth_source=AuthSource.ldap))
    elif setup == "directory_refuses":
        world.accounts.put(account("ola", auth_source=AuthSource.ldap))

    with pytest.raises(errors.LoginRejected) as refused:
        await sign_in(world, password="wrong")

    assert isinstance(refused.value, RecordedRefusal)
    assert world.attempts.events == [("failed", "ola")]
    expected_cost = 0 if setup.startswith("inactive") else 1
    assert world.passwords.cost == expected_cost
    assert world.sessions.opened == []


async def test_a_local_account_falls_back_to_the_directory_and_links_to_it(world) -> None:
    ola = world.accounts.put(account("ola", personnel_number="42"))
    world.directory = FakeDirectory(identity())

    signed_in = await sign_in(world, password="directory-password")

    assert signed_in.account.id == ola.id
    assert signed_in.account.auth_source == AuthSource.ldap
    assert world.accounts.hashes[ola.id] is None
    assert world.passwords.cost == 1
    assert world.journal.names == ["linked", "signed_in"]


async def test_the_first_directory_sign_in_provisions_a_viewer(world) -> None:
    world.directory = FakeDirectory(identity())

    signed_in = await sign_in(world)

    assert (signed_in.account.username, signed_in.account.role) == ("ola", UserRole.viewer)
    assert world.journal.names == ["provisioned", "signed_in"]


async def test_a_directory_account_follows_the_directory(world) -> None:
    world.accounts.put(
        account("ola", personnel_number="42", auth_source=AuthSource.ldap, first_name="Stara")
    )
    world.directory = FakeDirectory(identity())

    signed_in = await sign_in(world)

    assert signed_in.account.display_name == "Ola Nowak"
    name, call = world.journal.events[0]
    assert (name, call["fields"]) == ("synced", ["first_name", "last_name", "email"])


async def test_nothing_to_sync_writes_nothing(world) -> None:
    world.accounts.put(
        account(
            "ola",
            personnel_number="42",
            auth_source=AuthSource.ldap,
            last_name="Nowak",
            email="ola@example.com",
        )
    )
    world.directory = FakeDirectory(identity())
    await sign_in(world)
    assert world.journal.names == ["signed_in"]


@pytest.mark.parametrize("taken_by", ["login", "login_of_other_account"])
async def test_a_directory_identity_never_takes_over_another_account(world, taken_by) -> None:
    world.accounts.put(account("ola", personnel_number="7"))
    if taken_by == "login_of_other_account":
        world.accounts.put(account("ktos", personnel_number="42"))
    world.directory = FakeDirectory(identity())

    with pytest.raises(errors.DirectoryIdentityConflict) as refused:
        await sign_in(world, password="not-local")

    assert isinstance(refused.value, RecordedRefusal)
    assert world.attempts.events == [("identity_conflict", "ola")]
    assert world.sessions.opened == []


async def test_a_directory_outage_is_recorded_and_reported(world) -> None:
    world.directory = FakeDirectory(failure="timeout")

    with pytest.raises(errors.DirectoryLoginUnavailable) as refused:
        await sign_in(world)

    assert refused.value.reason == "timeout"
    assert world.attempts.events == [("directory_unavailable", "ola", "timeout")]
    assert world.passwords.cost == 0


async def test_an_account_deactivated_in_the_meantime_is_refused_after_the_sync(world) -> None:
    world.accounts.put(
        account("ola", personnel_number="42", auth_source=AuthSource.ldap, is_active=True)
    )
    world.directory = FakeDirectory(identity(first_name="Aleksandra"))
    original = world.accounts.update_from_directory

    async def deactivating(account_id, changes):
        synced = await original(account_id, changes)
        world.accounts.by_id[account_id] = synced.__class__(
            **{**synced.__dict__, "is_active": False}
        )
        return world.accounts.by_id[account_id]

    world.accounts.update_from_directory = deactivating
    with pytest.raises(errors.LoginRejected):
        await sign_in(world)
    # The sync is part of what the refusal keeps.
    assert world.journal.names == ["synced"]


@pytest.mark.parametrize(
    ("failures", "ip_failures", "label", "retry_after"),
    [(5, 0, "ola", 60), (0, 20, "ip:10.0.0.1", 60)],
)
async def test_the_throttle_counts_logins_and_addresses_separately(
    world, failures, ip_failures, label, retry_after
) -> None:
    world.accounts.put(account("ola"))
    world.attempts.failures = {"ola": failures, "ip:10.0.0.1": ip_failures}

    with pytest.raises(errors.LoginThrottled) as refused:
        await sign_in(world)

    assert (refused.value.label, refused.value.retry_after) == (label, retry_after)
    assert world.passwords.cost == 0


async def test_below_both_limits_nobody_is_throttled(world) -> None:
    world.accounts.put(account("ola"))
    world.attempts.failures = {"ola": 4, "ip:10.0.0.1": 19}
    assert (await sign_in(world)).account.username == "ola"


async def test_retry_after_doubles_up_to_five_minutes(world) -> None:
    world.attempts.failures = {"ola": 5}
    waits = []
    for _ in range(5):
        with pytest.raises(errors.LoginThrottled) as refused:
            await sign_in(world)
        waits.append(refused.value.retry_after)
    assert waits == [60, 120, 240, 300, 300]


def choice(token: str, kind=AccountTokenKind.activation, password: str = "Nowe-Haslo-123"):
    return PasswordChoice(token=token, kind=kind, password=password)


async def test_activating_an_account_once(world) -> None:
    fresh = world.accounts.put(account("nowa"), None)
    world.links.put("t" * 30, AccountTokenKind.activation, fresh)

    activated = await use_cases.choose_password(choice("t" * 30), world.password_choice, now=NOW)

    assert activated == fresh
    assert world.accounts.hashes[fresh.id] == "hash:Nowe-Haslo-123"
    assert world.links.held == ["t" * 30]
    assert world.sessions.ended == []
    assert world.journal.events == [
        ("password_set", {"args": (fresh, AccountTokenKind.activation)})
    ]
    with pytest.raises(errors.AccountLinkInvalid):
        await use_cases.choose_password(choice("t" * 30), world.password_choice, now=NOW)


async def test_a_password_reset_signs_the_account_out_everywhere(world) -> None:
    ola = world.accounts.put(account("ola"))
    world.links.put("r" * 30, AccountTokenKind.password_reset, ola)

    await use_cases.choose_password(
        choice("r" * 30, AccountTokenKind.password_reset), world.password_choice, now=NOW
    )

    assert world.sessions.ended == [ola.id]


@pytest.mark.parametrize(
    ("arrange", "error"),
    [
        (
            lambda w, o: w.links.put("x" * 30, AccountTokenKind.password_reset, o),
            errors.AccountLinkInvalid,
        ),
        (
            lambda w, o: w.links.put(
                "x" * 30, AccountTokenKind.activation, o, expires_in=timedelta(0)
            ),
            errors.AccountLinkInvalid,
        ),
        (
            lambda w, o: w.links.put("x" * 30, AccountTokenKind.activation, o, used_at=NOW),
            errors.AccountLinkInvalid,
        ),
    ],
)
async def test_a_link_of_another_kind_expired_or_used_is_invalid(world, arrange, error) -> None:
    fresh = world.accounts.put(account("nowa"), None)
    arrange(world, fresh)
    with pytest.raises(error):
        await use_cases.choose_password(choice("x" * 30), world.password_choice, now=NOW)
    with pytest.raises(error):
        await use_cases.describe_account_link(
            "x" * 30, AccountTokenKind.activation, world.links, now=NOW
        )


async def test_password_rules_of_account_links(world) -> None:
    directory = world.accounts.put(account("katalog", auth_source=AuthSource.ldap), None)
    active = world.accounts.put(account("aktywna"))
    fresh = world.accounts.put(account("haslo-login-1"), None)
    world.links.put("d" * 30, AccountTokenKind.password_reset, directory)
    world.links.put("a" * 30, AccountTokenKind.activation, active)
    world.links.put("f" * 30, AccountTokenKind.activation, fresh)

    with pytest.raises(DirectoryPasswordReadOnly):
        await use_cases.choose_password(
            choice("d" * 30, AccountTokenKind.password_reset), world.password_choice, now=NOW
        )
    with pytest.raises(errors.AccountAlreadyActivated):
        await use_cases.choose_password(choice("a" * 30), world.password_choice, now=NOW)
    with pytest.raises(errors.PasswordSameAsLogin):
        await use_cases.choose_password(
            choice("f" * 30, password="HASLO-LOGIN-1"), world.password_choice, now=NOW
        )
    assert world.journal.events == []


async def test_only_an_account_edits_its_own_phone(world) -> None:
    ola = world.accounts.put(account("ola"))
    with pytest.raises(errors.ShareSessionHasNoAccount):
        await use_cases.change_own_phone(None, "+48 600", world.accounts)
    overview = await use_cases.change_own_phone(ola.id, "+48 600", world.accounts)
    assert (overview.account.phone, overview.has_team_member) == ("+48 600", False)


async def test_a_deleted_account_refuses_the_phone_edit(world) -> None:
    """An administrator can delete an account while its owner still holds a
    session, so the id in that session can name a row that is gone."""
    with pytest.raises(errors.AccountGone):
        await use_cases.change_own_phone(uuid.uuid4(), "+48 600", world.accounts)
