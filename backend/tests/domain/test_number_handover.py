"""The number handover of the day's pair: when it holds, where the number
rings meanwhile, who may start and end it, and what anyone may read of it."""

import uuid
from dataclasses import replace
from datetime import date, datetime, timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest

from oncall.domain.calendar.models import Audience
from oncall.domain.forwarding import errors
from oncall.domain.forwarding.job import (
    ForwardingTarget,
    Receiver,
    desired_target,
    duty_day_end,
    handover_end,
)
from oncall.domain.forwarding.models import (
    ForwardingMode,
    ForwardingOutcome,
    ForwardingState,
    HandoverEnd,
    NumberHandover,
    SwitchStatus,
)
from oncall.domain.forwarding.ports import (
    ForwardingNowPorts,
    HandoverChangePorts,
    HandoverCheckPorts,
    HandoverPorts,
)
from oncall.domain.forwarding.use_cases import (
    end_handover,
    forwarding_now,
    handover_ended_by_correction,
    start_handover,
)
from oncall.domain.roster import Duty
from oncall.domain.team import Actor
from oncall.domain.vocabulary import AssignmentRole, UserRole

WARSAW = ZoneInfo("Europe/Warsaw")
DAY = date(2026, 3, 10)
NOW = datetime(2026, 3, 10, 11, 40, tzinfo=WARSAW)
ANNA, MAREK, JAN = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
ANNA_USER, MAREK_USER, OTHER_USER = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
NAMES = {ANNA: "Anna Kowalska", MAREK: "Marek Nowak", JAN: "Jan Wiśniewski"}


def _duty(role: AssignmentRole, member_id: uuid.UUID | None, day: date = DAY) -> Duty:
    name = NAMES.get(member_id, "Osoba z importu") if member_id else "Osoba z importu"
    return Duty(day, role, member_id, name, False, uuid.uuid4())


def _pair(primary=ANNA, secondary=MAREK):
    duties = {}
    if primary is not ...:
        duties[(DAY, AssignmentRole.primary)] = _duty(AssignmentRole.primary, primary)
    if secondary is not ...:
        duties[(DAY, AssignmentRole.secondary)] = _duty(AssignmentRole.secondary, secondary)
    return duties


HANDOVER = NumberHandover(
    id=uuid.uuid4(),
    day=DAY,
    from_member_id=ANNA,
    from_name="Anna Kowalska",
    to_member_id=MAREK,
    to_name="Marek Nowak",
    starts_at=NOW - timedelta(minutes=10),
    until=NOW + timedelta(hours=2),
)


class _Roster:
    def __init__(self, duties) -> None:
        self.duties = duties

    async def duties_in_force(self, starts_on: date, ends_on: date):
        return self.duties


class _Contacts:
    def __init__(self, phones: dict[uuid.UUID, str], *, published: bool = True) -> None:
        self.phones = phones
        self.published = published

    async def roster_published(self) -> bool:
        return self.published

    async def phone(self, member_id: uuid.UUID) -> str | None:
        return self.phones.get(member_id)


PHONES = {ANNA: "+48601234567", MAREK: "+48602345678", JAN: "+48603456789"}


class _Store:
    def __init__(self, handover: NumberHandover | None = None, *, wins: bool = True) -> None:
        self.handover = handover
        self.wins = wins
        self.ended: list[tuple[HandoverEnd, datetime, uuid.UUID | None]] = []
        self.started: list[dict] = []

    async def open(self) -> NumberHandover | None:
        return self.handover

    async def start(self, **values) -> NumberHandover:
        self.started.append(values)
        self.handover = NumberHandover(
            id=uuid.uuid4(),
            day=values["day"],
            from_member_id=values["from_member_id"],
            from_name=NAMES[values["from_member_id"]],
            to_member_id=values["to_member_id"],
            to_name=NAMES[values["to_member_id"]],
            starts_at=values["now"],
            until=values["until"],
        )
        return self.handover

    async def end(self, handover, reason, *, at, by_user_id) -> bool:
        self.ended.append((reason, at, by_user_id))
        return self.wins


class _Journal:
    def __init__(self) -> None:
        self.events: list[tuple] = []

    def started(self, handover) -> None:
        self.events.append(("started", handover.id))

    def ended(self, handover, reason) -> None:
        self.events.append(("ended", reason))

    async def ended_by_roster_change(self, handover, primary_name) -> None:
        self.events.append(("mail", primary_name))


class _Settings:
    def __init__(self, mode: ForwardingMode) -> None:
        self.mode = mode

    async def current(self):
        return SimpleNamespace(mode=self.mode)


class _Team:
    async def member_for_account(self, user_id: uuid.UUID):
        member_id = {ANNA_USER: ANNA, MAREK_USER: MAREK}.get(user_id)
        return SimpleNamespace(id=member_id) if member_id else None


def _actor(user_id: uuid.UUID, role: UserRole = UserRole.member) -> Actor:
    return Actor(user_id=user_id, display_name="Ktoś", role=role)


# --- when a handover holds ---------------------------------------------------


def test_a_handover_holds_until_its_end_within_its_day_and_pair() -> None:
    assert handover_end(HANDOVER, DAY, _pair(), NOW) is None
    assert handover_end(HANDOVER, DAY, _pair(), HANDOVER.until) is HandoverEnd.expired
    assert handover_end(HANDOVER, DAY + timedelta(days=1), _pair(), NOW) is HandoverEnd.expired
    assert handover_end(HANDOVER, DAY, _pair(primary=JAN), NOW) is HandoverEnd.roster_change
    assert handover_end(HANDOVER, DAY, _pair(secondary=JAN), NOW) is HandoverEnd.roster_change
    assert handover_end(HANDOVER, DAY, _pair(secondary=...), NOW) is HandoverEnd.roster_change


def test_the_duty_day_ends_at_the_next_reminder_hour() -> None:
    assert duty_day_end(DAY, 9) == datetime(2026, 3, 11, 9, 0, tzinfo=WARSAW)


async def _desired(store: _Store, journal: _Journal, duties, now=NOW, phones=PHONES):
    return await desired_target(
        now, 9, _Roster(duties), _Contacts(phones), HandoverPorts(store, journal)
    )


async def test_during_a_handover_the_number_rings_at_the_receiver() -> None:
    store, journal = _Store(HANDOVER), _Journal()

    target = await _desired(store, journal, _pair())

    assert target == ForwardingTarget(
        DAY, ANNA, "Anna Kowalska", "+48602345678", Receiver(MAREK, "Marek Nowak")
    )
    assert target is not None
    assert (target.holder_id, target.holder_name) == (MAREK, "Marek Nowak")
    assert store.ended == []
    assert journal.events == []


async def test_a_receiver_who_lost_the_number_leaves_the_call_with_the_primary() -> None:
    target = await _desired(_Store(HANDOVER), _Journal(), _pair(), phones={ANNA: "+48601234567"})

    assert target == ForwardingTarget(DAY, ANNA, "Anna Kowalska", "+48601234567")
    assert target is not None
    assert target.holder_name == "Anna Kowalska"


async def test_after_its_end_the_number_goes_back_to_the_primary_by_itself() -> None:
    store, journal = _Store(HANDOVER), _Journal()
    late = HANDOVER.until + timedelta(minutes=7)

    target = await _desired(store, journal, _pair(), now=late)

    assert target == ForwardingTarget(DAY, ANNA, "Anna Kowalska", "+48601234567")
    # Recorded at the end it had, however late the pass came, and nobody is
    # written to: both people knew when it would end (D4).
    assert store.ended == [(HandoverEnd.expired, HANDOVER.until, None)]
    assert journal.events == [("ended", HandoverEnd.expired)]


async def test_a_correction_out_of_the_pair_ends_it_and_tells_both_people() -> None:
    store, journal = _Store(HANDOVER), _Journal()

    target = await _desired(store, journal, _pair(primary=JAN))

    assert target == ForwardingTarget(DAY, JAN, "Jan Wiśniewski", "+48603456789")
    assert store.ended == [(HandoverEnd.roster_change, NOW, None)]
    assert journal.events == [("ended", HandoverEnd.roster_change), ("mail", "Jan Wiśniewski")]


async def test_a_roster_with_no_primary_left_ends_it_with_nobody_named() -> None:
    store, journal = _Store(HANDOVER), _Journal()

    target = await _desired(store, journal, _pair(primary=...))

    assert target == ForwardingTarget(DAY, None, None, None)
    assert journal.events == [("ended", HandoverEnd.roster_change), ("mail", None)]


async def test_a_pass_that_lost_the_race_to_end_it_records_nothing() -> None:
    store, journal = _Store(HANDOVER, wins=False), _Journal()

    await _desired(store, journal, _pair(secondary=JAN))

    assert store.ended == [(HandoverEnd.roster_change, NOW, None)]
    assert journal.events == []


# --- starting and ending -----------------------------------------------------


def _change_ports(
    store: _Store | None = None,
    journal: _Journal | None = None,
    *,
    settling: _Journal | None = None,
    mode: ForwardingMode = ForwardingMode.live,
    duties=None,
    phones=PHONES,
) -> HandoverChangePorts:
    store = store or _Store()
    return HandoverChangePorts(
        settings=_Settings(mode),  # type: ignore[arg-type]
        roster=_Roster(_pair() if duties is None else duties),  # type: ignore[arg-type]
        contacts=_Contacts(phones),
        team=_Team(),  # type: ignore[arg-type]
        handover=HandoverPorts(store, journal or _Journal()),
        settling=HandoverPorts(store, settling or _Journal()),
    )


UNTIL = NOW + timedelta(hours=2)


@pytest.mark.parametrize("mode", [ForwardingMode.live, ForwardingMode.dry_run])
async def test_either_of_the_pair_hands_the_number_to_the_secondary(mode) -> None:
    for user in (ANNA_USER, MAREK_USER):
        store, journal = _Store(), _Journal()

        handover = await start_handover(
            _actor(user), UNTIL, _change_ports(store, journal, mode=mode), now=NOW, reminder_hour=9
        )

        assert (handover.from_member_id, handover.to_member_id) == (ANNA, MAREK)
        assert store.started[0] | {"now": None} == {
            "day": DAY,
            "from_member_id": ANNA,
            "to_member_id": MAREK,
            "until": UNTIL,
            "now": None,
            "by_user_id": user,
        }
        assert journal.events == [("started", handover.id)]


async def test_a_coordinator_hands_it_over_for_the_pair() -> None:
    handover = await start_handover(
        _actor(OTHER_USER, UserRole.coordinator), UNTIL, _change_ports(), now=NOW, reminder_hour=9
    )

    assert handover.to_name == "Marek Nowak"


async def test_nothing_is_handed_over_while_forwarding_is_off() -> None:
    pending = start_handover(
        _actor(ANNA_USER),
        UNTIL,
        _change_ports(mode=ForwardingMode.off),
        now=NOW,
        reminder_hour=9,
    )
    with pytest.raises(errors.ForwardingOff):
        await pending


async def test_somebody_outside_the_pair_is_refused() -> None:
    for user in (OTHER_USER, uuid.uuid4()):
        pending = start_handover(_actor(user), UNTIL, _change_ports(), now=NOW, reminder_hour=9)
        with pytest.raises(errors.NotInThePair):
            await pending


async def test_a_second_handover_is_refused_while_the_first_holds() -> None:
    pending = start_handover(
        _actor(ANNA_USER), UNTIL, _change_ports(_Store(HANDOVER)), now=NOW, reminder_hour=9
    )
    with pytest.raises(errors.HandoverActive) as refused:
        await pending

    assert "Marek Nowak" in str(refused.value)


async def test_an_expired_handover_does_not_block_the_next_one() -> None:
    """The time ended the old one, not whoever starts the next: its end is
    recorded in nobody's name, as the worker would have."""
    old = replace(HANDOVER, until=NOW - timedelta(minutes=1))
    store, journal, settling = _Store(old), _Journal(), _Journal()

    await start_handover(
        _actor(ANNA_USER),
        UNTIL,
        _change_ports(store, journal, settling=settling),
        now=NOW,
        reminder_hour=9,
    )

    assert store.ended == [(HandoverEnd.expired, old.until, None)]
    assert settling.events == [("ended", HandoverEnd.expired)]
    assert [event[0] for event in journal.events] == ["started"]


@pytest.mark.parametrize(
    "duties",
    [_pair(secondary=...), _pair(primary=...), _pair(secondary=None), _pair(primary=None)],
    ids=["no secondary", "no primary", "imported secondary", "imported primary"],
)
async def test_a_day_without_a_whole_pair_has_nobody_to_hand_over_to(duties) -> None:
    pending = start_handover(
        _actor(ANNA_USER), UNTIL, _change_ports(duties=duties), now=NOW, reminder_hour=9
    )
    with pytest.raises(errors.HandoverNeedsPair):
        await pending


@pytest.mark.parametrize(
    "until",
    [NOW, NOW - timedelta(minutes=5), datetime(2026, 3, 11, 9, 1, tzinfo=WARSAW)],
    ids=["now", "past", "after the duty day"],
)
async def test_the_end_lies_after_now_and_within_the_duty_day(until) -> None:
    pending = start_handover(_actor(ANNA_USER), until, _change_ports(), now=NOW, reminder_hour=9)
    with pytest.raises(errors.HandoverUntilOutOfRange) as refused:
        await pending

    assert "11-03-2026 09:00" in str(refused.value)


async def test_the_end_of_the_duty_day_itself_is_allowed() -> None:
    latest = datetime(2026, 3, 11, 9, 0, tzinfo=WARSAW)

    handover = await start_handover(
        _actor(ANNA_USER), latest, _change_ports(), now=NOW, reminder_hour=9
    )

    assert handover.until == latest


async def test_a_receiver_without_a_number_is_refused_by_name() -> None:
    pending = start_handover(
        _actor(ANNA_USER),
        UNTIL,
        _change_ports(phones={ANNA: "+48601234567"}),
        now=NOW,
        reminder_hour=9,
    )
    with pytest.raises(errors.ReceiverHasNoPhone) as refused:
        await pending

    assert "Marek Nowak" in str(refused.value)


async def test_either_of_its_people_or_a_coordinator_ends_it() -> None:
    for actor in (_actor(ANNA_USER), _actor(MAREK_USER), _actor(OTHER_USER, UserRole.admin)):
        store, journal = _Store(HANDOVER), _Journal()

        await end_handover(actor, HANDOVER.id, _change_ports(store, journal), now=NOW)

        assert store.ended == [(HandoverEnd.manual, NOW, actor.user_id)]
        assert journal.events == [("ended", HandoverEnd.manual)]


async def test_ending_works_whatever_the_mode() -> None:
    store = _Store(HANDOVER)

    await end_handover(
        _actor(ANNA_USER), HANDOVER.id, _change_ports(store, mode=ForwardingMode.off), now=NOW
    )

    assert store.ended[0][0] is HandoverEnd.manual


async def test_somebody_else_cannot_end_it() -> None:
    pending = end_handover(
        _actor(OTHER_USER), HANDOVER.id, _change_ports(_Store(HANDOVER)), now=NOW
    )
    with pytest.raises(errors.NotInThePair):
        await pending


@pytest.mark.parametrize(
    ("store", "handover_id"),
    [
        (_Store(), HANDOVER.id),
        (_Store(HANDOVER), uuid.uuid4()),
        (_Store(HANDOVER, wins=False), HANDOVER.id),
    ],
    ids=["none open", "another one", "ended meanwhile"],
)
async def test_a_handover_that_is_not_open_is_not_found(store, handover_id) -> None:
    journal = _Journal()

    pending = end_handover(_actor(ANNA_USER), handover_id, _change_ports(store, journal), now=NOW)
    with pytest.raises(errors.HandoverNotFound):
        await pending

    assert journal.events == []


# --- what a correction would end ---------------------------------------------


async def test_a_correction_of_the_pair_on_its_day_names_the_handover() -> None:
    store = _Store(HANDOVER)
    late = (DAY, AssignmentRole.late_shift)
    next_day = (DAY + timedelta(days=1), AssignmentRole.primary)

    async def ends(*slots, handovers=store, now=NOW):
        ports = HandoverCheckPorts(_Settings(ForwardingMode.live), handovers)  # type: ignore[arg-type]
        return await handover_ended_by_correction(slots, ports, now=now)

    for role in (AssignmentRole.primary, AssignmentRole.secondary):
        assert await ends((DAY, role)) == HANDOVER
        assert await ends(late, next_day, (DAY, role)) == HANDOVER
    assert await ends(late, next_day) is None
    assert await ends() is None
    assert await ends((DAY, AssignmentRole.primary), now=HANDOVER.until) is None
    assert await ends((DAY, AssignmentRole.primary), handovers=_Store()) is None


async def test_while_forwarding_is_off_a_correction_names_no_handover() -> None:
    """Nothing happens in mode off (D5): the worker ends no handover and
    sends no mail, so the frame must not promise either."""
    ports = HandoverCheckPorts(_Settings(ForwardingMode.off), _Store(HANDOVER))  # type: ignore[arg-type]

    assert (
        await handover_ended_by_correction([(DAY, AssignmentRole.secondary)], ports, now=NOW)
        is None
    )


# --- where the number rings now ----------------------------------------------


def _state(**values) -> ForwardingState:
    empty = dict.fromkeys(
        (
            "applied_number",
            "applied_member_name",
            "applied_at",
            "desired_number",
            "desired_member_name",
            "desired_for_day",
            "last_attempt_at",
            "last_outcome",
            "last_error",
            "failing_since",
            "next_attempt_at",
        )
    )
    return ForwardingState(**(empty | {"attempts": 0} | values))


class _State:
    def __init__(self, state: ForwardingState) -> None:
        self.state = state

    async def current(self) -> ForwardingState:
        return self.state


def _now_ports(
    *,
    mode=ForwardingMode.live,
    handover: NumberHandover | None = None,
    duties=None,
    state: ForwardingState | None = None,
    published: bool = True,
    phones=PHONES,
) -> ForwardingNowPorts:
    return ForwardingNowPorts(
        settings=_Settings(mode),  # type: ignore[arg-type]
        roster=_Roster(_pair() if duties is None else duties),  # type: ignore[arg-type]
        contacts=_Contacts(phones, published=published),
        handovers=_Store(handover),
        state=_State(state or _state()),
    )


TEAM = Audience(role=UserRole.member, account_id=uuid.uuid4())
CONFIRMED_AT = NOW - timedelta(minutes=8)


async def _now(audience: Audience = TEAM, **ports):
    return await forwarding_now(audience, _now_ports(**ports), now=NOW, reminder_hour=9)


async def test_while_forwarding_is_off_nothing_but_the_mode_is_told() -> None:
    now = await _now(mode=ForwardingMode.off, handover=HANDOVER)

    assert now.mode is ForwardingMode.off
    assert (now.day, now.holder_name, now.handover, now.status) == (None, None, None, None)


async def test_a_share_link_outside_its_range_learns_only_the_mode() -> None:
    later = Audience(
        role=UserRole.viewer, share_range=(DAY + timedelta(days=1), DAY + timedelta(7))
    )
    inside = Audience(role=UserRole.viewer, share_range=(DAY, DAY))

    assert (await _now(later)).holder_name is None
    assert (await _now(inside)).holder_name == "Anna Kowalska"


async def test_before_any_publication_there_is_nobody_to_name() -> None:
    now = await _now(duties={}, published=False)

    assert (now.day, now.holder_name, now.status) == (DAY, None, None)
    assert now.day_ends_at == datetime(2026, 3, 11, 9, tzinfo=WARSAW)


async def test_the_primary_holds_the_number_once_wco_confirmed_it() -> None:
    switching = await _now()
    confirmed = await _now(
        state=_state(
            applied_number="+48601234567",
            applied_member_name="Anna Kowalska",
            applied_at=CONFIRMED_AT,
        )
    )

    assert switching.status is SwitchStatus.switching
    assert (confirmed.holder_member_id, confirmed.holder_role) == (ANNA, AssignmentRole.primary)
    assert (confirmed.status, confirmed.confirmed_at) == (SwitchStatus.confirmed, CONFIRMED_AT)
    assert confirmed.handover is None
    assert confirmed.day_ends_at == datetime(2026, 3, 11, 9, tzinfo=WARSAW)


async def test_during_a_handover_the_receiver_holds_it_and_the_old_number_is_switching() -> None:
    now = await _now(
        handover=HANDOVER,
        state=_state(applied_number="+48601234567", applied_member_name="Anna Kowalska"),
    )

    assert (now.holder_member_id, now.holder_name) == (MAREK, "Marek Nowak")
    assert now.holder_role is AssignmentRole.secondary
    assert now.handover == HANDOVER
    assert now.status is SwitchStatus.switching


async def test_a_handover_that_no_longer_holds_is_not_read_as_one() -> None:
    now = await _now(handover=HANDOVER, duties=_pair(secondary=JAN))

    assert now.holder_name == "Anna Kowalska"
    assert now.handover is None


async def test_a_receiver_who_lost_their_number_shows_no_handover() -> None:
    """The number rings at the PRIMARY again, so no handover is told: it
    does not decide where the number rings."""
    now = await _now(handover=HANDOVER, phones={ANNA: PHONES[ANNA]})

    assert (now.holder_name, now.holder_role) == ("Anna Kowalska", AssignmentRole.primary)
    assert now.handover is None


def _wanting_marek(**values) -> ForwardingState:
    return _state(
        desired_for_day=DAY,
        desired_member_name="Marek Nowak",
        desired_number="+48602345678",
        **values,
    )


async def test_a_failure_is_told_once_the_alert_for_this_target_went_out() -> None:
    anna = ForwardingTarget(DAY, ANNA, "Anna Kowalska", "+48601234567")
    marek = replace(anna, receiver=Receiver(MAREK, "Marek Nowak"), number="+48602345678")
    retrying = await _now(
        handover=HANDOVER, state=_wanting_marek(last_outcome=ForwardingOutcome.failed)
    )
    alerted_for_anna = await _now(
        handover=HANDOVER,
        state=_wanting_marek(
            last_outcome=ForwardingOutcome.failed, alerted_for=anna.failure_alert_key
        ),
    )
    alerted = await _now(
        handover=HANDOVER,
        state=_wanting_marek(
            last_outcome=ForwardingOutcome.failed, alerted_for=marek.failure_alert_key
        ),
    )

    assert retrying.status is SwitchStatus.switching
    assert alerted_for_anna.status is SwitchStatus.switching
    assert (alerted.status, alerted.confirmed_at) == (SwitchStatus.failed, None)


async def test_a_dry_run_counts_as_confirmed_once_the_pass_recorded_it() -> None:
    before = await _now(mode=ForwardingMode.dry_run, handover=HANDOVER)
    recorded = await _now(
        mode=ForwardingMode.dry_run,
        handover=HANDOVER,
        state=_wanting_marek(last_outcome=ForwardingOutcome.dry_run, last_attempt_at=CONFIRMED_AT),
    )

    assert before.status is SwitchStatus.switching
    assert (recorded.status, recorded.confirmed_at) == (SwitchStatus.confirmed, CONFIRMED_AT)
