import { Fragment, ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AssignmentRole, CalendarData, CalendarEventColor, CalendarEventRef, UserRole, api } from '../api'
import { availabilityLabels, cellLabel, roleLabels } from '../lib/labels'
import { formatDate, fourWeekRangeEnd, warsawDate } from '../lib/dates'
import {
  MEMBER_GROUP_LABELS,
  availabilityDutyConflicts,
  coverageGaps,
  hasDutyInRange,
  memberGroup,
  monthGroups,
  orderMembers,
  staffingCandidates,
  startsWeek,
} from '../lib/calendar'
import { useGridNavigation } from '../hooks/useGridNavigation'
import { CalendarDayList } from './CalendarDayList'
import { ConfirmDialog } from './ConfirmDialog'
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
  Input,
  LinkButton,
  Panel,
  RoleMark,
  Select,
  Skeleton,
  Tag,
  cx,
} from '../ui'

export type MatrixZoom = '2' | '4' | '8'
export interface CalendarRange { starts_on: string; ends_on: string }
export interface MatrixSummary { people: number; onDuty: number }
type Day = CalendarData['days'][number]
type Member = CalendarData['members'][number]

const ROLES: AssignmentRole[] = ['primary', 'secondary', 'late_shift']

/** Clock window of a duty, mirroring backend coverage.py (PLAN.md §3). */
export function coverageWindowText(day: Pick<Day, 'is_day_off'>, role: AssignmentRole): string {
  if (role === 'late_shift') return '11:00–19:00'
  return day.is_day_off ? 'całodobowo' : '19:00–09:00'
}

const CHANGE_LABELS: Record<string, string> = {
  swap: 'zamiana',
  manual_override: 'korekta',
}

export const EVENT_COLORS: Array<{ value: CalendarEventColor; label: string }> = [
  { value: 'blue', label: 'Niebieski' },
  { value: 'green', label: 'Zielony' },
  { value: 'amber', label: 'Bursztynowy' },
  { value: 'red', label: 'Czerwony' },
  { value: 'violet', label: 'Fioletowy' },
  { value: 'teal', label: 'Turkusowy' },
]

/** What a day is worth and why, as the inspector's title tag. */
function dayTag(day: Day) {
  if (day.holiday_name) return `2X · ${day.holiday_name}`
  if (day.is_day_off) return '2X · dzień wolny'
  return '1X · dzień roboczy'
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
  extraChips,
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
   *  function receives how many people the range holds and how many of them
   *  have a duty in it. */
  heading?: ReactNode | ((summary: MatrixSummary) => ReactNode)
  /** The "Teraz" screen carries the risk chips; the full schedule does not. */
  showRisks?: boolean
  /** Chips the screen adds to the risk row: swaps waiting, the fairness verdict. */
  extraChips?: ReactNode
}) {
  const queryClient = useQueryClient()
  const today = warsawDate()
  const calendar = useQuery({
    queryKey: ['calendar', range.starts_on, range.ends_on],
    queryFn: () => api.calendar(range.starts_on, range.ends_on),
    enabled,
  })
  // The inspector is day-scoped. `member` is the row that was clicked - context
  // for reading the day, never the target of a staffing change (MED6-03). The
  // change form names its person explicitly through `staffMemberId`.
  const [selected, setSelected] = useState<{ member?: Member; day: Day } | null>(null)
  const [selectedRole, setSelectedRole] = useState<AssignmentRole>('primary')
  const [staffOpen, setStaffOpen] = useState(false)
  const [staffMemberId, setStaffMemberId] = useState<string | null>(null)
  const [confirmOverride, setConfirmOverride] = useState(false)
  const [eventTitle, setEventTitle] = useState('')
  const [eventColor, setEventColor] = useState<CalendarEventColor>('blue')
  const [eventFormOpen, setEventFormOpen] = useState(false)
  const [eventToDelete, setEventToDelete] = useState<CalendarEventRef | null>(null)

  const closeInspector = () => {
    setSelected(null)
    setStaffOpen(false)
    setStaffMemberId(null)
    setConfirmOverride(false)
    setEventFormOpen(false)
  }
  const openDay = (day: Day, member: Member | undefined, nextRole: AssignmentRole) => {
    setSelected({ member, day })
    setSelectedRole(nextRole)
    setStaffOpen(false)
    setStaffMemberId(null)
    setEventFormOpen(false)
  }
  const override = useMutation({
    mutationFn: api.directOverride,
    onSuccess: () => {
      closeInspector()
      queryClient.invalidateQueries({ queryKey: ['calendar'] })
      queryClient.invalidateQueries({ queryKey: ['published-schedule'] })
    },
  })
  // Decision D3: the hard rules this override would break are shown in the
  // confirmation before the coordinator clicks, not after the fact.
  const overrideCheck = useQuery({
    queryKey: ['override-check', selected?.day.service_date, selectedRole, staffMemberId],
    queryFn: () => api.directOverrideCheck({
      service_date: selected!.day.service_date,
      role: selectedRole,
      replacement_member_id: staffMemberId!,
    }),
    enabled: confirmOverride && Boolean(selected) && Boolean(staffMemberId),
  })
  const refreshCalendar = () => queryClient.invalidateQueries({ queryKey: ['calendar'] })
  const createEvent = useMutation({
    mutationFn: api.createCalendarEvent,
    onSuccess: (event) => {
      setEventTitle('')
      setEventFormOpen(false)
      setSelected((current) => current ? {
        ...current,
        day: { ...current.day, events: [...current.day.events, event] },
      } : null)
      refreshCalendar()
    },
  })
  const deleteEvent = useMutation({
    mutationFn: api.deleteCalendarEvent,
    onSuccess: (_result, eventId) => {
      setEventToDelete(null)
      setSelected((current) => current ? {
        ...current,
        day: { ...current.day, events: current.day.events.filter((event) => event.id !== eventId) },
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
    people: data?.members.length ?? 0,
    onDuty: data ? data.members.filter((member) => hasDutyInRange(member, data.assignments)).length : 0,
  }), [data])
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
    if (!data || !focusDay || consumedDay.current === focusDay) return
    const day = dayByDate.get(focusDay)
    if (!day) return
    consumedDay.current = focusDay
    openDay(day, undefined, 'primary')
    const col = data.days.findIndex((item) => item.service_date === focusDay)
    if (col >= 0 && view === 'matrix') grid.focusCell(0, col)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, focusDay, dayByDate])
  const rowRefs = useRef(new Map<string, HTMLTableRowElement | null>())
  const consumedPerson = useRef<string | null>(null)
  useEffect(() => {
    if (!data || !focusPerson || consumedPerson.current === focusPerson) return
    const row = rowRefs.current.get(focusPerson)
    if (!row) return
    consumedPerson.current = focusPerson
    row.scrollIntoView({ block: 'center' })
  }, [data, focusPerson, members])

  const selectedAssignment = selected
    ? data?.assignments.find((item) => item.service_date === selected.day.service_date && item.role === selectedRole)
    : undefined
  const selectedDayPublished = selected ? (dayByDate.get(selected.day.service_date)?.published ?? true) : true
  // Every availability entry that covers the open day, named - the inspector is
  // about the whole day, not the one row that was clicked (MED6-03).
  const dayAvailability = useMemo(() => {
    if (!data || !selected) return []
    return data.availability
      .filter((item) => item.starts_on <= selected.day.service_date && item.ends_on >= selected.day.service_date)
      .map((item) => ({
        ...item,
        display_name: data.members.find((member) => member.id === item.member_id)?.display_name ?? 'nieznana osoba',
      }))
      .sort((a, b) => a.display_name.localeCompare(b.display_name, 'pl'))
  }, [data, selected])
  // Who the coordinator may move into the role the change form currently shows.
  const staffCandidates = useMemo(
    () => (data && selected ? staffingCandidates(data, selected.day.service_date, selectedRole) : []),
    [data, selected, selectedRole],
  )
  const chosenCandidate = staffCandidates.find((item) => item.id === staffMemberId)
  const staffBlockReason = !selectedDayPublished
    ? 'Dzień jest poza opublikowanym grafikiem.'
    : !staffMemberId
      ? 'Wybierz osobę, która ma objąć tę rolę.'
      : chosenCandidate?.disabledReason
        ? `Wybrana osoba ${chosenCandidate.disabledReason}.`
        : undefined
  const openStaffChange = (nextRole: AssignmentRole) => {
    // The role select drops „11–19" on a day off, so never open the form with
    // it pre-selected there.
    const safeRole: AssignmentRole = nextRole === 'late_shift' && selected?.day.is_day_off ? 'primary' : nextRole
    setSelectedRole(safeRole)
    setStaffMemberId(null)
    override.reset()
    setStaffOpen(true)
  }
  const jumpToDate = (date: string) => {
    if (!data) return
    const day = dayByDate.get(date)
    if (!day) return
    if (view === 'matrix') {
      const index = data.days.findIndex((item) => item.service_date === date)
      if (index >= 0) grid.focusCell(0, index)
    }
    openDay(day, undefined, 'primary')
  }
  const jumpToFirstGap = () => {
    // Prefer the staffable kind; jumping to a day nobody can fix was the trap
    // behind HGH-02.
    const first = publishedGaps[0] ?? gaps[0]
    if (first) jumpToDate(first.service_date)
  }
  const selectedGap = selected ? gaps.find((gap) => gap.service_date === selected.day.service_date) : undefined
  const isOwnDay = Boolean(selected && data?.assignments.some(
    (item) => item.service_date === selected.day.service_date && item.assignee_name === displayName,
  ))
  const ownRole = selected
    ? data?.assignments.find((item) => item.service_date === selected.day.service_date && item.assignee_name === displayName)?.role
    : undefined

  const scheduleRef = (selectedAssignment ?? data?.assignments.find(
    (item) => item.service_date === selected?.day.service_date,
  ))

  const riskChips = data && showRisks && (gaps.length > 0 || (canCoordinate && dutyConflicts.length > 0) || publishedGaps.length === 0)

  return (
    <>
      {(riskChips || extraChips) && (
        <ChipRow label="Ryzyka w zakresie">
          {riskChips && (
            <>
          {publishedGaps.length > 0 && (
            <Chip tone="bad" onClick={jumpToFirstGap} title="Pokaż pierwszy dzień bez pełnej obsady">
              {publishedGaps.length === 1 ? '1 dzień bez pełnej obsady' : `${publishedGaps.length} dni bez pełnej obsady`}
              {' · '}
              {publishedGaps.slice(0, 3).map((gap) => formatDate(gap.service_date).slice(0, 5)).join(', ')}
              {publishedGaps.length > 3 ? '…' : ''}
            </Chip>
          )}
          {outsideGaps.length > 0 && (
            <Chip tone="warn" title={canCoordinate ? 'Obsadzenie wymaga wygenerowania i opublikowania nowego grafiku' : 'Koordynator jeszcze nie opublikował tego okresu'}>
              {outsideGaps.length === 1 ? '1 dzień poza opublikowanym grafikiem' : `${outsideGaps.length} dni poza opublikowanym grafikiem`}
            </Chip>
          )}
          {canCoordinate && dutyConflicts.length > 0 && (
            <Chip tone="bad" onClick={() => jumpToDate(dutyConflicts[0].service_date)} title="Pokaż pierwszy taki dzień">
              {dutyConflictPeople === 1 ? '1 osoba z dyżurem w dniu niedostępności' : `${dutyConflictPeople} osób z dyżurem w dniu niedostępności`}
            </Chip>
          )}
          {gaps.length === 0 && (!canCoordinate || dutyConflicts.length === 0) && (
            <Chip tone="ok">Pełna obsada w całym zakresie</Chip>
          )}
            </>
          )}
          {extraChips}
        </ChipRow>
      )}
      {typeof heading === 'function' ? heading(summary) : heading}
      {calendar.error && <ErrorState error={calendar.error} onRetry={() => calendar.refetch()} />}
      {(calendar.isLoading || !enabled) && (
        <div className="panel sk-block" aria-busy="true" aria-label="Wczytywanie grafiku">
          <Skeleton height={22} width="min(340px, 100%)" />
          <Skeleton height={34 * 5} />
        </div>
      )}
      {data && hideIdle && members.length === 0 && (
        <EmptyState compact icon="calendar" title="Nikt nie ma dyżuru w tym zakresie" />
      )}
      {data && view === 'list' && (
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
        <div className="mx panel" role="region" aria-label="Macierz grafiku" tabIndex={-1}>
          <table className="m" data-zoom={zoom}>
            <caption className="sr-only">
              Grafik dyżurów od {formatDate(range.starts_on)} do {formatDate(range.ends_on)}.
              Osoby w wierszach, dni w kolumnach. Strzałkami przechodzisz po siatce, PageUp i PageDown przeskakują o tydzień.
            </caption>
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
                <th scope="col" className="who">Osoba</th>
                {data.days.map((day) => {
                  const isToday = day.service_date === today
                  const gap = gapDates.has(day.service_date) && day.published
                  return (
                    <th
                      scope="col"
                      key={day.service_date}
                      className={cx(day.is_day_off && 'we', startsWeek(day) && 'wk', isToday && 'td', gap && 'gap')}
                      title={[day.holiday_name, ...day.events.map((event) => event.title), gap ? 'brak pełnej obsady' : null]
                        .filter(Boolean).join(' · ') || undefined}
                    >
                      <span>{day.weekday}</span>
                      <b>{day.service_date.slice(8)}</b>
                      {gap && <span className="sr-only">brak pełnej obsady</span>}
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
                        <td className="who" colSpan={data.days.length + 1}>{MEMBER_GROUP_LABELS[group]}</td>
                      </tr>
                    )}
                    <tr ref={(node) => { rowRefs.current.set(member.display_name, node) }}>
                      <th scope="row" className="who">
                        <span className={cx('who-name', you && 'who-you')} title={member.display_name}>{member.display_name}</span>
                        {you && <span className="who-tag who-you">Ty</span>}
                        {out && <span className="who-tag who-out">poza rotacją</span>}
                        <span className="who-load" aria-hidden="true">
                          <i style={{ width: `${(count / load.max) * 100}%` }} />
                        </span>
                        <span className="sr-only">{count} dyżurów w zakresie</span>
                      </th>
                      {data.days.map((day, colIndex) => {
                        const assignments = data.assignments.filter(
                          (item) => item.service_date === day.service_date && item.assignee_name === member.display_name,
                        )
                        const availability = data.availability.find(
                          (item) => item.member_id === member.id && item.starts_on <= day.service_date && item.ends_on >= day.service_date,
                        )
                        const isSelected = selected?.day.service_date === day.service_date && selected.member?.id === member.id
                        return (
                          <td
                            key={day.service_date}
                            className={cx(day.is_day_off && 'we', startsWeek(day) && 'wk', day.service_date === today && 'td')}
                          >
                            <button
                              type="button"
                              className={cx('cell', isSelected && 'cell-sel', highlighted && 'cell-hl', day.events.length > 0 && 'cell-ev')}
                              style={day.events[0] ? { ['--ev' as string]: `var(--ev-${day.events[0].color})` } : undefined}
                              {...grid.cellProps(rowIndex, colIndex)}
                              onClick={() => openDay(day, member, assignments[0]?.role ?? 'primary')}
                              aria-label={cellLabel(
                                member.display_name,
                                day,
                                assignments.map((assignment) => [
                                  roleLabels[assignment.role],
                                  assignment.change_kind === 'swap' ? 'zamiana' : '',
                                  assignment.change_kind === 'manual_override' ? 'korekta' : '',
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
        onOpenChange={(open) => { if (!open) closeInspector() }}
        title={selected ? `${selected.day.weekday} ${formatDate(selected.day.service_date)}` : ''}
        meta={selected && (
          <>
            <Tag tone={selected.day.is_day_off ? 'late' : undefined}>{dayTag(selected.day)}</Tag>
            {!selectedDayPublished && <Tag>poza publikacją</Tag>}
          </>
        )}
        footer={staffOpen ? (
          <>
            <Button onClick={() => { setStaffOpen(false); override.reset() }}>Wróć</Button>
            <span className="sp" />
            <Button
              variant="primary"
              disabled={override.isPending || Boolean(staffBlockReason)}
              onClick={() => { override.reset(); setConfirmOverride(true) }}
            >
              {selectedAssignment ? 'Zmień obsadę…' : 'Obsadź…'}
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
                Otwórz generator z tym zakresem
              </LinkButton>
            )}
            {canCoordinate && selected && selectedDayPublished && (
              <>
                <Button icon="event" onClick={() => setEventFormOpen((open) => !open)} aria-expanded={eventFormOpen}>Wydarzenie</Button>
                <span className="sp" />
                <Button variant="primary" onClick={() => openStaffChange(selectedRole)}>Zmień obsadę…</Button>
              </>
            )}
            {!canCoordinate && selected && isOwnDay && role !== 'viewer' && (
              <LinkButton
                to={`/zamiany?data=${selected.day.service_date}&rola=${ownRole ?? selectedRole}`}
                onClick={closeInspector}
                variant="primary"
                icon="swap"
              >
                Poproś o zamianę
              </LinkButton>
            )}
          </>
        )}
      >
        {selected && !selectedDayPublished && (
          <Box tone="muted">
            Ten dzień jest poza opublikowanym zakresem grafiku.
            {canCoordinate
              ? ' Żeby go obsadzić, wygeneruj i opublikuj grafik obejmujący tę datę.'
              : ' Koordynator jeszcze nie opublikował grafiku na ten okres.'}
          </Box>
        )}
        {staffOpen && selected ? (
          <div className="stack-sm">
            <b>Zmień obsadę tego dnia</b>
            <Field label="Rola" id="calendar-override-role">
              {({ id }) => (
                <Select
                  id={id}
                  name={id}
                  value={selectedRole}
                  onChange={(event) => { setSelectedRole(event.target.value as AssignmentRole); setStaffMemberId(null) }}
                >
                  {ROLES.filter((item) => item !== 'late_shift' || !selected.day.is_day_off).map((item) => (
                    <option key={item} value={item}>{roleLabels[item]}</option>
                  ))}
                </Select>
              )}
            </Field>
            <div className="small muted">Obecnie: {selectedAssignment?.assignee_name ?? 'brak opublikowanego przydziału'}</div>
            <Field label="Osoba" id="calendar-override-member" hint={staffBlockReason}>
              {({ id, describedBy }) => (
                <Select
                  id={id}
                  name={id}
                  value={staffMemberId ?? ''}
                  aria-describedby={describedBy}
                  onChange={(event) => setStaffMemberId(event.target.value || null)}
                >
                  <option value="">Wybierz osobę</option>
                  {staffCandidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id} disabled={Boolean(candidate.disabledReason)}>
                      {candidate.display_name}{candidate.disabledReason ? ` - ${candidate.disabledReason}` : ''}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {/* While the confirmation covers this panel the error must live
                there; render it here only once the confirmation is gone. */}
            {override.error && !confirmOverride && <Box tone="bad" role="alert" title={override.error.message} />}
          </div>
        ) : selected && (
          <>
            {selectedGap && selectedDayPublished && (
              <Box tone="bad" title="Brak pełnej obsady">
                Nieobsadzone: {selectedGap.missing.map((item) => roleLabels[item]).join(', ')}.
              </Box>
            )}
            <div className="roles" aria-label="Obsada dnia">
              {ROLES.map((item) => {
                const slot = data?.assignments.find((entry) => entry.service_date === selected.day.service_date && entry.role === item)
                const notApplicable = item === 'late_shift' && selected.day.is_day_off
                const missing = !slot && !notApplicable && selectedGap?.missing.includes(item)
                const body = (
                  <>
                    <RoleMark role={item} change={slot?.change_kind} />
                    <span className="role-n">
                      {notApplicable
                        ? <span className="muted">nie dotyczy w dzień wolny</span>
                        : (slot?.assignee_name ?? <span className={missing ? undefined : 'muted'}>brak obsady</span>)}
                      {slot?.change_kind && <small>{CHANGE_LABELS[slot.change_kind]}</small>}
                    </span>
                    {!notApplicable && <span className="role-x mono">{coverageWindowText(selected.day, item)}</span>}
                  </>
                )
                const className = cx('role-row', selectedRole === item && 'role-row-sel', missing && 'role-row-gap')
                return canCoordinate && selectedDayPublished && !notApplicable ? (
                  <button type="button" key={item} className={className} onClick={() => openStaffChange(item)} aria-label={`${roleLabels[item]}: ${slot?.assignee_name ?? 'brak obsady'}. Zmień obsadę`}>
                    {body}
                  </button>
                ) : (
                  <div key={item} className={className}>{body}</div>
                )
              })}
            </div>
            {selected.day.events.length > 0 && (
              <div className="stack-sm">
                <div className="impact-h">Wydarzenia</div>
                {selected.day.events.map((event) => (
                  <div key={event.id} className="row" style={{ justifyContent: 'space-between' }}>
                    <span><i className="event-swatch" style={{ background: `var(--ev-${event.color})` }} />{event.title}</span>
                    {canCoordinate && (
                      <Button size="sm" variant="ghost" icon="trash" disabled={deleteEvent.isPending} onClick={() => { deleteEvent.reset(); setEventToDelete(event) }}>Usuń</Button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {dayAvailability.length > 0 && (
              <div className="avail">
                <div className="impact-h">Dostępności tego dnia</div>
                {dayAvailability.map((item) => (
                  <div key={`${item.member_id}-${item.starts_on}`} className="avail-row">
                    <AvailabilityMark kind={item.kind} />
                    <span>{item.display_name}: {availabilityLabels[item.kind]}{item.note ? ` - ${item.note}` : ''}</span>
                  </div>
                ))}
              </div>
            )}
            {selected.member && (
              <div className="muted small">
                Z wiersza osoby: {selected.member.display_name}.
                {!canCoordinate && !isOwnDay && ' Szczegóły opublikowanego grafiku.'}
              </div>
            )}
            {(createEvent.error || deleteEvent.error) && (
              <Box tone="bad" role="alert" title={createEvent.error?.message ?? deleteEvent.error?.message} />
            )}
            {canCoordinate && eventFormOpen && (
              <form
                className="stack-sm"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (!eventTitle.trim()) return
                  createEvent.mutate({
                    starts_on: selected.day.service_date,
                    ends_on: selected.day.service_date,
                    title: eventTitle.trim(),
                    color: eventColor,
                  })
                }}
              >
                <b>Dodaj wydarzenie tego dnia</b>
                <Field label="Nazwa" id="calendar-event-title">
                  {({ id }) => <Input id={id} name={id} value={eventTitle} onChange={(event) => setEventTitle(event.target.value)} autoFocus required />}
                </Field>
                <Field label="Kolor" id="calendar-event-color">
                  {({ id }) => (
                    <div className="color-pick" role="radiogroup" aria-label="Kolor" id={id}>
                      {EVENT_COLORS.map((color) => (
                        <button
                          type="button"
                          key={color.value}
                          role="radio"
                          aria-checked={eventColor === color.value}
                          aria-label={color.label}
                          title={color.label}
                          className={cx(eventColor === color.value && 'on')}
                          style={{ background: `var(--ev-${color.value})` }}
                          onClick={() => setEventColor(color.value)}
                        />
                      ))}
                    </div>
                  )}
                </Field>
                <div className="row">
                  <Button type="submit" variant="primary" size="sm" disabled={!eventTitle.trim()} loading={createEvent.isPending}>Dodaj wydarzenie</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEventFormOpen(false)}>Anuluj</Button>
                </div>
              </form>
            )}
          </>
        )}
      </Panel>

      <ConfirmDialog
        open={confirmOverride && Boolean(selected)}
        title={selectedAssignment ? 'Potwierdź zmianę obsady' : 'Potwierdź obsadzenie slotu'}
        description={selected ? (
          <>
            <div>
              <span className="mono">{formatDate(selected.day.service_date)}</span> · {roleLabels[selectedRole]}<br />
              Przypiszesz: <b>{chosenCandidate?.display_name ?? '-'}</b>
              {selectedAssignment && <> zamiast {selectedAssignment.assignee_name}</>}
            </div>
            {overrideCheck.isLoading && <div className="muted small">Sprawdzam reguły twarde…</div>}
            {(overrideCheck.data?.length ?? 0) > 0 && (
              <Box tone="warn" title="Ta korekta złamie reguły twarde">
                <ul className="box-list">
                  {overrideCheck.data!.map((violation, index) => (
                    <li key={index}>
                      {violation.message} ({violation.member_name}: {violation.days.map(formatDate).join(', ')})
                    </li>
                  ))}
                </ul>
                <div className="box-next">Naruszenie trafi do dziennika audytu.</div>
              </Box>
            )}
            {/* MED6-04: the same balance projection a team member sees before a
                swap - the confirmation is the only pause before the change is
                written, so it carries the full picture. */}
            {selectedAssignment && staffMemberId ? (
              <SwapImpactPreview
                serviceDate={selected.day.service_date}
                role={selectedRole}
                replacementId={staffMemberId}
                mode="override"
              />
            ) : staffMemberId ? (
              <div className="muted small">
                Slot był pusty - korekta dokłada dyżur tylko osobie {chosenCandidate?.display_name ?? ''}, nie zdejmuje go nikomu.
              </div>
            ) : null}
          </>
        ) : undefined}
        confirmLabel={selectedAssignment ? 'Zmień obsadę' : 'Obsadź'}
        reasonLabel={selected?.day.service_date && selected.day.service_date < today
          ? 'Powód korekty historycznej (minimum 10 znaków)'
          : undefined}
        reasonMinLength={10}
        pending={override.isPending}
        error={override.error ? override.error.message : null}
        onCancel={() => setConfirmOverride(false)}
        onConfirm={(reason) => selected && staffMemberId && scheduleRef && override.mutate({
          schedule_id: scheduleRef.schedule_id,
          expected_version: scheduleRef.schedule_version,
          service_date: selected.day.service_date,
          role: selectedRole,
          replacement_member_id: staffMemberId,
          reason: reason || undefined,
        })}
      />
      <ConfirmDialog
        open={Boolean(eventToDelete)}
        pending={deleteEvent.isPending}
        error={deleteEvent.error ? deleteEvent.error.message : null}
        onCancel={() => setEventToDelete(null)}
        onConfirm={() => eventToDelete && deleteEvent.mutate(eventToDelete.id)}
        title="Usunąć wydarzenie?"
        confirmLabel="Usuń"
        confirmColor="error"
        description={eventToDelete && <>„{eventToDelete.title}” zniknie ze wszystkich dni, na które je dodano. Tej operacji nie da się cofnąć.</>}
      />
    </>
  )
}
