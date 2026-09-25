import { LANGUAGES } from '../i18n/language'
import { messages } from '../i18n/messages'

export function warsawDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/**
 * Whether a value is a calendar date written as YYYY-MM-DD. The shape alone
 * is not enough: 2026-13-45 matches it but is not a day, and 2026-02-30
 * would silently roll over into March.
 */
export function isIsoDate(value: string | null): value is string {
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = parse(value)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function addDays(value: string, days: number) {
  const result = new Date(`${value}T12:00:00Z`)
  result.setUTCDate(result.getUTCDate() + days)
  return result.toISOString().slice(0, 10)
}

/** Sunday ending four full Monday-Sunday weeks after the starting week. */
export function fourWeekRangeEnd(value: string) {
  const start = new Date(`${value}T12:00:00Z`)
  const mondayBasedWeekday = (start.getUTCDay() + 6) % 7
  const daysToNextMonday = mondayBasedWeekday === 0 ? 0 : 7 - mondayBasedWeekday
  return addDays(value, daysToNextMonday + 27)
}

/** Format an API date (or timestamp) consistently as DD-MM-YYYY. */
export function formatDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return value
  return `${match[3]}-${match[2]}-${match[1]}`
}

/**
 * A timestamp as "DD-MM-YYYY, HH:MM" in Europe/Warsaw, the day and the time
 * both, so a moment just after midnight there is not dated the day before.
 * Screens state the timezone once, in their own header or hint.
 */
export function formatMoment(value: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value)).map(({ type, value: part }) => [type, part]))
  return `${parts.day}-${parts.month}-${parts.year}, ${parts.hour}:${parts.minute}`
}

/**
 * Weekday abbreviations in the current language, Sunday first like
 * `Date.getDay()`. The one set every screen prints; in Polish they are the
 * same words the API sends as a day's `weekday`.
 */
export const weekdays = () => messages().dates.weekdaysShort

/** The same abbreviations Monday first, for the heads of a calendar grid. */
export const weekdaysFromMonday = () => {
  const names = weekdays()
  return [...names.slice(1), names[0]]
}

/** Whether a calendar date is a Monday, which is where every grid starts a week. */
export const isMonday = (value: string) => parse(value).getUTCDay() === 1

/** Parsed at midday UTC so a timezone shift can never move the calendar day. */
function parse(value: string) {
  return new Date(`${value}T12:00:00Z`)
}

/** "czw" - the weekday of a calendar date. */
export function formatWeekday(value: string) {
  return weekdays()[parse(value).getUTCDay()]
}

/** "czw 14-09-2026" - a weekday plus the globally consistent date format. */
export function formatDay(value: string) {
  return `${formatWeekday(value)} ${formatDate(value)}`
}

/** Plain-language distance from today, for choosing between upcoming duties. */
export function relativeDay(value: string, from = warsawDate()) {
  const days = Math.round(
    (parse(value).getTime() - parse(from).getTime()) / 86_400_000,
  )
  const t = messages().dates
  if (days === 0) return t.today
  if (days === 1) return t.tomorrow
  if (days === -1) return t.yesterday
  if (days > 1) return t.inDays(days)
  return t.daysAgo(Math.abs(days))
}

/** Month abbreviations in the current language, January first. */
export const monthsShort = () => messages().dates.monthsShort

/**
 * The month (1-12) a typed-in name means, in any language the interface
 * speaks: "wrz", "września", "sep" and "september" all give 9, because the
 * first three letters name a month in every one of them. Null when they do
 * not.
 */
export function monthFromName(name: string): number | null {
  const typed = name.toLowerCase()
  for (const language of LANGUAGES) {
    const t = messages(language).dates
    for (const set of [t.monthsShort, t.months, t.monthsInDate]) {
      const index = set.findIndex((month) => month.toLowerCase().slice(0, 3) === typed.slice(0, 3))
      if (index >= 0) return index + 1
    }
  }
  return null
}

/** "3 paź" - a date in running text, the way the screens name days. */
export function formatShortDate(value: string) {
  const date = parse(value)
  return `${date.getUTCDate()} ${monthsShort()[date.getUTCMonth()]}`
}

/** "czw 24 wrz" - a day in running text: weekday, day, month. */
export function formatDayShort(value: string) {
  return `${formatWeekday(value)} ${formatShortDate(value)}`
}

/** "wrzesień 2026", or "wrzesień" - a month given as "2026-09". */
export function formatMonth(month: string, withYear = true) {
  const [year, index] = month.split('-').map(Number)
  const name = messages().dates.months[index - 1]
  return withYear ? `${name} ${year}` : name
}

/** "Niedziela, 20 września" - the title of the dashboard. */
export function formatDateLong(value: string) {
  const date = parse(value)
  const t = messages().dates
  return `${t.weekdaysLong[date.getUTCDay()]}, ${date.getUTCDate()} ${t.monthsInDate[date.getUTCMonth()]}`
}

/**
 * "20 wrz – 17 paź", "4 – 31 paź" inside one month, and the year only when
 * the range crosses one ("20 gru 2026 – 3 sty 2027").
 */
export function formatRange(startsOn: string, endsOn: string) {
  const start = parse(startsOn)
  const end = parse(endsOn)
  if (start.getUTCFullYear() !== end.getUTCFullYear()) {
    return `${formatShortDate(startsOn)} ${start.getUTCFullYear()} – ${formatShortDate(endsOn)} ${end.getUTCFullYear()}`
  }
  if (start.getUTCMonth() === end.getUTCMonth()) {
    return `${start.getUTCDate()} – ${end.getUTCDate()} ${monthsShort()[end.getUTCMonth()]}`
  }
  return `${formatShortDate(startsOn)} – ${formatShortDate(endsOn)}`
}

/** Calendar days from one date to another: 0 for the same day, negative backwards. */
export function daysBetween(from: string, to: string) {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000)
}

/** Whole weeks between two inclusive dates, for "4 tygodnie" in a heading. */
export function weeksBetween(startsOn: string, endsOn: string) {
  return Math.max(1, Math.round((daysBetween(startsOn, endsOn) + 1) / 7))
}

/** "4 tygodnie", "8 tygodni", "1 tydzień". */
export const weeksWord = (count: number) => messages().dates.weeks(count)

/** ISO-8601 week number of a calendar date (weeks start on Monday). */
export function isoWeek(value: string) {
  const date = parse(value)
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - day)
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1)
  return Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7)
}
