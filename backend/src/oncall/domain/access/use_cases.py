"""Signing in, the directory link, one-time account links and the account
owner's own details.

Signing in is guarded twice: a throttle keyed by login and by address, and a
constant cost per refusal (one password verification, real or decoy), so a
refusal says nothing about whether the account exists. A refused sign-in is
itself recorded, which is why its refusals are `RecordedRefusal`s: the caller
keeps the record. Nothing here commits.
"""

import uuid
from datetime import datetime, timedelta
from typing import NoReturn

from oncall.domain.access import errors
from oncall.domain.access.models import (
    FAILED_LOGIN_SERIES_WINDOW,
    LOGIN_ATTEMPTS_PER_IP,
    LOGIN_ATTEMPTS_PER_USERNAME,
    LOGIN_THROTTLE_WINDOW,
    AccountOverview,
    DirectoryIdentity,
    PasswordChoice,
    SignedIn,
    SignInRequest,
    retry_after_seconds,
)
from oncall.domain.access.ports import AccessPorts
from oncall.domain.accounts import Account
from oncall.domain.admin.errors import DirectoryPasswordReadOnly
from oncall.domain.clock import as_utc
from oncall.domain.vocabulary import AccountTokenKind, AuthSource


async def sign_in(
    request: SignInRequest,
    ports: AccessPorts,
    *,
    now: datetime,
    session_lifetime: timedelta,
) -> SignedIn:
    await _enforce_throttle(request, ports, now)
    login = request.login
    found = await ports.accounts.credentials_for_login(login)
    account = found.account if found is not None else None
    try_directory = True
    # Whether a real verification against this account's own hash already ran
    # - if so, the decoy verification below must be skipped, or an existing
    # account with a wrong password pays for two hashes while every other
    # outcome pays for one, and the difference in wall-clock time (measured:
    # 81.5 ms vs 44.5 ms) itself discloses that the account exists.
    local_password_checked = False
    if account is not None and account.auth_source == AuthSource.local:
        try_directory = False
        if account.is_active and await ports.passwords.verify(
            found.password_hash, request.password
        ):
            # Local credentials accepted; no directory round-trip needed.
            pass
        elif not account.is_active:
            await _reject(request, ports, now)
        else:
            # A manually created local account is expected to link with AD on
            # the person's first directory login, so a failed local password
            # still tries the directory before giving up. The directory itself
            # answers None immediately when it is not in use.
            local_password_checked = True
            try_directory = True
    if try_directory:
        if account is not None and not account.is_active:
            await _reject(request, ports, now)
        try:
            identity = await ports.directory.authenticate(login, request.password)
        except errors.DirectoryFailure as failure:
            await ports.attempts.directory_unavailable(login, failure.reason)
            raise errors.DirectoryLoginUnavailable(failure.reason) from failure
        if identity is None:
            if not local_password_checked:
                await ports.passwords.verify_decoy(request.password)
            await _reject(request, ports, now)
        try:
            account = await synchronize_directory_account(identity, ports)
        except errors.DirectoryIdentityTaken as taken:
            await ports.attempts.identity_conflict(login)
            raise errors.DirectoryIdentityConflict() from taken
        if not account.is_active:
            await _reject(request, ports, now)
    session = await ports.sessions.open_for_account(account.id, now + session_lifetime)
    await ports.journal.signed_in(account)
    return SignedIn(
        account=account,
        session=session,
        has_team_member=await ports.accounts.has_team_member(account.id),
    )


async def _enforce_throttle(request: SignInRequest, ports: AccessPorts, now: datetime) -> None:
    since = now - LOGIN_THROTTLE_WINDOW
    login_failures = await ports.attempts.failures_since(request.login_label, since)
    ip_failures = await ports.attempts.failures_since(request.ip_label, since)
    if login_failures < LOGIN_ATTEMPTS_PER_USERNAME and ip_failures < LOGIN_ATTEMPTS_PER_IP:
        return
    label = (
        request.login_label if login_failures >= LOGIN_ATTEMPTS_PER_USERNAME else request.ip_label
    )
    times = await ports.attempts.throttled(label, since)
    raise errors.LoginThrottled(label, retry_after_seconds(times))


async def _reject(request: SignInRequest, ports: AccessPorts, now: datetime) -> NoReturn:
    await ports.attempts.failed(request, now - FAILED_LOGIN_SERIES_WINDOW)
    raise errors.LoginRejected()


async def synchronize_directory_account(identity: DirectoryIdentity, ports: AccessPorts) -> Account:
    """The account a directory identity signs in as: provisioned on first
    sign-in, linked when a local account carries its personnel number, and
    kept in step with the directory afterwards."""
    login = identity.username.strip().lower()
    account = await ports.accounts.account_with_personnel_number(identity.personnel_number)
    login_owner = await ports.accounts.account_named(login)
    if account is None:
        if login_owner is not None:
            raise errors.DirectoryIdentityTaken()
        provisioned = await ports.accounts.provision_from_directory(login, identity)
        await ports.journal.provisioned(provisioned)
        return provisioned
    if login_owner is not None and login_owner.id != account.id:
        raise errors.DirectoryIdentityTaken()
    if account.auth_source == AuthSource.local:
        # The directory verified the person's credentials and vouches for the
        # personnel number, so the account converts: from now on the directory
        # is the only way in and the local password stops working.
        linked = await ports.accounts.link_to_directory(account.id, login, identity)
        await ports.journal.linked(linked, login=login)
        return linked
    if account.auth_source != AuthSource.ldap:
        raise errors.DirectoryIdentityTaken()
    changes = {
        field: value
        for field, value in (
            ("username", login),
            ("first_name", identity.first_name),
            ("last_name", identity.last_name),
            ("email", identity.email),
        )
        if getattr(account, field) != value
    }
    if not changes:
        return account
    synced = await ports.accounts.update_from_directory(account.id, changes)
    await ports.journal.synced(synced, fields=list(changes))
    return synced


async def describe_account_link(
    token: str, kind: AccountTokenKind, ports: AccessPorts, *, now: datetime
) -> Account:
    link = await ports.links.link(token, kind)
    if link is None or link.used_at is not None or as_utc(link.expires_at) <= now:
        raise errors.AccountLinkInvalid()
    return link.credentials.account


async def choose_password(choice: PasswordChoice, ports: AccessPorts, *, now: datetime) -> Account:
    """Activate an account or reset its password with a one-time link."""
    link = await ports.links.link_for_use(choice.token, choice.kind)
    if link is None or link.used_at is not None or as_utc(link.expires_at) <= now:
        raise errors.AccountLinkInvalid()
    account = link.credentials.account
    if account.auth_source != AuthSource.local:
        raise DirectoryPasswordReadOnly(account.id)
    if choice.kind == AccountTokenKind.activation and link.credentials.password_set:
        raise errors.AccountAlreadyActivated()
    if choice.password.lower() == account.username.lower():
        raise errors.PasswordSameAsLogin()
    await ports.accounts.set_password(account.id, await ports.passwords.hash(choice.password))
    await ports.links.mark_used(link.id, now)
    if choice.kind == AccountTokenKind.password_reset:
        # Whoever knew the old password is signed out everywhere.
        await ports.sessions.end_all_for_account(account.id)
    await ports.journal.password_set(account, choice.kind)
    return account


async def describe_account(account: Account, ports: AccessPorts) -> AccountOverview:
    return AccountOverview(
        account=account, has_team_member=await ports.accounts.has_team_member(account.id)
    )


async def change_own_phone(
    account_id: uuid.UUID | None, phone: str | None, ports: AccessPorts
) -> AccountOverview:
    """The one detail account owners edit themselves. A share-link session has
    no account to edit."""
    if account_id is None:
        raise errors.ShareSessionHasNoAccount()
    return await describe_account(await ports.accounts.change_phone(account_id, phone), ports)
