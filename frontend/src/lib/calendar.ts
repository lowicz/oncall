import { Assignment, AssignmentRole, AvailabilityKind, CalendarData, LateShiftAnchor } from '../api'
import { formatMonth, isMonday, monthsShort } from './dates'
import { messages } from '../i18n/messages'

/** Roles that must be staffed every single day. The 11-19 shift is working-days
 *  only (archive/docs/PLAN.md §3), so a missing one is not a coverage gap. */
export const REQUIRED_ROLES: AssignmentRole[] = ['primary', 'secondary']

const ALL_ROLES: AssignmentRole[] = ['primary', 'secondary', 'late_shift']

/** Who holds what over some days, with the team and its availability: the
 *  published calendar, or a draft's assignments over the calendar's team. */
export interface Roster extends Pick<CalendarData, 'days' | 'members' | 'availability'> {
  assignments: Array<Assignment & { member_id?: string | null }>
}
type Slot = Roster['assignments'][number]

/** `items` grouped under `key`, each group in the original order: what a grid
 *  reads per cell, built once per payload instead of a `filter` per cell. */
export function groupByKey<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const group = groups.get(key(item))
    if (group) group.push(item)
    else groups.set(key(item), [item])
  }
  return groups
}

/** The availability entry covering each person's day among `days`, keyed
 *  `member_id|service_date` (a person's entries never overlap). */
export function availabilityByDay<T extends { member_id: string; starts_on: string; ends_on: string }>(
  entries: readonly T[],
  days: readonly { service_date: string }[],
): Map<string, T> {
  const byDay = new Map<string, T>()
  for (const entry of entries) {
    for (const { service_date } of days) {
      if (entry.starts_on <= service_date && entry.ends_on >= service_date) byDay.set(`${entry.member_id}|${service_date}`, entry)
    }
  }
  return byDay
}

export interface CoverageGap {
  service_date: string
  missing: AssignmentRole[]
}

export interface AvailabilityDutyConflict {
  member_id: string
  display_name: string
  service_date: string
  role: AssignmentRole
  /** The reason the person gave, if any. */
  note: string | null
}

export function availabilityDutyConflicts(data: CalendarData): AvailabilityDutyConflict[] {
  const members = new Map(data.members.map((member) => [member.id, member.display_name]))
  const memberIds = new Map(data.members.map((member) => [member.display_name, member.id]))
  const unavailableOn = availabilityByDay(data.availability.filter((entry) => entry.kind === 'unavailable'), data.days)
  return data.assignments.flatMap((assignment) => {
    const member_id = assignment.member_id ?? memberIds.get(assignment.assignee_name)
    if (!member_id) return []
    const unavailable = unavailableOn.get(`${member_id}|${assignment.service_date}`)
    const display_name = members.get(member_id)
    return unavailable && display_name
      ? [{
          member_id,
          display_name,
          service_date: assignment.service_date,
          role: assignment.role,
          note: unavailable.note,
        }]
      : []
  })
}

/** Days where a required role has nobody assigned. Computed from the calendar
 *  payload the screen already fetches, so this needs no extra request. */
export function coverageGaps(data: CalendarData): CoverageGap[] {
  const members = new Map(data.members.map((member) => [member.id, member]))
  const staffed = new Set(data.assignments.filter((item) => {
    if (!item.member_id) return true
    const member = members.get(item.member_id)
    return Boolean(member
      && (!member.active_from || member.active_from <= item.service_date)
      && (!member.active_until || member.active_until >= item.service_date))
  }).map((item) => `${item.service_date}|${item.role}`))
  const gaps: CoverageGap[] = []
  for (const day of data.days) {
    const missing = REQUIRED_ROLES.filter(
      (role) => !staffed.has(`${day.service_date}|${role}`),
    )
    if (missing.length > 0) gaps.push({ service_date: day.service_date, missing })
  }
  return gaps
}

/** Rows in the order a reader actually scans them: yourself first, then whoever
 *  is on duty in this range, then the rest alphabetically. */
export function orderMembers(
  members: CalendarData['members'],
  assignments: CalendarData['assignments'],
  displayName: string,
) {
  const onDuty = new Set(assignments.map((item) => item.assignee_name))
  return [...members].sort((a, b) => {
    if (a.display_name === displayName) return -1
    if (b.display_name === displayName) return 1
    const aDuty = onDuty.has(a.display_name)
    const bDuty = onDuty.has(b.display_name)
    if (aDuty !== bDuty) return aDuty ? -1 : 1
    return a.display_name.localeCompare(b.display_name, 'pl')
  })
}

export function hasDutyInRange(
  member: CalendarData['members'][number],
  assignments: CalendarData['assignments'],
) {
  return assignments.some((item) => item.assignee_name === member.display_name)
}

/** Which of `orderMembers`' three groups a row belongs to (decision D10), so
 *  the matrix can caption them instead of leaving the order unexplained. */
export type MemberGroup = 'you' | 'on_duty' | 'rest'

export function memberGroup(
  member: CalendarData['members'][number],
  assignments: CalendarData['assignments'],
  displayName: string,
): MemberGroup {
  if (member.display_name === displayName) return 'you'
  return hasDutyInRange(member, assignments) ? 'on_duty' : 'rest'
}

export const memberGroupLabels = (): Record<Exclude<MemberGroup, 'you'>, string> => messages().calendar.memberGroups

/** Who holds `role` on `serviceDate`, if anybody. */
export function slotOf<T extends Slot>(data: { assignments: T[] }, serviceDate: string, role: AssignmentRole): T | undefined {
  return data.assignments.find((item) => item.service_date === serviceDate && item.role === role)
}

export function isCurrentAssignee(
  member: CalendarData['members'][number],
  assignment: Slot | undefined,
) {
  return Boolean(assignment && (
    assignment.member_id === member.id
    || (!assignment.member_id && assignment.assignee_name === member.display_name)
  ))
}

/** An eligibility window for `role` covers the day; a member listed without
 *  windows (as a member's own payload has them) counts as eligible. */
function isEligible(member: CalendarData['members'][number], role: AssignmentRole, serviceDate: string) {
  return member.eligibility?.some(
    (item) => item.role === role && item.starts_on <= serviceDate
      && (!item.ends_on || item.ends_on >= serviceDate),
  ) ?? true
}

/** The member recorded an unavailability covering the day. */
function isUnavailable(data: Pick<Roster, 'availability'>, memberId: string, serviceDate: string) {
  return data.availability.some(
    (item) => item.member_id === memberId
      && item.kind === 'unavailable'
      && item.starts_on <= serviceDate
      && item.ends_on >= serviceDate,
  )
}

export interface StaffingCandidate {
  id: string
  display_name: string
  /** Undefined when the person can be moved into the roles. Otherwise the
   *  reason the option is disabled, worded so it can be shown next to the
   *  control. */
  disabledReason?: string
  /** Of the roles asked for, the ones the person may not take that day:
   *  without the eligibility, or already theirs. Set only while they may take
   *  the rest, so the option stays and choosing it says what to change. */
  partial?: { notEligible: AssignmentRole[]; holds: AssignmentRole[] }
  /** The roles the person may hold that day; undefined when the payload
   *  carries no eligibility. */
  roles?: AssignmentRole[]
  /** What the person reported for that day, if anything. */
  availability?: AvailabilityKind
}

/** Whether two slots of a day have one holder: the identity, or the name on
 *  rows without one (`_same_holder` in the API). */
function sameHolder(a: Slot, b: Slot) {
  return b.member_id ? b.member_id === a.member_id : b.assignee_name === a.assignee_name
}

/**
 * Who the coordinator may assign to the `roles` of `serviceDate` in one
 * correction, built from the calendar payload alone. The picker names a
 * person explicitly instead of deriving one from the clicked cell (MED6-03).
 *
 * This mirrors the refusals of `POST /calendar/override/batch`: holding a
 * role already, missing its eligibility, an unavailability that day, the
 * other on-call role kept that day. Eligibility windows are included for
 * coordinators and administrators.
 */
export function staffingCandidates(
  data: Roster,
  serviceDate: string,
  roles: AssignmentRole[],
): StaffingCandidate[] {
  // A correction never holds both on-call roles, so the other one is kept.
  const kept = roles.flatMap((role): AssignmentRole[] =>
    role === 'primary' ? ['secondary'] : role === 'secondary' ? ['primary'] : [])
  const reasons = messages().calendar.disabledReasons
  return data.members
    .filter((member) =>
      (!member.active_from || member.active_from <= serviceDate)
      && (!member.active_until || member.active_until >= serviceDate),
    )
    .map((member) => {
      const availability = data.availability.find(
        (item) => item.member_id === member.id
          && item.starts_on <= serviceDate
          && item.ends_on >= serviceDate,
      )?.kind
      const holds = roles.filter((role) => isCurrentAssignee(member, slotOf(data, serviceDate, role)))
      const notEligible = roles.filter((role) => !holds.includes(role) && !isEligible(member, role, serviceDate))
      const takes = roles.length - holds.length - notEligible.length
      let disabledReason: string | undefined
      if (takes === 0) disabledReason = holds.length > 0 ? reasons.alreadyHoldsRole : reasons.notEligible
      else if (availability === 'unavailable') disabledReason = reasons.unavailable
      else if (kept.some((role) => isCurrentAssignee(member, slotOf(data, serviceDate, role)))) disabledReason = reasons.otherOnCall
      const partial = !disabledReason && takes < roles.length ? { notEligible, holds } : undefined
      return {
        id: member.id,
        display_name: member.display_name,
        disabledReason,
        partial,
        roles: member.eligibility && ALL_ROLES.filter((item) => isEligible(member, item, serviceDate)),
        availability,
      }
    })
    .sort((a, b) => {
      if (Boolean(a.disabledReason) !== Boolean(b.disabledReason)) {
        return a.disabledReason ? 1 : -1
      }
      return a.display_name.localeCompare(b.display_name, 'pl')
    })
}

/** How a working day's 11–19 stands to the policy's coupling: the anchor role
 *  it travels with, and whether that role's holder has it too. Null when the
 *  policy couples nothing, on a day off, or while either slot is empty. */
export interface LateShiftLink {
  anchor: 'primary' | 'secondary'
  coupled: boolean
  /** Who holds 11–19, and who holds the anchor role. */
  holder: string
  anchorHolder: string
}

export function lateShiftLink(data: Roster, serviceDate: string, anchor: LateShiftAnchor): LateShiftLink | null {
  const day = data.days.find((item) => item.service_date === serviceDate)
  if (anchor === 'independent' || !day || day.is_day_off) return null
  const late = slotOf(data, serviceDate, 'late_shift')
  const anchored = slotOf(data, serviceDate, anchor)
  if (!late || !anchored) return null
  return { anchor, coupled: sameHolder(anchored, late), holder: late.assignee_name, anchorHolder: anchored.assignee_name }
}

export type OnCall = 'primary' | 'secondary'

/** The roles a correction of a day changes, in the order the day reads them:
 *  the on-call role ticked, then 11–19. Without the coordinator's own choice
 *  (`lateChoice` null) 11–19 goes along exactly where the API would carry it:
 *  with its anchor role, from the person holding both. */
export function correctionRoles(onCall: OnCall | null, lateChoice: boolean | null, link: LateShiftLink | null) {
  const late = lateChoice ?? Boolean(link?.coupled && link.anchor === onCall)
  const roles: AssignmentRole[] = [...(onCall ? [onCall] : []), ...(late ? ['late_shift' as const] : [])]
  return { late, roles }
}

/** One slot a correction of a day's roles hands over: who has it now (null
 *  when nobody does) and the team member to give it back to on Undo. */
export interface StaffChange {
  role: AssignmentRole
  from: string | null
  /** Null when the slot cannot be handed back: empty, or its holder no
   *  team member, not eligible or unavailable that day. */
  restoreTo: string | null
}

/** What handing `roles` of `serviceDate` over would change, slot by slot, in
 *  the order of the roles. */
export function staffChanges(data: Roster, serviceDate: string, roles: AssignmentRole[]): StaffChange[] {
  return roles.map((role) => {
    const slot = slotOf(data, serviceDate, role)
    const holder = slot && data.members.find((member) => isCurrentAssignee(member, slot))
    const restorable = holder && isEligible(holder, role, serviceDate) && !isUnavailable(data, holder.id, serviceDate)
    return { role, from: slot?.assignee_name ?? null, restoreTo: restorable ? holder.id : null }
  })
}

export interface MonthGroup {
  key: string
  label: string
  shortLabel: string
  span: number
}

/** Contiguous runs of days belonging to the same month, for the grouping header
 *  row. Without it the columns read as bare `09-03` with no year or month. */
export function monthGroups(days: CalendarData['days']): MonthGroup[] {
  const groups: MonthGroup[] = []
  for (const day of days) {
    const key = day.service_date.slice(0, 7)
    const last = groups.at(-1)
    if (last?.key === key) {
      last.span += 1
      continue
    }
    const [year, month] = key.split('-')
    groups.push({
      key,
      label: formatMonth(key),
      shortLabel: `${monthsShort()[Number(month) - 1]} ${year}`,
      span: 1,
    })
  }
  return groups
}

/** Monday starts a new week block; used to draw the week separators. */
export const startsWeek = (day: CalendarData['days'][number]) => isMonday(day.service_date)

export interface SwapHolder { id: string; name: string }

/** A day's PRIMARY and SECONDARY that two different people hold, ready to
 *  trade places (P6), and what 11–19 may do in the same move. */
export interface RoleSwap {
  primary: SwapHolder
  secondary: SwapHolder
  /** Why the new holder of an on-call role may not take it that day, as the
   *  API would refuse it: the swap cannot be made while any is set. */
  refused: Partial<Record<'primary' | 'secondary', 'notEligible' | 'unavailable'>>
  /** 11–19 is the anchor holder's and may go along with the anchor role:
   *  the coordinator's choice, offered exactly where the API would carry it
   *  in a single correction (`_couples_late_shift` with `_same_holder`).
   *  Null when 11–19 is not part of the swap at all. */
  lateShift: {
    anchor: 'primary' | 'secondary'
    from: SwapHolder
    to: SwapHolder
    /** The person taking the anchor role may hold 11–19 that day. */
    eligible: boolean
  } | null
}

/** The swap of `serviceDate`'s on-call pair, or null when one role is empty,
 *  one person holds both, or a holder is not a team member. */
export function roleSwapOf(data: Roster, serviceDate: string, anchor: LateShiftAnchor): RoleSwap | null {
  const memberOf = (role: AssignmentRole) => {
    const slot = slotOf(data, serviceDate, role)
    return slot && data.members.find((item) => isCurrentAssignee(item, slot))
  }
  const holder = (member: CalendarData['members'][number] | undefined): SwapHolder | null =>
    member ? { id: member.id, name: member.display_name } : null
  const primaryMember = memberOf('primary')
  const secondaryMember = memberOf('secondary')
  const primary = holder(primaryMember)
  const secondary = holder(secondaryMember)
  if (!primary || !secondary || primary.id === secondary.id) return null
  const refused: RoleSwap['refused'] = {}
  for (const [role, taker] of [['primary', secondaryMember!], ['secondary', primaryMember!]] as const) {
    if (!isEligible(taker, role, serviceDate)) refused[role] = 'notEligible'
    else if (isUnavailable(data, taker.id, serviceDate)) refused[role] = 'unavailable'
  }
  const late = holder(memberOf('late_shift'))
  const day = data.days.find((item) => item.service_date === serviceDate)
  let lateShift: RoleSwap['lateShift'] = null
  if (anchor !== 'independent' && day && !day.is_day_off && late) {
    const from = anchor === 'primary' ? primary : secondary
    const to = anchor === 'primary' ? secondary : primary
    if (late.id === from.id) {
      const member = data.members.find((item) => item.id === to.id)!
      lateShift = { anchor, from, to, eligible: isEligible(member, 'late_shift', serviceDate) }
    }
  }
  return { primary, secondary, refused, lateShift }
}

/** The batch that performs `swap` (or, with the roles' holders as they were,
 *  undoes it): each on-call role goes to the other person, and 11–19 rides
 *  on the anchor role's line when `withLateShift`. */
export function roleSwapLines(swap: RoleSwap, serviceDate: string, withLateShift: boolean) {
  return (['primary', 'secondary'] as const).map((role) => ({
    service_date: serviceDate,
    role,
    replacement_member_id: (role === 'primary' ? swap.secondary : swap.primary).id,
    with_late_shift: withLateShift && swap.lateShift?.anchor === role,
  }))
}

/** The draft correction that performs `swap` (or, `back`, undoes it): each
 *  on-call role to the other person, and 11–19 to the anchor role's new
 *  holder when it goes along. */
export function draftSwapLines(swap: RoleSwap, carry: boolean, back = false) {
  const [primary, secondary] = back ? [swap.primary, swap.secondary] : [swap.secondary, swap.primary]
  const late = carry && swap.lateShift ? [{ role: 'late_shift' as const, replacement_member_id: (back ? swap.lateShift.from : swap.lateShift.to).id }] : []
  return [
    { role: 'primary' as const, replacement_member_id: primary.id },
    { role: 'secondary' as const, replacement_member_id: secondary.id },
    ...late,
  ]
}

/** The role labels `memberId` holds of `swap`, before it (`after` false) or after it. */
export function swapRoles(swap: RoleSwap, memberId: string, carry: boolean, after: boolean) {
  const labels = messages().labels.roles
  const holdsPrimary = (swap.primary.id === memberId) !== after
  const roles = [labels[holdsPrimary ? 'primary' : 'secondary']]
  const late = swap.lateShift
  if (late && carry && (after ? late.to : late.from).id === memberId) roles.push(labels.late_shift)
  return roles
}

/** „Marek Nowak PRIMARY, Anna Kowalska SECONDARY i 11–19": who holds what
 *  after the swap, or before it, PRIMARY first. */
export function swapHolders(swap: RoleSwap, carry: boolean, after: boolean) {
  const t = messages().schedule.roleSwap
  return (after ? [swap.secondary, swap.primary] : [swap.primary, swap.secondary])
    .map((person) => t.holder(person.name, t.roles(swapRoles(swap, person.id, carry, after))))
    .join(', ')
}
