import { describe, expect, it } from 'vitest'
import { formatAuditTime, formatDate, formatDateLong, formatDay, formatDayShort, formatRange, formatShortDate, fourWeekRangeEnd, isIsoDate, daysBetween, weeksBetween, weeksWord } from './dates'

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

describe('dates from the address bar', () => {
  it('accepts only days that exist', () => {
    expect(isIsoDate('2026-09-10')).toBe(true)
    expect(isIsoDate('2028-02-29')).toBe(true)
    expect(isIsoDate('2026-13-45')).toBe(false)
    expect(isIsoDate('2026-02-30')).toBe(false)
    expect(isIsoDate('2026-02-29')).toBe(false)
    expect(isIsoDate('2026-9-10')).toBe(false)
    expect(isIsoDate('abc')).toBe(false)
    expect(isIsoDate(null)).toBe(false)
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
    expect(daysBetween('2026-09-10', '2026-09-10')).toBe(0)
    expect(daysBetween('2026-09-10', '2026-11-04')).toBe(55)
    expect(daysBetween('2026-03-31', '2026-03-28')).toBe(-3)
    expect(weeksBetween('2026-09-14', '2026-11-08')).toBe(8)
    expect(weeksBetween('2026-09-10', '2026-09-12')).toBe(1)
    expect(weeksWord(1)).toBe('1 tydzień')
    expect(weeksWord(4)).toBe('4 tygodnie')
    expect(weeksWord(8)).toBe('8 tygodni')
    expect(weeksWord(12)).toBe('12 tygodni')
    expect(weeksWord(22)).toBe('22 tygodnie')
  })
})
