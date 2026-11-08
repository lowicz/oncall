"""Reading and changing the forwarding settings, revealing the stored
password to an administrator, checking the connection to WCO, reading the
state, and the day's pair handing the on-call number over."""

import uuid
from collections.abc import Iterable
from datetime import date, datetime

from oncall.domain.access.models import SignInRequest
from oncall.domain.access.use_cases import verify_own_password
from oncall.domain.accounts import Account
from oncall.domain.calendar.models import Audience
from oncall.domain.clock import BUSINESS_TIMEZONE
from oncall.domain.forwarding import errors
from oncall.domain.forwarding.job import (
    ForwardingTarget,
    duty_day_end,
    forwarding_day,
    handover_end,
    settle_handover,
    target_of,
)
from oncall.domain.forwarding.models import (
    FAILING_OUTCOMES,
    ConnectionTest,
    ForwardingMode,
    ForwardingNow,
    ForwardingOutcome,
    ForwardingSettings,
    ForwardingState,
    HandoverEnd,
    NumberHandover,
    RevealedPasswords,
    SettingsChange,
    SwitchStatus,
    WcoAccount,
)
from oncall.domain.forwarding.passwords import Passwords
from oncall.domain.forwarding.ports import (
    ConnectionTestPorts,
    CurrentSettings,
    CurrentState,
    ForwardingNowPorts,
    HandoverChangePorts,
    HandoverCheckPorts,
    PasswordReader,
    RevealPorts,
    SettingsPorts,
)
from oncall.domain.team import Actor
from oncall.domain.vocabulary import ONCALL_ROLES, AssignmentRole


async def current_settings(settings: CurrentSettings) -> ForwardingSettings:
    return await settings.current()


async def change_settings(
    change: SettingsChange, password: str | None, ports: SettingsPorts
) -> ForwardingSettings:
    """Save the settings; `password` replaces the stored one, None keeps it.

    A password is stored only encrypted, a stored one is kept only for the
    address it was entered for, and forwarding is turned on only with a key
    to decrypt it and everything a login to WCO needs.
    """
    enabling = change.mode is not ForwardingMode.off
    if (password is not None or enabling) and not ports.cipher.available():
        raise errors.SecretsKeyMissing()
    current = await ports.settings.current()
    keeps_password = password is None and current.password_set
    if keeps_password and change.base_url != current.base_url:
        raise errors.NewAddressNeedsPassword()
    if enabling and not (change.complete and (password is not None or current.password_set)):
        raise errors.SettingsIncomplete()
    token = None if password is None else ports.cipher.encrypt(password)
    settings = await ports.settings.change(change, token)
    ports.journal.settings_updated(settings, password_changed=token is not None)
    return settings


async def reveal_password(
    administrator: Account, confirmation: SignInRequest, ports: RevealPorts, *, now: datetime
) -> RevealedPasswords:
    """The stored WCO passwords in the clear, so the administrator can switch
    the number by hand when the forwarding pass cannot.

    The administrator first confirms it is them with their own sign-in
    password (`confirmation`), and every reveal is audited without the value.
    During a half-done rotation both passwords come back, the pending one
    first, because nobody knows for sure which one WCO holds.
    """
    await verify_own_password(administrator, confirmation, ports.confirm, now=now)
    settings = await ports.settings.current()
    tokens = await ports.settings.tokens()
    if tokens is None:
        raise errors.PasswordNotSet()
    if not ports.cipher.available():
        raise errors.SecretsKeyMissing()
    pending = None if tokens.pending is None else _read(tokens.pending, ports.cipher)
    revealed = RevealedPasswords(
        current=_read(tokens.current, ports.cipher),
        pending=pending,
        pending_since=settings.rotation_pending_since,
        credentials_invalid_since=settings.credentials_invalid_since,
        password_changed_at=settings.password_changed_at,
    )
    ports.journal.password_revealed(settings, pending_included=pending is not None)
    return revealed


async def test_connection(ports: ConnectionTestPorts) -> ConnectionTest:
    """Log in to WCO with the stored settings and read the number it forwards
    to, writing nothing there, so an administrator learns before turning
    forwarding on whether the settings work. Every test is audited.

    Once WCO has refused every stored password nothing is tried, as the
    worker does, until a new password is entered."""
    settings = await ports.settings.current()
    tokens = await ports.settings.tokens()
    if tokens is None or not (settings.vpbx_number and settings.username and settings.wco_user_id):
        raise errors.SettingsIncomplete()
    if settings.credentials_invalid_since is not None:
        raise errors.CredentialsRefused()
    if not ports.cipher.available():
        raise errors.SecretsKeyMissing()
    pending = None if tokens.pending is None else _read(tokens.pending, ports.cipher)
    account = WcoAccount(
        base_url=settings.base_url,
        vpbx_number=settings.vpbx_number,
        username=settings.username,
        wco_user_id=settings.wco_user_id,
        passwords=Passwords(_read(tokens.current, ports.cipher), pending),
    )
    result = await ports.probe(account)
    ports.journal.connection_tested(settings, result)
    return result


def _read(token: str, cipher: PasswordReader) -> str:
    plaintext = cipher.read(token)
    if plaintext is None:
        raise errors.StoredPasswordUnreadable()
    return plaintext


async def current_state(state: CurrentState) -> ForwardingState:
    return await state.current()


async def _acts_for(actor: Actor, members: set[uuid.UUID], ports: HandoverChangePorts) -> None:
    """Refuse anyone but a coordinator or one of `members` (decision D1)."""
    if actor.coordinates:
        return
    member = await ports.team.member_for_account(actor.user_id)
    if member is None or member.id not in members:
        raise errors.NotInThePair()


async def start_handover(
    actor: Actor,
    until: datetime,
    ports: HandoverChangePorts,
    *,
    now: datetime,
    reminder_hour: int,
) -> NumberHandover:
    """Give the on-call number to the day's SECONDARY until `until`, on one
    click of either of the pair or of a coordinator (D1, D2). It holds within
    the duty day only (D3): at its end the number passes to the next PRIMARY
    anyway. In a dry run it is recorded and WCO stays as it is."""
    if (await ports.settings.current()).mode is ForwardingMode.off:
        raise errors.ForwardingOff()
    day = forwarding_day(now.astimezone(BUSINESS_TIMEZONE), reminder_hour)
    duties = await ports.roster.duties_in_force(day, day)
    active = await settle_handover(day, duties, now, ports.settling)
    if active is not None:
        raise errors.HandoverActive(active.to_name)
    primary = duties.get((day, AssignmentRole.primary))
    secondary = duties.get((day, AssignmentRole.secondary))
    if (
        primary is None
        or secondary is None
        or primary.member_id is None
        or secondary.member_id is None
    ):
        raise errors.HandoverNeedsPair()
    await _acts_for(actor, {primary.member_id, secondary.member_id}, ports)
    latest = duty_day_end(day, reminder_hour)
    if not now < until <= latest:
        raise errors.HandoverUntilOutOfRange(f"{latest:%d-%m-%Y %H:%M}")
    if await ports.contacts.phone(secondary.member_id) is None:
        raise errors.ReceiverHasNoPhone(secondary.assignee_name)
    handover = await ports.handover.handovers.start(
        day=day,
        from_member_id=primary.member_id,
        to_member_id=secondary.member_id,
        until=until,
        now=now,
        by_user_id=actor.user_id,
    )
    ports.handover.journal.started(handover)
    return handover


async def end_handover(
    actor: Actor, handover_id: uuid.UUID, ports: HandoverChangePorts, *, now: datetime
) -> None:
    """End the open handover before its time: "Cofnij" right after starting
    it, or giving the number back. Either of its people or a coordinator may,
    whatever the forwarding mode."""
    handover = await ports.handover.handovers.open()
    if handover is None or handover.id != handover_id:
        raise errors.HandoverNotFound()
    await _acts_for(actor, {handover.from_member_id, handover.to_member_id}, ports)
    if not await ports.handover.handovers.end(
        handover, HandoverEnd.manual, at=now, by_user_id=actor.user_id
    ):
        raise errors.HandoverNotFound()
    ports.handover.journal.ended(handover, HandoverEnd.manual)


def _status(
    mode: ForwardingMode, target: ForwardingTarget, state: ForwardingState
) -> tuple[SwitchStatus, datetime | None]:
    """Whether WCO rings at `target` yet, read from what the last pass left."""
    wanted = (
        state.desired_for_day == target.day
        and state.desired_member_name == target.holder_name
        and state.desired_number == target.number
    )
    if wanted and state.last_outcome in FAILING_OUTCOMES and state.alert_sent:
        return SwitchStatus.failed, None
    if mode is ForwardingMode.dry_run:
        if wanted and state.last_outcome is ForwardingOutcome.dry_run:
            return SwitchStatus.confirmed, state.last_attempt_at
        return SwitchStatus.switching, None
    if (
        target.number is not None
        and state.applied_number == target.number
        and state.applied_member_name == target.holder_name
    ):
        return SwitchStatus.confirmed, state.applied_at
    return SwitchStatus.switching, None


async def forwarding_now(
    audience: Audience, ports: ForwardingNowPorts, *, now: datetime, reminder_hour: int
) -> ForwardingNow:
    """Where the on-call number rings now, for every role and share link:
    who has it, until when, whether WCO confirmed it. No phone number: the
    duty cards already show the ones the reader may see. Nothing while
    forwarding is off (D5), and nothing to a share link whose range leaves
    the duty day out. Read only: the worker ends a handover that ran out."""
    mode = (await ports.settings.current()).mode
    day = forwarding_day(now.astimezone(BUSINESS_TIMEZONE), reminder_hour)
    if mode is ForwardingMode.off or (
        audience.share_range is not None
        and not audience.share_range[0] <= day <= audience.share_range[1]
    ):
        return ForwardingNow(mode=mode)
    duties = await ports.roster.duties_in_force(day, day)
    handover = await ports.handovers.open()
    if handover is not None and handover_end(handover, day, duties, now) is not None:
        handover = None
    target = await target_of(day, duties, handover, ports.contacts)
    if target is None:
        return ForwardingNow(mode=mode, day=day)
    status, confirmed_at = _status(mode, target, await ports.state.current())
    return ForwardingNow(
        mode=mode,
        day=day,
        holder_member_id=target.holder_id,
        holder_name=target.holder_name,
        holder_role=AssignmentRole.secondary if target.receiver else AssignmentRole.primary,
        handover=handover if target.receiver is not None else None,
        status=status,
        confirmed_at=confirmed_at,
    )


async def handover_ended_by_correction(
    slots: Iterable[tuple[date, AssignmentRole]], ports: HandoverCheckPorts, *, now: datetime
) -> NumberHandover | None:
    """The handover a correction of these slots would end (NP-16): the open
    one, when a slot is PRIMARY or SECONDARY on its day. The correction
    frame says so before the coordinator saves. Nothing while forwarding is
    off (D5): the worker ends no handover then."""
    if (await ports.settings.current()).mode is ForwardingMode.off:
        return None
    handover = await ports.handovers.open()
    if handover is None or now >= handover.until:
        return None
    if any(day == handover.day and role in ONCALL_ROLES for day, role in slots):
        return handover
    return None
