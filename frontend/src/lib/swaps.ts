import { AssignmentRole, RuleViolation, SwapRequest, SwapSlot, SwapStatus, UserRole, api } from '../api'
import { formatDayShort } from './dates'
import { roleLabels } from './labels'

export const OPEN_STATUSES: SwapStatus[] = ['pending_replacement', 'pending_coordinator']

export interface SwapViewer {
  displayName: string
  role: UserRole
}

export const canCoordinate = (role: UserRole) => role === 'coordinator' || role === 'admin'

/** True when this request is waiting on *this* person specifically. */
export function needsMyDecision(item: SwapRequest, viewer: SwapViewer) {
  if (item.status === 'pending_replacement') return item.replacement_name === viewer.displayName
  if (item.status === 'pending_coordinator') return canCoordinate(viewer.role)
  return false
}

export const isOpen = (item: SwapRequest) => OPEN_STATUSES.includes(item.status)

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
