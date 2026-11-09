import uuid
from dataclasses import replace
from datetime import date, timedelta

from oncall.domain.availability.errors import (
    AvailabilityAlreadyExists,
    AvailabilityEntryNotFound,
    AvailabilityInThePast,
    AvailabilityOverlaps,
    AvailabilityRangeReversed,
    AvailabilityRangeTooLong,
    AvailabilityUndoNotFound,
    TeamMemberNotFound,
)
from oncall.domain.availability.models import (
    MAX_ENTRY_DAYS,
    AvailabilityDeclaration,
    AvailabilityDeclared,
    AvailabilityEntry,
    AvailabilityQuery,
    AvailabilityRangeReplacement,
    AvailabilityRangeUndo,
    AvailabilityWithdrawal,
    MemberAvailability,
    MemberById,
    MemberRef,
    NewAvailabilityEntry,
    RangeSnapshot,
)
from oncall.domain.availability.ports import AvailabilityReadPorts, AvailabilityWritePorts
from oncall.domain.clock import business_today
from oncall.domain.errors import NotATeamMember
from oncall.domain.ports import TeamDirectory
from oncall.domain.team import Actor, Member
from oncall.domain.vocabulary import AvailabilityKind
from oncall.i18n import translate


async def _resolve(ref: MemberRef, actor: Actor, team: TeamDirectory) -> Member:
    if isinstance(ref, MemberById):
        member = await team.member(ref.member_id)
        if member is None:
            raise TeamMemberNotFound()
        return member
    member = await team.member_for_account(actor.user_id)
    if member is None:
        raise NotATeamMember()
    return member


async def list_availability(
    query: AvailabilityQuery, ports: AvailabilityReadPorts
) -> MemberAvailability:
    member = await _resolve(query.member, query.actor, ports.team)
    entries = await ports.ledger.entries(member.id, query.starts_on, query.ends_on)
    return MemberAvailability(member=member, entries=tuple(entries))


def _validate_range(starts_on: date, ends_on: date, today: date) -> None:
    if ends_on < starts_on:
        raise AvailabilityRangeReversed()
    if (ends_on - starts_on).days > MAX_ENTRY_DAYS:
        raise AvailabilityRangeTooLong()
    if ends_on < today:
        raise AvailabilityInThePast()


async def declare_availability(
    declaration: AvailabilityDeclaration,
    ports: AvailabilityWritePorts,
    *,
    today: date | None = None,
    undo_id: uuid.UUID | None = None,
) -> AvailabilityDeclared:
    """One write path for a member's own entry and a coordinator's entry on
    their behalf, so the rules cannot drift between the two."""
    _validate_range(declaration.starts_on, declaration.ends_on, today or business_today())
    member = await _resolve(declaration.member, declaration.actor, ports.team)
    on_behalf = member.user_id != declaration.actor.user_id
    overlapping_entries = await ports.ledger.overlapping_entries(
        member.id, declaration.starts_on, declaration.ends_on
    )
    if overlapping_entries:
        overlapping = overlapping_entries[0]
        if (
            overlapping.kind == declaration.kind
            and overlapping.starts_on == declaration.starts_on
            and overlapping.ends_on == declaration.ends_on
        ):
            raise AvailabilityAlreadyExists()
        raise AvailabilityOverlaps()
    new_entry = NewAvailabilityEntry(
        member_id=member.id,
        created_by_user_id=declaration.actor.user_id,
        kind=declaration.kind,
        starts_on=declaration.starts_on,
        ends_on=declaration.ends_on,
        note=declaration.note,
    )
    await ports.ledger.record(new_entry)
    duty_conflicts = []
    if declaration.kind == AvailabilityKind.unavailable:
        duties = await ports.roster.duties_in_force(declaration.starts_on, declaration.ends_on)
        duty_conflicts = [
            duty for duty in duties.values() if duty.held_by(member.id, member.display_name)
        ]
    await ports.journal.declared(
        member=member,
        entry=new_entry,
        on_behalf=on_behalf,
        duty_conflicts=duty_conflicts,
        undo_id=undo_id,
    )
    warning: str | None = None
    if duty_conflicts:
        warning = (
            translate("availability.on_duty_warning_on_behalf", name=member.display_name)
            if on_behalf
            else translate("availability.on_duty_warning")
        )
    return AvailabilityDeclared(
        entry=await ports.ledger.recorded_entry(),
        member=member,
        on_behalf=on_behalf,
        duty_conflicts=tuple(duty_conflicts),
        warning=warning,
    )


def _inside(entry: AvailabilityEntry, starts_on: date, ends_on: date) -> NewAvailabilityEntry:
    """The part of the entry within the range, with its author and note."""
    return NewAvailabilityEntry(
        member_id=entry.member_id,
        created_by_user_id=entry.created_by_user_id,
        kind=entry.kind,
        starts_on=max(entry.starts_on, starts_on),
        ends_on=min(entry.ends_on, ends_on),
        note=entry.note,
    )


async def _cut_range(
    member: Member,
    starts_on: date,
    ends_on: date,
    *,
    on_behalf: bool,
    ports: AvailabilityWritePorts,
) -> list[AvailabilityEntry]:
    """Remove the range's days from the member's entries and answer with the
    entries it touched. The pieces kept outside the range, elapsed ones
    included, are the days that did not change: they keep their author and
    note and are not announced again."""
    overlapping = await ports.ledger.overlapping_entries(member.id, starts_on, ends_on)
    for entry in overlapping:
        withdrawn_days = replace(
            entry, starts_on=max(entry.starts_on, starts_on), ends_on=min(entry.ends_on, ends_on)
        )
        await ports.journal.withdrawn(member=member, entry=withdrawn_days, on_behalf=on_behalf)
        await ports.ledger.remove(entry.id)
        pieces = (
            (entry.starts_on, starts_on - timedelta(days=1)),
            (ends_on + timedelta(days=1), entry.ends_on),
        )
        for piece_starts_on, piece_ends_on in pieces:
            if piece_starts_on <= piece_ends_on:
                await ports.ledger.record(_inside(entry, piece_starts_on, piece_ends_on))
    return overlapping


async def replace_availability_range(
    replacement: AvailabilityRangeReplacement,
    ports: AvailabilityWritePorts,
    *,
    today: date | None = None,
) -> AvailabilityDeclared | None:
    """Replace one date range as a single unit-of-work operation.

    Existing entries are cut around the range, then an optional new entry is
    painted into it and returned. A stroke with an `undo_id` keeps what the
    range held, for `undo_availability_range`. The HTTP unit of work commits
    every staged withdrawal and declaration together, or rolls all of them
    back on any failure.
    """
    today = today or business_today()
    _validate_range(replacement.starts_on, replacement.ends_on, today)
    member = await _resolve(replacement.member, replacement.actor, ports.team)
    on_behalf = member.user_id != replacement.actor.user_id
    overlapping = await _cut_range(
        member, replacement.starts_on, replacement.ends_on, on_behalf=on_behalf, ports=ports
    )
    if replacement.undo_id is not None:
        await ports.snapshots.keep(
            RangeSnapshot(
                id=replacement.undo_id,
                member_id=member.id,
                actor_user_id=replacement.actor.user_id,
                starts_on=replacement.starts_on,
                ends_on=replacement.ends_on,
                entries=tuple(
                    _inside(entry, replacement.starts_on, replacement.ends_on)
                    for entry in overlapping
                ),
            )
        )
    if replacement.kind is None:
        return None
    return await declare_availability(
        AvailabilityDeclaration(
            actor=replacement.actor,
            member=replacement.member,
            kind=replacement.kind,
            starts_on=replacement.starts_on,
            ends_on=replacement.ends_on,
            note=replacement.note,
        ),
        ports,
        today=today,
        undo_id=replacement.undo_id,
    )


async def undo_availability_range(
    undo: AvailabilityRangeUndo, ports: AvailabilityWritePorts
) -> None:
    """Put a stroke's range back as it was, in one unit of work: whatever the
    range holds now is cut out and the kept entries return with their own
    author and reason. Days outside the range are left as they are, and the
    stroke's e-mails still waiting are withdrawn."""
    member = await _resolve(undo.member, undo.actor, ports.team)
    on_behalf = member.user_id != undo.actor.user_id
    snapshot = await ports.snapshots.take(undo.undo_id, member.id, undo.actor.user_id)
    if snapshot is None:
        raise AvailabilityUndoNotFound()
    await _cut_range(member, snapshot.starts_on, snapshot.ends_on, on_behalf=on_behalf, ports=ports)
    for entry in snapshot.entries:
        await ports.ledger.record(entry)
        await ports.journal.restored(member=member, entry=entry, on_behalf=on_behalf)
    await ports.journal.undone(undo.undo_id)


async def withdraw_availability(
    withdrawal: AvailabilityWithdrawal, ports: AvailabilityWritePorts
) -> None:
    member = await _resolve(withdrawal.member, withdrawal.actor, ports.team)
    entry = await ports.ledger.entry_to_withdraw(member.id, withdrawal.entry_id)
    if entry is None:
        raise AvailabilityEntryNotFound()
    await ports.journal.withdrawn(
        member=member,
        entry=entry,
        on_behalf=member.user_id != withdrawal.actor.user_id,
    )
    await ports.ledger.remove(entry.id)
