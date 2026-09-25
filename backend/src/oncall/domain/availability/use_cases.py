from datetime import date

from oncall.domain.availability.errors import (
    AvailabilityAlreadyExists,
    AvailabilityEntryNotFound,
    AvailabilityInThePast,
    AvailabilityOverlaps,
    AvailabilityRangeReversed,
    AvailabilityRangeTooLong,
    TeamMemberNotFound,
)
from oncall.domain.availability.models import (
    MAX_ENTRY_DAYS,
    AvailabilityDeclaration,
    AvailabilityDeclared,
    AvailabilityQuery,
    AvailabilityWithdrawal,
    MemberAvailability,
    MemberById,
    MemberRef,
    NewAvailabilityEntry,
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
            raise TeamMemberNotFound(ref.member_id)
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


async def declare_availability(
    declaration: AvailabilityDeclaration,
    ports: AvailabilityWritePorts,
    *,
    today: date | None = None,
) -> AvailabilityDeclared:
    """One write path for a member's own entry and a coordinator's entry on
    their behalf, so the rules cannot drift between the two."""
    if declaration.ends_on < declaration.starts_on:
        raise AvailabilityRangeReversed(declaration.starts_on, declaration.ends_on)
    if (declaration.ends_on - declaration.starts_on).days > MAX_ENTRY_DAYS:
        raise AvailabilityRangeTooLong(declaration.starts_on, declaration.ends_on)
    member = await _resolve(declaration.member, declaration.actor, ports.team)
    on_behalf = member.user_id != declaration.actor.user_id
    if declaration.ends_on < (today or business_today()):
        raise AvailabilityInThePast(declaration.ends_on)
    overlapping = await ports.ledger.overlapping_entry(
        member.id, declaration.starts_on, declaration.ends_on
    )
    if overlapping is not None:
        if (
            overlapping.kind == declaration.kind
            and overlapping.starts_on == declaration.starts_on
            and overlapping.ends_on == declaration.ends_on
        ):
            raise AvailabilityAlreadyExists(overlapping.id)
        raise AvailabilityOverlaps(overlapping.id)
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


async def withdraw_availability(
    withdrawal: AvailabilityWithdrawal, ports: AvailabilityWritePorts
) -> None:
    member = await _resolve(withdrawal.member, withdrawal.actor, ports.team)
    entry = await ports.ledger.entry_to_withdraw(member.id, withdrawal.entry_id)
    if entry is None:
        raise AvailabilityEntryNotFound(withdrawal.entry_id)
    await ports.journal.withdrawn(
        member=member,
        entry=entry,
        on_behalf=member.user_id != withdrawal.actor.user_id,
    )
    await ports.ledger.remove(entry.id)
