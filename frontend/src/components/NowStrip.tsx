import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AssignmentRole, CurrentDuty, api } from '../api'
import { roleLabels } from '../lib/labels'
import { RoleLabel, Skeleton, cx } from '../ui'

const ROLES: AssignmentRole[] = ['primary', 'secondary', 'late_shift']
const WEEKDAYS = ['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'so']

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
  const when = `${WEEKDAYS[end.getDay()]} ${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`
  const minutes = Math.round((end.getTime() - now.getTime()) / 60_000)
  if (minutes <= 0) return `do ${when}`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  const left = hours > 0 ? `${hours} h ${rest} min` : `${rest} min`
  return `do ${when} · ${left}`
}

function useMinuteTick() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

/**
 * The strip at the top of every screen: who holds each role right now, how
 * to call them, and until when. It is the one thing an operator needs during
 * an incident, so it is always there and keeps the last known staffing when
 * the network is gone.
 */
export function NowStrip({ children }: { children?: React.ReactNode }) {
  const schedule = useQuery({ queryKey: ['published-schedule'], queryFn: api.publishedSchedule })
  const now = useMinuteTick()
  const current = schedule.data?.current ?? []
  const stale = schedule.isError && schedule.data !== undefined
  const updated = schedule.dataUpdatedAt ? new Date(schedule.dataUpdatedAt) : null
  const dayOff = schedule.data?.today_is_day_off ?? false
  const holiday = schedule.data?.today_holiday_name ?? null

  return (
    <div className="now" role="region" aria-label="Dyżur teraz">
      {ROLES.map((role) => {
        const duty = current.find((item) => item.role === role)
        const notApplicable = !duty && role === 'late_shift' && dayOff
        return (
          <div key={role} className="now-slot" data-role={role}>
            <RoleLabel role={role} />
            {schedule.isLoading ? (
              <>
                <Skeleton width={110} height={14} inline />
                <Skeleton width={100} height={12} inline className="now-until" />
              </>
            ) : duty ? (
              <>
                <span className="now-who" title={duty.assignee_name}>{duty.assignee_name}</span>
                {duty.contact_phone && (
                  <a className="now-tel" href={`tel:${duty.contact_phone.replace(/\s+/g, '')}`}>
                    {duty.contact_phone}
                  </a>
                )}
                <span className={cx('now-until', stale && 'now-stale')} title={stale && updated ? `Stan z ${updated.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}` : undefined}>
                  {stale && updated
                    ? `stan z ${updated.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}`
                    : formatUntil(coverageEnd(duty), now)}
                </span>
              </>
            ) : (
              <>
                <span className="now-who now-who-none">{notApplicable ? 'nie dotyczy' : 'brak obsady'}</span>
                <span className="now-until">
                  {notApplicable ? (holiday ? `święto · ${holiday}` : 'dzień wolny · 2X') : schedule.isError ? 'brak połączenia' : ''}
                </span>
              </>
            )}
            <span className="sr-only">{roleLabels[role]}</span>
          </div>
        )
      })}
      {children && <div className="now-tools">{children}</div>}
    </div>
  )
}
