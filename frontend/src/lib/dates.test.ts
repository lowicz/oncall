import { describe, expect, it } from 'vitest'
import { formatAuditTime, formatDate, formatDay, fourWeekRangeEnd } from './dates'

describe('global date formatting', () => {
  it('formats API dates and timestamps as DD-MM-YYYY', () => {
    expect(formatDate('2026-09-03')).toBe('03-09-2026')
    expect(formatDate('2026-09-03T10:15:00Z')).toBe('03-09-2026')
  })

  it('uses the same order in calendar day labels', () => {
    expect(formatDay('2026-09-03')).toBe('czw 03-09-2026')
  })

  it('uses hyphens in audit timestamps, without repeating the timezone (QA7-L16)', () => {
    expect(formatAuditTime('2026-09-03T10:15:00Z')).toMatch(/^03-09-2026, \d{2}:\d{2}$/)
  })
})

describe('four-week generator range', () => {
  it('contains exactly 28 days when starting on Monday', () => {
    expect(fourWeekRangeEnd('2026-09-07')).toBe('2026-10-04')
  })

  it('starts four complete weeks after a partial starting week', () => {
    expect(fourWeekRangeEnd('2026-09-08')).toBe('2026-10-11')
    expect(fourWeekRangeEnd('2026-09-13')).toBe('2026-10-11')
  })
})
