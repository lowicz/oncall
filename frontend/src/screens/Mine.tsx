import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AssignmentRole,
  AvailabilityEntry,
  AvailabilityInput,
  AvailabilityKind,
  CalendarData,
  FeedToken,
  FeedTokenCreated,
  SwapRequest,
  UserRole,
  api,
} from '../api'
import { availabilityLabels, roleLabels, shortRoleLabels, swapStatusLabels } from '../lib/labels'
import { roleLabels as accountRoleLabels } from '../lib/nav'
import { DEVIATION_SCALE, deviationWords, formatPoints, monthlyTotals, totalBalance } from '../lib/fairness'
import { pluralPl } from '../lib/plural'
import { isOpen, needsMyDecision } from '../lib/swaps'
import { addDays, formatDate, formatDay, formatDayShort, formatRange, relativeDay, warsawDate } from '../lib/dates'
import { useNarrow } from '../hooks/useMediaQuery'
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
  IconButton,
  Input,
  LinkButton,
  List,
  ListRow,
  LoadingBlock,
  PageHeader,
  Panel,
  SectionHeading,
  Segmented,
  Select,
  StatusBadge,
  StatusTone,
  Tag,
  cx,
  useToast,
} from '../ui'

const WEEKDAY_HEAD = ['pn', 'wt', 'śr', 'cz', 'pt', 'so', 'nd']
const toneOf: Record<AvailabilityKind, 'na' | 'wn' | 'ch'> = { unavailable: 'na', prefer_not: 'wn', prefer: 'ch' }
const markOf: Record<AvailabilityKind, string> = { unavailable: 'N', prefer_not: 'W', prefer: 'C' }
const roleDot: Record<AssignmentRole, string> = { primary: 'dot-p', secondary: 'dot-s', late_shift: 'dot-l' }
const ROLE_ORDER: AssignmentRole[] = ['primary', 'secondary', 'late_shift']

/** What a click on the calendar writes: one of the three kinds, or nothing. */
type Brush = AvailabilityKind | 'clear'

function monthOf(iso: string) {
  return iso.slice(0, 7)
}
function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1 + delta, 1))
  return date.toISOString().slice(0, 7)
}
function monthDays(month: string) {
  const [y, m] = month.split('-').map(Number)
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`)
}
function weekdayIndex(iso: string) {
  return (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7
}
const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień']
function monthLabel(month: string, withYear = true) {
  const [y, m] = month.split('-').map(Number)
  return withYear ? `${MONTHS[m - 1]} ${y}` : MONTHS[m - 1]
}
const firstName = (name: string) => name.split(' ')[0]
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
  const byDate = new Map<string, Day>(calendar.days.map((day) => [day.service_date, day]))
  const own = calendar.assignments.filter((item) => item.assignee_name === displayName && item.service_date >= from && item.service_date <= to)
  const dates = [...new Set(own.map((item) => item.service_date))].sort()
  return dates.map((date) => {
    const mine = own.filter((item) => item.service_date === date)
    const others = calendar.assignments.filter((item) => item.service_date === date && item.assignee_name !== displayName)
    return {
      service_date: date,
      day: byDate.get(date),
      roles: ROLE_ORDER.filter((role) => mine.some((item) => item.role === role)),
      changed: mine.some((item) => item.change_kind || item.is_override),
      partners: others
        .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))
        .map((item) => `${shortRoleLabels[item.role]} ${firstName(item.assignee_name)}`)
        .join(', '),
    }
  })
}

/**
 * The upcoming duties as a list: day and roles, then the coverage window,
 * the multiplier and who else is on that day. Today's row is highlighted the
 * way "today" is in the matrix; a day that collides with a "nie mogę" entry
 * gets the warning rule on the left.
 */
function DutyList({ duties, today, collides }: {
  duties: DutyDay[]
  today: string
  collides: (serviceDate: string) => boolean
}) {
  if (duties.length === 0) {
    return (
      <div className="panel">
        <EmptyState compact icon="calendar" title="Brak nadchodzących dyżurów" description="W najbliższych 60 dniach nie masz przydzielonego dyżuru." />
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
              ? <LinkButton size="sm" to={`/grafik?dzien=${duty.service_date}`}>Szczegóły</LinkButton>
              : <LinkButton size="sm" variant="ghost" icon="swap" to={`/zamiany?data=${duty.service_date}&rola=${swapRole}`}>Zamień</LinkButton>}
          >
            <b className={cx(isToday && 'who-you')}>
              {isToday ? 'dziś, ' : ''}{formatDayShort(duty.service_date)} · {duty.roles.map((role) => roleLabels[role]).join(' + ')}
            </b>
            <small>
              {isToday ? 'trwa · ' : ''}{windows} · {duty.day?.is_day_off ? '2X' : '1X'}
              {duty.partners && ` · ${duty.partners}`}
              {duty.day?.holiday_name && ` · ${duty.day.holiday_name}`}
              {duty.changed && <> · <span className="who-you">po korekcie</span></>}
              {conflict && <> · <span className="who-out">koliduje z Twoją niedostępnością</span></>}
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
 * before it is committed.
 */
function AvailabilityCalendar({ month, entries, duties, brush, today, disabled, onPaint }: {
  month: string
  entries: AvailabilityEntry[]
  duties: Duty[]
  brush: Brush
  today: string
  disabled: boolean
  onPaint: (startsOn: string, endsOn: string) => void
}) {
  const days = monthDays(month)
  const lead = weekdayIndex(days[0])
  const [anchor, setAnchor] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const lastPainted = useRef<string | null>(null)
  const dutiesByDate = useMemo(() => {
    const map = new Map<string, AssignmentRole[]>()
    for (const duty of duties) map.set(duty.service_date, [...(map.get(duty.service_date) ?? []), duty.role])
    return map
  }, [duties])
  const entryFor = (date: string) => entries.find((entry) => entry.starts_on <= date && entry.ends_on >= date)
  const paint = (a: string, b: string) => {
    const [startsOn, endsOn] = a <= b ? [a, b] : [b, a]
    lastPainted.current = endsOn
    onPaint(startsOn, endsOn)
  }
  useEffect(() => {
    if (!anchor) return
    const commit = () => {
      if (anchor && hover) paint(anchor, hover)
      setAnchor(null)
      setHover(null)
    }
    const cancel = () => {
      setAnchor(null)
      setHover(null)
    }
    window.addEventListener('pointerup', commit)
    window.addEventListener('pointercancel', cancel)
    return () => {
      window.removeEventListener('pointerup', commit)
      window.removeEventListener('pointercancel', cancel)
    }
    // `paint` closes over the latest props; the listeners are re-bound on every
    // change of the drag so the commit always sees the current range.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, hover])
  const previewRange = anchor && hover ? [anchor, hover].sort() : null
  const inPreview = (date: string) => Boolean(previewRange && previewRange[0] <= date && date <= previewRange[1])
  const previewTone = brush === 'clear' ? null : toneOf[brush]
  return (
    <div className="avail-wrap">
      <div className="avail-cal-head" aria-hidden="true">
        {WEEKDAY_HEAD.map((label, index) => <span key={label} className={cx(index >= 5 && 'we')}>{label}</span>)}
      </div>
      <div className="avail-cal" role="grid" aria-label={`Kalendarz dostępności, ${monthLabel(month)}`}>
        {Array.from({ length: lead }, (_, index) => <span key={`lead-${index}`} aria-hidden="true" />)}
        {days.map((date) => {
          const entry = entryFor(date)
          const roles = dutiesByDate.get(date) ?? []
          const weekend = weekdayIndex(date) >= 5
          const past = date < today
          const preview = inPreview(date)
          const conflict = roles.length > 0 && (entry?.kind === 'unavailable' || (preview && brush === 'unavailable'))
          const label = [
            formatDay(date),
            entry ? availabilityLabels[entry.kind] : null,
            entry?.note ? `powód: ${entry.note}` : null,
            entry?.created_by_name ? `wpis: ${entry.created_by_name}` : null,
            roles.length ? `dyżur: ${roles.map((role) => roleLabels[role]).join(', ')}` : null,
            conflict ? 'kolizja z dyżurem' : null,
          ].filter(Boolean).join(', ')
          return (
            <button
              type="button"
              key={date}
              role="gridcell"
              aria-label={label}
              title={entry?.note ? `${availabilityLabels[entry.kind]}: ${entry.note}` : undefined}
              className={cx(
                'avail-day',
                weekend && 'avail-day-we',
                entry && !preview && `avail-day-${toneOf[entry.kind]}`,
                preview && previewTone && `avail-day-${previewTone}`,
                preview && 'avail-day-sel',
                date === today && 'avail-day-today',
                conflict && 'avail-day-conflict',
              )}
              disabled={past || disabled}
              onPointerDown={(event) => {
                if (event.button !== 0) return
                setAnchor(date)
                setHover(date)
              }}
              onPointerEnter={() => { if (anchor) setHover(date) }}
              onClick={(event) => {
                // A pointer click was already committed on pointerup; the
                // keyboard (Enter, Space) arrives here with no pointer at all.
                if (event.detail !== 0) return
                if (event.shiftKey && lastPainted.current) paint(lastPainted.current, date)
                else paint(date, date)
              }}
            >
              {roles.map((role) => <i key={role} className={cx('dot', roleDot[role])} aria-hidden="true" />)}
              <span>
                {date.slice(8)}
                {entry && !preview && <small>{markOf[entry.kind]}</small>}
                {preview && brush !== 'clear' && <small>{markOf[brush]}</small>}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Entries the painted range touches, with the pieces that stay outside it. */
function splitAround(entries: AvailabilityEntry[], startsOn: string, endsOn: string, today: string) {
  const overlapping = entries.filter((entry) => entry.starts_on <= endsOn && entry.ends_on >= startsOn)
  return overlapping.map((entry) => ({
    entry,
    pieces: [
      { starts_on: entry.starts_on, ends_on: addDays(startsOn, -1) },
      { starts_on: addDays(endsOn, 1), ends_on: entry.ends_on },
    ].filter((piece) => piece.starts_on <= piece.ends_on && piece.ends_on >= today),
  }))
}

/**
 * Availability as a calendar with a brush. The three kinds and "wyczyść" are
 * the brush; a painted range replaces whatever it covers (an entry it cuts
 * into is re-created around it) and is saved immediately. A coordinator can
 * paint another person's calendar from the "Osoba" picker.
 */
function AvailabilitySection({ role, hasTeamMember, displayName }: {
  role: UserRole
  hasTeamMember: boolean
  displayName: string
}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const today = warsawDate()
  const canActOnBehalf = role === 'coordinator' || role === 'admin'
  const team = useQuery({ queryKey: ['team'], queryFn: api.team, enabled: canActOnBehalf })
  const ownMember = team.data?.find((member) => member.display_name === displayName)
  // '' means "myself"; a member id means "on behalf of that person".
  const [target, setTarget] = useState('')
  const onBehalf = target !== '' && target !== ownMember?.id
  const targetMember = team.data?.find((member) => member.id === target)
  // An admin who is not in the rotation has no availability of their own to
  // show, so the section only works once a person is picked.
  const needsPick = canActOnBehalf && !hasTeamMember && !onBehalf

  const listKey = onBehalf ? ['availability', 'member', target] : ['availability', 'me']
  const entries = useQuery({
    queryKey: listKey,
    queryFn: onBehalf ? () => api.memberAvailability(target) : api.availability,
    enabled: onBehalf || hasTeamMember,
  })
  const [month, setMonth] = useState(monthOf(today))
  const calendarStart = `${month}-01`
  const calendarEnd = addDays(`${shiftMonth(month, 1)}-01`, -1)
  const calendar = useQuery({
    queryKey: ['calendar', calendarStart, calendarEnd],
    queryFn: () => api.calendar(calendarStart, calendarEnd),
    enabled: !needsPick,
  })
  const targetName = onBehalf ? targetMember?.display_name : displayName
  const duties = (calendar.data?.assignments ?? []).filter((item) => item.assignee_name === targetName)
  const [brush, setBrush] = useState<Brush>('unavailable')
  const [note, setNote] = useState('')
  const [warning, setWarning] = useState<string | null>(null)
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: listKey })
    queryClient.invalidateQueries({ queryKey: ['calendar'] })
  }
  const create = (input: AvailabilityInput) => (onBehalf ? api.createMemberAvailability(target, input) : api.createAvailability(input))
  const remove = (id: string) => (onBehalf ? api.deleteMemberAvailability(target, id) : api.deleteAvailability(id))
  const paint = useMutation({
    mutationFn: async ({ startsOn, endsOn }: { startsOn: string; endsOn: string }) => {
      let saved: string | null = null
      for (const { entry, pieces } of splitAround(entries.data ?? [], startsOn, endsOn, today)) {
        await remove(entry.id)
        for (const piece of pieces) await create({ kind: entry.kind, note: entry.note ?? undefined, ...piece })
      }
      if (brush !== 'clear') {
        const created = await create({ kind: brush, starts_on: startsOn, ends_on: endsOn, note: note.trim() || undefined })
        saved = created.warning ?? null
      }
      return { warning: saved, startsOn, endsOn, brush }
    },
    onSuccess: (result) => {
      invalidate()
      setWarning(result.warning)
      const range = rangeText(result.startsOn, result.endsOn)
      toast.success(result.brush === 'clear' ? `Wyczyszczono: ${range}` : `Zapisano: ${range} „${availabilityLabels[result.brush].toLowerCase()}”`)
    },
    onError: (error) => {
      invalidate()
      toast.error(error.message)
    },
  })

  const heading = onBehalf ? `Dostępność: ${targetMember?.display_name ?? ''}` : 'Moja dostępność'
  return (
    <section className="stack-sm" aria-labelledby="dostepnosc" id="dostepnosc">
      <SectionHeading
        id="dostepnosc-title"
        title={heading}
        meta={monthLabel(month)}
        controls={(
          <>
            {canActOnBehalf && (
              <Select
                aria-label="Osoba"
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                className="sech-select"
              >
                <option value="">{ownMember ? `Ja (${displayName})` : 'Wskaż osobę'}</option>
                {team.data?.filter((member) => member.id !== ownMember?.id).map((member) => (
                  <option key={member.id} value={member.id}>{member.display_name}</option>
                ))}
              </Select>
            )}
            <Segmented<Brush>
              size="sm"
              label="Pędzel"
              value={brush}
              onChange={setBrush}
              options={[
                { value: 'unavailable', label: 'nie mogę', tone: 'na' },
                { value: 'prefer_not', label: 'wolę nie', tone: 'wn' },
                { value: 'prefer', label: 'chętnie', tone: 'ch' },
                { value: 'clear', label: 'wyczyść' },
              ]}
            />
            <span className="pager">
              <IconButton size="sm" label="Poprzedni miesiąc" icon="chevron-left" onClick={() => setMonth(shiftMonth(month, -1))} />
              <IconButton size="sm" label="Następny miesiąc" icon="chevron-right" onClick={() => setMonth(shiftMonth(month, 1))} />
            </span>
          </>
        )}
      />
      {needsPick ? (
        <div className="panel">
          <EmptyState icon="user" title="Wybierz osobę" description="Twoje konto nie jest w rotacji. Wskaż osobę, w imieniu której chcesz zgłosić dostępność." />
        </div>
      ) : (
        <div className="panel panel-padded stack-sm">
          {entries.error && <ErrorState error={entries.error} onRetry={() => entries.refetch()} />}
          <AvailabilityCalendar
            month={month}
            entries={entries.data ?? []}
            duties={duties}
            brush={brush}
            today={today}
            disabled={paint.isPending || entries.isLoading}
            onPaint={(startsOn, endsOn) => paint.mutate({ startsOn, endsOn })}
          />
          <div className="avail-foot">
            <span className="muted small">
              Klikasz albo przeciągasz po dniach (Shift+klik domyka zakres); zapis automatyczny. Kropka to dyżur, bursztynowa obwódka to kolizja „nie mogę” z dyżurem.
            </span>
            <Field label="Powód" id="availability-note" hint="Opcjonalny, do kolejnych wpisów; widzą koordynatorzy i administratorzy." className="avail-note">
              {({ id, describedBy }) => <Input id={id} name={id} value={note} onChange={(event) => setNote(event.target.value)} aria-describedby={describedBy} />}
            </Field>
          </div>
          {onBehalf && targetMember && (
            <div className="small muted">Wpisujesz w imieniu: <b>{targetMember.display_name}</b> · dostanie o tym powiadomienie i może wpis usunąć.</div>
          )}
          {canActOnBehalf && !onBehalf && !ownMember && team.data && (
            <div className="small muted">Twoje konto nie jest w rotacji - wskaż osobę, w imieniu której wpisujesz.</div>
          )}
          {warning && <Box tone="warn" role="status" title={warning} />}
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
  const fairness = useQuery({ queryKey: ['fairness', undefined], queryFn: () => api.fairness() })
  const me = fairness.data?.members.find((member) => member.display_name === displayName)
  const duties = useQuery({
    queryKey: ['fairness-duties', me?.member_id, undefined],
    queryFn: () => api.fairnessDuties(me!.member_id),
    enabled: Boolean(me) && !compact,
  })
  const [period, setPeriod] = useState<'12m' | 'month'>('12m')
  const thisMonth = monthOf(warsawDate())
  const balance = me && fairness.data ? totalBalance(me, fairness.data.late_shift_balanced) : null
  const threshold = fairness.data?.criterion_points ?? 0
  const within = balance ? Math.abs(balance.deviation) <= threshold : true
  const rows = monthlyTotals(duties.data ?? []).filter((row) => period === '12m' || row.month === thisMonth)
  const bigNumber = balance
    ? `${balance.deviation > 0 ? '+' : balance.deviation < 0 ? '−' : ''}${formatPoints(Math.abs(balance.deviation))}`
    : null
  return (
    <section className="stack-sm" aria-labelledby="moje-punkty">
      <SectionHeading
        id="moje-punkty"
        title={compact ? 'Punkty' : 'Moje punkty'}
        controls={!compact && (
          <>
            <button type="button" className={cx('sech-link', period === '12m' && 'on')} aria-pressed={period === '12m'} onClick={() => setPeriod('12m')}>12 mies.</button>
            <button type="button" className={cx('sech-link', period === 'month' && 'on')} aria-pressed={period === 'month'} onClick={() => setPeriod('month')}>Ten miesiąc</button>
          </>
        )}
      />
      <div className="panel panel-padded stack-sm">
        {fairness.isLoading && <LoadingBlock label="Wczytywanie punktów" rows={2} />}
        {fairness.error && <ErrorState error={fairness.error} onRetry={() => fairness.refetch()} />}
        {fairness.data && !me && (
          <EmptyState compact icon="chart" title="Brak punktów" description="Twoje konto nie ma jeszcze dyżurów w oknie 12 miesięcy." />
        )}
        {balance && bigNumber && (
          <>
            <div className="big-number">
              <span className="big">{bigNumber}</span>
              <span className="muted small">{compact ? `${within ? 'w normie' : 'poza normą'} (±${formatPoints(threshold)})` : 'względem sprawiedliwego udziału'}</span>
            </div>
            <DeviationBar value={balance.deviation} max={DEVIATION_SCALE} label={deviationWords(balance.deviation)} />
            {!compact && (
              <Box tone={within ? 'ok' : 'warn'} title={within ? 'W normie' : 'Poza normą'}>
                Próg ostrzeżenia to ±{formatPoints(threshold)} pkt.
                {' '}{within
                  ? 'Generator wyrówna to w kolejnym zakresie.'
                  : `Generator da Ci ${balance.deviation > 0 ? 'mniej' : 'więcej'} dyżurów w kolejnym zakresie.`}
              </Box>
            )}
            {!compact && duties.isLoading && <LoadingBlock label="Wczytywanie miesięcy" rows={2} />}
            {!compact && duties.data && (
              <table className="lg" aria-label="Punkty miesiąc po miesiącu">
                <thead>
                  <tr><th scope="col">Miesiąc</th><th scope="col" className="n">Pkt</th><th scope="col" className="n">Dyż.</th><th scope="col" className="n">Week.</th></tr>
                </thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={4} className="muted">Brak dyżurów w tym okresie.</td></tr>}
                  {rows.map((row) => (
                    <tr key={row.month}>
                      <td>{monthLabel(row.month, row.month.slice(0, 4) !== thisMonth.slice(0, 4))}</td>
                      <td className="n">{formatPoints(row.points)}</td>
                      <td className="n">{row.duties}</td>
                      <td className="n">{row.weekends}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {compact
              ? <Button variant="primary" block icon="calendar" onClick={onAvailability}>Zgłoś dostępność</Button>
              : <LinkButton to="/sprawiedliwosc" size="sm" variant="ghost" className="self-start">Pełny raport sprawiedliwości</LinkButton>}
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
const swapShort: Record<SwapRequest['status'], string> = {
  pending_replacement: 'oczekuje',
  pending_coordinator: 'oczekuje',
  approved: 'wpisana',
  rejected: 'odrzucona',
  cancelled: 'wycofana',
}

/** The swaps this person is part of, decided with one click; the rest is on Zamiany. */
function SwapsSection({ displayName, role }: { displayName: string; role: UserRole }) {
  const swaps = useQuery({ queryKey: ['swaps'], queryFn: () => api.swaps() })
  const viewer = { displayName, role }
  const mine = (swaps.data ?? []).filter((item) => item.requester_name === displayName || item.replacement_name === displayName)
  const visible = [
    ...mine.filter(isOpen).sort((a, b) => a.service_date.localeCompare(b.service_date)),
    ...mine.filter((item) => !isOpen(item)).sort((a, b) => b.created_at.localeCompare(a.created_at)),
  ].slice(0, 5)
  const stage = (item: SwapRequest) => {
    if (item.status === 'pending_replacement') {
      return item.replacement_name === displayName
        ? 'prośba do Ciebie · odpowiedz'
        : `czeka na: ${firstName(item.replacement_name)} · ${relativeDay(item.created_at.slice(0, 10))}`
    }
    if (item.status === 'pending_coordinator') return needsMyDecision(item, viewer) ? 'czeka na Twoje zatwierdzenie' : 'czeka na koordynatora'
    if (item.status === 'approved') return 'wpisana do grafiku'
    return item.decision_note ? `${swapStatusLabels[item.status].toLowerCase()} · „${item.decision_note}”` : swapStatusLabels[item.status].toLowerCase()
  }
  return (
    <section className="stack-sm" aria-labelledby="moje-zamiany">
      <SectionHeading
        id="moje-zamiany"
        title="Zamiany"
        controls={<LinkButton to="/zamiany" size="sm" variant="ghost">Wszystkie</LinkButton>}
      />
      <div className="panel">
        {swaps.isLoading && <LoadingBlock label="Wczytywanie zamian" rows={2} />}
        {swaps.error && <ErrorState error={swaps.error} onRetry={() => swaps.refetch()} />}
        {swaps.data && visible.length === 0 && (
          <EmptyState compact icon="swap" title="Brak zamian z Twoim udziałem" description="Zamianę zaczniesz od dyżuru na liście powyżej." />
        )}
        {visible.length > 0 && (
          <List>
            {visible.map((item) => (
              <ListRow
                key={item.id}
                aside={needsMyDecision(item, viewer)
                  ? <LinkButton size="sm" variant="primary" to="/zamiany?skrzynka=do-mnie">Zdecyduj</LinkButton>
                  : <StatusBadge tone={swapTone[item.status]}>{swapShort[item.status]}</StatusBadge>}
              >
                <b>
                  {item.requester_name === displayName ? `Ty → ${firstName(item.replacement_name)}` : `${firstName(item.requester_name)} → Ty`}
                  {' · '}{formatDayShort(item.service_date)} {roleLabels[item.role]}
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

/** The ICS subscriptions, in a side panel behind "Eksport ICS". */
function FeedsPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
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
      <Panel open={open} onOpenChange={onOpenChange} title="Subskrypcja kalendarza (ICS)" meta={<Tag>tylko Twoje dyżury</Tag>}>
        <p className="muted small">Adres ICS pokazuje wyłącznie Twoje dyżury i aktualizuje się po zamianach. Dodaj go w swojej aplikacji kalendarza.</p>
        <form
          className="stack-sm"
          aria-label="Nowa subskrypcja"
          onSubmit={(event) => {
            event.preventDefault()
            create.mutate(label.trim() || 'Mój kalendarz')
          }}
        >
          <Field label="Nazwa subskrypcji" id="feed-label">
            {({ id }) => <Input id={id} name={id} value={label} onChange={(event) => setLabel(event.target.value)} placeholder="np. telefon" />}
          </Field>
          <div className="row">
            <Button type="submit" variant="primary" loading={create.isPending} icon="plus">Utwórz adres ICS</Button>
          </div>
        </form>
        {(create.error || revoke.error) && <Box tone="bad" role="alert" title={create.error?.message ?? revoke.error?.message} />}
        {created && (
          <Box tone="ok" role="status" title="Nowy adres ICS. Zapisz go teraz, nie pokażemy go ponownie.">
            <div className="token-once"><code>{created.url}</code><CopyButton value={created.url} /></div>
          </Box>
        )}
        {feeds.isLoading && <LoadingBlock label="Wczytywanie subskrypcji" rows={2} />}
        {feeds.data && visible.length === 0 && (
          <EmptyState compact icon="link" title="Nie masz jeszcze subskrypcji" description="Pierwszy adres utworzysz powyżej." />
        )}
        {visible.length > 0 && (
          <List className="panel">
            {visible.map((feed) => (
              <ListRow
                key={feed.id}
                aside={feed.revoked_at
                  ? <StatusBadge tone="bad">odwołana</StatusBadge>
                  : <Button size="sm" variant="ghost" disabled={revoke.isPending} onClick={() => { revoke.reset(); setToRevoke(feed) }}>Odwołaj</Button>}
              >
                <b>{feed.label}</b>
                <small>utworzono {formatDate(feed.created_at)}{feed.last_used_at ? ` · ostatnie użycie ${formatDate(feed.last_used_at)}` : ' · jeszcze nieużyta'}</small>
              </ListRow>
            ))}
          </List>
        )}
        {feeds.data?.some((feed) => feed.revoked_at) && (
          <Checkbox label="Pokaż odwołane" checked={showRevoked} onChange={(event) => setShowRevoked(event.target.checked)} />
        )}
      </Panel>
      <ConfirmDialog
        open={Boolean(toRevoke)}
        pending={revoke.isPending}
        error={revoke.error ? revoke.error.message : null}
        onCancel={() => setToRevoke(null)}
        onConfirm={() => toRevoke && revoke.mutate(toRevoke.id)}
        title="Odwołać subskrypcję ICS?"
        confirmLabel="Odwołaj subskrypcję"
        confirmColor="error"
        description={toRevoke && <>Adres „{toRevoke.label}” przestanie działać w aplikacjach kalendarza, które go używają. Odwołanego adresu nie da się przywrócić - trzeba będzie utworzyć nowy.</>}
      />
    </>
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
  const scrollToAvailability = () => document.getElementById('dostepnosc')?.scrollIntoView({ block: 'start', behavior: 'smooth' })

  const subtitle = [
    displayName,
    accountRoleLabels[role].toLowerCase(),
    inRotation ? (history.data ? `${pluralPl(past.length, ['dyżur', 'dyżury', 'dyżurów'])} w ostatnich 90 dniach` : null) : 'poza rotacją',
  ].filter(Boolean).join(' · ')

  const duties = (
    <section className="stack-sm" aria-labelledby="moje-dyzury">
      <SectionHeading
        id="moje-dyzury"
        title="Najbliższe dyżury"
        meta={calendar.data ? `najbliższe 60 dni · ${upcoming.length}` : undefined}
        controls={<LinkButton to={`/grafik?osoba=${encodeURIComponent(displayName)}`} size="sm" variant="ghost">Grafik</LinkButton>}
      />
      {calendar.isLoading && <LoadingBlock label="Wczytywanie dyżurów" rows={3} />}
      {calendar.error && <ErrorState error={calendar.error} onRetry={() => calendar.refetch()} />}
      {calendar.data && <DutyList duties={upcoming} today={today} collides={collides} />}
    </section>
  )
  const availability = <AvailabilitySection role={role} hasTeamMember={inRotation} displayName={displayName} />

  return (
    <div className="page">
      <PageHeader
        title="Moje dyżury"
        sub={(
          <span>
            {subtitle}
            {inRotation && calendar.data && (
              <>
                {' · następny: '}
                <b className="fg">{next ? `${relativeDay(next.service_date)}, ${next.roles.map((item) => roleLabels[item]).join(' + ')}` : 'brak w najbliższych 60 dniach'}</b>
              </>
            )}
          </span>
        )}
        actions={inRotation && (
          <>
            <Button variant="ghost" icon="download" onClick={() => setIcsOpen(true)}>Eksport ICS (tylko moje)</Button>
            <LinkButton icon="swap" to={next ? `/zamiany?data=${next.service_date}&rola=${next.roles[0]}` : '/zamiany'}>Zaproponuj zamianę</LinkButton>
          </>
        )}
      />
      {!inRotation ? availability : narrow ? (
        <>
          {duties}
          <PointsSection displayName={displayName} compact onAvailability={scrollToAvailability} />
          {availability}
          <SwapsSection displayName={displayName} role={role} />
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
          </div>
        </div>
      )}
      {inRotation && <FeedsPanel open={icsOpen} onOpenChange={setIcsOpen} />}
    </div>
  )
}
