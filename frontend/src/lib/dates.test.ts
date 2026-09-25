import { describe, expect, it } from 'vitest'
import { weekdays, weekdaysFromMonday, formatMoment, formatDate, formatDateLong, formatDay, formatDayShort, formatMonth, formatRange, formatShortDate, formatWeekday, fourWeekRangeEnd, isIsoDate, daysBetween, weeksBetween, weeksWord } from './dates'

describe('global date formatting', () => {
  it('formats API dates and timestamps as DD-MM-YYYY', () => {
    expect(formatDate('2026-09-03')).toBe('03-09-2026')
    expect(formatDate('2026-09-03T10:15:00Z')).toBe('03-09-2026')
  })

  it('uses the same order in calendar day labels', () => {
    expect(formatDay('2026-09-03')).toBe('czw 03-09-2026')
  })

  it('writes a timestamp with hyphens, in Warsaw time, without repeating the timezone', () => {
    expect(formatMoment('2026-09-03T10:15:00Z')).toBe('03-09-2026, 12:15')
    expect(formatMoment('2026-01-15T10:15:00Z')).toBe('15-01-2026, 11:15')
  })

  it('dates a moment just after midnight in Warsaw by the Warsaw day', () => {
    expect(formatMoment('2026-09-03T22:30:00Z')).toBe('04-09-2026, 00:30')
  })

  it('abbreviates every weekday with one set, the words the API sends', () => {
    expect(weekdays()).toEqual(['niedz', 'pon', 'wt', 'śr', 'czw', 'pt', 'sob'])
    expect(weekdaysFromMonday()).toEqual(['pon', 'wt', 'śr', 'czw', 'pt', 'sob', 'niedz'])
    const week = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']
    expect(week.map(formatWeekday)).toEqual(weekdaysFromMonday())
    // A day in running text and a day with its full date name the same weekday.
    for (const day of week) {
      expect(formatDayShort(day).split(' ')[0]).toBe(formatDay(day).split(' ')[0])
    }
    expect(formatDay('2026-10-05')).toBe('pon 05-10-2026')
    expect(formatDayShort('2026-11-09')).toBe('pon 9 lis')
    expect(formatDayShort('2026-10-03')).toBe('sob 3 paź')
  })

  it('names a month with or without its year', () => {
    expect(formatMonth('2026-08')).toBe('sierpień 2026')
    expect(formatMonth('2027-01', false)).toBe('styczeń')
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
    expect(formatDayShort('2026-10-04')).toBe('niedz 4 paź')
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
