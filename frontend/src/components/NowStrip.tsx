import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AssignmentRole, api } from '../api'
import { roleLabels } from '../lib/labels'
import { coverageEnd, formatUntil } from '../lib/coverage'
import { phoneTextNational, telHref } from '../lib/phone'
import { locale, useMessages } from '../i18n'
import { RoleLabel, Skeleton, cx } from '../ui'
import { heldNumber, useForwardingNow } from '../hooks/useForwardingNow'
import { useBelowWide } from '../hooks/useMediaQuery'
import { NumberPill } from './NumberHandover'

const ROLES: AssignmentRole[] = ['primary', 'secondary', 'late_shift']

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
 * the network is gone. While forwarding is on, a pill beside one of them
 * says the on-call number rings there; below 1100 px it takes the slot's
 * second row.
 */
export function NowStrip({ children }: { children?: React.ReactNode }) {
  const schedule = useQuery({ queryKey: ['published-schedule'], queryFn: api.publishedSchedule })
  const t = useMessages().duty.nowStrip
  const now = useMinuteTick()
  const current = schedule.data?.current ?? []
  const noData = schedule.isError && schedule.data === undefined
  const stale = schedule.isError && schedule.data !== undefined
  const updated = schedule.dataUpdatedAt ? new Date(schedule.dataUpdatedAt) : null
  const dayOff = schedule.data?.today_is_day_off ?? false
  const holiday = schedule.data?.today_holiday_name ?? null
  const held = heldNumber(useForwardingNow().data)
  const handover = useMessages().duty.handover
  const belowWide = useBelowWide()
  // In the slot of the role holding the number, also when the slot names
  // the calendar day's person: before the reminder hour the number is still
  // with yesterday's pair.
  const slotPill = (role: AssignmentRole, name?: string) => held?.holder_role === role && (
    <>
      {belowWide && <span className="now-break" />}
      <NumberPill now={held} where={held.holder_name === name ? handover.pill : handover.at(held.holder_name)} />
    </>
  )

  return (
    <div className="now" role="region" aria-label={t.region}>
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
                  <a className="now-tel" href={telHref(duty.contact_phone)}>
                    {phoneTextNational(duty.contact_phone)}
                  </a>
                )}
                {slotPill(role, duty.assignee_name)}
                <span className={cx('now-until', stale && 'now-stale')} title={stale && updated ? t.asOf(updated.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })) : undefined}>
                  {stale && updated
                    ? t.asOfInline(updated.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }))
                    : formatUntil(coverageEnd(duty), now)}
                </span>
              </>
            ) : noData ? (
              <>
                <span className="now-who now-who-none now-stale">{t.noData}</span>
                <span className="now-until">{t.offline}</span>
              </>
            ) : (
              <>
                <span className={cx('now-who', notApplicable ? 'now-who-none' : 'now-gap')}>{notApplicable ? t.notApplicable : t.unstaffed}</span>
                {slotPill(role)}
                <span className="now-until">
                  {notApplicable ? (holiday ? t.holiday(holiday) : t.dayOff) : stale ? t.offline : ''}
                </span>
              </>
            )}
            <span className="sr-only">{roleLabels()[role]}</span>
          </div>
        )
      })}
      {children && <div className="now-tools">{children}</div>}
    </div>
  )
}
