import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AssignmentRole, CalendarData, DraftSchedule, api } from '../api'
import { useMessages } from '../i18n'
import { availabilityLabels, cellLabel, roleLabels } from '../lib/labels'
import { REQUIRED_ROLES, availabilityByDay, groupByKey, monthGroups, startsWeek } from '../lib/calendar'
import { formatDate, formatShortDate, formatWeekday, warsawDate } from '../lib/dates'
import { draftFairnessImpactQuery, roundPoints } from '../lib/fairness'
import { signed } from '../lib/numbers'
import { useUndoable } from '../hooks/useUndoable'
import { problemCounts } from './DraftProblems'
import { AvailabilityMark, Box, Button, ErrorState, Field, KeyValue, LoadingBlock, Panel, RoleMark, Select, Tag, cx, useToast } from '../ui'

type Member = CalendarData['members'][number]
type Day = CalendarData['days'][number]
const ROLES: AssignmentRole[] = ['primary', 'secondary', 'late_shift']

/** A cell the problems table asked the matrix to open. */
export interface DraftFocus { service_date: string; assignee_name: string; role: AssignmentRole }

/** The required roles nobody holds on a day of the draft: what the solver left empty. */
function missingRoles(result: DraftSchedule, serviceDate: string): AssignmentRole[] {
  return REQUIRED_ROLES.filter((role) => !result.assignments.some((item) => item.service_date === serviceDate && item.role === role))
}

/** The one member with this name; none when it is missing or shared, so Undo never puts back the wrong person. */
function soleMember(members: Member[], name?: string) {
  const matches = members.filter((item) => item.display_name === name)
  return matches.length === 1 ? matches[0] : undefined
}

/**
 * The draft as a matrix. A coordinator corrects one assignment at a time
 * from the inspector, an empty role included; the rest of the draft is not
 * re-solved. Days with an empty role are marked in the header. Availability
 * marks show who can be moved in before the API refuses the move.
 */
export function DraftScheduleMatrix({ result, onChange, focus }: {
  result: DraftSchedule
  onChange: (value: DraftSchedule) => void
  focus?: DraftFocus | null
}) {
  const { generator: { matrix: t }, common } = useMessages()
  const today = warsawDate()
  const [selected, setSelected] = useState<{ member: Member; day: Day } | null>(null)
  const [selectedRole, setSelectedRole] = useState<AssignmentRole>('primary')
  const metadata = useQuery({
    queryKey: ['draft-matrix-metadata', result.starts_on, result.ends_on],
    queryFn: () => api.calendar(result.starts_on, result.ends_on),
  })
  const fairness = useQuery(draftFairnessImpactQuery(result))
  const undoable = useUndoable()
  const toast = useToast()
  // The inverse is the same correction back to the person it replaced; the
  // cell stays marked as corrected, the rest of the draft is untouched.
  const override = useMutation({
    mutationFn: async ({ previousName, previous, next, ...input }: Parameters<typeof api.overrideDraft>[0] & { previousName: string; previous?: Member; next: Member }) => {
      const message = (value: DraftSchedule) => ({
        title: t.assigned(formatShortDate(input.service_date), roleLabels()[input.role], previousName, next.display_name),
        description: t.remainingProblems(problemCounts(value).total),
      })
      if (!previous) {
        const value = await api.overrideDraft(input)
        const { title, description } = message(value)
        toast.success(title, { description })
        return value
      }
      return undoable({
        execute: () => api.overrideDraft(input),
        undo: async (value) => onChange(await api.overrideDraft({
          ...input,
          expected_version: value.version,
          replacement_member_id: previous.id,
        })),
        message,
      })
    },
    onSuccess: (value) => {
      onChange(value)
      setSelected(null)
    },
  })
  const editable = result.status === 'draft'
  const days = useMemo(() => metadata.data?.days ?? [], [metadata.data])
  const members = metadata.data?.members ?? []
  const months = useMemo(() => monthGroups(days), [days])
  // Every cell looks its duties and availability up instead of searching the payload.
  const cellAssignments = useMemo(
    () => groupByKey(result.assignments, (item) => `${item.service_date}|${item.assignee_name}`),
    [result.assignments],
  )
  const cellAvailability = useMemo(() => availabilityByDay(metadata.data?.availability ?? [], days), [metadata.data, days])
  const availabilityOf = (memberId: string, serviceDate: string) => cellAvailability.get(`${memberId}|${serviceDate}`)
  const conflictKeys = useMemo(
    () => new Set((result.unavailability_conflicts ?? []).map((item) => `${item.service_date}:${item.assignee_name}`)),
    [result.unavailability_conflicts],
  )
  // The problems table hands over a cell to open; each focus is consumed once.
  const consumed = useRef<DraftFocus | null>(null)
  useEffect(() => {
    if (!focus || !metadata.data || consumed.current === focus) return
    const member = metadata.data.members.find((item) => item.display_name === focus.assignee_name)
    const day = metadata.data.days.find((item) => item.service_date === focus.service_date)
    if (!member || !day) return
    consumed.current = focus
    setSelected({ member, day })
    setSelectedRole(focus.role)
  }, [focus, metadata.data])

  const selectedAssignment = selected
    ? result.assignments.find((item) => item.service_date === selected.day.service_date && item.role === selectedRole)
    : undefined
  const previousMember = soleMember(members, selectedAssignment?.assignee_name)
  const selectedAvailability = selected ? availabilityOf(selected.member.id, selected.day.service_date) : undefined
  const selectedBalance = selected ? fairness.data?.projected_members.find((item) => item.member_id === selected.member.id) : undefined
  const selectedCategory = selectedBalance?.[selectedRole]
  const correctionPoints = selectedRole === 'late_shift' ? 1 : selected?.day.is_day_off ? 2 : 1
  const changesHolder = selectedAssignment?.assignee_name !== selected?.member.display_name
  const cannotAssign = !changesHolder || selectedAvailability?.kind === 'unavailable'

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
                <th scope="col" className="who" />
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
              {members.map((member) => (
                <tr key={member.id}>
                  <th scope="row" className="who"><span className="who-name" title={member.display_name}>{member.display_name}</span></th>
                  {days.map((day) => {
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
                          onClick={() => {
                            setSelected({ member, day })
                            // An empty cell on a day with a gap opens on the empty role.
                            setSelectedRole(assignments[0]?.role ?? missingRoles(result, day.service_date)[0] ?? 'primary')
                          }}
                          aria-label={cellLabel(
                            member.display_name,
                            day,
                            assignments.map((assignment) => [roleLabels()[assignment.role], assignment.is_override ? t.correction : '', conflict ? t.clash : ''].filter(Boolean).join(' ')),
                            availability?.kind,
                          )}
                        >
                          {assignments.map((assignment) => (
                            <RoleMark key={assignment.role} role={assignment.role} change={assignment.is_override ? 'manual_override' : null} size={days.length > 28 ? 'sm' : undefined} />
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
        onClose={() => setSelected(null)}
        title={selected ? (cannotAssign ? t.dayTitle : t.correctionTitle)(selected.member.display_name, formatDate(selected.day.service_date)) : ''}
        meta={selected?.day.is_day_off && <Tag>{t.dayOffTag(selected.day.holiday_name ?? t.dayOff)}</Tag>}
        footer={selected && (
          <>
            <Button onClick={() => setSelected(null)}>{common.cancel}</Button>
            <span className="sp" />
            <Button
              variant="primary"
              disabled={cannotAssign || override.isPending}
              loading={override.isPending}
              onClick={() => override.mutate({
                previousName: selectedAssignment?.assignee_name ?? t.noAssignment,
                previous: previousMember,
                next: selected.member,
                id: result.id,
                expected_version: result.version,
                service_date: selected.day.service_date,
                role: selectedRole,
                replacement_member_id: selected.member.id,
              })}
            >
              {override.isPending ? common.saving : t.assign}
            </Button>
          </>
        )}
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
            {selectedAvailability && (
              <Box tone={selectedAvailability.kind === 'unavailable' ? 'bad' : 'muted'} title={t.availabilityTitle(selected.member.display_name, availabilityLabels()[selectedAvailability.kind])}>
                {selectedAvailability.kind === 'unavailable' && <>{t.willBeRejected}{' '}</>}
                {selectedAvailability.note ? t.quotedNote(selectedAvailability.note) : ''}
              </Box>
            )}
            <Field label={t.roleToChange} id="draft-override-role">
              {({ id }) => (
                <Select id={id} value={selectedRole} onChange={(event) => setSelectedRole(event.target.value as AssignmentRole)}>
                  {ROLES.filter((item) => item !== 'late_shift' || !selected.day.is_day_off).map((item) => (
                    <option key={item} value={item}>{roleLabels()[item]}</option>
                  ))}
                </Select>
              )}
            </Field>
            <KeyValue items={[
              { key: t.currently, value: selectedAssignment?.assignee_name ?? t.noAssignment },
              { key: t.afterCorrection, value: selected.member.display_name },
            ]} />
            {!selectedAssignment && !cannotAssign && <p className="muted small">{t.nobodyHoldsRole(selected.member.display_name)}</p>}
            {selectedBalance && selectedCategory && changesHolder && (
              <Box tone="sig" title={t.balanceTitle(roleLabels()[selectedRole], selectedBalance.display_name)}>
                {t.balanceChange(signed(selectedCategory.deviation), signed(roundPoints(selectedCategory.deviation + correctionPoints)), correctionPoints > 1 ? t.twoPoints : t.onePoint)}
              </Box>
            )}
            {override.error && <Box tone="bad" role="alert" title={override.error.message} />}
          </>
        )}
      </Panel>
    </div>
  )
}
