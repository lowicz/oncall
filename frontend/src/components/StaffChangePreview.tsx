import { useQuery } from '@tanstack/react-query'
import { AssignmentRole, BatchOverrideLine, api } from '../api'
import { useMessages } from '../i18n'
import { LateShiftLink, StaffChange } from '../lib/calendar'
import { formatDate, formatDay } from '../lib/dates'
import { roleLabels } from '../lib/labels'
import { InlineError, LoadingBlock, RoleMark } from '../ui'
import { ImpactSide } from './SwapImpactPreview'

/** The change slot by slot: who has each role now and who takes it, and what
 *  a moved 11–19 does to the policy's coupling. */
export function StaffChangePreview({ changes, name, onCall, link }: Readonly<{
  changes: StaffChange[]
  name: string
  onCall: AssignmentRole | null
  link: LateShiftLink | null
}>) {
  const t = useMessages().schedule.staffChange
  // 11–19 goes to the person taking its anchor role: with it, or back to it.
  const anchored = link && onCall === link.anchor ? link : null
  return (
    <div className="swap-preview">
      {changes.map((change) => (
        <div key={change.role} className="swap-preview-row">
          <RoleMark role={change.role} />
          <div className="swap-cell">
            <span>{change.from ?? t.unstaffed} → <b>{name}</b></span>
            {change.role === 'late_shift' && anchored && (
              <small className="muted">
                {anchored.coupled ? t.carries(roleLabels()[anchored.anchor]) : t.restores(roleLabels()[anchored.anchor])}
              </small>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Everybody's balance after the change: the person taking the roles, then
 *  each person giving one up. */
export function StaffChangeImpact({ scheduleId, lines, changes, name }: Readonly<{
  scheduleId: string
  lines: BatchOverrideLine[]
  changes: StaffChange[]
  name: string
}>) {
  const { swaps, schedule } = useMessages()
  const t = swaps.impact
  const s = schedule.staffChange
  const impact = useQuery({
    queryKey: ['staff-change-impact', scheduleId, lines],
    queryFn: () => api.batchOverrideImpact({ schedule_id: scheduleId, assignments: lines }),
  })
  if (!impact.data) return impact.error ? <InlineError error={impact.error} /> : <LoadingBlock label={t.loading} rows={2} />

  const roles = (items: StaffChange[]) => s.roleList(items.map((item) => roleLabels()[item.role]))
  const direction = (member: string) =>
    member === name ? s.takes(roles(changes)) : s.gives(roles(changes.filter((item) => item.from === member)))
  const { service_date: day, points } = impact.data
  return (
    <div className="impact" aria-label={t.heading}>
      <div className="impact-h">{t.heading}</div>
      <div className="small muted">
        {t.dayWorth(formatDay(day), points === 2 ? t.twoPoints : t.onePoint)}
        {' '}{t.window(formatDate(impact.data.window_start), formatDate(impact.data.window_end))}
      </div>
      {impact.data.members.map((member) => (
        <ImpactSide key={member.member_id} side={member} direction={direction(member.display_name)} />
      ))}
      {changes.every((item) => item.from === null) && (
        <div className="muted small">{schedule.confirm.emptySlot(name)}</div>
      )}
    </div>
  )
}
