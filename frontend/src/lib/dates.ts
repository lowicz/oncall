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

// The timezone used to be repeated on every row (QA7-L16); the audit screen
// now states it once in its own header and this only formats the moment.
export function formatAuditTime(value: string) {
  const time = new Date(value).toLocaleTimeString('pl-PL', {
    hour: '2-digit',
    minute: '2-digit',
  })
  return `${formatDate(value)}, ${time}`
}

const WEEKDAYS = ['niedz', 'pon', 'wt', 'śr', 'czw', 'pt', 'sob']

/** Parsed at midday UTC so a timezone shift can never move the calendar day. */
function parse(value: string) {
  return new Date(`${value}T12:00:00Z`)
}

/** "czw 14-09-2026" - a weekday plus the globally consistent date format. */
export function formatDay(value: string) {
  const date = parse(value)
  return `${WEEKDAYS[date.getUTCDay()]} ${formatDate(value)}`
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

const MONTHS_SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru']
const MONTHS_GENITIVE = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia']
const WEEKDAYS_SHORT = ['nd', 'pn', 'wt', 'śr', 'czw', 'pt', 'so']
const WEEKDAYS_LONG = ['Niedziela', 'Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota']

/** "3 paź" - a date in running text, the way the screens name days. */
export function formatShortDate(value: string) {
  const date = parse(value)
  return `${date.getUTCDate()} ${MONTHS_SHORT[date.getUTCMonth()]}`
}

/** "czw 24 wrz" - a day in running text: weekday, day, month. */
export function formatDayShort(value: string) {
  const date = parse(value)
  return `${WEEKDAYS_SHORT[date.getUTCDay()]} ${formatShortDate(value)}`
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
