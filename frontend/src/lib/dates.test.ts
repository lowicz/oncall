import { describe, expect, it } from 'vitest'
import { formatAuditTime, formatDate, formatDateLong, formatDay, formatDayShort, formatRange, formatShortDate, fourWeekRangeEnd, weeksBetween, weeksWord } from './dates'

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

describe('dates in running text', () => {
  it('names a day the way the screens do', () => {
    expect(formatShortDate('2026-10-03')).toBe('3 paź')
    expect(formatDayShort('2026-09-24')).toBe('czw 24 wrz')
    expect(formatDayShort('2026-10-04')).toBe('nd 4 paź')
    expect(formatDateLong('2026-09-20')).toBe('Niedziela, 20 września')
  })

  it('writes a range once per month and adds the year only across one', () => {
    expect(formatRange('2026-09-20', '2026-10-17')).toBe('20 wrz – 17 paź')
    expect(formatRange('2026-10-04', '2026-10-31')).toBe('4 – 31 paź')
    expect(formatRange('2026-12-20', '2027-01-03')).toBe('20 gru 2026 – 3 sty 2027')
  })

  it('counts and declines weeks', () => {
    expect(weeksBetween('2026-09-14', '2026-11-08')).toBe(8)
    expect(weeksBetween('2026-09-10', '2026-09-12')).toBe(1)
    expect(weeksWord(1)).toBe('1 tydzień')
    expect(weeksWord(4)).toBe('4 tygodnie')
    expect(weeksWord(8)).toBe('8 tygodni')
    expect(weeksWord(12)).toBe('12 tygodni')
    expect(weeksWord(22)).toBe('22 tygodnie')
  })
})
