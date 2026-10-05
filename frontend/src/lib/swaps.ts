import { AssignmentRole, RuleViolation, SwapRequest, SwapSlot, SwapStatus, UserRole, api } from '../api'
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

/**
 * The projected balances of one move, as a query every place that shows them
 * shares. `inReturn` makes it an exchange; `correction` a coordinator's
 * correction instead of a swap.
 */
export const swapImpactQuery = (serviceDate: string, role: AssignmentRole, replacementId: string, inReturn?: SwapSlot, correction = false) => ({
  queryKey: ['swap-impact', serviceDate, role, replacementId, inReturn?.service_date, inReturn?.role, correction],
  queryFn: () => api.swapImpact(serviceDate, role, replacementId, { inReturn, correction }),
})

/** The shortest reason a rule-breaking request may carry, as the API has it. */
export const RULE_BREAK_REASON_LENGTH = 10

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
