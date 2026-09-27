import { describe, expect, it } from 'vitest'
import { isMonday, isoWeek, monthFromName, relativeDay, warsawDate, weekdays, weekdaysFromMonday, formatMoment, formatDate, formatDateLong, formatDay, formatDayShort, formatMonth, formatRange, formatShortDate, formatWeekday, fourWeekRangeEnd, isIsoDate, daysBetween, weeksBetween, weeksWord } from './dates'

describe('global date formatting', () => {
  it('formats API dates and timestamps as DD-MM-YYYY', () => {
    expect(formatDate('2026-09-03')).toBe('03-09-2026')
    expect(formatDate('2026-09-03T10:15:00Z')).toBe('03-09-2026')
  })

  it('shows a value that is not a date as it came', () => {
    expect(formatDate('wkrótce')).toBe('wkrótce')
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

describe('today in Warsaw', () => {
  it('is the Warsaw calendar day of the pinned clock', () => {
    // setup.ts pins the clock to 10-09-2026, 09:00 in Warsaw.
    expect(warsawDate()).toBe('2026-09-10')
  })
})

describe('relativeDay', () => {
  it('names the distance from a given day', () => {
    expect(relativeDay('2026-09-10', '2026-09-10')).toBe('dziś')
    expect(relativeDay('2026-09-11', '2026-09-10')).toBe('jutro')
    expect(relativeDay('2026-09-09', '2026-09-10')).toBe('wczoraj')
    expect(relativeDay('2026-09-15', '2026-09-10')).toBe('za 5 dni')
    expect(relativeDay('2026-09-07', '2026-09-10')).toBe('3 dni temu')
  })

  it('counts from today in Warsaw by default', () => {
    expect(relativeDay('2026-09-12')).toBe('za 2 dni')
  })
})

describe('monthFromName', () => {
  it('reads a month typed in either language, abbreviated or in full', () => {
    expect(monthFromName('wrz')).toBe(9)
    expect(monthFromName('Września')).toBe(9)
    expect(monthFromName('paź')).toBe(10)
    expect(monthFromName('sep')).toBe(9)
    expect(monthFromName('September')).toBe(9)
    expect(monthFromName('may')).toBe(5)
  })

  it('reads a month in the case used inside a date', () => {
    expect(monthFromName('lipca')).toBe(7)
    expect(monthFromName('stycznia')).toBe(1)
  })

  it('is null for words that name no month', () => {
    expect(monthFromName('xyz')).toBeNull()
    expect(monthFromName('')).toBeNull()
  })
})

describe('isoWeek', () => {
  it('numbers weeks from Monday, the first holding a Thursday', () => {
    expect(isoWeek('2026-09-10')).toBe(37)
    // A Sunday belongs to the week that began on the Monday before it.
    expect(isoWeek('2026-09-13')).toBe(37)
    expect(isoWeek('2026-09-14')).toBe(38)
    // 1 January 2027 is a Friday, so it closes week 53 of 2026.
    expect(isoWeek('2027-01-01')).toBe(53)
    expect(isoWeek('2025-12-29')).toBe(1)
  })

  it('counts every week of a year that begins on a Friday', () => {
    // 2027 opens on a Friday: its Thursdays fall on day 7, 14, ... of the
    // year, where a count from a midday date overshoots by one week.
    expect(isoWeek('2027-01-04')).toBe(1)
    expect(isoWeek('2027-01-10')).toBe(1)
    expect(isoWeek('2027-03-15')).toBe(11)
    expect(isoWeek('2027-12-31')).toBe(52)
    expect(isoWeek('2021-01-04')).toBe(1)
  })
})

describe('isMonday', () => {
  it('is true only for a Monday', () => {
    expect(isMonday('2026-09-14')).toBe(true)
    expect(isMonday('2026-09-13')).toBe(false)
    expect(isMonday('2026-09-15')).toBe(false)
  })
})
