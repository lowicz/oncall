import { pluralPl } from './plural'

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
 * Polish weekday abbreviations, Sunday first like `Date.getDay()`. The one set
 * every screen prints, and the same words the API sends as a day's `weekday`.
 */
export const WEEKDAYS = ['niedz', 'pon', 'wt', 'śr', 'czw', 'pt', 'sob'] as const

/** The same abbreviations Monday first, for the heads of a calendar grid. */
export const WEEKDAYS_FROM_MONDAY = [...WEEKDAYS.slice(1), WEEKDAYS[0]]

/** Parsed at midday UTC so a timezone shift can never move the calendar day. */
function parse(value: string) {
  return new Date(`${value}T12:00:00Z`)
}

/** "czw" - the weekday of a calendar date. */
export function formatWeekday(value: string) {
  return WEEKDAYS[parse(value).getUTCDay()]
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
  if (days === 0) return 'dziś'
  if (days === 1) return 'jutro'
  if (days === -1) return 'wczoraj'
  if (days > 1) return `za ${days} dni`
  return `${Math.abs(days)} dni temu`
}

const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień']
export const MONTHS_SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru']
const MONTHS_GENITIVE = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia']
const WEEKDAYS_LONG = ['Niedziela', 'Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota']

/** "3 paź" - a date in running text, the way the screens name days. */
export function formatShortDate(value: string) {
  const date = parse(value)
  return `${date.getUTCDate()} ${MONTHS_SHORT[date.getUTCMonth()]}`
}

/** "czw 24 wrz" - a day in running text: weekday, day, month. */
export function formatDayShort(value: string) {
  return `${formatWeekday(value)} ${formatShortDate(value)}`
}

/** "wrzesień 2026", or "wrzesień" - a month given as "2026-09". */
export function formatMonth(month: string, withYear = true) {
  const [year, index] = month.split('-').map(Number)
  return withYear ? `${MONTHS[index - 1]} ${year}` : MONTHS[index - 1]
}

/** "Niedziela, 20 września" - the title of the dashboard. */
export function formatDateLong(value: string) {
  const date = parse(value)
  return `${WEEKDAYS_LONG[date.getUTCDay()]}, ${date.getUTCDate()} ${MONTHS_GENITIVE[date.getUTCMonth()]}`
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
    return `${start.getUTCDate()} – ${end.getUTCDate()} ${MONTHS_SHORT[end.getUTCMonth()]}`
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
export const weeksWord = (count: number) => pluralPl(count, ['tydzień', 'tygodnie', 'tygodni'])

/** ISO-8601 week number of a calendar date (weeks start on Monday). */
export function isoWeek(value: string) {
  const date = parse(value)
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - day)
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1)
  return Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7)
}
