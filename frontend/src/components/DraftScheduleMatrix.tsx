import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AssignmentRole, CalendarData, DraftSchedule, api } from '../api'
import { useMessages } from '../i18n'
import { availabilityLabels, cellLabel } from '../lib/labels'
import { REQUIRED_ROLES, Roster, availabilityByDay, groupByKey, monthGroups, startsWeek } from '../lib/calendar'
import { formatDate, formatWeekday, warsawDate } from '../lib/dates'
import { useDraftRoleSwap } from '../hooks/useDraftRoleSwap'
import { useDraftStaffChange } from '../hooks/useDraftStaffChange'
import { useGridNavigation } from '../hooks/useGridNavigation'
import { AvailabilityMark, Box, ErrorState, InlineError, LoadingBlock, Panel, RoleMark, Tag, cx } from '../ui'

type Member = CalendarData['members'][number]
type Day = CalendarData['days'][number]

/** A cell the problems table asked the matrix to open. */
export interface DraftFocus { service_date: string; assignee_name: string; role: AssignmentRole }

/** The required roles nobody holds on a day of the draft: what the solver left empty. */
function missingRoles(result: DraftSchedule, serviceDate: string): AssignmentRole[] {
  return REQUIRED_ROLES.filter((role) => !result.assignments.some((item) => item.service_date === serviceDate && item.role === role))
}

/** The member and day a problems-table focus points at, once the calendar has loaded. */
function focusTarget(focus: DraftFocus, data?: CalendarData) {
  const member = data?.members.find((item) => item.display_name === focus.assignee_name)
  const day = data?.days.find((item) => item.service_date === focus.service_date)
  return member && day ? { member, day } : null
}

/**
 * The draft as a matrix. A coordinator corrects one day at a time from the
 * panel, as the published day inspector does: the roles to change for the
 * person whose cell was clicked, an empty role included, or the day's on-call
 * pair trading places; the rest of the draft is not re-solved. Days with an
 * empty role are marked in the header. Availability marks show who can be
 * moved in before the API refuses the move.
 */
export function DraftScheduleMatrix({ result, onChange, focus }: {
  result: DraftSchedule
  onChange: (value: DraftSchedule) => void
  focus?: DraftFocus | null
}) {
  const { generator: { matrix: t }, common } = useMessages()
  const today = warsawDate()
  const [selected, setSelected] = useState<{ member: Member; day: Day } | null>(null)
  const metadata = useQuery({
    queryKey: ['draft-matrix-metadata', result.starts_on, result.ends_on],
    queryFn: () => api.calendar(result.starts_on, result.ends_on),
  })
  const policy = useQuery({ queryKey: ['swap-policy'], queryFn: api.swapPolicy, enabled: Boolean(selected) })
  // The draft's assignments over the calendar's team: what the inspector's
  // helpers read the published days from.
  const roster = useMemo<Roster | undefined>(
    () => metadata.data && { ...metadata.data, assignments: result.assignments },
    [metadata.data, result.assignments],
  )
  const serviceDate = selected?.day.service_date
  const roleSwap = useDraftRoleSwap({
    draft: result,
    roster,
    serviceDate,
    anchor: policy.data?.late_shift_anchor ?? 'secondary',
    onSaved: (value) => {
      onChange(value)
      setSelected(null)
    },
    onUndone: onChange,
  })
  const editable = result.status === 'draft'
  const days = useMemo(() => metadata.data?.days ?? [], [metadata.data])
  const members = metadata.data?.members ?? []
  const months = useMemo(() => monthGroups(days), [days])
  const grid = useGridNavigation(members.length, days.length)
  // Every cell looks its duties and availability up instead of searching the payload.
  const cellAssignments = useMemo(
    () => groupByKey(result.assignments, (item) => `${item.service_date}|${item.assignee_name}`),
    [result.assignments],
  )
  const cellAvailability = useMemo(() => availabilityByDay(metadata.data?.availability ?? [], days), [metadata.data, days])
  const availabilityOf = (memberId: string, serviceDate: string) => cellAvailability.get(`${memberId}|${serviceDate}`)
  const selectedAvailability = selected ? availabilityOf(selected.member.id, selected.day.service_date) : undefined
  const unavailable = selectedAvailability?.kind === 'unavailable'
  const staffChange = useDraftStaffChange({
    draft: result,
    roster,
    selected,
    unavailable,
    anchor: policy.data?.late_shift_anchor,
    onSaved: (value) => {
      onChange(value)
      setSelected(null)
    },
    onUndone: onChange,
    onClose: () => closePanel(),
  })
  const { openFor } = staffChange
  const conflictKeys = useMemo(
    () => new Set((result.unavailability_conflicts ?? []).map((item) => `${item.service_date}:${item.assignee_name}`)),
    [result.unavailability_conflicts],
  )
  // The problems table hands over a cell to open; each focus is consumed once.
  const consumed = useRef<DraftFocus | null>(null)
  useEffect(() => {
    if (!focus || consumed.current === focus) return
    const target = focusTarget(focus, metadata.data)
    if (!target) return
    consumed.current = focus
    setSelected(target)
    openFor([focus.role])
  }, [focus, metadata.data, openFor])
  const openCell = (member: Member, day: Day, roles: AssignmentRole[]) => {
    roleSwap.close()
    setSelected({ member, day })
    openFor(roles)
  }
  const closePanel = () => {
    roleSwap.close()
    setSelected(null)
  }
  // The panel puts the clicked person in; only the swap frame is about the day.
  const panelTitle = roleSwap.open ? t.dayTitle : t.correctionTitle

  return (
    <div className="stack-sm">
      {metadata.isLoading && <LoadingBlock label={t.loading} rows={4} />}
      {metadata.error && <ErrorState error={metadata.error} onRetry={() => metadata.refetch()} />}
      {metadata.data && (
        <div className="mx panel" role="region" aria-label={t.region}>
          <table className="m" data-zoom={days.length > 28 ? '8' : days.length > 14 ? '4' : '2'}>
            <caption className="sr-only">{t.caption}</caption>
            <thead>
              <tr className="mrow">
                <th scope="row" className="who"><span className="sr-only">{t.month}</span></th>
                {months.map((month) => (
                  <th key={month.key} scope="col" colSpan={month.span} className="mo">
                    {month.span >= 4 ? month.label : month.span < 3 ? month.shortLabel.split(' ')[0] : month.shortLabel}
                  </th>
                ))}
              </tr>
              <tr className="drow">
                <th scope="col" className="who">{t.person}</th>
                {days.map((day) => {
                  const gap = missingRoles(result, day.service_date).length > 0 ? t.gapDay : null
                  return (
                    <th
                      key={day.service_date}
                      scope="col"
                      className={cx(day.is_day_off && 'we', startsWeek(day) && 'wk', day.service_date === today && 'td', gap && 'gap')}
                      title={[day.holiday_name, ...day.events.map((event) => event.title), gap].filter(Boolean).join(' · ') || undefined}
                      aria-label={[formatWeekday(day.service_date), day.service_date.slice(8), day.holiday_name, ...day.events.map((event) => event.title), gap].filter(Boolean).join(' · ')}
                    >
                      <span>{formatWeekday(day.service_date)}</span>
                      <b>{day.service_date.slice(8)}</b>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {members.map((member, rowIndex) => (
                <tr key={member.id}>
                  <th scope="row" className="who"><span className="who-name" title={member.display_name}>{member.display_name}</span></th>
                  {days.map((day, colIndex) => {
                    const assignments = cellAssignments.get(`${day.service_date}|${member.display_name}`) ?? []
                    const availability = availabilityOf(member.id, day.service_date)
                    const conflict = conflictKeys.has(`${day.service_date}:${member.display_name}`)
                    const isSelected = selected?.day.service_date === day.service_date && selected.member.id === member.id
                    return (
                      <td key={day.service_date} className={cx(day.is_day_off && 'we', startsWeek(day) && 'wk', day.service_date === today && 'td', conflict && 'gap')}>
                        <button
                          type="button"
                          className={cx('cell', isSelected && 'cell-sel', day.events.length > 0 && 'cell-ev')}
                          style={day.events[0] ? { ['--ev' as string]: `var(--ev-${day.events[0].color})` } : undefined}
                          disabled={!editable}
                          {...grid.cellProps(rowIndex, colIndex)}
                          // A cell opens on all its roles; an empty one on a day
                          // with a gap on the empty role.
                          onClick={() => openCell(member, day, assignments.length > 0
                            ? assignments.map((assignment) => assignment.role)
                            : [missingRoles(result, day.service_date)[0] ?? 'primary'])}
                          aria-label={cellLabel(
                            member.display_name,
                            day,
                            assignments.map((assignment) => ({
                              role: assignment.role,
                              note: [assignment.is_override ? t.correction : '', conflict ? t.clash : ''].filter(Boolean).join(' '),
                            })),
                            availability?.kind,
                          )}
                        >
                          {assignments.map((assignment) => (
                            // The space keeps two marks two words, as the cell's name reads them.
                            <Fragment key={assignment.role}><RoleMark role={assignment.role} change={assignment.is_override ? 'manual_override' : null} size={days.length > 28 ? 'sm' : undefined} />{' '}</Fragment>
                          ))}
                          {availability && <AvailabilityMark kind={availability.kind} />}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Panel
        open={Boolean(selected)}
        onClose={closePanel}
        title={selected ? panelTitle(selected.member.display_name, formatDate(selected.day.service_date)) : ''}
        meta={selected?.day.is_day_off && <Tag>{t.dayOffTag(selected.day.holiday_name ?? t.dayOff)}</Tag>}
        footer={policy.data && (roleSwap.open ? roleSwap.footer : staffChange.footer)}
      >
        {selected && (
          <>
            {selected.day.is_day_off && <Box tone="muted">{t.noLateShift}</Box>}
            {selected.day.events.length > 0 && (
              <div className="stack-sm">
                <div className="impact-h">{t.events}</div>
                {selected.day.events.map((event) => (
                  <div key={event.id} className="row">
                    <span><i className="event-swatch" style={{ background: `var(--ev-${event.color})` }} />{event.title}</span>
                  </div>
                ))}
              </div>
            )}
            {selectedAvailability && !roleSwap.open && (
              <Box tone={unavailable ? 'bad' : 'muted'} title={t.availabilityTitle(selected.member.display_name, availabilityLabels()[selectedAvailability.kind])}>
                {unavailable && <>{t.willBeRejected}{' '}</>}
                {selectedAvailability.note ? t.quotedNote(selectedAvailability.note) : ''}
              </Box>
            )}
            {/* The 11–19 choices follow the policy's anchor, so they wait for it rather than change under the cursor. */}
            {policy.data ? (
              <>
                {roleSwap.trigger}
                {roleSwap.frame || staffChange.form}
              </>
            ) : policy.isError ? <InlineError error={policy.error} /> : <LoadingBlock label={common.loading} rows={2} />}
          </>
        )}
      </Panel>
    </div>
  )
}
