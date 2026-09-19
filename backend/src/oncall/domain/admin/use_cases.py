"""Administration: accounts, rotation membership and eligibility periods.

Every rule an administrator can run into lives here, in the order the checks
have always run, so the first failing rule is the one reported. Nothing here
commits: the caller owns the unit of work.
"""

import uuid
from datetime import date

from oncall.domain.admin import errors
from oncall.domain.admin.models import (
    ACTIVATION_LINK_LIFETIME,
    IDENTITY_FIELDS,
    LISTED_SLOTS,
    LOGIN_ACTION,
    RESET_LINK_LIFETIME,
    Account,
    AccountAction,
    AccountChange,
    AccountCreated,
    AccountRecord,
    AuditFilter,
    AuditPage,
    AuditQuery,
    EligibilityChange,
    EligibilityGrant,
    EligibilityPeriod,
    EligibilityRevocation,
    Enrolment,
    IssuedToken,
    MembershipChange,
    NewAccount,
    NewEligibilityPeriod,
    RotationMember,
)
from oncall.domain.admin.ports import (
    AccountBook,
    AdminPorts,
    AuditTrail,
    RotationBook,
    RotationDirectory,
)
from oncall.domain.vocabulary import AccountTokenKind, AssignmentRole, AuthSource, UserRole


async def list_accounts(accounts: AccountBook) -> list[Account]:
    return await accounts.accounts()


async def list_rotation(rotation: RotationDirectory) -> list[RotationMember]:
    """Everyone in the rotation, by name."""
    return await rotation.members()


async def create_account(new: NewAccount, ports: AdminPorts) -> AccountCreated:
    first_name = new.first_name.strip()
    if not first_name:
        raise errors.FirstNameRequired()
    if await ports.accounts.username_taken(new.username):
        raise errors.UsernameTaken(new.username)
    if new.email and await ports.accounts.email_taken(new.email):
        raise errors.EmailTaken(new.email)
    if new.personnel_number and await ports.accounts.personnel_number_taken(new.personnel_number):
        raise errors.PersonnelNumberTaken(new.personnel_number)
    account = await ports.accounts.open_account(
        AccountRecord(
            username=new.username,
            personnel_number=new.personnel_number,
            first_name=first_name,
            last_name=new.last_name.strip(),
            email=new.email or None,
            phone=new.phone,
            role=new.role,
        )
    )
    activation = await ports.accounts.issue_token(
        account.id, AccountTokenKind.activation, ACTIVATION_LINK_LIFETIME
    )
    await ports.journal.account_created(account)
    return AccountCreated(account=account, activation=activation)


async def update_account(change: AccountChange, ports: AdminPorts) -> Account:
    account = await _account(ports.accounts, change.account_id)
    changes = dict(change.changes)
    touched_identity = IDENTITY_FIELDS & changes.keys()
    if account.auth_source == AuthSource.ldap and touched_identity:
        raise errors.DirectoryIdentityReadOnly(set(touched_identity))
    if account.id == change.actor.user_id and (
        ("role" in changes and changes["role"] != account.role)
        or ("is_active" in changes and changes["is_active"] != account.is_active)
    ):
        raise errors.OwnRoleOrStatusChange()
    removes_active_admin = account.is_active_admin and (
        ("role" in changes and changes["role"] != UserRole.admin)
        or changes.get("is_active") is False
    )
    if removes_active_admin and await ports.accounts.active_admin_count() == 1:
        raise errors.LastActiveAdminDemotion(account.id)
    if "first_name" in changes and not changes["first_name"]:
        raise errors.FirstNameCleared()
    if "last_name" in changes and changes["last_name"] is None:
        raise errors.LastNameCleared()
    number = changes.get("personnel_number")
    if number is not None and await ports.accounts.personnel_number_taken(
        number, other_than=account.id
    ):
        raise errors.PersonnelNumberTaken(number)
    email = changes.get("email")
    if email is not None and await ports.accounts.email_taken(email, other_than=account.id):
        raise errors.EmailTaken(email)

    before = {key: getattr(account, key) for key in changes}
    stored = {
        key: value.strip() if key in {"first_name", "last_name"} and value is not None else value
        for key, value in changes.items()
    }
    updated = await ports.accounts.change_account(account.id, stored)
    if account.member_id is not None and touched_identity:
        # Identity and every rule use the member id; the name is carried over
        # only so labels and exports stay readable.
        await ports.rotation.rename_member(account.member_id, updated.display_name)
    await ports.journal.account_updated(
        updated,
        fields=sorted(changes),
        before={key: str(value) if value is not None else None for key, value in before.items()},
    )
    return updated


async def issue_password_reset(action: AccountAction, ports: AdminPorts) -> IssuedToken:
    account = await _account(ports.accounts, action.account_id)
    if account.auth_source != AuthSource.local:
        raise errors.DirectoryPasswordReadOnly(account.id)
    token = await ports.accounts.issue_token(
        account.id, AccountTokenKind.password_reset, RESET_LINK_LIFETIME
    )
    await ports.journal.reset_link_issued(account)
    return token


async def delete_account(action: AccountAction, ports: AdminPorts) -> None:
    account = await _account(ports.accounts, action.account_id)
    if account.id == action.actor.user_id:
        raise errors.OwnAccountDeletion()
    if account.is_active_admin and await ports.accounts.active_admin_count() == 1:
        raise errors.LastActiveAdminDeletion(account.id)
    await ports.journal.account_deleted(account)
    await ports.accounts.close_account(account.id)


async def enrol_in_rotation(enrolment: Enrolment, ports: AdminPorts) -> RotationMember:
    account = await _account(ports.accounts, enrolment.account_id)
    if await ports.rotation.account_is_enrolled(account.id):
        raise errors.AccountAlreadyInRotation(account.id)
    member = await ports.rotation.enrol(account, enrolment.active_from)
    await ports.journal.member_enrolled(member)
    return member


async def change_membership(change: MembershipChange, ports: AdminPorts) -> RotationMember:
    member = await _member_for_change(ports.rotation, change.member_id)
    changes = dict(change.changes)
    active_from = changes.get("active_from", member.active_from)
    active_until = changes.get("active_until", member.active_until)
    if active_until is not None and active_until < active_from:
        raise errors.MembershipEndsBeforeStart()
    if any(
        period.starts_on < active_from
        or (active_until is not None and (period.ends_on is None or period.ends_on > active_until))
        for period in member.eligibility
    ):
        raise errors.EligibilityOutlivesMembership()
    if active_until is not None:
        duties = await ports.rotation.published_duties(
            member.id, after=active_until, limit=LISTED_SLOTS
        )
        if duties:
            raise errors.DutiesAfterExit(duties)
    updated = await ports.rotation.change_membership(member.id, changes)
    await ports.journal.membership_changed(updated, fields=sorted(changes))
    return updated


async def grant_eligibility(grant: EligibilityGrant, ports: AdminPorts) -> EligibilityPeriod:
    member = await _member_for_change(ports.rotation, grant.member_id)
    if not member.contains(grant.starts_on, grant.ends_on):
        raise errors.EligibilityOutsideMembership()
    if await ports.rotation.overlapping_period_exists(
        member.id, grant.role, grant.starts_on, grant.ends_on
    ):
        raise errors.EligibilityOverlaps()
    period = await ports.rotation.grant(
        NewEligibilityPeriod(member.id, grant.role, grant.starts_on, grant.ends_on)
    )
    await ports.journal.eligibility_granted(member, period)
    return period


async def change_eligibility(change: EligibilityChange, ports: AdminPorts) -> EligibilityPeriod:
    member, period = await _period_for_change(ports.rotation, change.eligibility_id)
    changes = dict(change.changes)
    starts_on = changes.get("starts_on", period.starts_on)
    ends_on = changes.get("ends_on", period.ends_on)
    if ends_on is not None and ends_on < starts_on:
        raise errors.EligibilityEndsBeforeStart()
    if not member.contains(starts_on, ends_on):
        raise errors.EligibilityOutsideMembership()
    if await ports.rotation.overlapping_period_exists(
        member.id, period.role, starts_on, ends_on, other_than=period.id
    ):
        raise errors.EligibilityOverlaps()
    await _ensure_duties_stay_eligible(
        ports.rotation, member.id, period.role, starts_on, ends_on, other_than=period.id
    )
    updated = await ports.rotation.change_period(period.id, changes)
    await ports.journal.eligibility_changed(member, updated, fields=sorted(changes))
    return updated


async def revoke_eligibility(revocation: EligibilityRevocation, ports: AdminPorts) -> None:
    member, period = await _period_for_change(ports.rotation, revocation.eligibility_id)
    # No span is left, so every published duty in the role must be covered by
    # another period.
    await _ensure_duties_stay_eligible(
        ports.rotation, member.id, period.role, date.max, date.min, other_than=period.id
    )
    await ports.journal.eligibility_revoked(member, period)
    await ports.rotation.revoke(period.id)


async def browse_audit(query: AuditQuery, trail: AuditTrail) -> AuditPage:
    logins_excluded = not query.include_logins and query.action != LOGIN_ACTION
    entries = await trail.entries(
        AuditFilter(
            action=query.action,
            entity_type=query.entity_type,
            actor=query.actor,
            text=query.text,
            starts_on=query.starts_on,
            ends_on=query.ends_on,
            excluded_action=LOGIN_ACTION if logins_excluded else None,
            limit=query.limit,
            offset=query.offset,
        )
    )
    return AuditPage(entries=entries, logins_excluded=logins_excluded)


async def _account(accounts: AccountBook, account_id: uuid.UUID) -> Account:
    account = await accounts.account(account_id)
    if account is None:
        raise errors.AccountNotFound(account_id)
    return account


async def _member_for_change(rotation: RotationBook, member_id: uuid.UUID) -> RotationMember:
    member = await rotation.member_for_change(member_id)
    if member is None:
        raise errors.RotationMemberNotFound(member_id)
    return member


async def _period_for_change(
    rotation: RotationBook, eligibility_id: uuid.UUID
) -> tuple[RotationMember, EligibilityPeriod]:
    """The period and its member, the member held first and the period read
    again under it, so a concurrent change to the same person is seen."""
    period = await rotation.period(eligibility_id)
    if period is None:
        raise errors.EligibilityNotFound(eligibility_id)
    member = await _member_for_change(rotation, period.member_id)
    period = await rotation.period(eligibility_id)
    if period is None:
        raise errors.EligibilityNotFound(eligibility_id)
    return member, period


async def _ensure_duties_stay_eligible(
    rotation: RotationBook,
    member_id: uuid.UUID,
    role: AssignmentRole,
    starts_on: date | None,
    ends_on: date | None,
    *,
    other_than: uuid.UUID,
) -> None:
    """Refuse a new span that would leave a published duty in this role with
    no eligibility period covering its day."""
    if starts_on is None and ends_on is None:
        return
    duties = await rotation.published_duties(member_id, role=role, before=starts_on, after=ends_on)
    others = [item for item in await rotation.periods(member_id, role) if item.id != other_than]
    uncovered = [slot for slot in duties if not any(period.covers(slot[0]) for period in others)][
        :LISTED_SLOTS
    ]
    if uncovered:
        raise errors.DutiesLoseEligibility(uncovered)
