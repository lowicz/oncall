import { AssignmentRole, CurrentDuty } from '../api'
import { weekdays } from './dates'
import { messages } from '../i18n/messages'

/** When the coverage ends as a local Date, given the duty's day and window. */
export function coverageEnd(duty: CurrentDuty): Date | null {
  if (duty.is_day_off) {
    const end = new Date(`${duty.service_date}T00:00:00`)
    end.setDate(end.getDate() + 1)
    return end
  }
  const [startHour] = duty.coverage_starts_at.split(':').map(Number)
  const [endHour, endMinute = 0] = duty.coverage_ends_at.split(':').map(Number)
  if (Number.isNaN(startHour) || Number.isNaN(endHour)) return null
  const end = new Date(`${duty.service_date}T00:00:00`)
  end.setHours(endHour, endMinute, 0, 0)
  // A window ending before it starts (19:00 to 09:00) ends the next day.
  if (endHour <= startHour) end.setDate(end.getDate() + 1)
  return end
}

/** "do wt 09:00 · 14 h 12 min", or only the end when it is already past. */
export function formatUntil(end: Date | null, now: Date): string {
  if (!end) return ''
  const t = messages().duty.nowStrip
  const when = `${weekdays()[end.getDay()]} ${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`
  const minutes = Math.round((end.getTime() - now.getTime()) / 60_000)
  if (minutes <= 0) return t.until(when)
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  const left = hours > 0 ? t.hoursMinutes(hours, rest) : t.minutes(rest)
  return t.untilWithLeft(when, left)
}

/** Clock window of a duty, mirroring backend coverage.py (PLAN.md §3). */
export function coverageWindowText(day: { is_day_off: boolean }, role: AssignmentRole): string {
  if (role === 'late_shift') return '11:00–19:00'
  return day.is_day_off ? messages().schedule.allDay : '19:00–09:00'
}
