import { useQuery } from '@tanstack/react-query'
import { AssignmentRole, ForwardingNow, SwitchStatus, api } from '../api'

export const FORWARDING_NOW_KEY = ['forwarding-now']

/** Where the number rings while forwarding is on and somebody holds it. */
export type HeldNumber = ForwardingNow & { holder_name: string; holder_role: AssignmentRole; status: SwitchStatus }

/**
 * Where the on-call number rings now. Polled every few seconds while WCO has
 * not confirmed it yet, so the pill turns as soon as it does.
 */
export function useForwardingNow() {
  return useQuery({
    queryKey: FORWARDING_NOW_KEY,
    queryFn: api.forwardingNow,
    refetchInterval: (query) => (query.state.data?.status === 'switching' ? 5_000 : 60_000),
  })
}

/** Nothing while forwarding is off (D5) or there is nobody to forward to. */
export const heldNumber = (now: ForwardingNow | undefined): HeldNumber | null =>
  now?.holder_name && now.status ? (now as HeldNumber) : null
