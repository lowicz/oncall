import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Paper,
  Skeleton,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import ChevronLeft from '@mui/icons-material/ChevronLeft'
import ChevronRight from '@mui/icons-material/ChevronRight'
import { AssignmentRole, CalendarData, CalendarEventColor, UserRole, api } from '../api'
import { availabilityLabels, cellLabel, roleLabels, shortRoleLabels } from '../lib/labels'
import { addDays, formatDate, fourWeekRangeEnd, warsawDate } from '../lib/dates'
import {
  MEMBER_GROUP_LABELS,
  availabilityCodes,
  availabilityDutyConflicts,
  changeCodes,
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
import { DateField } from './DateField'
import { ConfirmDialog } from './ConfirmDialog'
import { SwapImpactPreview } from './SwapImpactPreview'

/** Kept in sync with .calendar-matrix in styles.css. */
const MEMBER_COL = 150
const DAY_COL = 44
/** Header rows plus four member rows: close enough to the real table that the
 *  content below does not jump when the data lands. */
const CALENDAR_SKELETON_HEIGHT = 24 + 56 + 4 * 60

/** Clock window of a duty, mirroring backend coverage.py (PLAN.md §3). */
function coverageWindowText(day: CalendarData['days'][number], role: AssignmentRole): string {
  if (role === 'late_shift') return '11:00-19:00'
  return day.is_day_off ? 'całodobowo' : '19:00-09:00'
}

const CHANGE_LABELS: Record<string, string> = {
  swap: 'zamiana',
  manual_override: 'korekta koordynatora',
}

const EVENT_COLORS: Array<{ value: CalendarEventColor; label: string }> = [
  { value: 'blue', label: 'Niebieski' },
  { value: 'green', label: 'Zielony' },
  { value: 'amber', label: 'Bursztynowy' },
  { value: 'red', label: 'Czerwony' },
  { value: 'violet', label: 'Fioletowy' },
  { value: 'teal', label: 'Turkusowy' },
]

function Legend({ showAvailability }: { showAvailability: boolean }) {
  return (
    <Box className="calendar-legend" aria-label="Legenda oznaczeń">
      <span><b className="calendar-duty duty-primary">P</b> primary</span>
      <span><b className="calendar-duty duty-secondary">S</b> secondary</span>
      <span><b className="calendar-duty duty-late_shift">11–19</b> zmiana 11–19</span>
      <span><b className="calendar-duty duty-primary">Z</b> zamiana</span>
      <span><b className="calendar-duty duty-primary">K</b> korekta koordynatora</span>
      <span><b className="calendar-duty duty-primary">H</b> korekta historyczna</span>
      {showAvailability && <span><b className="calendar-state state-unavailable">N</b> nie mogę</span>}
      {showAvailability && <span><b className="calendar-state">W</b> wolę nie</span>}
      {showAvailability && <span><b className="calendar-state state-prefer">C</b> chętnie wezmę</span>}
      <span><b className="coverage-flag">!</b> brak obsady</span>
      <span><b className="calendar-event-key" /> wydarzenie</span>
    </Box>
  )
}

export function CalendarMatrix({ role, displayName }: { role: UserRole; displayName: string }) {
  const queryClient = useQueryClient()
  const today = warsawDate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [hideIdle, setHideIdle] = useState(false)
  const [view, setView] = useState<'matrix' | 'list'>(
    () => (typeof window !== 'undefined' && window.innerWidth < 760 ? 'list' : 'matrix'),
  )
  useEffect(() => {
    const narrow = window.matchMedia('(max-width: 759px)')
    const apply = (matches: boolean) => setView(matches ? 'list' : 'matrix')
    apply(narrow.matches)
    const onChange = (event: MediaQueryListEvent) => apply(event.matches)
    narrow.addEventListener('change', onChange)
    return () => narrow.removeEventListener('change', onChange)
  }, [])
  // A rigid 30-day default painted 29 red exclamation marks over days nobody
  // had published yet, duplicating the banner above it. The default now ends
  // where the published coverage ends (LOW5-05); „Najbliższe 30 dni" is still
  // one click away for looking past it.
  const published = useQuery({
    queryKey: ['published-schedule'],
    queryFn: api.publishedSchedule,
  })
  const coveredEnd = published.data?.ends_on
  // QA7-L01: an empty installation has no publication at all, so there is no
  // coverage end to shrink the window to - fall back to the same 30-day
  // default the toggle below offers, instead of collapsing to a single day.
  const defaultEnd = !published.data?.is_published
    ? addDays(today, 29)
    : coveredEnd && coveredEnd >= today
      ? (coveredEnd < addDays(today, 29) ? coveredEnd : addDays(today, 29))
      : today
  const explicitRange = searchParams.has('od') && searchParams.has('do')
  const range = {
    starts_on: searchParams.get('od') ?? today,
    ends_on: searchParams.get('do') ?? defaultEnd,
  }
  const setRange = (value: { starts_on: string; ends_on: string }) => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current)
        next.set('od', value.starts_on)
        next.set('do', value.ends_on)
        return next
      },
      { replace: true },
    )
  }
  const shiftRange = (days: number) => setRange({
    starts_on: addDays(range.starts_on, days),
    ends_on: addDays(range.ends_on, days),
  })
  // The drawer is day-scoped. `member` is the row that was clicked - context for
  // reading the day, never the target of a staffing change (MED6-03). The change
  // form names its person explicitly through `staffMemberId`.
  const [selected, setSelected] = useState<{
    member?: CalendarData['members'][number]
    day: CalendarData['days'][number]
  } | null>(null)
  const [selectedRole, setSelectedRole] = useState<AssignmentRole>('primary')
  const [staffOpen, setStaffOpen] = useState(false)
  const [staffMemberId, setStaffMemberId] = useState<string | null>(null)
  const [confirmOverride, setConfirmOverride] = useState(false)
  const [eventTitle, setEventTitle] = useState('')
  const [eventColor, setEventColor] = useState<CalendarEventColor>('blue')
  const calendar = useQuery({
    queryKey: ['calendar', range.starts_on, range.ends_on],
    queryFn: () => api.calendar(range.starts_on, range.ends_on),
    // Without this the default range is „today only" until the publication
    // query lands, so the matrix would fetch and paint one column and then
    // jump to the covered range.
    enabled: explicitRange || published.isSuccess || published.isError,
  })
  const closeDrawer = () => {
    setSelected(null)
    setStaffOpen(false)
    setStaffMemberId(null)
    setConfirmOverride(false)
  }
  const override = useMutation({
    mutationFn: api.directOverride,
    onSuccess: () => {
      closeDrawer()
      queryClient.invalidateQueries({ queryKey: ['calendar'] })
      queryClient.invalidateQueries({ queryKey: ['published-schedule'] })
    },
  })
  // Decision D3: the hard rules this override would break are shown in the
  // confirmation dialog before the coordinator clicks, not after the fact.
  const overrideCheck = useQuery({
    queryKey: [
      'override-check',
      selected?.day.service_date,
      selectedRole,
      staffMemberId,
    ],
    queryFn: () =>
      api.directOverrideCheck({
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
  const dutyConflicts = useMemo(
    () => (data ? availabilityDutyConflicts(data) : []),
    [data],
  )
  const dutyConflictPeople = useMemo(
    () => new Set(dutyConflicts.map((item) => item.member_id)).size,
    [dutyConflicts],
  )
  const gapDates = useMemo(() => new Set(gaps.map((gap) => gap.service_date)), [gaps])
  const dayByDate = useMemo(
    () => new Map((data?.days ?? []).map((day) => [day.service_date, day])),
    [data],
  )
  // A gap inside a published schedule is staffable by an override; a gap beyond
  // every published range needs a new publication, so the two must not be
  // announced with the same words (QA-REPORT-2, HGH-02).
  const publishedGaps = useMemo(
    () => gaps.filter((gap) => dayByDate.get(gap.service_date)?.published),
    [gaps, dayByDate],
  )
  const outsideGaps = useMemo(
    () => gaps.filter((gap) => !dayByDate.get(gap.service_date)?.published),
    [gaps, dayByDate],
  )
  const months = useMemo(() => (data ? monthGroups(data.days) : []), [data])
  const members = useMemo(() => {
    if (!data) return []
    const ordered = orderMembers(data.members, data.assignments, displayName)
    return hideIdle
      ? ordered.filter((member) => hasDutyInRange(member, data.assignments))
      : ordered
  }, [data, displayName, hideIdle])

  const grid = useGridNavigation(members.length, data?.days.length ?? 0)

  const selectedAssignment = selected
    ? data?.assignments.find(
      (item) => item.service_date === selected.day.service_date && item.role === selectedRole,
    )
    : undefined
  const selectedDayPublished = selected
    ? (dayByDate.get(selected.day.service_date)?.published ?? true)
    : true
  // Every availability entry that covers the open day, named - „szczegóły dnia"
  // are about the whole day, not the one row that was clicked (MED6-03).
  const dayAvailability = useMemo(() => {
    if (!data || !selected) return []
    return data.availability
      .filter((item) => item.starts_on <= selected.day.service_date
        && item.ends_on >= selected.day.service_date)
      .map((item) => ({
        ...item,
        display_name: data.members.find((member) => member.id === item.member_id)?.display_name
          ?? 'nieznana osoba',
      }))
      .sort((a, b) => a.display_name.localeCompare(b.display_name, 'pl'))
  }, [data, selected])
  // Who the coordinator may move into the role the change form currently shows.
  // The person is chosen from this list, not derived from the clicked cell, so
  // „żeby zdjąć dyżur z X trzeba kliknąć pustą komórkę Y" stops being true.
  const staffCandidates = useMemo(
    () => (data && selected
      ? staffingCandidates(data, selected.day.service_date, selectedRole)
      : []),
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
    // The role select drops „11-19" on a day off, so never open the form with it
    // pre-selected there - a value with no MenuItem renders an empty select.
    const safeRole: AssignmentRole = nextRole === 'late_shift' && selected?.day.is_day_off
      ? 'primary'
      : nextRole
    setSelectedRole(safeRole)
    setStaffMemberId(null)
    override.reset()
    setStaffOpen(true)
  }

  const jumpToFirstGap = () => {
    // Prefer the staffable kind; jumping to a day nobody can fix was the trap
    // behind HGH-02.
    const first = publishedGaps[0] ?? gaps[0]
    if (!first || !data) return
    const index = data.days.findIndex((day) => day.service_date === first.service_date)
    if (index < 0) return
    grid.focusCell(0, index)
  }

  return (
    <Box className="calendar-section" id="kalendarz">
      <Box>
        <Typography className="eyebrow">[KALENDARZ OPERACYJNY]</Typography>
        <Typography variant="h1">Kalendarz zespołu</Typography>
        <Typography color="text.secondary">
          {view === 'matrix'
            ? 'Osoby w wierszach, dni w kolumnach. Strzałkami przechodzisz po siatce, PageUp i PageDown przeskakują o tydzień.'
            : 'Dzień po dniu, z obsadą każdej roli. Dotknij roli, aby zobaczyć szczegóły.'}
        </Typography>
      </Box>
      <Paper component="form" variant="outlined" className="form-row calendar-controls">
        <Button
          onClick={() => shiftRange(-7)}
          startIcon={<ChevronLeft />}
          aria-label="Cofnij zakres o tydzień"
        >
          Tydzień
        </Button>
        <DateField
          id="calendar-from"
          label="Od"
          value={range.starts_on}
          onChange={(value) => setRange({ ...range, starts_on: value })}
        />
        <DateField
          id="calendar-to"
          label="Do"
          value={range.ends_on}
          onChange={(value) => setRange({ ...range, ends_on: value })}
        />
        <Button
          onClick={() => shiftRange(7)}
          endIcon={<ChevronRight />}
          aria-label="Przesuń zakres o tydzień"
        >
          Tydzień
        </Button>
        <Button onClick={() => setRange({ starts_on: today, ends_on: addDays(today, 29) })}>
          Najbliższe 30 dni
        </Button>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={view}
          onChange={(_event: unknown, next: 'matrix' | 'list' | null) => next && setView(next)}
          aria-label="Widok kalendarza"
          className="calendar-view-toggle"
        >
          <ToggleButton value="matrix">Macierz</ToggleButton>
          <ToggleButton value="list">Lista dni</ToggleButton>
        </ToggleButtonGroup>
        <FormControlLabel
          className="calendar-filter"
          control={(
            <Switch
              size="small"
              checked={hideIdle}
              onChange={(event) => setHideIdle(event.target.checked)}
            />
          )}
          label="Tylko osoby z dyżurem"
        />
      </Paper>
      {calendar.error && <Alert severity="error">{calendar.error.message}</Alert>}
      {calendar.isLoading && (
        <Box className="calendar-skeleton" aria-busy="true" aria-label="Ładowanie kalendarza">
          <Skeleton variant="rectangular" height={22} />
          <Skeleton variant="rectangular" height={CALENDAR_SKELETON_HEIGHT} />
        </Box>
      )}
      {data && gaps.length > 0 && (
        <Alert
          severity="warning"
          action={publishedGaps.length > 0
            ? <Button color="inherit" size="small" onClick={jumpToFirstGap}>Pokaż pierwszy</Button>
            : undefined}
        >
          {publishedGaps.length > 0 && (
            <>
              {publishedGaps.length === 1
                ? '1 dzień w opublikowanym grafiku nie ma pełnej obsady'
                : `${publishedGaps.length} dni w opublikowanym grafiku nie ma pełnej obsady`}
              {': '}
              {publishedGaps.slice(0, 5).map((gap) => (
                `${formatDate(gap.service_date)} (${gap.missing.map((item) => roleLabels[item]).join(', ')})`
              )).join(' · ')}
              {publishedGaps.length > 5 ? ` i ${publishedGaps.length - 5} więcej` : ''}
              . Możesz je obsadzić bezpośrednio z macierzy.
            </>
          )}
          {outsideGaps.length > 0 && (
            <>
              {publishedGaps.length > 0 && ' '}
              {outsideGaps.length === 1
                ? '1 dzień jest poza opublikowanym zakresem'
                : `${outsideGaps.length} dni pozostaje poza opublikowanym zakresem`}
              {' - '}
              {canCoordinate
                ? 'obsadzenie wymaga wygenerowania i opublikowania nowego grafiku.'
                : 'poczekaj, aż koordynator opublikuje kolejny zakres grafiku.'}
            </>
          )}
        </Alert>
      )}
      {canCoordinate && dutyConflicts.length > 0 && (
        <Alert severity="error">
          {dutyConflictPeople === 1
            ? '1 osoba ma dyżur w dniu zgłoszonej niedostępności'
            : `${dutyConflictPeople} osób ma dyżur w dniu zgłoszonej niedostępności`}
          {': '}
          {dutyConflicts.slice(0, 5).map((item) => (
            `${item.display_name} - ${formatDate(item.service_date)} (${roleLabels[item.role]})`
          )).join(' · ')}
          {dutyConflicts.length > 5 ? ` i ${dutyConflicts.length - 5} więcej` : ''}.
        </Alert>
      )}
      {data && hideIdle && members.length === 0 && (
        <Alert severity="info">Nikt nie ma dyżuru w tym zakresie.</Alert>
      )}
      {data && view === 'list' && (
        <CalendarDayList
          data={data}
          displayName={displayName}
          gaps={gaps}
          onSelectDay={(day, role) => {
            const member = members.find((item) => item.display_name === displayName)
            setSelected({ member, day })
            setSelectedRole(role)
            setStaffOpen(false)
            setStaffMemberId(null)
          }}
        />
      )}
      {data && view === 'matrix' && (
        <>
          <Legend showAvailability={role !== 'viewer'} />
          <Paper variant="outlined" className="calendar-scroll calendar-scroll-fit">
            <table
              className="calendar-matrix matrix-grid"
              style={{ width: MEMBER_COL + DAY_COL * data.days.length }}
            >
              <colgroup>
                <col style={{ width: MEMBER_COL }} />
                {data.days.map((day) => (
                  <col key={day.service_date} style={{ width: DAY_COL }} />
                ))}
              </colgroup>
              <caption className="visually-hidden">
                Grafik dyżurów od {formatDate(range.starts_on)} do {formatDate(range.ends_on)}.
                Osoby w wierszach, dni w kolumnach.
              </caption>
              <thead>
                <tr className="month-row">
                  <th scope="col" className="member-column" />
                  {months.map((month) => (
                    <th key={month.key} scope="col" colSpan={month.span} className="month-cell">
                      {/* Sticky so the month stays readable while scrolling inside it. */}
                      <span className="month-label">
                        {month.span >= 5 ? month.label : month.shortLabel}
                      </span>
                    </th>
                  ))}
                </tr>
                <tr className="day-row">
                  <th scope="col" className="member-column">Osoba</th>
                  {data.days.map((day) => {
                    const isToday = day.service_date === today
                    const gap = gapDates.has(day.service_date)
                    const eventColorClass = day.events[0] ? `event-${day.events[0].color}` : ''
                    return (
                      <th
                        scope="col"
                        key={day.service_date}
                        className={[
                          day.is_day_off ? 'day-off' : '',
                          startsWeek(day) ? 'week-start' : '',
                          isToday ? 'is-today' : '',
                          gap && day.published ? 'has-gap' : '',
                          day.events.length ? 'has-event' : '',
                          eventColorClass,
                        ].filter(Boolean).join(' ')}
                        title={[day.holiday_name, ...day.events.map((event) => event.title)]
                          .filter(Boolean).join(' · ') || undefined}
                      >
                        <span>{day.weekday}</span>
                        <strong>{day.service_date.slice(8)}</strong>
                        {gap && day.published && <em className="coverage-flag" title="Brak pełnej obsady">!</em>}
                        {isToday && <small className="today-flag">dziś</small>}
                        {!isToday && day.is_day_off && <small>{day.holiday_name ? 'św.' : '2X'}</small>}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {members.map((member, rowIndex) => {
                  const group = memberGroup(member, data.assignments, displayName)
                  const previousGroup = rowIndex > 0
                    ? memberGroup(members[rowIndex - 1], data.assignments, displayName)
                    : null
                  const showGroupCaption = group !== 'you' && group !== previousGroup
                  return (
                    <Fragment key={member.id}>
                      {showGroupCaption && (
                        <tr className="calendar-group-row">
                          <th scope="rowgroup" colSpan={data.days.length + 1}>
                            {MEMBER_GROUP_LABELS[group]}
                          </th>
                        </tr>
                      )}
                      <tr>
                        <th scope="row" className="member-column">
                          {member.display_name}
                          {member.active_until && member.active_until < range.starts_on && (
                            <Chip label="Poza rotacją" size="small" color="warning" />
                          )}
                          {member.display_name === displayName && (
                            <Chip label="Ty" size="small" className="member-you" />
                          )}
                        </th>
                        {data.days.map((day, colIndex) => {
                          const eventColorClass = day.events[0] ? `event-${day.events[0].color}` : ''
                          const assignments = data.assignments.filter(
                            (item) => item.service_date === day.service_date
                              && item.assignee_name === member.display_name,
                          )
                          const availability = data.availability.find(
                            (item) => item.member_id === member.id
                              && item.starts_on <= day.service_date
                              && item.ends_on >= day.service_date,
                          )
                          return (
                            <td
                              key={day.service_date}
                              className={[
                                day.is_day_off ? 'day-off' : '',
                                startsWeek(day) ? 'week-start' : '',
                                day.service_date === today ? 'is-today' : '',
                                day.events.length ? 'has-event' : '',
                                eventColorClass,
                              ].filter(Boolean).join(' ')}
                            >
                              <button
                                type="button"
                                className="calendar-cell"
                                {...grid.cellProps(rowIndex, colIndex)}
                                onClick={() => {
                                  setSelected({ member, day })
                                  setSelectedRole(assignments[0]?.role ?? 'primary')
                                  setStaffOpen(false)
                                  setStaffMemberId(null)
                                }}
                                aria-label={cellLabel(
                                  member.display_name,
                                  day,
                                  assignments.map((assignment) => [
                                    roleLabels[assignment.role],
                                    assignment.change_kind === 'swap' ? 'zamiana' : '',
                                    assignment.change_kind === 'manual_override' ? 'override' : '',
                                  ].filter(Boolean).join(' ')),
                                  availability?.kind,
                                )}
                              >
                                {assignments.map((assignment) => (
                                  <span
                                    className={`calendar-duty duty-${assignment.role}`}
                                    key={assignment.role}
                                  >
                                    {shortRoleLabels[assignment.role]}
                                    {assignment.change_kind && (
                                      <sup>
                                        {assignment.change_kind === 'manual_override'
                                          && day.service_date < today
                                          ? 'H'
                                          : changeCodes[assignment.change_kind]}
                                      </sup>
                                    )}
                                  </span>
                                ))}
                                {availability && (
                                  <span className={`calendar-state state-${availability.kind}`}>
                                    {availabilityCodes[availability.kind]}
                                  </span>
                                )}
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
          </Paper>
        </>
      )}
      <Dialog open={Boolean(selected)} onClose={closeDrawer} fullWidth maxWidth="xs">
        <DialogTitle>
          {selected ? `${selected.day.weekday} ${formatDate(selected.day.service_date)}` : ''}
          {selected?.day.is_day_off && (
            <Chip
              size="small"
              sx={{ ml: 1 }}
              label={selected.day.holiday_name ?? 'dzień 2X'}
            />
          )}
        </DialogTitle>
        <DialogContent className="calendar-dialog-content">
          {selected?.member && !staffOpen && (
            <Typography variant="body2" color="text.secondary">
              Z wiersza osoby: {selected.member.display_name}
            </Typography>
          )}
          {selected && !selectedDayPublished && (
            <Alert severity="info">
              Ten dzień jest poza opublikowanym zakresem grafiku.
              {canCoordinate
                ? ' Żeby go obsadzić, wygeneruj i opublikuj grafik obejmujący tę datę.'
                : ' Koordynator jeszcze nie opublikował grafiku na ten okres.'}
            </Alert>
          )}
          {staffOpen ? (
            <Box className="calendar-staff-form">
              <Typography variant="subtitle2">Zmień obsadę tego dnia</Typography>
              <TextField
                select
                fullWidth
                id="calendar-override-role"
                name="calendar-override-role"
                label="Rola"
                value={selectedRole}
                onChange={(event) => {
                  setSelectedRole(event.target.value as AssignmentRole)
                  setStaffMemberId(null)
                }}
              >
                {(Object.keys(roleLabels) as AssignmentRole[])
                  .filter((item) => item !== 'late_shift' || !selected?.day.is_day_off)
                  .map((item) => (
                    <MenuItem key={item} value={item}>{roleLabels[item]}</MenuItem>
                  ))}
              </TextField>
              <Typography color="text.secondary">
                Obecnie: {selectedAssignment?.assignee_name ?? 'brak opublikowanego przydziału'}
              </Typography>
              <TextField
                select
                fullWidth
                id="calendar-override-member"
                name="calendar-override-member"
                label="Osoba"
                value={staffMemberId ?? ''}
                onChange={(event) => setStaffMemberId(event.target.value || null)}
              >
                <MenuItem value=""><em>Wybierz osobę</em></MenuItem>
                {staffCandidates.map((candidate) => (
                  <MenuItem
                    key={candidate.id}
                    value={candidate.id}
                    disabled={Boolean(candidate.disabledReason)}
                  >
                    {candidate.display_name}
                    {candidate.disabledReason ? ` — ${candidate.disabledReason}` : ''}
                  </MenuItem>
                ))}
              </TextField>
              {/* Under the field it modifies, not squeezed into the footer next
                  to the buttons (QA7-L16) - the hint explains the field above it. */}
              {staffBlockReason && (
                <Typography variant="caption" color="text.secondary">
                  {staffBlockReason}
                </Typography>
              )}
              {/* While the confirmation covers this dialog the error must live
                  there; render it here only once the confirmation is gone. */}
              {override.error && !confirmOverride && (
                <Alert severity="error">{override.error.message}</Alert>
              )}
            </Box>
          ) : (
            <>
              {selected && selected.day.events.length > 0 && (
                <Alert severity="info" className="calendar-event-alert">
                  <strong>Wydarzenia:</strong>
                  {selected.day.events.map((event) => (
                    <Box key={event.id} className="calendar-event-dialog-row">
                      <Chip
                        size="small"
                        label={event.title}
                        className={`calendar-event-chip event-${event.color}`}
                      />
                      {canCoordinate && (
                        <Button
                          size="small"
                          color="error"
                          disabled={deleteEvent.isPending}
                          onClick={() => deleteEvent.mutate(event.id)}
                        >Usuń</Button>
                      )}
                    </Box>
                  ))}
                </Alert>
              )}
              {selected && gapDates.has(selected.day.service_date) && selectedDayPublished && (
                <Alert severity="warning">
                  Ten dzień nie ma pełnej obsady:{' '}
                  {gaps.find((gap) => gap.service_date === selected.day.service_date)
                    ?.missing.map((item) => roleLabels[item]).join(', ')}
                </Alert>
              )}
              {dayAvailability.length > 0 && (
                <Alert
                  severity={dayAvailability.some((item) => item.kind === 'unavailable')
                    ? 'warning'
                    : 'info'}
                >
                  <strong>Dostępności:</strong>
                  <Box component="ul" sx={{ m: 0, pl: 2 }}>
                    {dayAvailability.map((item) => (
                      <li key={`${item.member_id}-${item.starts_on}`}>
                        {item.display_name}: {availabilityLabels[item.kind]}
                        {item.note ? ` - ${item.note}` : ''}
                      </li>
                    ))}
                  </Box>
                </Alert>
              )}
              {selected && (
                <Box component="dl" className="day-staffing">
                  {(Object.keys(roleLabels) as AssignmentRole[]).map((item) => {
                    const slot = data?.assignments.find(
                      (entry) => entry.service_date === selected.day.service_date && entry.role === item,
                    )
                    const notApplicable = item === 'late_shift' && selected.day.is_day_off
                    return (
                      <Box key={item} className="day-staffing-row">
                        <dt>{roleLabels[item]}</dt>
                        <dd className="grow">
                          {notApplicable
                            ? <span className="day-staffing-na">nie dotyczy w dzień wolny</span>
                            : (
                              <>
                                {slot?.assignee_name ?? 'brak obsady'}
                                {slot?.change_kind && (
                                  <Chip size="small" variant="outlined" label={CHANGE_LABELS[slot.change_kind]} />
                                )}
                              </>
                            )}
                        </dd>
                        {!notApplicable && (
                          <dd className="date-code">{coverageWindowText(selected.day, item)}</dd>
                        )}
                      </Box>
                    )
                  })}
                </Box>
              )}
              {canCoordinate && selected && !selectedDayPublished && (
                <Button
                  component={Link}
                  to={`/generator?od=${selected.day.service_date}&do=${fourWeekRangeEnd(selected.day.service_date)}`}
                  onClick={closeDrawer}
                  variant="contained"
                >Otwórz generator z tym zakresem</Button>
              )}
              {!canCoordinate && selected?.member?.display_name === displayName && (
                <Button
                  component={Link}
                  to={`/zamiany?data=${selected.day.service_date}&rola=${selectedRole}`}
                  onClick={closeDrawer}
                >Poproś o zamianę</Button>
              )}
              {!canCoordinate && selected?.member?.display_name !== displayName && (
                <Typography color="text.secondary">Szczegóły opublikowanego harmonogramu.</Typography>
              )}
              {canCoordinate && selected && (
                <Box className="calendar-event-form">
                  <Typography variant="subtitle2">Dodaj wydarzenie tego dnia</Typography>
                  <TextField
                    fullWidth
                    size="small"
                    label="Nazwa wydarzenia"
                    value={eventTitle}
                    onChange={(event) => setEventTitle(event.target.value)}
                  />
                  <TextField
                    select
                    fullWidth
                    size="small"
                    label="Kolor"
                    value={eventColor}
                    onChange={(event) => setEventColor(event.target.value as CalendarEventColor)}
                  >
                    {EVENT_COLORS.map((color) => (
                      <MenuItem key={color.value} value={color.value}>{color.label}</MenuItem>
                    ))}
                  </TextField>
                  {(createEvent.error || deleteEvent.error) && (
                    <Alert severity="error">
                      {createEvent.error?.message ?? deleteEvent.error?.message}
                    </Alert>
                  )}
                  <Button
                    variant="outlined"
                    disabled={!eventTitle.trim() || createEvent.isPending}
                    onClick={() => createEvent.mutate({
                      starts_on: selected.day.service_date,
                      ends_on: selected.day.service_date,
                      title: eventTitle.trim(),
                      color: eventColor,
                    })}
                  >Dodaj wydarzenie</Button>
                </Box>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          {staffOpen ? (
            <>
              <Button onClick={() => { setStaffOpen(false); override.reset() }}>Wróć</Button>
              <Button
                variant="contained"
                disabled={override.isPending || Boolean(staffBlockReason)}
                onClick={() => {
                  override.reset()
                  setConfirmOverride(true)
                }}
              >
                {selectedAssignment ? 'Zmień obsadę…' : 'Obsadź…'}
              </Button>
            </>
          ) : (
            <>
              <Button onClick={closeDrawer}>Zamknij</Button>
              {canCoordinate && selected && selectedDayPublished && (
                <Button
                  variant="contained"
                  onClick={() => openStaffChange(selectedRole)}
                >
                  Zmień obsadę…
                </Button>
              )}
            </>
          )}
        </DialogActions>
      </Dialog>
      <ConfirmDialog
        open={confirmOverride && Boolean(selected)}
        title={selectedAssignment ? 'Potwierdź zmianę obsady' : 'Potwierdź obsadzenie slotu'}
        description={selected ? (
          <>
            {formatDate(selected.day.service_date)} · {roleLabels[selectedRole]}<br />
            Przypiszesz: <strong>{chosenCandidate?.display_name ?? '—'}</strong>
            {selectedAssignment && <> zamiast {selectedAssignment.assignee_name}</>}
            {overrideCheck.isLoading && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Sprawdzam reguły twarde…
              </Typography>
            )}
            {(overrideCheck.data?.length ?? 0) > 0 && (
              <Alert severity="warning" sx={{ mt: 1 }}>
                Ta korekta złamie reguły twarde:
                <Box component="ul" sx={{ mt: 0.5, mb: 0, pl: 2 }}>
                  {overrideCheck.data!.map((violation, index) => (
                    <li key={index}>
                      {violation.message} ({violation.member_name}:{' '}
                      {violation.days.map(formatDate).join(', ')})
                    </li>
                  ))}
                </Box>
                Naruszenie trafi do dziennika audytu.
              </Alert>
            )}
            {/* MED6-04: the same balance projection a team member sees before a
                swap - the confirmation is the only pause before the change is
                written, so it carries the full picture. */}
            {selectedAssignment && staffMemberId ? (
              <Box sx={{ mt: 1.5 }}>
                <SwapImpactPreview
                  serviceDate={selected.day.service_date}
                  role={selectedRole}
                  replacementId={staffMemberId}
                  mode="override"
                />
              </Box>
            ) : staffMemberId ? (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Slot był pusty - korekta dokłada dyżur tylko osobie{' '}
                {chosenCandidate?.display_name ?? ''}, nie zdejmuje go nikomu.
              </Typography>
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
        onConfirm={(reason) => selected && staffMemberId && override.mutate({
          schedule_id: (selectedAssignment ?? data?.assignments.find(
            (item) => item.service_date === selected.day.service_date,
          ))?.schedule_id,
          expected_version: (selectedAssignment ?? data?.assignments.find(
            (item) => item.service_date === selected.day.service_date,
          ))!.schedule_version,
          service_date: selected.day.service_date,
          role: selectedRole,
          replacement_member_id: staffMemberId,
          reason: reason || undefined,
        })}
      />
    </Box>
  )
}
