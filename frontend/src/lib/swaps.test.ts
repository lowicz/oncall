import { describe, expect, it } from 'vitest'
import { SwapRequest, SwapStatus } from '../api'
import { brokenRules, canWithdraw, defaultChoice, dutyDays, groupSwaps, isExpired, isLapsed, isOpen, movesOf, needsMyDecision } from './swaps'

const swap = (over: Partial<SwapRequest> & { id: string }): SwapRequest => ({
  schedule_id: 's1',
  service_date: '2026-09-14',
  role: 'primary',
  requester_name: 'Anna',
  replacement_name: 'Piotr',
  status: 'pending_replacement' as SwapStatus,
  note: null,
  decision_note: null,
  created_at: '2026-09-01T10:00:00Z',
  ...over,
})

describe('needsMyDecision', () => {
  it('waits on the nominated replacement first', () => {
    const item = swap({ id: '1', status: 'pending_replacement' })
    expect(needsMyDecision(item, { displayName: 'Piotr', role: 'member' })).toBe(true)
    expect(needsMyDecision(item, { displayName: 'Anna', role: 'member' })).toBe(false)
  })

  it('waits on any coordinator once the replacement accepted', () => {
    const item = swap({ id: '1', status: 'pending_coordinator' })
    expect(needsMyDecision(item, { displayName: 'Kto', role: 'coordinator' })).toBe(true)
    expect(needsMyDecision(item, { displayName: 'Kto', role: 'admin' })).toBe(true)
    expect(needsMyDecision(item, { displayName: 'Piotr', role: 'member' })).toBe(false)
  })

  it('never waits on anyone once resolved', () => {
    for (const status of ['approved', 'rejected', 'cancelled'] as SwapStatus[]) {
      expect(needsMyDecision(swap({ id: '1', status }), { displayName: 'Piotr', role: 'admin' }))
        .toBe(false)
    }
  })
})

describe('isExpired', () => {
  // The test clock stands on 10 September 2026.
  it('holds from the day after the duty, not on the day itself', () => {
    expect(isExpired(swap({ id: '1', service_date: '2026-09-10' }))).toBe(false)
    expect(isExpired(swap({ id: '1', service_date: '2026-09-09' }))).toBe(true)
  })

  it('reads every slot of both directions: an exchange is one decision', () => {
    const ahead = { service_date: '2026-09-14', role: 'primary' } as const
    const past = { service_date: '2026-09-08', role: 'secondary' } as const
    expect(isExpired(swap({ id: '1', slots: [ahead], return_slots: [ahead] }))).toBe(false)
    expect(isExpired(swap({ id: '1', slots: [ahead], return_slots: [past] }))).toBe(true)
    expect(isExpired(swap({ id: '1', slots: [past] }))).toBe(true)
  })

  it('closes a request past its day, whatever its status still says', () => {
    const viewer = { displayName: 'Piotr', role: 'admin' } as const
    const rule_violations = [{ rule: 'three_in_seven', message: 'Więcej niż 3 dyżury.', member_name: 'Piotr', days: ['2026-09-09'] }]
    for (const status of ['pending_replacement', 'pending_coordinator'] as SwapStatus[]) {
      const item = swap({ id: '1', status, service_date: '2026-09-09', rule_violations })
      expect(isOpen(item)).toBe(false)
      expect(isLapsed(item)).toBe(true)
      expect(isLapsed({ ...item, service_date: '2026-09-10' })).toBe(false)
      expect(isLapsed({ ...item, status: 'cancelled' })).toBe(false)
      // Nobody can decide on it or pull it back, so no count and no inbox keeps it.
      expect(needsMyDecision(item, viewer)).toBe(false)
      expect(canWithdraw(item, { displayName: 'Anna', role: 'member' })).toBe(false)
      expect(groupSwaps([item], viewer)).toEqual({ actionable: [], inProgress: [], resolved: [item] })
      expect(brokenRules(item)).toEqual([])
    }
  })
})

describe('brokenRules', () => {
  const rule_violations = [{ rule: 'three_in_seven', message: 'Więcej niż 3 dyżury.', member_name: 'Piotr', days: ['2026-09-14'] }]

  it('names the rules of a request still open or already in the schedule', () => {
    for (const status of ['pending_replacement', 'pending_coordinator', 'approved'] as SwapStatus[]) {
      expect(brokenRules(swap({ id: '1', status, rule_violations }))).toEqual(rule_violations)
    }
  })

  it('names none for a request that was turned down or withdrawn: it broke nothing', () => {
    for (const status of ['rejected', 'cancelled'] as SwapStatus[]) {
      expect(brokenRules(swap({ id: '1', status, rule_violations }))).toEqual([])
    }
  })

  it('names none when the API sends none', () => {
    expect(brokenRules(swap({ id: '1' }))).toEqual([])
  })
})

describe('canWithdraw', () => {
  it('lets the author pull back an open request', () => {
    expect(canWithdraw(swap({ id: '1' }), { displayName: 'Anna', role: 'member' })).toBe(true)
  })

  it('does not let anyone else withdraw it', () => {
    expect(canWithdraw(swap({ id: '1' }), { displayName: 'Piotr', role: 'admin' })).toBe(false)
  })

  it('does not reopen a settled request', () => {
    expect(canWithdraw(swap({ id: '1', status: 'approved' }), { displayName: 'Anna', role: 'member' }))
      .toBe(false)
  })
})

describe('groupSwaps', () => {
  it('separates what waits on you from what waits on others and what is done', () => {
    const items = [
      swap({ id: 'mine', status: 'pending_replacement', replacement_name: 'Piotr' }),
      swap({ id: 'theirs', status: 'pending_replacement', replacement_name: 'Ola' }),
      swap({ id: 'done', status: 'approved' }),
      swap({ id: 'gone', status: 'cancelled' }),
    ]
    const groups = groupSwaps(items, { displayName: 'Piotr', role: 'member' })
    expect(groups.actionable.map((i) => i.id)).toEqual(['mine'])
    expect(groups.inProgress.map((i) => i.id)).toEqual(['theirs'])
    expect(groups.resolved.map((i) => i.id)).toEqual(['done', 'gone'])
  })

  it('gives a coordinator every request awaiting approval', () => {
    const items = [
      swap({ id: 'a', status: 'pending_coordinator' }),
      swap({ id: 'b', status: 'pending_coordinator', requester_name: 'Ola' }),
      swap({ id: 'c', status: 'pending_replacement', replacement_name: 'Ktoś' }),
    ]
    const groups = groupSwaps(items, { displayName: 'Koordynator', role: 'coordinator' })
    expect(groups.actionable.map((i) => i.id)).toEqual(['a', 'b'])
    expect(groups.inProgress.map((i) => i.id)).toEqual(['c'])
  })

  it('returns empty buckets for an empty list', () => {
    expect(groupSwaps([], { displayName: 'Anna', role: 'member' }))
      .toEqual({ actionable: [], inProgress: [], resolved: [] })
  })
})

describe('dutyDays', () => {
  it('lists each coming day once, with every role held that day, the on-call role first', () => {
    const held = (service_date: string, role: 'primary' | 'secondary' | 'late_shift', assignee_name = 'Anna') =>
      ({ service_date, role, assignee_name })
    expect(dutyDays([
      held('2026-09-09', 'primary'),
      held('2026-09-14', 'late_shift'),
      held('2026-09-14', 'secondary'),
      held('2026-09-14', 'primary', 'Piotr'),
      held('2026-09-19', 'primary'),
    ], 'Anna', '2026-09-10')).toEqual([
      { service_date: '2026-09-14', roles: ['secondary', 'late_shift'] },
      { service_date: '2026-09-19', roles: ['primary'] },
    ])
  })
})

describe('defaultChoice', () => {
  it.each(['secondary', 'primary'] as const)('gives the pair the %s anchor binds whole', (anchor) => {
    expect(defaultChoice([anchor, 'late_shift'], anchor, 'late_shift')).toBe('whole')
  })

  it('gives two slots nothing binds one at a time, the one the link names first', () => {
    expect(defaultChoice(['primary', 'late_shift'], 'secondary', null)).toBe('primary')
    expect(defaultChoice(['primary', 'late_shift'], 'secondary', 'late_shift')).toBe('late_shift')
    expect(defaultChoice(['secondary', 'late_shift'], 'independent', 'secondary')).toBe('secondary')
  })

  it('gives the one role of a day that has one', () => {
    expect(defaultChoice(['secondary'], 'secondary', 'primary')).toBe('secondary')
  })
})

describe('movesOf', () => {
  it('reads either direction of a stored request as the whole duty when it moves both slots of its day', () => {
    expect(movesOf(swap({
      id: '1',
      slots: [{ service_date: '2026-09-14', role: 'primary' }, { service_date: '2026-09-14', role: 'late_shift' }],
      return_slots: [{ service_date: '2026-09-16', role: 'late_shift' }, { service_date: '2026-09-16', role: 'secondary' }],
    }))).toEqual({ inReturn: { service_date: '2026-09-16', role: 'late_shift' }, scope: 'whole', returnScope: 'whole' })
    expect(movesOf(swap({
      id: '2',
      slots: [{ service_date: '2026-09-14', role: 'late_shift' }],
      return_slots: [{ service_date: '2026-09-16', role: 'late_shift' }],
    }))).toEqual({ inReturn: { service_date: '2026-09-16', role: 'late_shift' }, scope: 'single', returnScope: 'single' })
  })

  it('asks nothing of a day in return that a one-way request does not take', () => {
    expect(movesOf(swap({ id: '3' }))).toEqual({ inReturn: undefined, scope: 'single', returnScope: undefined })
  })
})
