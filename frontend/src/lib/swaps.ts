import { AssignmentRole, LateShiftAnchor, RuleViolation, SwapRequest, SwapScope, SwapSlot, SwapStatus, UserRole, api } from '../api'
import { formatDayShort, warsawDate } from './dates'
import { roleLabels } from './labels'

export const OPEN_STATUSES: SwapStatus[] = ['pending_replacement', 'pending_coordinator']

export interface SwapViewer {
  displayName: string
  role: UserRole
}

export const canCoordinate = (role: UserRole) => role === 'coordinator' || role === 'admin'

/** What the requester gives: the duty and the 11-19 that travels with it. */
export const slotsOf = (item: SwapRequest): SwapSlot[] => (item.slots?.length ? item.slots : [item])
/** What comes back in an exchange; nothing for a one-way hand-over. */
export const returnSlotsOf = (item: SwapRequest) => item.return_slots ?? []

/** True once a day of the request has passed, in either direction: nobody can decide on it any more. */
export const isExpired = (item: SwapRequest) =>
  [...slotsOf(item), ...returnSlotsOf(item)].some((slot) => slot.service_date < warsawDate())

/**
 * Still waiting for a decision somebody can give. A request past its day is
 * not, whatever its status says: the worker closes it within the hour, and
 * until then the screens already count and list it as closed.
 */
export const isOpen = (item: SwapRequest) => OPEN_STATUSES.includes(item.status) && !isExpired(item)

/** Past its day with nobody having decided: closed in all but its status, which the worker changes within the hour. */
export const isLapsed = (item: SwapRequest) => OPEN_STATUSES.includes(item.status) && isExpired(item)

/** True when this request is waiting on *this* person specifically. */
export function needsMyDecision(item: SwapRequest, viewer: SwapViewer) {
  if (!isOpen(item)) return false
  if (item.status === 'pending_replacement') return item.replacement_name === viewer.displayName
  return canCoordinate(viewer.role)
}

/**
 * The hard rules a request breaks: on the roster as it is now while it is
 * open, as acknowledged once it is in the schedule. A request turned down or
 * withdrawn broke nothing, whatever it was filed with.
 */
export const brokenRules = (item: SwapRequest): RuleViolation[] =>
  (isOpen(item) || item.status === 'approved' ? item.rule_violations ?? [] : [])

/** The duty an exchange takes back, by its headline slot; nothing for a one-way hand-over. */
export const returnOf = (item: SwapRequest): SwapSlot | undefined => item.return_slots?.[0]

/** "pon 14 wrz PRIMARY" - the day and role that name a duty in a title. */
export const dayRole = (slot: SwapSlot) => `${formatDayShort(slot.service_date)} ${roleLabels()[slot.role]}`

/** What names a request: its duty and, for an exchange, the one that comes back. */
export function swapHeadline(item: SwapRequest) {
  const returned = returnOf(item)
  return returned ? `${dayRole(item)} ⇄ ${dayRole(returned)}` : dayRole(item)
}

const scopeOf = (slots: SwapSlot[]): SwapScope => (slots.length > 1 ? 'whole' : 'single')

/** What a stored request moves, as the projection of its points asks for it. */
export function movesOf(item: SwapRequest) {
  const inReturn = returnOf(item)
  return { inReturn, scope: scopeOf(slotsOf(item)), returnScope: inReturn && scopeOf(returnSlotsOf(item)) }
}

/**
 * The projected balances of one move, as a query every place that shows them
 * shares. `inReturn` makes it an exchange; `scope` is what it gives of the
 * day and `returnScope` what it takes of the day in return; `correction`
 * makes it a coordinator's correction instead of a swap.
 */
export const swapImpactQuery = (
  serviceDate: string,
  role: AssignmentRole,
  replacementId: string,
  { inReturn, scope, returnScope, correction = false }: {
    inReturn?: SwapSlot
    scope?: SwapScope
    returnScope?: SwapScope
    correction?: boolean
  } = {},
) => ({
  queryKey: ['swap-impact', serviceDate, role, replacementId, inReturn?.service_date, inReturn?.role, scope, returnScope, correction],
  queryFn: () => api.swapImpact(serviceDate, role, replacementId, { inReturn, scope, returnScope, correction }),
})

/** What the form gives of a day: the whole duty, or one of its roles. */
export type SwapChoice = 'whole' | AssignmentRole

const ROLE_ORDER: AssignmentRole[] = ['primary', 'secondary', 'late_shift']

/** One day of the person's duties, with every role held that day, the on-call role first. */
export interface DutyDay {
  service_date: string
  roles: AssignmentRole[]
}

/** The person's published duties from `from` on, one entry per day. */
export function dutyDays(
  assignments: { service_date: string; role: AssignmentRole; assignee_name: string }[],
  displayName: string,
  from: string,
): DutyDay[] {
  const held = new Map<string, AssignmentRole[]>()
  for (const item of assignments) {
    if (item.assignee_name === displayName && item.service_date >= from) {
      held.set(item.service_date, [...(held.get(item.service_date) ?? []), item.role])
    }
  }
  return [...held].map(([service_date, roles]) => ({ service_date, roles: ROLE_ORDER.filter((role) => roles.includes(role)) }))
}

/**
 * What the form gives of a day until the person picks otherwise: what a
 * request moved before it could say. The pair the 11-19 anchor binds goes
 * whole; two slots nothing binds go one at a time, the one the person came
 * with first.
 */
export function defaultChoice(roles: AssignmentRole[], anchor: LateShiftAnchor, linked: string | null): SwapChoice {
  if (roles.length > 1 && roles[0] === anchor) return 'whole'
  return roles.find((role) => role === linked) ?? roles[0]
}

export interface SwapGroups {
  actionable: SwapRequest[]
  inProgress: SwapRequest[]
  resolved: SwapRequest[]
}

/**
 * Three buckets instead of one flat list.
 *
 * A single chronological list mixed requests needing a decision with ones
 * settled months ago, and nothing told a coordinator that anything was waiting.
 */
export function groupSwaps(items: SwapRequest[], viewer: SwapViewer): SwapGroups {
  const groups: SwapGroups = { actionable: [], inProgress: [], resolved: [] }
  for (const item of items) {
    if (!isOpen(item)) groups.resolved.push(item)
    else if (needsMyDecision(item, viewer)) groups.actionable.push(item)
    else groups.inProgress.push(item)
  }
  return groups
}

/** The requester may pull a request back until it is decided. */
export const canWithdraw = (item: SwapRequest, viewer: SwapViewer) =>
  isOpen(item) && item.requester_name === viewer.displayName
