import { describe, expect, it } from 'vitest'
import { SwapRequest, SwapStatus } from '../api'
import { canWithdraw, groupSwaps, needsMyDecision } from './swaps'

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
