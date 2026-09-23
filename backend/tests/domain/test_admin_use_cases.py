"""Administration use cases against in-memory ports: no database, no HTTP."""

import uuid
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta

import pytest

from oncall.domain.admin import errors, use_cases
from oncall.domain.admin.models import (
    AccountAction,
    AccountChange,
    AuditEntry,
    AuditQuery,
    EligibilityChange,
    EligibilityGrant,
    EligibilityRevocation,
    Enrolment,
    MembershipChange,
    NewAccount,
    PendingActivation,
)
from oncall.domain.team import Actor
from oncall.domain.vocabulary import AccountTokenKind, AssignmentRole, AuthSource, UserRole
from tests.domain.admin_fakes import AdminWorld, FakeAuditTrail, account, slot

START = date(2030, 1, 1)


@pytest.fixture
def world() -> AdminWorld:
    world = AdminWorld()
    world.admin = world.accounts.put(account("ada admin", role=UserRole.admin))
    return world


def as_actor(item) -> Actor:
    return Actor(item.id, item.display_name, item.role)


def new_account(world, **changes) -> NewAccount:
    values = {
        "actor": as_actor(world.admin),
        "username": "nowa",
        "personnel_number": None,
        "first_name": "Nowa",
        "last_name": " Osoba ",
        "email": None,
        "phone": None,
        "role": UserRole.member,
    }
    return NewAccount(**(values | changes))


def change(world, target, **changes) -> AccountChange:
    return AccountChange(as_actor(world.admin), target.id, changes)


async def test_a_new_account_is_trimmed_audited_and_gets_an_activation_link(world) -> None:
    created = await use_cases.create_account(new_account(world), world.account_administration)

    assert (created.account.first_name, created.account.last_name) == ("Nowa", "Osoba")
    assert created.activation.kind == AccountTokenKind.activation
    assert created.activation.expires_at - datetime.now(UTC) > timedelta(hours=23)
    assert world.journal.names == ["account_created"]
    listed = await use_cases.list_accounts(world.accounts)
    assert [item.pending_activation for item in listed if item.id == created.account.id] == [
        PendingActivation(created.activation.expires_at)
    ]


@pytest.mark.parametrize(
    ("changes", "error"),
    [
        ({"first_name": "  "}, errors.FirstNameRequired),
        ({"username": "ADA.ADMIN"}, errors.UsernameTaken),
        ({"email": "ADA@example.com"}, errors.EmailTaken),
        ({"personnel_number": "42"}, errors.PersonnelNumberTaken),
    ],
)
async def test_a_new_account_must_not_clash(world, changes, error) -> None:
    world.accounts.put(account("zajety", email="ada@example.com", personnel_number="42"))
    with pytest.raises(error):
        await use_cases.create_account(new_account(world, **changes), world.account_administration)
    assert world.journal.events == [] and world.accounts.tokens == []


async def test_the_first_rule_broken_is_the_one_reported(world) -> None:
    with pytest.raises(errors.UsernameTaken):
        await use_cases.create_account(
            new_account(world, username="ada.admin", email=None), world.account_administration
        )


async def test_a_directory_account_keeps_its_identity_but_not_its_role(world) -> None:
    ldap = world.accounts.put(account("lu dap", auth_source=AuthSource.ldap))
    with pytest.raises(errors.DirectoryIdentityReadOnly) as refused:
        await use_cases.update_account(
            change(world, ldap, email="x@example.com"), world.account_administration
        )
    assert refused.value.fields == {"email"}

    updated = await use_cases.update_account(
        change(world, ldap, role=UserRole.coordinator), world.account_administration
    )
    assert updated.role == UserRole.coordinator


async def test_an_admin_changes_neither_their_own_role_nor_status(world) -> None:
    for changes in ({"role": UserRole.member}, {"is_active": False}):
        with pytest.raises(errors.OwnRoleOrStatusChange):
            await use_cases.update_account(
                change(world, world.admin, **changes), world.account_administration
            )
    unchanged = await use_cases.update_account(
        change(world, world.admin, role=UserRole.admin, is_active=True),
        world.account_administration,
    )
    assert unchanged.is_active_admin


async def test_the_last_active_admin_is_neither_demoted_nor_deleted(world) -> None:
    """Unreachable over HTTP one request at a time (the acting admin counts),
    and exactly what two admins removing each other at once run into."""
    other = world.accounts.put(account("bo admin", role=UserRole.admin))
    world.accounts.put(replace(world.admin, is_active=False))

    with pytest.raises(errors.LastActiveAdminDemotion):
        await use_cases.update_account(
            change(world, other, role=UserRole.member), world.account_administration
        )
    with pytest.raises(errors.LastActiveAdminDeletion):
        await use_cases.delete_account(
            AccountAction(as_actor(world.admin), other.id), world.account_administration
        )


async def test_the_admin_count_is_consulted_only_when_an_active_admin_would_go(world) -> None:
    person = world.accounts.put(account("ola nowak"))
    await use_cases.update_account(
        change(world, person, role=UserRole.coordinator), world.account_administration
    )
    await use_cases.update_account(
        change(world, person, is_active=False), world.account_administration
    )
    assert world.accounts.admin_counts == 0


async def test_updating_checks_names_and_unique_identity(world) -> None:
    person = world.accounts.put(account("ola nowak"))
    world.accounts.put(account("inny", email="inny@example.com", personnel_number="7"))

    for changes, error in (
        ({"first_name": None}, errors.FirstNameCleared),
        ({"first_name": ""}, errors.FirstNameCleared),
        ({"last_name": None}, errors.LastNameCleared),
        ({"personnel_number": "7"}, errors.PersonnelNumberTaken),
        ({"email": "INNY@example.com"}, errors.EmailTaken),
    ):
        with pytest.raises(error):
            await use_cases.update_account(
                change(world, person, **changes), world.account_administration
            )
    assert world.journal.events == []


async def test_renaming_a_rotation_member_carries_the_name_and_audits_before(world) -> None:
    person = world.accounts.put(account("ola nowak"))
    member = world.rotation.enrolled(person, START)
    person = world.accounts.put(replace(person, member_id=member.id))

    updated = await use_cases.update_account(
        change(world, person, first_name=" Aleksandra ", phone="+48 600 000 000"),
        world.account_administration,
    )

    assert updated.display_name == "Aleksandra Nowak"
    assert world.rotation.renamed == [(member.id, "Aleksandra Nowak")]
    name, call = world.journal.events[0]
    assert (name, call["fields"], call["before"]) == (
        "account_updated",
        ["first_name", "phone"],
        {"first_name": "Ola", "phone": None},
    )


async def test_a_phone_change_renames_nobody(world) -> None:
    person = world.accounts.put(account("ola nowak"))
    world.rotation.enrolled(person, START)
    await use_cases.update_account(
        change(world, person, phone="+48 600"), world.account_administration
    )
    assert world.rotation.renamed == []


async def test_password_resets_are_for_local_accounts(world) -> None:
    ldap = world.accounts.put(account("lu dap", auth_source=AuthSource.ldap))
    with pytest.raises(errors.DirectoryPasswordReadOnly):
        await use_cases.issue_password_reset(
            AccountAction(as_actor(world.admin), ldap.id), world.account_administration
        )
    with pytest.raises(errors.AccountNotFound):
        await use_cases.issue_password_reset(
            AccountAction(as_actor(world.admin), uuid.uuid4()), world.account_administration
        )

    token = await use_cases.issue_password_reset(
        AccountAction(as_actor(world.admin), world.admin.id), world.account_administration
    )
    assert token.kind == AccountTokenKind.password_reset
    assert token.expires_at - datetime.now(UTC) <= timedelta(hours=1)


def reissue(world, target):
    return use_cases.reissue_activation(
        AccountAction(as_actor(world.admin), target), world.account_administration
    )


@pytest.mark.parametrize(
    "link_expires_at",
    [datetime.now(UTC) + timedelta(hours=3), datetime.now(UTC) - timedelta(hours=3), None],
    ids=["valid", "expired", "none-left"],
)
async def test_a_pending_account_gets_a_fresh_activation_link(world, link_expires_at) -> None:
    person = world.accounts.put(
        account("nowa osoba", pending_activation=PendingActivation(link_expires_at))
    )

    token = await reissue(world, person.id)

    assert token.kind == AccountTokenKind.activation
    assert token.expires_at - datetime.now(UTC) > timedelta(hours=23)
    assert world.journal.names == ["activation_link_issued"]
    stored = await world.accounts.account(person.id)
    assert stored.pending_activation == PendingActivation(token.expires_at)


@pytest.mark.parametrize(
    ("target", "error"),
    [
        (lambda: account("aktywna osoba"), errors.AccountAlreadyActivated),
        (
            lambda: account(
                "lu dap",
                auth_source=AuthSource.ldap,
                pending_activation=PendingActivation(None),
            ),
            errors.DirectoryPasswordReadOnly,
        ),
        (
            lambda: account(
                "wylaczona osoba", is_active=False, pending_activation=PendingActivation(None)
            ),
            errors.DisabledAccountActivation,
        ),
    ],
    ids=["activated", "directory", "disabled"],
)
async def test_an_activation_link_is_only_for_an_enabled_pending_local_account(
    world, target, error
) -> None:
    person = world.accounts.put(target())
    with pytest.raises(error):
        await reissue(world, person.id)
    with pytest.raises(errors.AccountNotFound):
        await reissue(world, uuid.uuid4())
    assert world.accounts.tokens == [] and world.journal.events == []


async def test_deleting_an_account(world) -> None:
    person = world.accounts.put(account("ola nowak"))
    linked = world.accounts.put(account("pio wiazany"))
    world.accounts.referenced.add(linked.id)

    with pytest.raises(errors.OwnAccountDeletion):
        await use_cases.delete_account(
            AccountAction(as_actor(world.admin), world.admin.id), world.account_administration
        )
    with pytest.raises(errors.AccountStillReferenced):
        await use_cases.delete_account(
            AccountAction(as_actor(world.admin), linked.id), world.account_administration
        )
    await use_cases.delete_account(
        AccountAction(as_actor(world.admin), person.id), world.account_administration
    )

    assert person.id not in world.accounts.by_id
    # The audit entry is written first, so it is part of the same failed or
    # committed unit of work as the deletion itself.
    assert world.journal.names == ["account_deleted", "account_deleted"]


async def test_enrolling_an_account_once(world) -> None:
    person = world.accounts.put(account("ola nowak"))
    enrolment = Enrolment(as_actor(world.admin), person.id, START)

    member = await use_cases.enrol_in_rotation(enrolment, world.membership_administration)
    assert (member.user_id, member.display_name, member.active_from) == (
        person.id,
        "Ola Nowak",
        START,
    )
    with pytest.raises(errors.AccountAlreadyInRotation):
        await use_cases.enrol_in_rotation(enrolment, world.membership_administration)
    with pytest.raises(errors.AccountNotFound):
        await use_cases.enrol_in_rotation(
            Enrolment(as_actor(world.admin), uuid.uuid4(), START), world.membership_administration
        )


def membership(world, member, **changes) -> MembershipChange:
    return MembershipChange(as_actor(world.admin), member.id, changes)


async def test_membership_dates_must_hold_the_periods_and_the_duties(world) -> None:
    member = world.rotation.enrolled(None, START)
    world.rotation.granted(member, AssignmentRole.primary, START + timedelta(days=5))
    world.rotation.duties[member.id] = [
        slot(START + timedelta(days=30 + offset)) for offset in range(25)
    ]

    with pytest.raises(errors.MembershipEndsBeforeStart):
        await use_cases.change_membership(
            membership(world, member, active_until=START - timedelta(days=1)),
            world.membership_administration,
        )
    with pytest.raises(errors.EligibilityOutlivesMembership):
        await use_cases.change_membership(
            membership(world, member, active_from=START + timedelta(days=6)),
            world.membership_administration,
        )
    with pytest.raises(errors.EligibilityOutlivesMembership):
        await use_cases.change_membership(
            membership(world, member, active_until=START + timedelta(days=90)),
            world.membership_administration,
        )

    world.rotation.periods_by_id.clear()
    with pytest.raises(errors.DutiesAfterExit) as refused:
        await use_cases.change_membership(
            membership(world, member, active_until=START + timedelta(days=29)),
            world.membership_administration,
        )
    assert len(refused.value.slots) == 20
    assert str(refused.value).startswith(
        "Osoba ma dyżury po dacie wyjścia z rotacji. Najpierw przepisz lub zwolnij sloty: "
        f"{START + timedelta(days=30)} (primary), "
    )

    updated = await use_cases.change_membership(
        membership(world, member, active_until=None, active_from=START + timedelta(days=1)),
        world.membership_administration,
    )
    assert updated.active_from == START + timedelta(days=1)
    assert world.rotation.held == [member.id] * 5
    assert world.journal.events[-1][1]["fields"] == ["active_from", "active_until"]


def grant(world, member, starts: int, ends: int | None = None, role=AssignmentRole.primary):
    return EligibilityGrant(
        as_actor(world.admin),
        member.id,
        role,
        START + timedelta(days=starts),
        START + timedelta(days=ends) if ends is not None else None,
    )


async def test_granting_eligibility(world) -> None:
    member = world.rotation.enrolled(None, START, START + timedelta(days=60))

    with pytest.raises(errors.RotationMemberNotFound):
        await use_cases.grant_eligibility(
            EligibilityGrant(
                as_actor(world.admin), uuid.uuid4(), AssignmentRole.primary, START, None
            ),
            world.eligibility_administration,
        )
    for starts, ends in ((-1, 10), (0, None), (0, 61)):
        with pytest.raises(errors.EligibilityOutsideMembership):
            await use_cases.grant_eligibility(
                grant(world, member, starts, ends), world.eligibility_administration
            )

    period = await use_cases.grant_eligibility(
        grant(world, member, 0, 20), world.eligibility_administration
    )
    with pytest.raises(errors.EligibilityOverlaps):
        await use_cases.grant_eligibility(
            grant(world, member, 20, 30), world.eligibility_administration
        )
    await use_cases.grant_eligibility(
        grant(world, member, 20, 30, role=AssignmentRole.secondary),
        world.eligibility_administration,
    )
    assert world.journal.events[0] == ("eligibility_granted", {"args": (member, period)})


async def test_changing_and_revoking_eligibility_keeps_published_duties_covered(world) -> None:
    member = world.rotation.enrolled(None, START, START + timedelta(days=60))
    first = world.rotation.granted(
        member, AssignmentRole.primary, START, START + timedelta(days=20)
    )
    world.rotation.granted(
        member, AssignmentRole.primary, START + timedelta(days=21), START + timedelta(days=40)
    )
    world.rotation.duties[member.id] = [
        slot(START + timedelta(days=10)),
        slot(START + timedelta(days=30)),
        slot(START + timedelta(days=10), AssignmentRole.secondary),
    ]

    def edit(**changes):
        return use_cases.change_eligibility(
            EligibilityChange(as_actor(world.admin), first.id, changes),
            world.eligibility_administration,
        )

    with pytest.raises(errors.EligibilityEndsBeforeStart):
        await edit(ends_on=START - timedelta(days=1))
    with pytest.raises(errors.EligibilityOutsideMembership):
        await edit(ends_on=None)
    with pytest.raises(errors.EligibilityOverlaps):
        await edit(ends_on=START + timedelta(days=25))
    with pytest.raises(errors.DutiesLoseEligibility) as refused:
        await edit(ends_on=START + timedelta(days=5))
    # The duty on day 30 sits in the other period, and the secondary one is
    # another role: only day 10 is left uncovered.
    assert refused.value.slots == [slot(START + timedelta(days=10))]
    with pytest.raises(errors.DutiesLoseEligibility):
        await use_cases.revoke_eligibility(
            EligibilityRevocation(as_actor(world.admin), first.id), world.eligibility_administration
        )
    with pytest.raises(errors.EligibilityNotFound):
        await use_cases.revoke_eligibility(
            EligibilityRevocation(as_actor(world.admin), uuid.uuid4()),
            world.eligibility_administration,
        )

    moved = await edit(starts_on=START + timedelta(days=1))
    assert moved.starts_on == START + timedelta(days=1)
    world.rotation.duties.clear()
    await use_cases.revoke_eligibility(
        EligibilityRevocation(as_actor(world.admin), first.id), world.eligibility_administration
    )
    assert first.id not in world.rotation.periods_by_id
    assert world.journal.names == ["eligibility_changed", "eligibility_revoked"]


async def test_the_audit_trail_leaves_logins_out_unless_asked(world) -> None:
    def entry(action: str) -> AuditEntry:
        return AuditEntry(uuid.uuid4(), datetime.now(UTC), "Ada", action, None, None, "s", None)

    trail = FakeAuditTrail(entry("auth.login"), entry("admin.user_created"))

    default = await use_cases.browse_audit(AuditQuery(), trail)
    logins = await use_cases.browse_audit(AuditQuery(action="auth.login"), trail)
    everything = await use_cases.browse_audit(AuditQuery(include_logins=True), trail)

    assert (default.logins_excluded, [item.action for item in default.entries]) == (
        True,
        ["admin.user_created"],
    )
    assert (logins.logins_excluded, len(logins.entries)) == (False, 1)
    assert (everything.logins_excluded, len(everything.entries)) == (False, 2)
