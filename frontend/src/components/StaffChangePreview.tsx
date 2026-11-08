import { useQuery } from '@tanstack/react-query'
import { AssignmentRole, BatchOverrideLine, api } from '../api'
import { messages, useMessages } from '../i18n'
import { LateShiftLink, OnCall, Roster, StaffChange, slotOf } from '../lib/calendar'
import { formatDate, formatDay } from '../lib/dates'
import { roleLabels } from '../lib/labels'
import { Checkbox, Fieldset, InlineError, LoadingBlock, RoleMark } from '../ui'
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
  const anchored = onCall === link?.anchor ? link : null
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

/** What the 11–19 row says about its slot, and why 11–19 is ticked or not,
 *  said only while its anchor role is changed. */
function lateTexts(
  data: Roster,
  serviceDate: string,
  link: LateShiftLink | null,
  onCall: OnCall | null,
  late: boolean,
) {
  const t = messages().schedule.staffChange
  const lateSlot = slotOf(data, serviceDate, 'late_shift')
  const anchorLabel = link && roleLabels()[link.anchor]
  let note = t.unstaffed
  if (link?.coupled) note = t.withAnchor(anchorLabel!)
  else if (lateSlot) note = t.heldBy(lateSlot.assignee_name)
  let hint: string | undefined
  if (onCall === link?.anchor) {
    if (late) hint = link.coupled ? t.lateByPolicy(link.holder, anchorLabel!) : t.lateByYou(anchorLabel!, link.anchorHolder)
    else if (link.coupled) hint = t.lateStays(link.holder)
  }
  return { note, hint }
}

/** „Role do zmiany": the roles of one day a correction changes, PRIMARY and
 *  SECONDARY excluding each other, 11–19 saying how it stands to the policy's
 *  coupling; no 11–19 on a day off. `error` is what stops the save. */
export function RolesFieldset({ data, serviceDate, link, onCall, late, dayOff, disabled, error, onOnCall, onLate }: Readonly<{
  data: Roster
  serviceDate: string
  link: LateShiftLink | null
  onCall: OnCall | null
  late: boolean
  dayOff: boolean
  disabled: boolean
  error?: string
  onOnCall: (role: OnCall | null) => void
  onLate: (late: boolean) => void
}>) {
  const t = useMessages().schedule.staffChange
  const { note, hint } = lateTexts(data, serviceDate, link, onCall, late)
  const other: OnCall | null = onCall && (onCall === 'primary' ? 'secondary' : 'primary')
  const groupHint = [other && t.excluded(roleLabels()[other]), hint].filter(Boolean).join(' ') || undefined
  const onCallCheck = (role: OnCall) => (
    <Checkbox
      className="role-check"
      label={roleLabels()[role]}
      checked={onCall === role}
      blocked={other === role}
      disabled={disabled}
      onChange={() => onOnCall(onCall === role ? null : role)}
    />
  )
  return (
    <Fieldset legend={t.roles} hint={groupHint} error={onCall || late ? error : t.pickRole}>
      <div className="role-checks">
        {onCallCheck('primary')}
        {onCallCheck('secondary')}
        {!dayOff && (
          <Checkbox
            className="role-check"
            label={<>{roleLabels().late_shift} <small>· {note}</small></>}
            checked={late}
            disabled={disabled}
            onChange={() => onLate(!late)}
          />
        )}
      </div>
    </Fieldset>
  )
}
