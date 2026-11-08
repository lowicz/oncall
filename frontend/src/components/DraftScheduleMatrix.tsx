import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AssignmentRole, CalendarData, DraftSchedule, api } from '../api'
import { messages, useMessages } from '../i18n'
import { availabilityLabels, cellLabel, roleLabels } from '../lib/labels'
import {
  OnCall,
  REQUIRED_ROLES,
  Roster,
  StaffChange,
  StaffingCandidate,
  availabilityByDay,
  correctionRoles,
  groupByKey,
  isCurrentAssignee,
  lateShiftLink,
  monthGroups,
  slotOf,
  staffChanges,
  staffingCandidates,
  startsWeek,
} from '../lib/calendar'
import { formatDate, formatShortDate, formatWeekday, warsawDate } from '../lib/dates'
import { draftFairnessImpactQuery, roundPoints } from '../lib/fairness'
import { signed } from '../lib/numbers'
import { useUndoable } from '../hooks/useUndoable'
import { useDraftRoleSwap } from '../hooks/useDraftRoleSwap'
import { problemCounts } from './DraftProblems'
import { RolesFieldset, StaffChangePreview } from './StaffChangePreview'
import { AvailabilityMark, Box, Button, ErrorState, LoadingBlock, Panel, RoleMark, Tag, cx, useToast } from '../ui'

type Member = CalendarData['members'][number]
type Day = CalendarData['days'][number]
/** The roles ticked in the panel: an on-call role, and the coordinator's own
 *  choice about 11–19 (null follows the policy). */
interface RolesPick { onCall: OnCall | null; lateChoice: boolean | null }

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

/** The one member with this name; none when it is missing or shared, so Undo never puts back the wrong person. */
function soleMember(members: Member[], name: string | null) {
  const matches = members.filter((item) => item.display_name === name)
  return matches.length === 1 ? matches[0] : undefined
}

/** The roles a cell opens on: its role, 11–19 alone included. */
function pickFor(role: AssignmentRole): RolesPick {
  return role === 'late_shift' ? { onCall: null, lateChoice: true } : { onCall: role, lateChoice: null }
}

/** What stops `member` taking `roles` of the day, said under the roles: the
 *  roles they cannot take of several, or why they take none. Nothing when the
 *  roles are theirs already or their availability already says why. */
function memberError(
  candidate: StaffingCandidate | undefined,
  roster: Roster,
  serviceDate: string,
  roles: AssignmentRole[],
  member: Member,
  unavailable: boolean,
) {
  const t = messages().generator.matrix
  const { roleList } = messages().schedule.staffChange
  if (candidate?.partial) {
    const { notEligible, holds } = candidate.partial
    return notEligible.length > 0
      ? t.notEligible(member.display_name, roleList(notEligible.map((role) => roleLabels()[role])))
      : t.holds(member.display_name, roleList(holds.map((role) => roleLabels()[role])))
  }
  const reason = candidate ? candidate.disabledReason : messages().calendar.disabledReasons.notEligible
  const holdsAll = roles.every((role) => isCurrentAssignee(member, slotOf(roster, serviceDate, role)))
  return reason && !holdsAll && !unavailable ? t.cannot(member.display_name, reason) : undefined
}

/** The toast title of a saved correction: the roles it moved, or its one slot. */
function assignedTitle(changes: StaffChange[], serviceDate: string, name: string) {
  const t = messages().generator.matrix
  const date = formatShortDate(serviceDate)
  if (changes.length > 1) {
    return t.assignedRoles(date, name, messages().schedule.staffChange.roleList(changes.map((item) => roleLabels()[item.role])))
  }
  return t.assigned(date, roleLabels()[changes[0].role], changes[0].from ?? t.noAssignment, name)
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
  const [pick, setPick] = useState<RolesPick>({ onCall: 'primary', lateChoice: null })
  const metadata = useQuery({
    queryKey: ['draft-matrix-metadata', result.starts_on, result.ends_on],
    queryFn: () => api.calendar(result.starts_on, result.ends_on),
  })
  const fairness = useQuery(draftFairnessImpactQuery(result))
  const policy = useQuery({ queryKey: ['swap-policy'], queryFn: api.swapPolicy, enabled: Boolean(selected) })
  const undoable = useUndoable()
  const toast = useToast()
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
  // The inverse hands each slot back to the person it was taken from; the
  // cells stay marked as corrected, the rest of the draft is untouched.
  const override = useMutation({
    mutationFn: async ({ serviceDate, changes, next }: { serviceDate: string; changes: StaffChange[]; next: Member }) => {
      const input = {
        id: result.id,
        expected_version: result.version,
        service_date: serviceDate,
        assignments: changes.map((item) => ({ role: item.role, replacement_member_id: next.id })),
      }
      const message = (value: DraftSchedule) => ({
        title: assignedTitle(changes, serviceDate, next.display_name),
        description: t.remainingProblems(problemCounts(value).total),
      })
      const restorable = changes.every((item) => item.restoreTo && soleMember(members, item.from)?.id === item.restoreTo)
      if (!restorable) {
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
          assignments: changes.map((item) => ({ role: item.role, replacement_member_id: item.restoreTo! })),
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
    if (!focus || consumed.current === focus) return
    const target = focusTarget(focus, metadata.data)
    if (!target) return
    consumed.current = focus
    setSelected(target)
    setPick(pickFor(focus.role))
  }, [focus, metadata.data])
  const openCell = (member: Member, day: Day, role: AssignmentRole) => {
    roleSwap.close()
    override.reset()
    setSelected({ member, day })
    setPick(pickFor(role))
  }
  const closePanel = () => {
    roleSwap.close()
    setSelected(null)
  }

  const link = roster && serviceDate && policy.data ? lateShiftLink(roster, serviceDate, policy.data.late_shift_anchor) : null
  const { late, roles } = correctionRoles(pick.onCall, pick.lateChoice, link)
  const changes = roster && serviceDate ? staffChanges(roster, serviceDate, roles) : []
  const selectedAvailability = selected ? availabilityOf(selected.member.id, selected.day.service_date) : undefined
  const unavailable = selectedAvailability?.kind === 'unavailable'
  const candidate = roster && selected
    ? staffingCandidates(roster, selected.day.service_date, roles).find((item) => item.id === selected.member.id)
    : undefined
  const ready = roles.length > 0 && Boolean(candidate && !candidate.disabledReason && !candidate.partial)
  const selectedBalance = selected ? fairness.data?.projected_members.find((item) => item.member_id === selected.member.id) : undefined

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
                          // An empty cell on a day with a gap opens on the empty role.
                          onClick={() => openCell(member, day, assignments[0]?.role ?? missingRoles(result, day.service_date)[0] ?? 'primary')}
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
        onClose={closePanel}
        title={selected ? (ready && !roleSwap.open ? t.correctionTitle : t.dayTitle)(selected.member.display_name, formatDate(selected.day.service_date)) : ''}
        meta={selected?.day.is_day_off && <Tag>{t.dayOffTag(selected.day.holiday_name ?? t.dayOff)}</Tag>}
        footer={roleSwap.open ? roleSwap.footer : selected && (
          <>
            <Button onClick={closePanel}>{common.cancel}</Button>
            <span className="sp" />
            <Button
              variant="primary"
              disabled={!ready || override.isPending}
              loading={override.isPending}
              onClick={() => override.mutate({ serviceDate: selected.day.service_date, changes, next: selected.member })}
            >
              {override.isPending ? common.saving : roles.length > 1 ? t.assignRoles(roles.length) : t.assign}
            </Button>
          </>
        )}
      >
        {selected && roster && (
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
            {roleSwap.trigger}
            {roleSwap.frame || (
              <>
                <RolesFieldset
                  data={roster}
                  serviceDate={selected.day.service_date}
                  link={link}
                  onCall={pick.onCall}
                  late={late}
                  dayOff={selected.day.is_day_off}
                  disabled={override.isPending}
                  error={memberError(candidate, roster, selected.day.service_date, roles, selected.member, unavailable)}
                  onOnCall={(onCall) => setPick({ ...pick, onCall })}
                  onLate={(lateChoice) => setPick({ ...pick, lateChoice })}
                />
                {ready && (
                  <>
                    <StaffChangePreview changes={changes} name={selected.member.display_name} onCall={pick.onCall} link={link} />
                    {changes.every((item) => item.from === null) && <p className="muted small">{t.nobodyHoldsRole(selected.member.display_name)}</p>}
                    {selectedBalance && changes.map((item) => {
                      const points = item.role !== 'late_shift' && selected.day.is_day_off ? 2 : 1
                      const category = selectedBalance[item.role]
                      return (
                        <Box key={item.role} tone="sig" title={t.balanceTitle(roleLabels()[item.role], selectedBalance.display_name)}>
                          {t.balanceChange(signed(category.deviation), signed(roundPoints(category.deviation + points)), points > 1 ? t.twoPoints : t.onePoint)}
                        </Box>
                      )
                    })}
                  </>
                )}
                {override.error && <Box tone="bad" role="alert" title={override.error.message} />}
              </>
            )}
          </>
        )}
      </Panel>
    </div>
  )
}
