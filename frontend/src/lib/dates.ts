export function warsawDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
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
