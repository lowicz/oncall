import { AssignmentRole, AvailabilityKind, CalendarData } from '../api'
import { formatMonth, isMonday, monthsShort } from './dates'
import { messages } from '../i18n/messages'

/** Roles that must be staffed every single day. The 11-19 shift is working-days
 *  only (archive/docs/PLAN.md §3), so a missing one is not a coverage gap. */
export const REQUIRED_ROLES: AssignmentRole[] = ['primary', 'secondary']

export interface CoverageGap {
  service_date: string
  missing: AssignmentRole[]
}

export interface AvailabilityDutyConflict {
  member_id: string
  display_name: string
  service_date: string
  role: AssignmentRole
}

export function availabilityDutyConflicts(data: CalendarData): AvailabilityDutyConflict[] {
  const members = new Map(data.members.map((member) => [member.id, member.display_name]))
  const memberIds = new Map(data.members.map((member) => [member.display_name, member.id]))
  return data.assignments.flatMap((assignment) => {
    const member_id = assignment.member_id ?? memberIds.get(assignment.assignee_name)
    if (!member_id) return []
    const unavailable = data.availability.some(
      (entry) => entry.member_id === member_id
        && entry.kind === 'unavailable'
        && entry.starts_on <= assignment.service_date
        && entry.ends_on >= assignment.service_date,
    )
    const display_name = members.get(member_id)
    return unavailable && display_name
      ? [{
          member_id,
          display_name,
          service_date: assignment.service_date,
          role: assignment.role,
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

export function isCurrentAssignee(
  member: CalendarData['members'][number],
  assignment: CalendarData['assignments'][number] | undefined,
) {
  return Boolean(assignment && (
    assignment.member_id === member.id
    || (!assignment.member_id && assignment.assignee_name === member.display_name)
  ))
}

export interface StaffingCandidate {
  id: string
  display_name: string
  /** Already holds this exact (day, role) - the "change" would be a no-op. */
  isCurrent: boolean
  /** Undefined when the person can be moved into the slot. Otherwise the reason
   *  the option is disabled, worded so it can be shown next to the control. */
  disabledReason?: string
}

/**
 * Who the coordinator may assign to (`serviceDate`, `role`), built from the
 * calendar payload alone. The picker names a person explicitly instead of
 * deriving one from the clicked cell (MED6-03).
 *
 * This mirrors three of the four 422s `POST /calendar/override` raises. The
 * Eligibility windows are included for coordinators and administrators.
 */
export function staffingCandidates(
  data: CalendarData,
  serviceDate: string,
  role: AssignmentRole,
): StaffingCandidate[] {
  const opposite: AssignmentRole | null =
    role === 'primary' ? 'secondary' : role === 'secondary' ? 'primary' : null
  const current = data.assignments.find(
    (item) => item.service_date === serviceDate && item.role === role,
  )
  return data.members
    .filter((member) =>
      (!member.active_from || member.active_from <= serviceDate)
      && (!member.active_until || member.active_until >= serviceDate),
    )
    .map((member) => {
      const isCurrent = isCurrentAssignee(member, current)
      const unavailable = data.availability.some(
        (item) => item.member_id === member.id
          && item.kind === 'unavailable'
          && item.starts_on <= serviceDate
          && item.ends_on >= serviceDate,
      )
      const oppositeClash = opposite !== null && data.assignments.some(
        (item) => item.service_date === serviceDate
          && item.role === opposite
          && isCurrentAssignee(member, item),
      )
      const eligible = member.eligibility?.some(
        (item) => item.role === role && item.starts_on <= serviceDate
          && (!item.ends_on || item.ends_on >= serviceDate),
      ) ?? true
      let disabledReason: string | undefined
      const reasons = messages().calendar.disabledReasons
      if (isCurrent) disabledReason = reasons.alreadyHoldsRole
      else if (!eligible) disabledReason = reasons.notEligible
      else if (unavailable) disabledReason = reasons.unavailable
      else if (oppositeClash) disabledReason = reasons.otherOnCall
      return { id: member.id, display_name: member.display_name, isCurrent, disabledReason }
    })
    .sort((a, b) => {
      if (Boolean(a.disabledReason) !== Boolean(b.disabledReason)) {
        return a.disabledReason ? 1 : -1
      }
      return a.display_name.localeCompare(b.display_name, 'pl')
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
    const last = groups[groups.length - 1]
    if (last && last.key === key) {
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

/** Single letters keep a 44px column readable. The legend above the matrix and
 *  the cell's accessible name both spell them out. */
export const availabilityCodes: Record<AvailabilityKind, string> = {
  unavailable: 'N',
  prefer_not: 'W',
  prefer: 'C',
}

export const changeCodes = {
  swap: 'Z',
  manual_override: 'K',
} as const
