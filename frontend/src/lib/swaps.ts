import { SwapRequest, SwapStatus, UserRole } from '../api'

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
