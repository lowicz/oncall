import { describe, expect, it } from 'vitest'
import { DraftSchedule } from '../api'
import { draftProblems } from './DraftProblems'

const draft = (over: Partial<DraftSchedule>): DraftSchedule => ({
  id: 'd1',
  name: 'Szkic 2026-09-17',
  starts_on: '2026-09-17',
  ends_on: '2026-09-18',
  status: 'draft',
  version: 1,
  rotation_mode: 'hybrid',
  solver_status: 'OPTIMAL',
  acceptance_floor: null,
  assignments: [],
  ...over,
})

const detail = (result: DraftSchedule, kind: string) =>
  draftProblems(result).find((problem) => problem.kind === kind)?.detail

describe('draftProblems', () => {
  it.each([
    [1, 'od wygenerowania zmienił się 1 wpis'],
    [3, 'od wygenerowania zmieniły się 3 wpisy'],
    [5, 'od wygenerowania zmieniło się 5 wpisów'],
  ])('words %i stale changes with the verb agreeing', (count, text) => {
    expect(detail(draft({ stale_changes_count: count }), 'stale')).toBe(text)
  })

  it('has no stale row when nothing changed since generation', () => {
    expect(detail(draft({ stale_changes_count: 0 }), 'stale')).toBeUndefined()
  })

  it.each([
    [['2026-09-16'], '1 nieobsadzony dzień: 16-09-2026'],
    [['2026-09-15', '2026-09-16'], '2 nieobsadzone dni: 15-09-2026, 16-09-2026'],
  ])('words the uncovered days before the draft by count', (days, text) => {
    expect(detail(draft({ uncovered_before: days }), 'gap')).toBe(text)
  })
})
