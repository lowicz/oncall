import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AssignmentRole,
  AvailabilityEntry,
  AvailabilityKind,
  AvailabilityRangeInput,
  CalendarData,
  FeedToken,
  FeedTokenCreated,
  SwapRequest,
  UserRole,
  api,
} from '../api'
import { messages, useMessages } from '../i18n'
import { meKey } from '../session'
import { isPolishPhone } from '../lib/phone'
import { availabilityLabels, firstName, roleLabels, swapStatusLabels } from '../lib/labels'
import { roleLabels as accountRoleLabels } from '../lib/nav'
import { DEVIATION_SCALE, deviationWords, monthlyTotals, totalBalance } from '../lib/fairness'
import { formatPoints, printedPoints, signedPoints } from '../lib/numbers'
import { preferredScrollBehavior } from '../lib/motion'
import { isLapsed, isOpen, needsMyDecision, returnOf, swapHeadline } from '../lib/swaps'
import { addDays, formatDate, formatDay, formatDayShort, formatMonth, formatRange, formatShortDate, relativeDay, shiftMonth, warsawDate, weekdayIndex, weekdaysFromMonday } from '../lib/dates'
import { useGridNavigation } from '../hooks/useGridNavigation'
import { useNarrow } from '../hooks/useMediaQuery'
import { usePublicConfig } from '../hooks/usePublicConfig'
import { useUrlParams } from '../hooks/useUrlParams'
import { newUndoId, undoable } from '../lib/undo'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { CopyButton } from '../components/CopyButton'
import { coverageWindowText } from '../components/CalendarMatrix'
import {
  Box,
  Button,
  Checkbox,
  DeviationBar,
  EmptyState,
  ErrorState,
  Field,
  Icon,
  IconButton,
  Input,
  LinkButton,
  List,
  ListRow,
  LoadingBlock,
  PageHeader,
  Panel,
  Popover,
  SectionHeading,
  Segmented,
  Select,
  StatusBadge,
  StatusTone,
  Tag,
  cx,
  useToast,
} from '../ui'

const toneOf: Record<AvailabilityKind, 'na' | 'wn' | 'ch'> = { unavailable: 'na', prefer_not: 'wn', prefer: 'ch' }
const roleDot: Record<AssignmentRole, string> = { primary: 'dot-p', secondary: 'dot-s', late_shift: 'dot-l' }
const ROLE_ORDER: AssignmentRole[] = ['primary', 'secondary', 'late_shift']

/** What a click on the calendar writes: one of the three kinds, or nothing. */
type Brush = AvailabilityKind | 'clear'

function monthOf(iso: string) {
  return iso.slice(0, 7)
}

const isMonth = (value: string | null): value is string => Boolean(value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value))
function monthDays(month: string) {
  const [y, m] = month.split('-').map(Number)
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`)
}
const rangeText = (startsOn: string, endsOn: string) => (startsOn === endsOn ? formatDayShort(startsOn) : formatRange(startsOn, endsOn))

type Day = CalendarData['days'][number]
type Duty = CalendarData['assignments'][number]

/** The person's duties in the loaded window, one row per day. */
interface DutyDay {
  service_date: string
  day?: Day
  roles: AssignmentRole[]
  changed: boolean
  partners: string
}

function dutyDays(calendar: CalendarData | undefined, displayName: string, from: string, to: string): DutyDay[] {
  if (!calendar) return []
  const { partnerRoles } = messages().mine.duties
  const byDate = new Map<string, Day>(calendar.days.map((day) => [day.service_date, day]))
  const own = calendar.assignments.filter((item) => item.assignee_name === displayName && item.service_date >= from && item.service_date <= to)
  const dates = [...new Set(own.map((item) => item.service_date))].sort((a, b) => a.localeCompare(b))
  return dates.map((date) => {
    const mine = own.filter((item) => item.service_date === date)
    const others = calendar.assignments.filter((item) => item.service_date === date && item.assignee_name !== displayName)
    others.sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))
    return {
      service_date: date,
      day: byDate.get(date),
      roles: ROLE_ORDER.filter((role) => mine.some((item) => item.role === role)),
      changed: mine.some((item) => item.change_kind || item.is_override),
      partners: others
        .map((item) => `${partnerRoles[item.role]}: ${firstName(item.assignee_name)}`)
        .join(', '),
    }
  })
}

/**
 * The upcoming duties as a list: day and roles, then the coverage window,
 * the multiplier and who else is on that day. Today's row is highlighted the
 * way "today" is in the matrix; a day that collides with an "unavailable"
 * entry gets the warning rule on the left.
 */
function DutyList({ duties, today, collides, onShowCollision }: {
  duties: DutyDay[]
  today: string
  collides: (serviceDate: string) => boolean
  /** Shows the colliding day in the availability calendar. */
  onShowCollision: (serviceDate: string) => void
}) {
  const t = useMessages()
  const roles = roleLabels()
  if (duties.length === 0) {
    return (
      <div className="panel">
        <EmptyState compact icon="calendar" title={t.mine.duties.emptyTitle} description={t.mine.duties.emptyDescription} />
      </div>
    )
  }
  return (
    <List className="panel">
      {duties.map((duty) => {
        const day = duty.day ?? { is_day_off: false }
        const conflict = collides(duty.service_date)
        const isToday = duty.service_date === today
        const windows = [...new Set(duty.roles.map((role) => coverageWindowText(day, role)))].join(' + ')
        const swapRole = duty.roles[0]
        return (
          <ListRow
            key={duty.service_date}
            highlight={isToday}
            tone={conflict ? 'warn' : undefined}
            aside={isToday
              ? <LinkButton size="sm" to={`/grafik?dzien=${duty.service_date}`}>{t.mine.duties.details}</LinkButton>
              : <LinkButton size="sm" variant="ghost" icon="swap" to={`/zamiany?data=${duty.service_date}&rola=${swapRole}`}>{t.mine.duties.swap}</LinkButton>}
          >
            <b className={cx(isToday && 'who-you')}>
              {isToday ? `${t.dates.today}, ` : ''}{formatDayShort(duty.service_date)} · {duty.roles.map((role) => roles[role]).join(' + ')}
            </b>
            <small>
              {isToday ? `${t.mine.duties.ongoing} · ` : ''}{windows} · {duty.day?.is_day_off ? '2X' : '1X'}
              {duty.partners && ` · ${duty.partners}`}
              {duty.day?.holiday_name && ` · ${duty.day.holiday_name}`}
              {duty.changed && <> · <span className="who-you">{t.mine.duties.afterCorrection}</span></>}
              {conflict && <> · <button type="button" className="link-btn" aria-label={t.mine.duties.showCollision(formatDayShort(duty.service_date))} onClick={() => onShowCollision(duty.service_date)}>{t.mine.duties.collision}</button></>}
            </small>
          </ListRow>
        )
      })}
    </List>
  )
}

/**
 * A month of days painted with the person's entries and duties. A click
 * writes one day with the current brush, a drag writes the range under the
 * pointer, Shift+click writes the range from the last painted day; every
 * write is saved at once. The pointer range is previewed in the brush colour
 * before it is committed. On a phone, where a drag scrolls the page, the
 * first tap starts a range and the second closes and saves it.
 */
function AvailabilityCalendar({ month, entries, duties, brush, today, disabled, narrow, onPaint }: {
  month: string
  entries: AvailabilityEntry[]
  duties: Duty[]
  brush: Brush
  today: string
  disabled: boolean
  narrow: boolean
  onPaint: (startsOn: string, endsOn: string) => void
}) {
  const words = useMessages()
  const t = words.mine.calendar
  const { range, brushes } = words.mine.availability
  const kinds = availabilityLabels()
  const roleNames = roleLabels()
  const days = monthDays(month)
  const lead = weekdayIndex(days[0])
  // Week rows of seven cells, each keyed by its place in the month; a blank
  // before the first day or after the last has no date.
  const weeks = Array.from({ length: Math.ceil((lead + days.length) / 7) }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => ({ key: `${month}-${week}-${day}`, date: days[week * 7 + day - lead] ?? null })))
  const grid = useGridNavigation(weeks.length, 7, {
    isCellDisabled: (row, col) => {
      const date = weeks[row]?.[col]?.date
      return !date || date < today
    },
    wrap: true,
  })
  // A drag in progress: the day it started on and the day under the pointer.
  const [drag, setDrag] = useState<{ anchor: string; hover: string } | null>(null)
  // A range started by a tap on a phone, waiting for the tap that closes it.
  const [pick, setPick] = useState<{ anchor: string; hover: string } | null>(null)
  const lastPainted = useRef<string | null>(null)
  const dutiesByDate = useMemo(() => {
    const map = new Map<string, AssignmentRole[]>()
    for (const duty of duties) map.set(duty.service_date, [...(map.get(duty.service_date) ?? []), duty.role])
    return map
  }, [duties])
  const entryFor = (date: string) => entries.find((entry) => entry.starts_on <= date && entry.ends_on >= date)
  const pickedEntry = pick && entryFor(pick.anchor)
  const paint = (a: string, b: string) => {
    const [startsOn, endsOn] = a <= b ? [a, b] : [b, a]
    lastPainted.current = endsOn
    onPaint(startsOn, endsOn)
  }
  useEffect(() => {
    if (!drag) return
    const commit = () => {
      paint(drag.anchor, drag.hover)
      setDrag(null)
    }
    const cancel = () => setDrag(null)
    window.addEventListener('pointerup', commit)
    window.addEventListener('pointercancel', cancel)
    return () => {
      window.removeEventListener('pointerup', commit)
      window.removeEventListener('pointercancel', cancel)
    }
    // `paint` closes over the latest props; the listeners are re-bound on every
    // change of the drag so the commit always sees the current range.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag])
  const selection = drag ?? pick
  const previewRange = selection
    ? [selection.anchor, selection.hover].sort((a, b) => a.localeCompare(b))
    : null
  const inPreview = (date: string) => Boolean(previewRange && previewRange[0] <= date && date <= previewRange[1])
  const previewTone = brush === 'clear' ? null : toneOf[brush]
  return (
    <div>
      <div className="avail-cal-head" aria-hidden="true">
        {weekdaysFromMonday().map((label, index) => <span key={label} className={cx(index >= 5 && 'we')}>{label}</span>)}
      </div>
      <div className="avail-cal" role="grid" aria-label={t.label(formatMonth(month))} aria-busy={disabled || undefined}>
        {weeks.map((week, rowIndex) => (
          <div className="avail-cal-row" role="row" key={week[0].key}>
            {week.map(({ key, date }, colIndex) => {
              if (!date) return <span key={key} role="gridcell" aria-hidden="true" />
              const entry = entryFor(date)
              const roles = dutiesByDate.get(date) ?? []
              const weekend = weekdayIndex(date) >= 5
              const past = date < today
              const preview = inPreview(date)
              const conflict = roles.length > 0 && (entry?.kind === 'unavailable' || (preview && brush === 'unavailable'))
              const label = [
                formatDay(date),
                entry ? kinds[entry.kind] : null,
                entry?.note ? t.reason(entry.note) : null,
                entry?.created_by_name ? t.filedBy(entry.created_by_name) : null,
                roles.length ? t.duty(roles.map((role) => roleNames[role]).join(', ')) : null,
                conflict ? t.dutyCollision : null,
              ].filter(Boolean).join(', ')
              return (
                <button
                  type="button"
                  key={date}
                  role="gridcell"
                  aria-selected={preview}
                  aria-label={label}
                  title={entry?.note ? t.entryTitle(kinds[entry.kind], entry.note) : undefined}
                  className={cx(
                    'avail-day',
                    weekend && 'avail-day-we',
                    entry && !preview && `avail-day-${toneOf[entry.kind]}`,
                    preview && previewTone && `avail-day-${previewTone}`,
                    preview && 'avail-day-sel',
                    date === today && 'avail-day-today',
                    conflict && 'avail-day-conflict',
                  )}
                  disabled={past}
                  {...grid.cellProps(rowIndex, colIndex)}
                  onPointerDown={(event) => {
                    if (disabled || narrow || event.button !== 0) return
                    // Shift+click closes a range from the last painted day.
                    const anchor = event.shiftKey && lastPainted.current ? lastPainted.current : date
                    setDrag({ anchor, hover: date })
                  }}
                  onPointerEnter={() => {
                    // A browser may report a pointer over a passed day, which is disabled.
                    if (disabled || past) return
                    if (drag) setDrag({ anchor: drag.anchor, hover: date })
                    if (pick) setPick({ anchor: pick.anchor, hover: date })
                  }}
                  onClick={(event) => {
                    if (disabled) return
                    if (narrow) {
                      if (pick) paint(pick.anchor, date)
                      setPick(pick ? null : { anchor: date, hover: date })
                      return
                    }
                    // A pointer click was already committed on pointerup; the
                    // keyboard (Enter, Space) arrives here with no pointer at all.
                    if (event.detail !== 0) return
                    if (event.shiftKey && lastPainted.current) paint(lastPainted.current, date)
                    else paint(date, date)
                  }}
                >
                  {roles.map((role) => <i key={role} className={cx('dot', roleDot[role])} aria-hidden="true" />)}
                  {entry?.note && !preview && <Icon name="doc" className="avail-day-note" />}
                  <span>
                    {date.slice(8)}
                    {entry && !preview && <small>{t.marks[entry.kind]}</small>}
                    {preview && brush !== 'clear' && <small>{t.marks[brush]}</small>}
                  </span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
      {pick && (
        <Box tone="sig" role="status" title={range.from(formatShortDate(pick.anchor))}>
          {/* A phone has no hover, so the reason of the day touched first is said here. */}
          {pickedEntry?.note && <div>{range.entry(brushes[pickedEntry.kind], pickedEntry.note)}</div>}
          {brush === 'clear' ? range.closeToClear : range.closeToSave(brushes[brush])}
          <div className="row avail-box-actions">
            <Button size="sm" onClick={() => setPick(null)}>{words.common.cancel}</Button>
          </div>
        </Box>
      )}
    </div>
  )
}

/** Entries the painted range touches, with the pieces that stay outside it. */
function splitAround(entries: AvailabilityEntry[], startsOn: string, endsOn: string) {
  const overlapping = entries.filter((entry) => entry.starts_on <= endsOn && entry.ends_on >= startsOn)
  return overlapping.map((entry) => ({
    entry,
    pieces: [
      { starts_on: entry.starts_on, ends_on: addDays(startsOn, -1) },
      { starts_on: addDays(endsOn, 1), ends_on: entry.ends_on },
    ].filter((piece) => piece.starts_on <= piece.ends_on),
  }))
}

function optimisticRange(
  entries: AvailabilityEntry[],
  startsOn: string,
  endsOn: string,
  brush: Brush,
  note: string | undefined,
): AvailabilityEntry[] {
  const split = splitAround(entries, startsOn, endsOn)
  const replacedIds = new Set(split.map(({ entry }) => entry.id))
  const result = entries.filter((entry) => !replacedIds.has(entry.id))
  for (const { entry, pieces } of split) {
    for (const piece of pieces) {
      result.push({ ...entry, id: `pending:${entry.id}:${piece.starts_on}`, ...piece })
    }
  }
  if (brush !== 'clear') {
    result.push({
      id: `pending:${startsOn}:${endsOn}`,
      kind: brush,
      starts_on: startsOn,
      ends_on: endsOn,
      note: note ?? null,
      created_at: new Date().toISOString(),
    })
  }
  return result
}

const PAINT_KEY = ['availability', 'paint']

/** One range written with one brush; `before` is what the range held when it
 *  was painted, which its Undo draws until the server has put it back, and
 *  `undoId` names the save to the server for that Undo. */
interface PaintCommand {
  member: string
  startsOn: string
  endsOn: string
  brush: Brush
  note: string | undefined
  before: AvailabilityEntry[]
  undoId: string
}

/** An Undo in flight: the paint it reverts and how the range is drawn meanwhile. */
interface PaintUndo {
  command: PaintCommand
  steps: PaintCommand[]
}

const applyPaint = (list: AvailabilityEntry[], command: PaintCommand) => (
  optimisticRange(list, command.startsOn, command.endsOn, command.brush, command.note)
)

/**
 * How an Undo of a paint draws while the server puts the range back: the
 * painted range cleared, then the part of every entry it touched that lies
 * inside the range, with its kind and reason. Days outside the range are
 * never drawn over, as the server never writes them.
 */
function undoSteps(command: PaintCommand): PaintCommand[] {
  return [
    { ...command, brush: 'clear', note: undefined, before: [] },
    ...command.before.map((entry) => ({
      member: command.member,
      startsOn: entry.starts_on > command.startsOn ? entry.starts_on : command.startsOn,
      endsOn: entry.ends_on < command.endsOn ? entry.ends_on : command.endsOn,
      brush: entry.kind,
      note: entry.note ?? undefined,
      before: [],
      undoId: command.undoId,
    })),
  ]
}

/** Days from today on where the person holds a duty and has said "unavailable",
 *  with the duty's roles in order. */
function dutyCollisions(duties: Duty[], entries: AvailabilityEntry[], today: string) {
  const dates = [...new Set(duties.map((duty) => duty.service_date))].sort((a, b) => a.localeCompare(b))
  return dates
    .filter((date) => date >= today && entries.some((entry) => entry.kind === 'unavailable' && entry.starts_on <= date && date <= entry.ends_on))
    .map((date) => ({ date, roles: ROLE_ORDER.filter((role) => duties.some((duty) => duty.service_date === date && duty.role === role)) }))
}

const availabilityKey = (member: string) => (member ? ['availability', 'member', member] : ['availability', 'me'])

/**
 * Availability as a calendar with a brush. The three kinds and "clear" are
 * the brush; a painted range replaces whatever it covers (an entry it cuts
 * into is re-created around it) and is saved immediately. A coordinator can
 * paint another person's calendar from the person picker.
 */
function AvailabilitySection({ role, hasTeamMember, displayName, month, onStepMonth, target, onTarget }: {
  role: UserRole
  hasTeamMember: boolean
  displayName: string
  /** The month and the person shown, held by the screen so a duty in the list
   *  can open its own day in the user's own calendar. */
  month: string
  onStepMonth: (months: number) => void
  /** '' means "myself"; a member id means "on behalf of that person". */
  target: string
  onTarget: (target: string) => void
}) {
  const m = useMessages().mine
  const t = m.availability
  const reasonOf = m.calendar.reason
  const roleWords = roleLabels()
  const roleNames = (roles: AssignmentRole[]) => roles.map((item) => roleWords[item]).join(' + ')
  const narrow = useNarrow()
  const queryClient = useQueryClient()
  const toast = useToast()
  const today = warsawDate()
  const canActOnBehalf = role === 'coordinator' || role === 'admin'
  const team = useQuery({ queryKey: ['team'], queryFn: api.team, enabled: canActOnBehalf })
  const ownMember = team.data?.find((member) => member.display_name === displayName)
  // The person picked, unless it is the user themself or has left the team
  // since (a reload of the team drops them, and the section returns to the
  // user's own availability).
  const targetMember = team.data?.find((member) => member.id === target && member.id !== ownMember?.id)
  const onBehalf = Boolean(targetMember)
  // A person named by the URL is only known once the team has loaded; until
  // then the section neither reads nor paints anyone's availability.
  const resolving = Boolean(target) && canActOnBehalf && team.isPending
  // An admin who is not in the rotation has no availability of their own to
  // show, so the section only works once a person is picked.
  const needsPick = canActOnBehalf && !hasTeamMember && !onBehalf && !resolving

  // Whose list the brush paints: '' is the user's own.
  const member = onBehalf ? target : ''
  const entries = useQuery({
    queryKey: availabilityKey(member),
    queryFn: onBehalf ? () => api.memberAvailability(target) : api.availability,
    enabled: !resolving && (onBehalf || hasTeamMember),
  })
  const calendarStart = `${month}-01`
  const calendarEnd = addDays(`${shiftMonth(month, 1)}-01`, -1)
  const calendar = useQuery({
    queryKey: ['calendar', calendarStart, calendarEnd],
    queryFn: () => api.calendar(calendarStart, calendarEnd),
    enabled: !needsPick,
  })
  const targetName = targetMember?.display_name ?? displayName
  const duties = (calendar.data?.assignments ?? []).filter((item) => item.assignee_name === targetName)
  const [brush, setBrush] = useState<Brush>('unavailable')
  const [note, setNote] = useState('')
  const config = usePublicConfig()
  const save = (command: PaintCommand) => {
    const input: AvailabilityRangeInput = {
      kind: command.brush === 'clear' ? null : command.brush,
      starts_on: command.startsOn,
      ends_on: command.endsOn,
      note: command.note,
      undo_id: command.undoId,
    }
    return command.member ? api.replaceMemberAvailabilityRange(command.member, input) : api.replaceAvailabilityRange(input)
  }
  // The paint stays pending, and so stays drawn, until its person's list has
  // been read back.
  const reload = (command: PaintCommand) => Promise.all([
    queryClient.invalidateQueries({ queryKey: availabilityKey(command.member) }),
    queryClient.invalidateQueries({ queryKey: ['calendar'] }),
  ])
  // One scope runs the paints and the Undos one after another in the order
  // they were made; an Undo is one request that puts the whole range back.
  const restore = useMutation<void, Error, PaintUndo>({
    mutationKey: PAINT_KEY,
    scope: { id: 'availability-paint' },
    mutationFn: ({ command }) => (command.member
      ? api.undoMemberAvailabilityRange(command.member, command.undoId)
      : api.undoAvailabilityRange(command.undoId)),
    onSettled: (_result, _error, { command }) => reload(command),
  })
  const paint = useMutation<AvailabilityEntry | null, Error, PaintCommand>({
    mutationKey: PAINT_KEY,
    scope: { id: 'availability-paint' },
    mutationFn: (command) => {
      const range = rangeText(command.startsOn, command.endsOn)
      return undoable({
        execute: () => save(command),
        undo: () => restore.mutateAsync({ command, steps: undoSteps(command) }),
        toast,
        message: () => ({
          title: command.brush === 'clear' ? t.cleared(range) : t.saved(range, t.brushes[command.brush]),
          description: command.note && command.brush !== 'clear' ? reasonOf(command.note) : undefined,
        }),
        undoLabel: t.undo,
        onUndoError: () => toast.error(t.undoFailed(range)),
        // Until the config has answered, the server's default window.
        windowSeconds: config.data?.undo_window_seconds ?? 10,
      })
    },
    onError: (error, command) => toast.error(t.notSaved(rangeText(command.startsOn, command.endsOn)), { description: error.message }),
    onSettled: (_result, _error, command) => reload(command),
  })
  // Paints and Undo steps waiting to be saved are drawn over the list the
  // server returned; one that fails is no longer pending and drops out by itself.
  const pending = useMutationState({
    filters: { mutationKey: PAINT_KEY, status: 'pending' },
    select: (mutation) => {
      const variables = mutation.state.variables as PaintCommand | PaintUndo
      return 'steps' in variables ? variables.steps : [variables]
    },
  })
  const shown = pending.flat().filter((command) => command.member === member).reduce(applyPaint, entries.data ?? [])
  const collisions = dutyCollisions(duties, shown, today)
  const collidingDuties = collisions.reduce((count, collision) => count + collision.roles.length, 0)

  const heading = targetMember ? t.headingFor(targetMember.display_name) : t.heading
  return (
    <section className="stack-sm" aria-labelledby="dostepnosc-title" id="dostepnosc">
      <SectionHeading
        id="dostepnosc-title"
        className="avail-head"
        title={heading}
        controls={(
          <>
            {canActOnBehalf && (
              <Select
                aria-label={t.person}
                value={target}
                onChange={(event) => onTarget(event.target.value)}
              >
                <option value="">{ownMember ? t.myself(displayName) : t.pickPerson}</option>
                {team.data?.filter((member) => member.id !== ownMember?.id).map((member) => (
                  <option key={member.id} value={member.id}>{member.display_name}</option>
                ))}
              </Select>
            )}
            <span className="pager avail-month">
              <IconButton size="sm" label={t.previousMonth} icon="chevron-left" onClick={() => onStepMonth(-1)} />
              <h3 className="month-title">{formatMonth(month)}</h3>
              <IconButton size="sm" label={t.nextMonth} icon="chevron-right" onClick={() => onStepMonth(1)} />
            </span>
          </>
        )}
      />
      {needsPick ? (
        <div className="panel">
          <EmptyState icon="user" title={t.pickTitle} description={t.pickDescription} />
        </div>
      ) : (
        <div className="panel panel-padded stack-sm">
          {entries.error && <ErrorState error={entries.error} onRetry={() => entries.refetch()} />}
          <div className="avail-brush-row">
            <Segmented<Brush>
              size="sm"
              label={t.brush}
              value={brush}
              onChange={setBrush}
              options={[
                { value: 'unavailable', label: t.brushes.unavailable, tone: 'na' },
                { value: 'prefer_not', label: t.brushes.prefer_not, tone: 'wn' },
                { value: 'prefer', label: t.brushes.prefer, tone: 'ch' },
              ]}
            />
            <IconButton size="sm" icon="eraser" label={t.brushes.clear} active={brush === 'clear'} onClick={() => setBrush('clear')} />
            <Field label={t.note} id="availability-note" hint={t.noteHint} className="avail-note">
              {({ id, describedBy }) => <Input id={id} name={id} value={note} onChange={(event) => setNote(event.target.value)} aria-describedby={describedBy} />}
            </Field>
          </div>
          <AvailabilityCalendar
            key={member}
            month={month}
            entries={shown}
            duties={duties}
            brush={brush}
            today={today}
            disabled={resolving || entries.isLoading}
            narrow={narrow}
            onPaint={(startsOn, endsOn) => paint.mutate({
              member,
              startsOn,
              endsOn,
              brush,
              note: note.trim() || undefined,
              before: shown.filter((entry) => entry.starts_on <= endsOn && entry.ends_on >= startsOn),
              undoId: newUndoId(),
            })}
          />
          <span className="muted small">
            {narrow ? t.howToTouch : <>{t.howTo}<span className="only-pointer">{' '}{t.howToShift}</span></>}
            {' '}
            <Popover
              title={t.legend.title}
              trigger={<button type="button" className="link-btn">{t.legend.link}</button>}
            >
              <div className="legend-grid small">
                <div className="pop-row"><span className="pop-swatch pop-swatch-duty" aria-hidden="true" /> {t.legend.duty}</div>
                <div className="pop-row"><span className="pop-swatch pop-swatch-collision" aria-hidden="true" /> {t.legend.collision}</div>
                {(Object.keys(toneOf) as AvailabilityKind[]).map((kind) => (
                  <div key={kind} className="pop-row">
                    <span className={cx('am', `am-${toneOf[kind]}`)} aria-hidden="true">{m.calendar.marks[kind]}</span>
                    {availabilityLabels()[kind]}
                  </div>
                ))}
              </div>
            </Popover>
          </span>
          {targetMember && (
            <div className="small muted">{t.onBehalfBefore} <b>{targetMember.display_name}</b> · {t.onBehalfAfter}</div>
          )}
          {canActOnBehalf && !onBehalf && !ownMember && team.data && (
            <div className="small muted">{t.notInRotation}</div>
          )}
          {collisions.length > 0 && (
            <Box
              tone="warn"
              role="status"
              title={targetMember
                ? t.collision.titleFor(targetMember.display_name, collisions.length, collidingDuties, roleNames(collisions[0].roles), formatShortDate(collisions[0].date))
                : t.collision.title(collisions.length, collidingDuties, roleNames(collisions[0].roles), formatShortDate(collisions[0].date))}
            >
              {targetMember ? t.collision.fixInSchedule(collisions.length) : t.collision.askForSwap(collisions.length)}
              <div className="row avail-box-actions">
                {collisions.map(({ date, roles }) => (targetMember
                  ? <LinkButton key={date} size="sm" to={`/grafik?dzien=${date}`}>{t.collision.openDay(formatShortDate(date))}</LinkButton>
                  : <LinkButton key={date} size="sm" to={`/zamiany?data=${date}&rola=${roles[0]}`}>{t.collision.requestSwap(formatShortDate(date))}</LinkButton>))}
              </div>
            </Box>
          )}
        </div>
      )}
    </section>
  )
}

/**
 * One number: the person's deviation from the fair share across the
 * on-call lenses, then the bar, the verdict against the threshold and the
 * months that make it up. The full per-lens report is one click away.
 */
function PointsSection({ displayName, compact, onAvailability }: {
  displayName: string
  /** The phone: number, bar and the way to the calendar, no table. */
  compact?: boolean
  onAvailability?: () => void
}) {
  const t = useMessages().mine.points
  const fairness = useQuery({ queryKey: ['fairness', undefined], queryFn: () => api.fairness() })
  const me = fairness.data?.members.find((member) => member.display_name === displayName)
  const duties = useQuery({
    queryKey: ['fairness-duties', me?.member_id, undefined],
    queryFn: () => api.fairnessDuties(me!.member_id),
    enabled: Boolean(me) && !compact,
  })
  // The period lives in the URL (`?okres=miesiac`), so a refresh keeps it.
  const [params, setParams] = useUrlParams()
  const period = params.get('okres') === 'miesiac' ? 'month' : '12m'
  const thisMonth = monthOf(warsawDate())
  const balance = me && fairness.data ? totalBalance(me, fairness.data.late_shift_balanced) : null
  const threshold = fairness.data?.criterion_points ?? 0
  const rows = monthlyTotals(duties.data ?? []).filter((row) => period === '12m' || row.month === thisMonth)
  const shown = balance ? printedPoints(balance.deviation) : 0
  const within = Math.abs(shown) <= printedPoints(threshold)
  const bigNumber = balance ? signedPoints(shown) : null
  return (
    <section className="stack-sm" aria-labelledby="moje-punkty">
      <SectionHeading
        id="moje-punkty"
        title={compact ? t.headingCompact : t.heading}
        controls={!compact && (
          <Segmented<'12m' | 'month'>
            label={t.period}
            value={period}
            onChange={(value) => setParams({ okres: value === 'month' ? 'miesiac' : null })}
            options={[{ value: '12m', label: t.twelveMonths }, { value: 'month', label: t.thisMonth }]}
          />
        )}
      />
      <div className="panel panel-padded stack-sm">
        {fairness.isLoading && <LoadingBlock label={t.loading} rows={2} />}
        {fairness.error && <ErrorState error={fairness.error} onRetry={() => fairness.refetch()} />}
        {fairness.data && !me && (
          <EmptyState compact icon="chart" title={t.emptyTitle} description={t.emptyDescription} />
        )}
        {balance && bigNumber && (
          <>
            <div className="big-number">
              <span className="big">{bigNumber}</span>
              <span className="muted small">
                {compact
                  ? (within ? t.withinCompact(formatPoints(threshold)) : t.outsideCompact(formatPoints(threshold)))
                  : t.againstFairShare}
              </span>
            </div>
            <DeviationBar value={shown} max={DEVIATION_SCALE} label={deviationWords(shown)} />
            {!compact && (
              <Box tone={within ? 'ok' : 'warn'} title={within ? t.within : t.outside}>
                {shown > 0 ? t.aboveShare(formatPoints(shown)) : shown < 0 ? t.belowShare(formatPoints(-shown)) : t.atShare}
                {' '}{t.norm(formatPoints(threshold))}
                {shown !== 0 && <>{' '}{within
                  ? t.generatorEvensOut
                  : shown > 0 ? t.generatorFewer : t.generatorMore}</>}
              </Box>
            )}
            {!compact && duties.isLoading && <LoadingBlock label={t.loadingMonths} rows={2} />}
            {!compact && duties.data && (
              <table className="lg" aria-label={t.table}>
                <thead>
                  <tr><th scope="col">{t.month}</th><th scope="col" className="n">{t.pts}</th><th scope="col" className="n">{t.dutiesShort}</th><th scope="col" className="n">{t.weekendsShort}</th></tr>
                </thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={4} className="muted">{t.noDutiesInPeriod}</td></tr>}
                  {rows.map((row) => (
                    <tr key={row.month}>
                      <td>{formatMonth(row.month, row.month.slice(0, 4) !== thisMonth.slice(0, 4))}</td>
                      <td className="n">{formatPoints(row.points)}</td>
                      <td className="n">{row.duties}</td>
                      <td className="n">{row.weekends}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {compact
              ? <Button variant="primary" block icon="calendar" onClick={onAvailability}>{t.fileAvailability}</Button>
              : <LinkButton to="/sprawiedliwosc" size="sm" variant="ghost" className="self-start">{t.fullReport}</LinkButton>}
          </>
        )}
      </div>
    </section>
  )
}

const swapTone: Record<SwapRequest['status'], StatusTone> = {
  pending_replacement: 'prop',
  pending_coordinator: 'prop',
  approved: 'ok',
  rejected: 'bad',
  cancelled: 'muted',
}

/** The swaps this person is part of, decided with one click; the rest is on the swaps screen. */
function SwapsSection({ displayName, role }: { displayName: string; role: UserRole }) {
  const { mine: { swaps: t }, swaps: { table: { expired } }, common } = useMessages()
  const statuses = swapStatusLabels()
  const swaps = useQuery({ queryKey: ['swaps'], queryFn: () => api.swaps() })
  const viewer = { displayName, role }
  const mine = (swaps.data ?? []).filter((item) => item.requester_name === displayName || item.replacement_name === displayName)
  const visible = [
    ...mine.filter(isOpen).sort((a, b) => a.service_date.localeCompare(b.service_date)),
    ...mine.filter((item) => !isOpen(item)).sort((a, b) => b.created_at.localeCompare(a.created_at)),
  ].slice(0, 5)
  const arrow = (item: SwapRequest) => (returnOf(item) ? '⇄' : '→')
  const lead = (item: SwapRequest, spoken: boolean) => {
    const handingOver = item.requester_name === displayName
    const name = firstName(handingOver ? item.replacement_name : item.requester_name)
    if (spoken) return (handingOver ? t.youToSpoken : t.toYouSpoken)(name, Boolean(returnOf(item)))
    return (handingOver ? t.youTo : t.toYou)(name, arrow(item))
  }
  const stage = (item: SwapRequest) => {
    if (isLapsed(item)) return expired
    if (item.status === 'pending_replacement') {
      return item.replacement_name === displayName
        ? t.askedYou
        : t.waitingFor(firstName(item.replacement_name), relativeDay(item.created_at.slice(0, 10)))
    }
    if (item.status === 'pending_coordinator') return needsMyDecision(item, viewer) ? t.waitingForYourApproval : t.waitingForCoordinator
    if (item.status === 'approved') return t.inSchedule
    return item.decision_note ? t.settledWithNote(statuses[item.status].toLowerCase(), item.decision_note) : statuses[item.status].toLowerCase()
  }
  return (
    <section className="stack-sm" aria-labelledby="moje-zamiany">
      <SectionHeading
        id="moje-zamiany"
        title={t.heading}
        controls={<LinkButton to="/zamiany" size="sm" variant="ghost">{t.all}</LinkButton>}
      />
      <div className="panel">
        {swaps.isLoading && <LoadingBlock label={t.loading} rows={2} />}
        {swaps.error && <ErrorState error={swaps.error} onRetry={() => swaps.refetch()} />}
        {swaps.data && visible.length === 0 && (
          <EmptyState compact icon="swap" title={t.emptyTitle} description={t.emptyDescription} />
        )}
        {visible.length > 0 && (
          <List>
            {visible.map((item) => (
              <ListRow
                key={item.id}
                aside={needsMyDecision(item, viewer)
                  ? <LinkButton size="sm" variant="primary" to="/zamiany?skrzynka=do-mnie">{t.decide}</LinkButton>
                  : <StatusBadge tone={swapTone[item.status]}>{t.short[item.status]}</StatusBadge>}
              >
                <b>
                  <span aria-hidden="true">{lead(item, false)} · {swapHeadline(item)}</span>
                  <span className="sr-only">{lead(item, true)} · {swapHeadline(item, common.swapWith)}</span>
                </b>
                <small>{stage(item)}</small>
              </ListRow>
            ))}
          </List>
        )}
      </div>
    </section>
  )
}

/** The ICS subscriptions, in a side panel behind the ICS export action. */
function FeedsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useMessages().mine.feeds
  const queryClient = useQueryClient()
  const feeds = useQuery({ queryKey: ['feeds'], queryFn: api.feeds, enabled: open })
  const [label, setLabel] = useState('')
  const [created, setCreated] = useState<FeedTokenCreated | null>(null)
  const [showRevoked, setShowRevoked] = useState(false)
  const [toRevoke, setToRevoke] = useState<FeedToken | null>(null)
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['feeds'] })
  const create = useMutation({
    mutationFn: (name: string) => api.createFeed(name),
    onSuccess: (value) => {
      setCreated(value)
      setLabel('')
      invalidate()
    },
  })
  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeFeed(id),
    onSuccess: () => { setToRevoke(null); invalidate() },
  })
  const visible = feeds.data?.filter((feed) => showRevoked || !feed.revoked_at) ?? []
  return (
    <>
      <Panel open={open} onClose={onClose} title={t.title} meta={<Tag>{t.onlyYourDuties}</Tag>}>
        <p className="muted small">{t.explanation}</p>
        <form
          className="stack-sm"
          aria-label={t.newSubscription}
          onSubmit={(event) => {
            event.preventDefault()
            create.mutate(label.trim() || t.defaultLabel)
          }}
        >
          <Field label={t.labelField} id="feed-label">
            {({ id }) => <Input id={id} name={id} value={label} onChange={(event) => setLabel(event.target.value)} placeholder={t.labelPlaceholder} />}
          </Field>
          <div className="row">
            <Button type="submit" variant="primary" loading={create.isPending} icon="plus">{t.create}</Button>
          </div>
        </form>
        {(create.error || revoke.error) && <Box tone="bad" role="alert" title={create.error?.message ?? revoke.error?.message} />}
        {created && (
          <Box tone="ok" role="status" title={t.createdOnce}>
            <div className="token-once"><code translate="no">{created.url}</code><CopyButton value={created.url} /></div>
          </Box>
        )}
        {feeds.isLoading && <LoadingBlock label={t.loading} rows={2} />}
        {feeds.data && visible.length === 0 && (
          <EmptyState compact icon="link" title={t.emptyTitle} description={t.emptyDescription} />
        )}
        {visible.length > 0 && (
          <List className="panel">
            {visible.map((feed) => (
              <ListRow
                key={feed.id}
                aside={feed.revoked_at
                  ? <StatusBadge tone="bad">{t.revoked}</StatusBadge>
                  : <Button size="sm" variant="ghost" disabled={revoke.isPending} onClick={() => { revoke.reset(); setToRevoke(feed) }}>{t.revoke}</Button>}
              >
                <b>{feed.label}</b>
                <small>{t.createdOn(formatDate(feed.created_at))}{feed.last_used_at ? ` · ${t.lastUsed(formatDate(feed.last_used_at))}` : ` · ${t.neverUsed}`}</small>
              </ListRow>
            ))}
          </List>
        )}
        {feeds.data?.some((feed) => feed.revoked_at) && (
          <Checkbox label={t.showRevoked} checked={showRevoked} onChange={(event) => setShowRevoked(event.target.checked)} />
        )}
      </Panel>
      <ConfirmDialog
        open={Boolean(toRevoke)}
        pending={revoke.isPending}
        error={revoke.error ? revoke.error.message : null}
        onCancel={() => setToRevoke(null)}
        onConfirm={() => toRevoke && revoke.mutate(toRevoke.id)}
        title={t.revokeTitle}
        confirmLabel={t.revokeConfirm}
        confirmColor="error"
        description={toRevoke && t.revokeDescription(toRevoke.label)}
      />
    </>
  )
}

/**
 * The person's own number: what the "Now" strip and the on-call card show and
 * what the call forwarding dials. The API stores `+48` and nine digits and
 * normalises what is typed, so the field shows the stored form back after a
 * save; the rule is mirrored here only to say "popraw numer" before the
 * save, once the field has been left.
 */
function PhoneSection({ inRotation }: { inRotation: boolean }) {
  const t = useMessages().mine.phone
  const toast = useToast()
  const queryClient = useQueryClient()
  const me = useQuery({ queryKey: meKey, queryFn: api.me })
  const [draft, setDraft] = useState<string | null>(null)
  // Judged once the field is left or saved, never while it is being typed.
  const [checked, setChecked] = useState(false)
  const value = draft ?? me.data?.phone ?? ''
  const typed = value.trim()
  // The save button falls idle once the number is stored, so focus goes
  // back to the number it saved.
  const field = useRef<HTMLInputElement>(null)
  const save = useMutation({
    mutationFn: () => api.updateMyPhone(typed || null),
    onSuccess: (updated) => {
      queryClient.setQueryData(meKey, updated)
      setDraft(null)
      toast.success(t.saved)
      field.current?.focus()
    },
  })
  // No verdict on a value that has not arrived yet.
  const verdict = typed ? (isPolishPhone(typed) ? undefined : t.fix) : inRotation ? t.required : undefined
  const error = me.data && checked ? verdict : undefined
  return (
    <section className="stack-sm" aria-labelledby="moj-telefon">
      <SectionHeading id="moj-telefon" title={t.heading} />
      <form className="stack-sm" onSubmit={(event) => { event.preventDefault(); setChecked(true); save.mutate() }}>
        <Field label={t.label} id="my-phone" hint={t.hint} error={error}>
          {({ id, describedBy, invalid }) => (
            <Input ref={field} id={id} name="phone" type="tel" autoComplete="tel" autoCapitalize="off" spellCheck={false} mono invalid={invalid} value={value} aria-describedby={describedBy} disabled={!me.data} onBlur={() => setChecked(true)} onChange={(event) => { setChecked(false); setDraft(event.target.value) }} />
          )}
        </Field>
        {save.error && <Box tone="bad" role="alert" focus title={save.error.message} />}
        <div><Button type="submit" size="sm" loading={save.isPending} disabled={draft === null}>{t.save}</Button></div>
      </form>
    </section>
  )
}

/**
 * The member's screen: when is my duty, what have I declared, how do I stand
 * against the team. Duties and the availability calendar on the left, the
 * points and the swaps that concern me on the right; on a phone the points
 * come right after the duties with the way to the calendar.
 */
export function MineScreen({ role = 'member', hasTeamMember, displayName = '' }: {
  role?: UserRole
  hasTeamMember?: boolean
  displayName?: string
} = {}) {
  const t = useMessages().mine
  const roles = roleLabels()
  const inRotation = hasTeamMember !== false
  const narrow = useNarrow()
  const location = useLocation()
  const today = warsawDate()
  const windowStart = addDays(today, -90)
  const yesterday = addDays(today, -1)
  const windowEnd = addDays(today, 59)
  // One calendar request covers at most 90 days, so the 90 days behind and
  // the 60 days ahead are two requests.
  const calendar = useQuery({
    queryKey: ['calendar', today, windowEnd],
    queryFn: () => api.calendar(today, windowEnd),
    enabled: inRotation,
  })
  const history = useQuery({
    queryKey: ['calendar', windowStart, yesterday],
    queryFn: () => api.calendar(windowStart, yesterday),
    enabled: inRotation,
  })
  const upcoming = dutyDays(calendar.data, displayName, today, windowEnd)
  const past = dutyDays(history.data, displayName, windowStart, yesterday)
  const ownId = calendar.data?.members.find((member) => member.display_name === displayName)?.id
  const collides = (serviceDate: string) => Boolean(calendar.data?.availability.some(
    (entry) => entry.member_id === ownId && entry.kind === 'unavailable' && entry.starts_on <= serviceDate && entry.ends_on >= serviceDate,
  ))
  const next = upcoming[0]
  const [icsOpen, setIcsOpen] = useState(false)
  useEffect(() => {
    if (location.hash === '#ics') setIcsOpen(true)
    if (location.hash === '#dostepnosc') document.getElementById('dostepnosc')?.scrollIntoView({ block: 'start' })
  }, [location.hash])
  // The month and the person of the availability calendar live in the URL
  // (`?osoba=<id>&miesiac=2026-09`), so a refresh keeps them.
  const [params, setParams] = useUrlParams()
  const target = params.get('osoba') ?? ''
  const monthIn = (query: URLSearchParams) => {
    const value = query.get('miesiac')
    return isMonth(value) ? value : monthOf(today)
  }
  const month = monthIn(params)
  // From the latest query, which a render of quick clicks may not show yet.
  const stepMonth = (months: number) => setParams((latest) => ({ miesiac: shiftMonth(monthIn(latest), months) }))
  const setTarget = (value: string) => setParams({ osoba: value || null })
  const showCollision = (serviceDate: string) => {
    setParams({ miesiac: monthOf(serviceDate), osoba: null })
    scrollToAvailability()
  }
  const scrollToAvailability = () => document.getElementById('dostepnosc')?.scrollIntoView({ block: 'start', behavior: preferredScrollBehavior() })

  const subtitle = [
    displayName,
    accountRoleLabels()[role].toLowerCase(),
    inRotation ? (history.data ? t.dutiesInLast90Days(past.length) : null) : t.outsideRotation,
  ].filter(Boolean).join(' · ')

  const duties = (
    <section className="stack-sm" aria-labelledby="moje-dyzury">
      <SectionHeading
        id="moje-dyzury"
        title={t.duties.heading}
        meta={calendar.data ? t.duties.meta(upcoming.length) : undefined}
        controls={<LinkButton to={`/grafik?osoba=${encodeURIComponent(displayName)}`} size="sm" variant="ghost">{t.duties.schedule}</LinkButton>}
      />
      {calendar.isLoading && <LoadingBlock label={t.duties.loading} rows={3} />}
      {calendar.error && <ErrorState error={calendar.error} onRetry={() => calendar.refetch()} />}
      {calendar.data && <DutyList duties={upcoming} today={today} collides={collides} onShowCollision={showCollision} />}
    </section>
  )
  const availability = <AvailabilitySection role={role} hasTeamMember={inRotation} displayName={displayName} month={month} onStepMonth={stepMonth} target={target} onTarget={setTarget} />
  const phone = <PhoneSection inRotation={inRotation} />

  return (
    <div className="page">
      <PageHeader
        title={t.title}
        sub={(
          <span>
            {subtitle}
            {inRotation && calendar.data && (
              <>
                {` · ${t.next} `}
                <b className="fg">{next ? `${relativeDay(next.service_date)}, ${next.roles.map((item) => roles[item]).join(' + ')}` : t.noDutyIn60Days}</b>
              </>
            )}
          </span>
        )}
        actions={inRotation && (
          <>
            <Button variant="ghost" icon="link" onClick={() => setIcsOpen(true)}>{t.exportIcs}</Button>
            <LinkButton icon="swap" to={next ? `/zamiany?data=${next.service_date}&rola=${next.roles[0]}` : '/zamiany'}>{t.proposeSwap}</LinkButton>
          </>
        )}
      />
      {!inRotation ? (
        <>
          {availability}
          {phone}
        </>
      ) : narrow ? (
        <>
          {duties}
          <PointsSection displayName={displayName} compact onAvailability={scrollToAvailability} />
          {availability}
          <SwapsSection displayName={displayName} role={role} />
          {phone}
        </>
      ) : (
        <div className="split split-md">
          <div className="stack">
            {duties}
            {availability}
          </div>
          <div className="stack">
            <PointsSection displayName={displayName} />
            <SwapsSection displayName={displayName} role={role} />
            {phone}
          </div>
        </div>
      )}
      {inRotation && <FeedsPanel open={icsOpen} onClose={() => setIcsOpen(false)} />}
    </div>
  )
}
