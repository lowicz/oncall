import { Fragment, ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, AssignmentRole, CalendarData, CalendarEventRef, UserRole, api } from '../api'
import { availabilityLabels, cellLabel, roleLabels } from '../lib/labels'
import { eventDates, formatDate, formatDay, formatShortDate, formatWeekday, fourWeekRangeEnd, warsawDate } from '../lib/dates'
import {
  StaffingCandidate,
  availabilityByDay,
  availabilityDutyConflicts,
  coverageGaps,
  groupByKey,
  hasDutyInRange,
  memberGroup,
  memberGroupLabels,
  monthGroups,
  orderMembers,
  staffingCandidates,
  startsWeek,
} from '../lib/calendar'
import { locale, messages, useMessages } from '../i18n'
import { useGridNavigation } from '../hooks/useGridNavigation'
import { useUndoable } from '../hooks/useUndoable'
import { useRoleSwap } from '../hooks/useRoleSwap'
import { CalendarDayList } from './CalendarDayList'
import { ConfirmDialog } from './ConfirmDialog'
import { DayEventDialog } from './DayEventDialog'
import { DecisionFrame } from './DecisionFrame'
import { SwapImpactPreview } from './SwapImpactPreview'
import {
  AvailabilityMark,
  Box,
  Button,
  Chip,
  ChipRow,
  EmptyState,
  ErrorState,
  Field,
  LinkButton,
  Panel,
  RoleMark,
  Select,
  Skeleton,
  Tag,
  cx,
  useToast,
} from '../ui'

export type MatrixZoom = '2' | '4' | '8'
export interface CalendarRange { starts_on: string; ends_on: string }
export interface MatrixSummary {
  loaded: boolean
  people: number
  onDuty: number
  teamHasMembers: boolean
  /** The staffable days without full coverage and the way to the first of them. */
  firstGap?: { count: number; date: string; show: () => void }
}
type Day = CalendarData['days'][number]
type Member = CalendarData['members'][number]

const ROLES: AssignmentRole[] = ['primary', 'secondary', 'late_shift']

/** Clock window of a duty, mirroring backend coverage.py (PLAN.md §3). */
export function coverageWindowText(day: Pick<Day, 'is_day_off'>, role: AssignmentRole): string {
  if (role === 'late_shift') return '11:00–19:00'
  return day.is_day_off ? messages().schedule.allDay : '19:00–09:00'
}

/** What the hint under the person picker says about the chosen person: the
 *  roles they may hold that day and what they reported for it. */
function candidateHint(candidate: StaffingCandidate, serviceDate: string) {
  const t = messages().schedule.inspector.candidate
  const date = formatShortDate(serviceDate)
  return [
    candidate.roles && t.roles(candidate.display_name, candidate.roles.map((item) => roleLabels()[item]).join(', ')),
    candidate.availability ? t.reported(date, availabilityLabels()[candidate.availability]) : t.notReported(date),
  ].filter(Boolean).join(' ')
}

/** What a day is worth and why, as the inspector's title tag. */
function dayTag(day: Day) {
  const t = messages().schedule.dayTag
  if (day.holiday_name) return t.holiday(day.holiday_name)
  if (day.is_day_off) return t.dayOff
  return t.workday
}

/**
 * The people-by-days matrix with its day inspector.
 *
 * The screen around it decides the range, the zoom and the view; this
 * component fetches the calendar for that range, paints it, and owns the
 * inspector panel: reading a day, changing its staffing (coordinator), adding
 * an event, asking for a swap (member). `focusDay` and `focusPerson` come
 * from the command palette through the URL: the first opens the inspector on
 * that day, the second lights that person's row.
 */
export function CalendarMatrix({
  role,
  displayName,
  range,
  view = 'matrix',
  hideIdle = false,
  zoom = '4',
  focusDay,
  focusPerson,
  enabled = true,
  heading,
  showRisks = true,
}: {
  role: UserRole
  displayName: string
  range: CalendarRange
  view?: 'matrix' | 'list'
  hideIdle?: boolean
  zoom?: MatrixZoom
  focusDay?: string | null
  focusPerson?: string | null
  /** False while the screen is still working out the default range. */
  enabled?: boolean
  /** The ruled section heading drawn between the risk chips and the grid; a
   *  function receives whether the range has loaded, how many people it holds,
   *  how many of them have a duty in it and the first day without full coverage. */
  heading?: ReactNode | ((summary: MatrixSummary) => ReactNode)
  /** The "Teraz" screen carries the risk chips; the full schedule does not. */
  showRisks?: boolean
}) {
  const queryClient = useQueryClient()
  const today = warsawDate()
  const { schedule: t, calendarEvents } = useMessages()
  const calendar = useQuery({
    queryKey: ['calendar', range.starts_on, range.ends_on],
    queryFn: () => api.calendar(range.starts_on, range.ends_on),
    enabled,
    // Moving the window keeps the last range on screen until the next one
    // arrives, instead of collapsing the matrix to its skeleton.
    placeholderData: keepPreviousData,
  })
  // The inspector is day-scoped. `member` is the row that was clicked - context
  // for reading the day, never the target of a staffing change (MED6-03). The
  // change form names its person explicitly through `staffMemberId`.
  const [selected, setSelected] = useState<{ member?: Member; day: Day } | null>(null)
  const [selectedRole, setSelectedRole] = useState<AssignmentRole>('primary')
  const [staffOpen, setStaffOpen] = useState(false)
  const [staffMemberId, setStaffMemberId] = useState<string | null>(null)
  const [violationsAcknowledged, setViolationsAcknowledged] = useState(false)
  const [confirmHistorical, setConfirmHistorical] = useState(false)
  const [historicalReason, setHistoricalReason] = useState('')
  const [eventDialogOpen, setEventDialogOpen] = useState(false)
  const toast = useToast()
  const undoable = useUndoable()

  const roleSwap = useRoleSwap({
    data: calendar.data,
    serviceDate: selected?.day.service_date,
    coordinates: role === 'coordinator' || role === 'admin',
  })

  const closeInspector = () => {
    roleSwap.close()
    setSelected(null)
    setStaffOpen(false)
    setStaffMemberId(null)
    setConfirmHistorical(false)
    setEventDialogOpen(false)
  }
  const openDay = (day: Day, member: Member | undefined, nextRole: AssignmentRole) => {
    if (override.isPending || calendar.isPlaceholderData) return
    roleSwap.close()
    setSelected({ member, day })
    setSelectedRole(nextRole)
    setStaffOpen(false)
    setStaffMemberId(null)
    setEventDialogOpen(false)
  }
  const override = useMutation({
    mutationFn: api.directOverride,
    onSuccess: () => {
      closeInspector()
      queryClient.invalidateQueries({ queryKey: ['calendar'] })
      queryClient.invalidateQueries({ queryKey: ['published-schedule'] })
    },
    onError: (error) => {
      // The roster moved between the check and the write, and the override
      // now breaks a rule the panel did not show: check again so the
      // violations and their acknowledgement appear, in the panel rather
      // than behind the past-day dialog.
      if (error instanceof ApiError && error.violations.length > 0) {
        queryClient.invalidateQueries({ queryKey: ['override-check'] })
        setConfirmHistorical(false)
      }
    },
  })
  const refreshCalendar = () => queryClient.invalidateQueries({ queryKey: ['calendar'] })
  const eventCreated = (event: CalendarEventRef) => {
    setEventDialogOpen(false)
    // The window is modal over the open day, so that day is still open.
    setSelected((current) => current && {
      ...current,
      day: { ...current.day, events: [...current.day.events, event] },
    })
    refreshCalendar()
  }
  // An event is deleted at once and offered back in the toast: Undo creates
  // it again over the whole range it had, read before the delete because the
  // day only carries its title and colour.
  const deleteEvent = useMutation({
    mutationFn: ({ event, day }: { event: CalendarEventRef; day: string }) => undoable({
      execute: async () => {
        const stored = (await api.calendarEvents(day, day)).find((item) => item.id === event.id)!
        await api.deleteCalendarEvent(event.id)
        return stored
      },
      undo: async ({ starts_on, ends_on, title, color }) => {
        const restored = await api.createCalendarEvent({ starts_on, ends_on, title, color })
        setSelected((current) => current && current.day.service_date >= starts_on && current.day.service_date <= ends_on ? {
          ...current,
          day: { ...current.day, events: [...current.day.events, restored] },
        } : current)
        refreshCalendar()
      },
      message: (stored) => ({ title: calendarEvents.toast.deleted(event.title), description: eventDates(stored) }),
    }),
    onSuccess: (_result, { event: { id } }) => {
      setSelected((current) => current ? {
        ...current,
        day: { ...current.day, events: current.day.events.filter((event) => event.id !== id) },
      } : null)
      refreshCalendar()
    },
  })
  const canCoordinate = role === 'coordinator' || role === 'admin'
  const data = calendar.data

  const gaps = useMemo(() => (data ? coverageGaps(data) : []), [data])
  const dutyConflicts = useMemo(() => (data ? availabilityDutyConflicts(data) : []), [data])
  const dutyConflictPeople = useMemo(
    () => new Set(dutyConflicts.map((item) => item.member_id)).size,
    [dutyConflicts],
  )
  const gapDates = useMemo(() => new Set(gaps.map((gap) => gap.service_date)), [gaps])
  const dayByDate = useMemo(() => new Map((data?.days ?? []).map((day) => [day.service_date, day])), [data])
  // What the cells and the inspector read, looked up instead of searched for
  // in every cell of every render.
  const cellAssignments = useMemo(
    () => groupByKey(data?.assignments ?? [], (item) => `${item.service_date}|${item.assignee_name}`),
    [data],
  )
  const slots = useMemo(() => new Map((data?.assignments ?? []).map((item) => [`${item.service_date}|${item.role}`, item])), [data])
  const cellAvailability = useMemo(() => availabilityByDay(data?.availability ?? [], data?.days ?? []), [data])
  // A gap inside a published schedule is staffable by an override; a gap beyond
  // every published range needs a new publication, so the two must not be
  // announced with the same words (HGH-02).
  const publishedGaps = useMemo(() => gaps.filter((gap) => dayByDate.get(gap.service_date)?.published), [gaps, dayByDate])
  const outsideGaps = useMemo(() => gaps.filter((gap) => !dayByDate.get(gap.service_date)?.published), [gaps, dayByDate])
  const months = useMemo(() => (data ? monthGroups(data.days) : []), [data])
  const members = useMemo(() => {
    if (!data) return []
    const ordered = orderMembers(data.members, data.assignments, displayName)
    return hideIdle ? ordered.filter((member) => hasDutyInRange(member, data.assignments)) : ordered
  }, [data, displayName, hideIdle])
  const summary = useMemo<MatrixSummary>(() => ({
    loaded: Boolean(data),
    people: data?.members.length ?? 0,
    onDuty: data ? data.members.filter((member) => hasDutyInRange(member, data.assignments)).length : 0,
    teamHasMembers: data?.team_has_members ?? false,
  }), [data])
  // Nobody belongs to the rotation in this range: there is no row to draw, so
  // the matrix, the day list and "only on duty" have nothing to say. A team
  // with nobody in it at all reads apart from a range that simply holds none of
  // its members - the first tells an admin to add people, the second does not.
  const noPeople = summary.loaded && summary.people === 0
  const emptyTeam = noPeople && !summary.teamHasMembers
  const noneInRange = noPeople && summary.teamHasMembers
  // Duties per person in the range, drawn as a load bar under the name so the
  // eye can compare rows without counting marks.
  const load = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of data?.assignments ?? []) {
      counts.set(item.assignee_name, (counts.get(item.assignee_name) ?? 0) + 1)
    }
    const max = Math.max(1, ...counts.values())
    return { counts, max }
  }, [data])

  const grid = useGridNavigation(members.length, data?.days.length ?? 0)

  // A day named in the URL (from the palette or a link) opens the inspector
  // once per value; a person named there lights the row and scrolls to it.
  const consumedDay = useRef<string | null>(null)
  useEffect(() => {
    if (!data || calendar.isPlaceholderData || !focusDay || consumedDay.current === focusDay) return
    const day = dayByDate.get(focusDay)
    if (!day) return
    consumedDay.current = focusDay
    openDay(day, undefined, 'primary')
    const col = data.days.findIndex((item) => item.service_date === focusDay)
    if (col >= 0 && view === 'matrix') grid.focusCell(0, col)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, calendar.isPlaceholderData, focusDay, dayByDate])
  const rowRefs = useRef(new Map<string, HTMLTableRowElement | null>())
  const consumedPerson = useRef<string | null>(null)
  useEffect(() => {
    if (!data || !focusPerson || consumedPerson.current === focusPerson) return
    const row = rowRefs.current.get(focusPerson)
    if (!row) return
    consumedPerson.current = focusPerson
    row.scrollIntoView({ block: 'center' })
  }, [data, focusPerson, members])

  const selectedAssignment = selected ? slots.get(`${selected.day.service_date}|${selectedRole}`) : undefined
  const selectedDayPublished = selected ? (dayByDate.get(selected.day.service_date)?.published ?? true) : true
  // Every availability entry that covers the open day, named - the inspector is
  // about the whole day, not the one row that was clicked (MED6-03).
  const dayAvailability = useMemo(() => {
    if (!data || !selected) return []
    return data.availability
      .filter((item) => item.starts_on <= selected.day.service_date && item.ends_on >= selected.day.service_date)
      .map((item) => ({
        ...item,
        display_name: data.members.find((member) => member.id === item.member_id)?.display_name ?? t.unknownPerson,
      }))
      .sort((a, b) => a.display_name.localeCompare(b.display_name, locale()))
  }, [data, selected, t])
  // Who the coordinator may move into the role the change form currently shows.
  const staffCandidates = useMemo(
    () => (data && selected ? staffingCandidates(data, selected.day.service_date, selectedRole) : []),
    [data, selected, selectedRole],
  )
  const chosenCandidate = staffCandidates.find((item) => item.id === staffMemberId)
  const staffBlockReason = !selectedDayPublished
    ? t.staffBlock.outsidePublished
    : !chosenCandidate
      ? t.staffBlock.pickPerson
      : chosenCandidate?.disabledReason
        ? t.staffBlock.chosenPerson(chosenCandidate.disabledReason)
        : undefined
  // The people on duty that day despite reporting they cannot be, as one
  // frame each above the role rows rather than a sum left to the reader.
  const dayConflicts = selected && canCoordinate
    ? dutyConflicts.filter((item) => item.service_date === selected.day.service_date)
    : []
  const conflictText = (item: (typeof dutyConflicts)[number]) =>
    t.inspector.collision(item.display_name, roleLabels()[item.role], formatShortDate(item.service_date), availabilityLabels().unavailable)
  // The hard rules this override would break are shown under the chosen
  // person before the coordinator saves, and saving waits for their explicit
  // acknowledgement: the API refuses an unacknowledged rule-breaking override.
  const overrideCheck = useQuery({
    queryKey: ['override-check', selected?.day.service_date, selectedRole, staffMemberId],
    queryFn: () => api.directOverrideCheck({
      service_date: selected!.day.service_date,
      role: selectedRole,
      replacement_member_id: staffMemberId!,
    }),
    enabled: staffOpen && !staffBlockReason,
  })
  // An acknowledgement covers the violations it was given for, never a set
  // that changed under it.
  useEffect(() => setViolationsAcknowledged(false), [overrideCheck.data])
  const violations = overrideCheck.data?.violations
  const endsHandover = overrideCheck.data?.ends_handover
  const historical = Boolean(selected && selected.day.service_date < today)
  const saveBlocked = Boolean(staffBlockReason)
    || overrideCheck.isLoading
    || ((violations?.length ?? 0) > 0 && !violationsAcknowledged)
  // The correction closes the inspector; the toast says what changed and who
  // is told, and reopens the day.
  const announceOverride = (target: { member?: Member; day: Day }, next: string) => {
    const role = roleLabels()[selectedRole]
    const date = formatShortDate(target.day.service_date)
    const previous = selectedAssignment?.assignee_name
    const acknowledged = (violations?.length ?? 0) > 0 && violationsAcknowledged
    toast.success(previous ? t.toast.changed(date, role, previous, next) : t.toast.filled(role, date, next), {
      description: [previous ? t.toast.emailBoth : t.toast.emailOne(next), acknowledged ? t.toast.violationAudited : ''].filter(Boolean).join(' '),
      action: { label: t.toast.openDay, onClick: () => openDay(target.day, target.member, selectedRole) },
    })
  }
  const saveOverride = (reason?: string) => selected && staffMemberId && scheduleRef && chosenCandidate && override.mutate({
    schedule_id: scheduleRef.schedule_id,
    expected_version: scheduleRef.schedule_version,
    service_date: selected.day.service_date,
    role: selectedRole,
    replacement_member_id: staffMemberId,
    reason,
    acknowledge_rule_violations: (violations?.length ?? 0) > 0 && violationsAcknowledged,
  }, { onSuccess: () => announceOverride(selected, chosenCandidate.display_name) })
  const openStaffChange = (nextRole: AssignmentRole) => {
    // The role select drops „11–19" on a day off, so never open the form with
    // it pre-selected there.
    const safeRole: AssignmentRole = nextRole === 'late_shift' && selected?.day.is_day_off ? 'primary' : nextRole
    setSelectedRole(safeRole)
    setStaffMemberId(null)
    setHistoricalReason('')
    override.reset()
    roleSwap.close()
    setStaffOpen(true)
  }
  // The risk chips jump to a day the calendar itself reported (a gap, a
  // conflict), so the day is always among the loaded ones.
  const jumpToDate = (days: CalendarData['days'], date: string) => {
    const index = days.findIndex((item) => item.service_date === date)
    if (view === 'matrix') grid.focusCell(0, index)
    openDay(days[index], undefined, 'primary')
  }
  const selectedGap = selected ? gaps.find((gap) => gap.service_date === selected.day.service_date) : undefined
  const ownRole = selected
    ? data?.assignments.find((item) => item.service_date === selected.day.service_date && item.assignee_name === displayName)?.role
    : undefined

  const scheduleRef = (selectedAssignment ?? data?.assignments.find(
    (item) => item.service_date === selected?.day.service_date,
  ))

  const riskChips = data && showRisks && (gaps.length > 0 || (canCoordinate && dutyConflicts.length > 0) || publishedGaps.length === 0)

  return (
    <>
      {riskChips && (
        <ChipRow label={t.risks.label}>
          {/* Only the staffable kind is a jump target; jumping to a day nobody
              can fix was the trap behind HGH-02. */}
          {publishedGaps.length > 0 && (
            <Chip tone="bad" onClick={() => jumpToDate(data.days, publishedGaps[0].service_date)} title={t.risks.showFirstGap}>
              {t.risks.gapDays(publishedGaps.length)}
              {' · '}
              {publishedGaps.slice(0, 3).map((gap) => formatDate(gap.service_date).slice(0, 5)).join(', ')}
              {publishedGaps.length > 3 ? '…' : ''}
            </Chip>
          )}
          {outsideGaps.length > 0 && (
            <Chip tone="warn" title={canCoordinate ? t.risks.outsideNeedsPublishing : t.risks.outsideNotPublished}>
              {t.risks.outsideDays(outsideGaps.length)}
            </Chip>
          )}
          {canCoordinate && dutyConflicts.length > 0 && (
            <Chip tone="bad" onClick={() => jumpToDate(data.days, dutyConflicts[0].service_date)} title={t.risks.showFirstConflict}>
              {t.risks.conflictPeople(dutyConflictPeople)}
            </Chip>
          )}
          {gaps.length === 0 && (!canCoordinate || dutyConflicts.length === 0) && (
            <Chip tone="ok">{t.risks.fullCoverage}</Chip>
          )}
        </ChipRow>
      )}
      {typeof heading === 'function'
        ? heading(data && publishedGaps.length > 0
          ? { ...summary, firstGap: { count: publishedGaps.length, date: publishedGaps[0].service_date, show: () => jumpToDate(data.days, publishedGaps[0].service_date) } }
          : summary)
        : heading}
      {calendar.error && <ErrorState error={calendar.error} onRetry={() => calendar.refetch()} />}
      {(calendar.isLoading || !enabled) && (
        <div className="panel sk-block" role="status" aria-busy="true" aria-label={t.loading}>
          <Skeleton height={22} width="min(340px, 100%)" />
          <Skeleton height={34 * 5} />
        </div>
      )}
      {emptyTeam && (
        role === 'admin' ? (
          <EmptyState
            icon="people"
            title={t.empty.nobodyYet}
            description={t.empty.addPeople}
            action={<LinkButton to="/osoby" icon="people">{t.empty.openPeople}</LinkButton>}
          />
        ) : (
          <EmptyState icon="people" title={t.empty.noPeople} />
        )
      )}
      {noneInRange && (
        <EmptyState icon="people" title={t.empty.nobodyInRange} />
      )}
      {data && !noPeople && hideIdle && members.length === 0 && (
        <EmptyState compact icon="calendar" title={t.empty.nobodyOnDuty} />
      )}
      {data && !noPeople && view === 'list' && (
        <CalendarDayList
          data={data}
          displayName={displayName}
          gaps={gaps}
          selectedDate={selected?.day.service_date}
          onSelectDay={(day, nextRole) => {
            const member = members.find((item) => item.display_name === displayName)
            openDay(day, member, nextRole)
          }}
        />
      )}
      {data && view === 'matrix' && members.length > 0 && (
        <div className="mx panel" role="region" aria-label={t.grid.region} aria-busy={calendar.isPlaceholderData || undefined} tabIndex={-1}>
          <table className="m" data-zoom={zoom}>
            <caption className="sr-only">{t.grid.caption(formatDate(range.starts_on), formatDate(range.ends_on))}</caption>
            <thead>
              <tr className="mrow">
                <th scope="col" className="who" />
                {months.map((month) => (
                  <th key={month.key} scope="col" colSpan={month.span} className="mo">
                    {month.span >= 4 ? month.label : month.shortLabel}
                  </th>
                ))}
              </tr>
              <tr className="drow">
                <th scope="col" className="who">{t.grid.person}</th>
                {data.days.map((day) => {
                  const isToday = day.service_date === today
                  const gap = gapDates.has(day.service_date) && day.published
                  return (
                    <th
                      scope="col"
                      key={day.service_date}
                      className={cx(day.is_day_off && 'we', startsWeek(day) && 'wk', isToday && 'td', gap && 'gap')}
                      title={[day.holiday_name, ...day.events.map((event) => event.title), gap ? t.grid.noFullCoverage : null]
                        .filter(Boolean).join(' · ') || undefined}
                      aria-label={[formatWeekday(day.service_date), day.service_date.slice(8), day.holiday_name, ...day.events.map((event) => event.title), gap ? t.grid.noFullCoverage : null]
                        .filter(Boolean).join(' · ')}
                    >
                      <span>{formatWeekday(day.service_date)}</span>
                      <b>{day.service_date.slice(8)}</b>
                      {gap && <span className="sr-only">{t.grid.noFullCoverage}</span>}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {members.map((member, rowIndex) => {
                const group = memberGroup(member, data.assignments, displayName)
                const previousGroup = rowIndex > 0 ? memberGroup(members[rowIndex - 1], data.assignments, displayName) : null
                const showGroupCaption = group !== 'you' && group !== previousGroup
                const you = member.display_name === displayName
                const out = Boolean(member.active_until && member.active_until < range.starts_on)
                const highlighted = focusPerson === member.display_name
                const count = load.counts.get(member.display_name) ?? 0
                return (
                  <Fragment key={member.id}>
                    {showGroupCaption && (
                      <tr className="grp">
                        <td className="who" colSpan={data.days.length + 1}>{memberGroupLabels()[group]}</td>
                      </tr>
                    )}
                    <tr ref={(node) => { rowRefs.current.set(member.display_name, node) }} aria-current={highlighted || undefined}>
                      <th scope="row" className="who">
                        <span className={cx('who-name', you && 'who-you')} title={member.display_name}>{member.display_name}</span>
                        {you && <span className="who-tag who-you">{t.grid.you}</span>}
                        {out && <span className="who-tag who-out">{t.grid.outOfRotation}</span>}
                        {highlighted && <span className="who-tag who-hl">{t.grid.highlighted}</span>}
                        <span className="who-load" aria-hidden="true">
                          <i style={{ width: `${(count / load.max) * 100}%` }} />
                        </span>
                        <span className="sr-only">{t.grid.dutiesInRange(count)}</span>
                      </th>
                      {data.days.map((day, colIndex) => {
                        const assignments = cellAssignments.get(`${day.service_date}|${member.display_name}`) ?? []
                        const availability = cellAvailability.get(`${member.id}|${day.service_date}`)
                        const isSelected = selected?.day.service_date === day.service_date && selected.member?.id === member.id
                        return (
                          <td
                            key={day.service_date}
                            className={cx(day.is_day_off && 'we', startsWeek(day) && 'wk', day.service_date === today && 'td')}
                          >
                            <button
                              type="button"
                              className={cx('cell', isSelected && 'cell-sel', highlighted && 'cell-hl', day.events.length > 0 && 'cell-ev')}
                              aria-current={isSelected || undefined}
                              style={day.events[0] ? { ['--ev' as string]: `var(--ev-${day.events[0].color})` } : undefined}
                              {...grid.cellProps(rowIndex, colIndex)}
                              onClick={() => openDay(day, member, assignments[0]?.role ?? 'primary')}
                              aria-label={cellLabel(
                                member.display_name,
                                day,
                                assignments.map((assignment) => [
                                  roleLabels()[assignment.role],
                                  assignment.change_kind ? t.changes[assignment.change_kind] : '',
                                ].filter(Boolean).join(' ')),
                                availability?.kind,
                              )}
                            >
                              {assignments.map((assignment) => (
                                <RoleMark key={assignment.role} role={assignment.role} change={assignment.change_kind} size={zoom === '8' ? 'sm' : undefined} />
                              ))}
                              {availability && <AvailabilityMark kind={availability.kind} />}
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Panel
        open={Boolean(selected)}
        onClose={() => { if (!override.isPending) closeInspector() }}
        title={selected ? formatDay(selected.day.service_date) : ''}
        meta={selected && (
          <>
            <Tag>{dayTag(selected.day)}</Tag>
            {!selectedDayPublished && <Tag>{t.inspector.outsidePublication}</Tag>}
          </>
        )}
        footer={roleSwap.open ? roleSwap.footer : staffOpen ? (
          <>
            <Button disabled={override.isPending} onClick={() => { setStaffOpen(false); override.reset() }}>{t.inspector.back}</Button>
            <span className="sp" />
            {/* Focusable while blocked, so the frame above says what is missing. */}
            <Button
              variant="primary"
              loading={override.isPending}
              aria-disabled={saveBlocked || undefined}
              onClick={() => {
                if (saveBlocked) return
                if (historical) {
                  override.reset()
                  setConfirmHistorical(true)
                } else {
                  saveOverride()
                }
              }}
            >
              {historical ? t.confirm.saveHistorical : t.confirm.save}
            </Button>
          </>
        ) : (
          <>
            {canCoordinate && selected && !selectedDayPublished && (
              <LinkButton
                to={`/generator?od=${selected.day.service_date}&do=${fourWeekRangeEnd(selected.day.service_date)}`}
                onClick={closeInspector}
                variant="primary"
              >
                {t.inspector.openGenerator}
              </LinkButton>
            )}
            {canCoordinate && selected && selectedDayPublished && (
              <>
                <Button onClick={() => setEventDialogOpen(true)}>{t.inspector.event}</Button>
                <span className="sp" />
                <Button variant="primary" onClick={() => openStaffChange(selectedRole)}>{t.inspector.changeStaffing}</Button>
              </>
            )}
            {!canCoordinate && selected && ownRole && role !== 'viewer' && (
              <LinkButton
                to={`/zamiany?data=${selected.day.service_date}&rola=${ownRole}`}
                onClick={closeInspector}
                variant="primary"
                icon="swap"
              >
                {t.inspector.requestSwap}
              </LinkButton>
            )}
          </>
        )}
      >
        {selected && !selectedDayPublished && (
          <Box tone="muted">
            {t.inspector.outsideRange} {canCoordinate ? t.inspector.outsideRangeCoordinator : t.inspector.outsideRangeMember}
          </Box>
        )}
        {staffOpen && selected ? (
          <div className="stack-sm">
            <b>{t.inspector.changeTitle}</b>
            <Field label={t.inspector.role} id="calendar-override-role">
              {({ id }) => (
                <Select
                  id={id}
                  name={id}
                  value={selectedRole}
                  disabled={override.isPending}
                  onChange={(event) => { setSelectedRole(event.target.value as AssignmentRole); setStaffMemberId(null); setHistoricalReason(''); override.reset() }}
                >
                  {ROLES.filter((item) => item !== 'late_shift' || !selected.day.is_day_off).map((item) => (
                    <option key={item} value={item}>{roleLabels()[item]}</option>
                  ))}
                </Select>
              )}
            </Field>
            <div className="small muted">{t.inspector.currently(selectedAssignment?.assignee_name ?? t.inspector.noPublishedAssignment)}</div>
            <Field
              label={t.inspector.personFor(roleLabels()[selectedRole], formatShortDate(selected.day.service_date))}
              id="calendar-override-member"
              hint={staffBlockReason ?? candidateHint(chosenCandidate!, selected.day.service_date)}
            >
              {({ id, describedBy }) => (
                <Select
                  id={id}
                  name={id}
                  value={staffMemberId ?? ''}
                  aria-describedby={describedBy}
                  disabled={override.isPending}
                  onChange={(event) => { setStaffMemberId(event.target.value || null); setHistoricalReason(''); override.reset() }}
                >
                  <option value="">{t.inspector.pickPerson}</option>
                  {staffCandidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id} disabled={Boolean(candidate.disabledReason)}>
                      {candidate.disabledReason ? `${candidate.display_name} · ${candidate.disabledReason}` : candidate.display_name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {!staffBlockReason && (
              <DecisionFrame
                violations={violations}
                checkFailed={overrideCheck.isError}
                violationsTitle={t.confirm.breaksRules}
                acknowledged={violationsAcknowledged}
                onAcknowledge={setViolationsAcknowledged}
                error={confirmHistorical ? null : override.error?.message}
                pending={override.isPending}
              >
                {/* NP-16: the number handover this correction ends, stated
                    rather than asked about: ending it is the correction's
                    own effect. */}
                {endsHandover && (
                  <Box tone="warn">{t.confirm.endsHandover(endsHandover.from_name, endsHandover.to_name)}</Box>
                )}
                {/* MED6-04: the same balance projection a team member sees
                    before a swap, beside the rules it is decided with. */}
                {selectedAssignment ? (
                  <SwapImpactPreview
                    serviceDate={selected.day.service_date}
                    role={selectedRole}
                    replacementId={staffMemberId!}
                    mode="override"
                  />
                ) : (
                  <div className="muted small">{t.confirm.emptySlot(chosenCandidate!.display_name)}</div>
                )}
              </DecisionFrame>
            )}
          </div>
        ) : selected && (
          <>
            {selectedGap && selectedDayPublished && (
              <Box tone="bad" title={t.inspector.noFullCoverage}>
                {t.inspector.unstaffedRoles(selectedGap.missing.map((item) => roleLabels()[item]).join(', '))}
              </Box>
            )}
            {dayConflicts.map((item) => (
              <Box key={`${item.member_id}-${item.role}`} tone="warn" title={conflictText(item)}>
                {item.note && `${t.inspector.collisionNote(item.note)} `}
                {selectedDayPublished && (
                  <div className="box-next">
                    <Button size="sm" onClick={() => openStaffChange(item.role)}>{t.inspector.changePerson}</Button>
                  </div>
                )}
              </Box>
            ))}
            <div className="roles" role="group" aria-label={t.inspector.dayStaffing}>
              {ROLES.map((item) => {
                const slot = slots.get(`${selected.day.service_date}|${item}`)
                const conflict = dayConflicts.find((entry) => entry.role === item)
                const notApplicable = item === 'late_shift' && selected.day.is_day_off
                const missing = !slot && !notApplicable && selectedGap?.missing.includes(item)
                const body = (
                  <>
                    <RoleMark role={item} change={slot?.change_kind} />
                    <span className="role-n">
                      {notApplicable
                        ? <span className="muted">{t.inspector.notApplicableDayOff}</span>
                        : (slot?.assignee_name ?? <span className={missing ? undefined : 'muted'}>{t.inspector.unstaffed}</span>)}
                      {!notApplicable && (
                        <small>{coverageWindowText(selected.day, item)}{slot?.change_kind && ` · ${t.changes[slot.change_kind]}`}</small>
                      )}
                    </span>
                    {conflict && <span className="sr-only">{conflictText(conflict)}</span>}
                  </>
                )
                const lit = roleSwap.open ? roleSwap.covers(item) : selectedRole === item
                const className = cx('role-row', lit && 'role-row-sel', missing && 'role-row-gap')
                return (
                  <Fragment key={item}>
                    {canCoordinate && selectedDayPublished && !notApplicable ? (
                      <button type="button" className={className} onClick={() => openStaffChange(item)} aria-label={[slot ? t.inspector.changeRole(roleLabels()[item], slot.assignee_name) : t.inspector.staffRole(roleLabels()[item]), conflict && conflictText(conflict)].filter(Boolean).join('. ')}>
                        {body}
                        {/* The whole row is the button; this only shows that it is one. */}
                        <span className={cx('btn', 'btn-sm', slot && 'btn-ghost')} aria-hidden="true">{slot ? t.inspector.change : t.inspector.staff}</span>
                      </button>
                    ) : (
                      <div className={className}>{body}</div>
                    )}
                    {item === 'primary' && roleSwap.trigger}
                  </Fragment>
                )
              })}
            </div>
            {roleSwap.frame}
            {selected.day.events.length > 0 && (
              <div className="stack-sm">
                <div className="impact-h">{t.inspector.events}</div>
                {selected.day.events.map((event) => (
                  <div key={event.id} className="row row-between">
                    <span><i className="event-swatch" style={{ background: `var(--ev-${event.color})` }} />{event.title}</span>
                    {canCoordinate && (
                      <Button size="sm" variant="ghost" icon="trash" disabled={deleteEvent.isPending} onClick={() => { deleteEvent.reset(); deleteEvent.mutate({ event, day: selected.day.service_date }) }}>{t.inspector.delete}</Button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {dayAvailability.length > 0 && (
              <div className="avail">
                <div className="impact-h">{t.inspector.availabilityToday}</div>
                {dayAvailability.map((item) => (
                  <div key={`${item.member_id}-${item.starts_on}`} className="avail-row">
                    <AvailabilityMark kind={item.kind} />
                    <span>{item.display_name}: {availabilityLabels()[item.kind]}{item.note ? ` - ${item.note}` : ''}</span>
                  </div>
                ))}
              </div>
            )}
            {selected.member && (
              <div className="muted small">
                {t.inspector.fromRow(selected.member.display_name)}
                {!canCoordinate && !ownRole && ` ${t.inspector.publishedDetails}`}
              </div>
            )}
            {deleteEvent.error && <Box tone="bad" role="alert" title={deleteEvent.error.message} />}
          </>
        )}
      </Panel>

      <DayEventDialog
        serviceDate={eventDialogOpen && selected ? selected.day.service_date : null}
        onClose={() => setEventDialogOpen(false)}
        onCreated={eventCreated}
      />
      <ConfirmDialog
        open={confirmHistorical}
        title={t.confirm.historicalTitle}
        confirmLabel={t.confirm.save}
        reasonLabel={t.confirm.historicalReason}
        reasonMinLength={10}
        initialReason={historicalReason}
        confirmDisabled={saveBlocked}
        pending={override.isPending}
        error={confirmHistorical ? override.error?.message : null}
        onCancel={() => setConfirmHistorical(false)}
        onConfirm={(reason) => { setHistoricalReason(reason); saveOverride(reason) }}
      />
    </>
  )
}
