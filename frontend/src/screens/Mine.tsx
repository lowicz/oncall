import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AssignmentRole, AvailabilityEntry, AvailabilityInput, AvailabilityKind, FeedTokenCreated, UserRole, api } from '../api'
import { availabilityLabels, roleLabels } from '../lib/labels'
import { addDays, formatDate, formatDay, relativeDay, warsawDate } from '../lib/dates'
import { CopyButton } from '../components/CopyButton'
import { DateField } from '../components/DateField'
import { coverageWindowText } from '../components/CalendarMatrix'
import {
  Box,
  Button,
  Checkbox,
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
  Panelbox,
  RoleMark,
  SectionHeading,
  Segmented,
  Select,
  StatusBadge,
  Tag,
  cx,
} from '../ui'

const WEEKDAY_HEAD = ['pon', 'wt', 'śr', 'czw', 'pt', 'sob', 'niedz']
const toneOf: Record<AvailabilityKind, 'na' | 'wn' | 'ch'> = { unavailable: 'na', prefer_not: 'wn', prefer: 'ch' }
const roleDot: Record<AssignmentRole, string> = { primary: 'dot-p', secondary: 'dot-s', late_shift: 'dot-l' }

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
function monthLabel(month: string) {
  const [y, m] = month.split('-').map(Number)
  return `${MONTHS[m - 1]} ${y}`
}

/** The person's upcoming duties, with a swap link on each. */
function MyDuties({ displayName }: { displayName: string }) {
  const today = warsawDate()
  const end = addDays(today, 59)
  const calendar = useQuery({
    queryKey: ['calendar', today, end],
    queryFn: () => api.calendar(today, end),
  })
  const duties = calendar.data?.assignments
    .filter((item) => item.assignee_name === displayName)
    .sort((a, b) => a.service_date.localeCompare(b.service_date) || a.role.localeCompare(b.role)) ?? []
  const dayByDate = new Map(calendar.data?.days.map((day) => [day.service_date, day]) ?? [])
  const ownId = calendar.data?.members.find((member) => member.display_name === displayName)?.id
  const collision = (serviceDate: string) => calendar.data?.availability.some(
    (entry) => entry.member_id === ownId && entry.kind === 'unavailable'
      && entry.starts_on <= serviceDate && entry.ends_on >= serviceDate,
  )
  const points = duties.reduce((sum, duty) => sum + (dayByDate.get(duty.service_date)?.is_day_off ? 2 : 1), 0)
  return (
    <section className="stack-sm" aria-labelledby="moje-dyzury">
      <SectionHeading
        id="moje-dyzury"
        title="Moje dyżury"
        meta={`najbliższe 60 dni · ${duties.length} ${duties.length === 1 ? 'dyżur' : 'dyżurów'} · ${points} pkt`}
        controls={<LinkButton to="/grafik" size="sm" variant="ghost">Grafik →</LinkButton>}
      />
      {calendar.isLoading && <LoadingBlock label="Wczytywanie dyżurów" rows={3} />}
      {calendar.error && <ErrorState error={calendar.error} onRetry={() => calendar.refetch()} />}
      {calendar.data && duties.length === 0 && (
        <EmptyState compact icon="calendar" title="Brak nadchodzących dyżurów" description="W najbliższych 60 dniach nie masz przydzielonego dyżuru." />
      )}
      {duties.length > 0 && (
        <List className="panel">
          {duties.map((duty) => {
            const day = dayByDate.get(duty.service_date)
            const conflict = collision(duty.service_date)
            return (
              <ListRow
                key={`${duty.service_date}-${duty.role}`}
                tone={conflict ? 'warn' : undefined}
                highlight={duty.service_date === today}
                aside={(
                  <LinkButton size="sm" icon="swap" to={`/zamiany?data=${duty.service_date}&rola=${duty.role}`}>
                    Poproś o zamianę
                  </LinkButton>
                )}
              >
                <div className="row">
                  <RoleMark role={duty.role} change={duty.change_kind} />
                  <b>{formatDay(duty.service_date)}</b>
                  <span className="muted small">{relativeDay(duty.service_date)}</span>
                  {day?.holiday_name && <Tag tone="late">{day.holiday_name}</Tag>}
                </div>
                <small>
                  {roleLabels[duty.role]} · {coverageWindowText(day ?? { is_day_off: false }, duty.role)} · {day?.is_day_off ? '2X' : '1X'}
                  {conflict && <> · <span className="who-out">koliduje z Twoją niedostępnością</span></>}
                </small>
              </ListRow>
            )
          })}
        </List>
      )}
    </section>
  )
}

/**
 * A month of days to click on: the first click starts a range, the second
 * ends it, the form under the grid shows the same dates and takes the kind
 * and the note. Existing entries and own duties are painted on the grid so a
 * conflict is visible before the entry is saved.
 */
function AvailabilityCalendar({ month, onMonth, entries, duties, range, onPick, kind }: {
  month: string
  onMonth: (month: string) => void
  entries: AvailabilityEntry[]
  duties: Array<{ service_date: string; role: AssignmentRole }>
  range: { starts_on: string; ends_on: string }
  onPick: (date: string) => void
  kind: AvailabilityKind
}) {
  const today = warsawDate()
  const days = monthDays(month)
  const lead = weekdayIndex(days[0])
  const dutiesByDate = useMemo(() => {
    const map = new Map<string, AssignmentRole[]>()
    for (const duty of duties) map.set(duty.service_date, [...(map.get(duty.service_date) ?? []), duty.role])
    return map
  }, [duties])
  const entryFor = (date: string) => entries.find((entry) => entry.starts_on <= date && entry.ends_on >= date)
  const inRange = (date: string) => range.starts_on <= date && date <= range.ends_on
  return (
    <div className="stack-sm">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b style={{ textTransform: 'capitalize' }}>{monthLabel(month)}</b>
        <span className="pager">
          <IconButton size="sm" label="Poprzedni miesiąc" icon="chevron-left" onClick={() => onMonth(shiftMonth(month, -1))} />
          <Button size="sm" variant="ghost" onClick={() => onMonth(monthOf(today))}>Dziś</Button>
          <IconButton size="sm" label="Następny miesiąc" icon="chevron-right" onClick={() => onMonth(shiftMonth(month, 1))} />
        </span>
      </div>
      <div className="avail-cal-head" aria-hidden="true">
        {WEEKDAY_HEAD.map((label, index) => <span key={label} className={cx(index >= 5 && 'we')}>{label}</span>)}
      </div>
      <div className="avail-cal" role="grid" aria-label={`Kalendarz dostępności, ${monthLabel(month)}`}>
        {Array.from({ length: lead }, (_, index) => <span key={`lead-${index}`} aria-hidden="true" />)}
        {days.map((date) => {
          const entry = entryFor(date)
          const roles = dutiesByDate.get(date) ?? []
          const weekend = weekdayIndex(date) >= 5
          const selected = inRange(date)
          const conflict = roles.length > 0 && (entry?.kind === 'unavailable' || (selected && kind === 'unavailable'))
          const label = [
            formatDay(date),
            entry ? availabilityLabels[entry.kind] : null,
            roles.length ? `dyżur: ${roles.map((role) => roleLabels[role]).join(', ')}` : null,
            selected ? 'w wybranym zakresie' : null,
          ].filter(Boolean).join(', ')
          return (
            <button
              type="button"
              key={date}
              role="gridcell"
              aria-selected={selected}
              aria-label={label}
              className={cx(
                'avail-day',
                weekend && 'avail-day-we',
                entry && `avail-day-${toneOf[entry.kind]}`,
                selected && `avail-day-${toneOf[kind]} avail-day-sel`,
                date === today && 'avail-day-today',
                conflict && 'avail-day-conflict',
              )}
              disabled={date < today}
              onClick={() => onPick(date)}
            >
              {roles.map((role) => <i key={role} className={cx('dot', roleDot[role])} aria-hidden="true" />)}
              {date.slice(8)}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function AvailabilityPanel({ role = 'member', hasTeamMember = true, displayName = '' }: {
  role?: UserRole
  hasTeamMember?: boolean
  displayName?: string
}) {
  const queryClient = useQueryClient()
  const today = warsawDate()
  const canActOnBehalf = role === 'coordinator' || role === 'admin'
  const team = useQuery({ queryKey: ['team'], queryFn: api.team, enabled: canActOnBehalf })
  const ownMember = team.data?.find((member) => member.display_name === displayName)
  // '' means "myself"; a member id means "on behalf of that person".
  const [target, setTarget] = useState('')
  const onBehalf = target !== '' && target !== ownMember?.id
  const targetMember = team.data?.find((member) => member.id === target)
  // An admin who is not in the rotation has no availability of their own to
  // show, so the screen only works once a person is picked.
  const needsPick = canActOnBehalf && !hasTeamMember && !onBehalf

  const listKey = onBehalf ? ['availability', 'member', target] : ['availability', 'me']
  const entries = useQuery({
    queryKey: listKey,
    queryFn: onBehalf ? () => api.memberAvailability(target) : api.availability,
    enabled: onBehalf || hasTeamMember,
  })
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: listKey })
    queryClient.invalidateQueries({ queryKey: ['calendar'] })
  }
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

  const [form, setForm] = useState<AvailabilityInput>({ kind: 'unavailable', starts_on: today, ends_on: today, note: '' })
  const pick = (date: string) => {
    setForm((current) => {
      const fresh = current.starts_on !== current.ends_on || date < current.starts_on
      return fresh ? { ...current, starts_on: date, ends_on: date } : { ...current, ends_on: date }
    })
  }
  const create = useMutation({
    mutationFn: (input: AvailabilityInput) =>
      onBehalf ? api.createMemberAvailability(target, input) : api.createAvailability(input),
    onSuccess: () => {
      invalidate()
      setForm((previous) => ({ ...previous, note: '' }))
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => (onBehalf ? api.deleteMemberAvailability(target, id) : api.deleteAvailability(id)),
    onSuccess: invalidate,
  })
  const sortedEntries = [...(entries.data ?? [])].sort((a, b) => a.starts_on.localeCompare(b.starts_on))
  const upcoming = sortedEntries.filter((entry) => entry.ends_on >= today)
  const past = sortedEntries.filter((entry) => entry.ends_on < today)
  const [showPast, setShowPast] = useState(false)

  return (
    <section className="stack-sm" aria-labelledby="dostepnosc">
      <SectionHeading
        id="dostepnosc"
        title={onBehalf ? `Dostępność: ${targetMember?.display_name ?? ''}` : 'Moja dostępność'}
        meta="powód widzą koordynatorzy i administratorzy"
      />
      {canActOnBehalf && (
        <Field
          label="Osoba"
          id="availability-target"
          hint={onBehalf
            ? 'Wpisujesz w imieniu innej osoby. Dostanie o tym powiadomienie i może wpis usunąć.'
            : ownMember
              ? 'Domyślnie wpisujesz własną dostępność.'
              : 'Twoje konto nie jest w rotacji - wskaż osobę, w imieniu której wpisujesz.'}
          className="field-narrow"
        >
          {({ id, describedBy }) => (
            <Select id={id} name={id} value={target} onChange={(event) => setTarget(event.target.value)} aria-describedby={describedBy}>
              <option value="">{ownMember ? `Ja (${displayName})` : 'Wskaż osobę'}</option>
              {team.data?.filter((member) => member.id !== ownMember?.id).map((member) => (
                <option key={member.id} value={member.id}>{member.display_name}</option>
              ))}
            </Select>
          )}
        </Field>
      )}
      {needsPick ? (
        <EmptyState icon="user" title="Wybierz osobę" description="Twoje konto nie jest w rotacji. Wskaż osobę, w imieniu której chcesz zgłosić dostępność." />
      ) : (
        <div className="split">
          <Panelbox padded>
            <AvailabilityCalendar
              month={month}
              onMonth={setMonth}
              entries={entries.data ?? []}
              duties={duties}
              range={{ starts_on: form.starts_on, ends_on: form.ends_on }}
              onPick={pick}
              kind={form.kind}
            />
            <p className="muted small" style={{ marginTop: 8 }}>
              Kliknij pierwszy i ostatni dzień zakresu, wybierz rodzaj i zapisz. Kropki to Twoje dyżury; czerwona ramka to kolizja „nie mogę” z dyżurem.
            </p>
          </Panelbox>
          <div className="stack">
            <form
              className="panel panel-padded stack-sm"
              aria-label="Nowy wpis dostępności"
              onSubmit={(event) => {
                event.preventDefault()
                create.mutate(form)
              }}
            >
              <Segmented<AvailabilityKind>
                label="Rodzaj"
                value={form.kind}
                onChange={(kind) => setForm({ ...form, kind })}
                options={[
                  { value: 'unavailable', label: 'Nie mogę', tone: 'na' },
                  { value: 'prefer_not', label: 'Wolę nie', tone: 'wn' },
                  { value: 'prefer', label: 'Chętnie wezmę', tone: 'ch' },
                ]}
              />
              <div className="frow">
                <DateField id="availability-from" label="Od" value={form.starts_on} onChange={(value) => setForm({ ...form, starts_on: value, ends_on: value > form.ends_on ? value : form.ends_on })} required />
                <DateField id="availability-to" label="Do" value={form.ends_on} onChange={(value) => setForm({ ...form, ends_on: value })} required minDate={form.starts_on} />
              </div>
              <Field label="Powód" hint="Widzą koordynatorzy i administratorzy." id="availability-note">
                {({ id, describedBy }) => <Input id={id} name={id} value={form.note ?? ''} onChange={(event) => setForm({ ...form, note: event.target.value })} aria-describedby={describedBy} />}
              </Field>
              {onBehalf && targetMember && <div className="small muted">Wpisujesz w imieniu: <b>{targetMember.display_name}</b></div>}
              {create.error && <Box tone="bad" role="alert" title={create.error.message} />}
              {create.data?.warning && <Box tone="warn" role="status" title={create.data.warning} />}
              <div className="row">
                <Button type="submit" variant="primary" loading={create.isPending} disabled={form.ends_on < form.starts_on}>
                  Zapisz {formatDate(form.starts_on)}{form.ends_on !== form.starts_on ? ` – ${formatDate(form.ends_on)}` : ''}
                </Button>
              </div>
            </form>
            <div className="stack-sm">
              <SectionHeading as="h3" title="Zgłoszone terminy" meta={`${upcoming.length} nadchodzących`} controls={past.length > 0 && (
                <Checkbox label={`Pokaż minione (${past.length})`} checked={showPast} onChange={(event) => setShowPast(event.target.checked)} />
              )} />
              {entries.isLoading && <LoadingBlock label="Wczytywanie terminów" rows={2} />}
              {entries.error && <ErrorState error={entries.error} onRetry={() => entries.refetch()} />}
              {entries.data && upcoming.length === 0 && !showPast && (
                <EmptyState
                  compact
                  icon="calendar"
                  title={onBehalf ? `${targetMember?.display_name ?? 'Ta osoba'} nie ma zgłoszonych terminów` : 'Nie masz jeszcze zgłoszonych terminów'}
                  description="Zgłoś dni, w których nie możesz dyżurować, albo takie, które chętnie weźmiesz. Generator uwzględni je przy układaniu grafiku."
                />
              )}
              {(upcoming.length > 0 || (showPast && past.length > 0)) && (
                <List className="panel">
                  {[...upcoming, ...(showPast ? past : [])].map((entry) => (
                    <ListRow
                      key={entry.id}
                      aside={(
                        <IconButton
                          size="sm"
                          label={`Usuń wpis od ${formatDate(entry.starts_on)}`}
                          icon="trash"
                          onClick={() => remove.mutate(entry.id)}
                          disabled={remove.isPending}
                        />
                      )}
                    >
                      <div className="row">
                        <StatusBadge tone={entry.kind === 'unavailable' ? 'bad' : entry.kind === 'prefer' ? 'ok' : 'warn'}>{availabilityLabels[entry.kind]}</StatusBadge>
                        <b className="mono">{formatDate(entry.starts_on)}{entry.ends_on !== entry.starts_on ? ` – ${formatDate(entry.ends_on)}` : ''}</b>
                        {entry.ends_on < today && <Tag>minione</Tag>}
                      </div>
                      {(entry.note || entry.created_by_name) && (
                        <small>{entry.note}{entry.note && entry.created_by_name ? ' · ' : ''}{entry.created_by_name ? `wpis dodał(a): ${entry.created_by_name}` : ''}</small>
                      )}
                    </ListRow>
                  ))}
                </List>
              )}
              {remove.error && <Box tone="bad" role="alert" title={remove.error.message} />}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function CalendarFeedsPanel() {
  const queryClient = useQueryClient()
  const feeds = useQuery({ queryKey: ['feeds'], queryFn: api.feeds })
  const [label, setLabel] = useState('')
  const [created, setCreated] = useState<FeedTokenCreated | null>(null)
  const [showRevoked, setShowRevoked] = useState(false)
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['feeds'] })
  const create = useMutation({
    mutationFn: api.createFeed,
    onSuccess: (value) => {
      setCreated(value)
      setLabel('')
      invalidate()
    },
  })
  const revoke = useMutation({ mutationFn: api.revokeFeed, onSuccess: invalidate })
  const visible = feeds.data?.filter((feed) => showRevoked || !feed.revoked_at) ?? []

  return (
    <section className="stack-sm" aria-labelledby="ics" id="ics">
      <SectionHeading
        id="ics"
        title="Subskrypcja kalendarza (ICS)"
        meta="tylko Twoje dyżury"
        controls={feeds.data?.some((feed) => feed.revoked_at) && (
          <Checkbox label="Pokaż odwołane" checked={showRevoked} onChange={(event) => setShowRevoked(event.target.checked)} />
        )}
      />
      <form
        className="toolbar panel"
        aria-label="Nowa subskrypcja"
        onSubmit={(event) => {
          event.preventDefault()
          create.mutate(label.trim() || 'Mój kalendarz')
        }}
      >
        <Field label="Nazwa subskrypcji" id="feed-label" className="field-grow">
          {({ id }) => <Input id={id} name={id} value={label} onChange={(event) => setLabel(event.target.value)} placeholder="np. telefon" />}
        </Field>
        <Button type="submit" variant="primary" loading={create.isPending} icon="plus">Utwórz adres ICS</Button>
      </form>
      {(create.error || revoke.error) && <Box tone="bad" role="alert" title={create.error?.message ?? revoke.error?.message} />}
      {created && (
        <Box tone="ok" role="status" title="Nowy adres ICS. Zapisz go teraz, nie pokażemy go ponownie.">
          <div className="token-once"><code>{created.url}</code><CopyButton value={created.url} /></div>
        </Box>
      )}
      {feeds.isLoading && <LoadingBlock label="Wczytywanie subskrypcji" rows={2} />}
      {feeds.data && visible.length === 0 && (
        <EmptyState compact icon="link" title="Nie masz jeszcze subskrypcji" description="Adres ICS pokazuje wyłącznie Twoje dyżury i aktualizuje się po zamianach. Dodaj go w swojej aplikacji kalendarza." />
      )}
      {visible.length > 0 && (
        <List className="panel">
          {visible.map((feed) => (
            <ListRow
              key={feed.id}
              aside={feed.revoked_at
                ? <StatusBadge tone="bad">odwołana</StatusBadge>
                : <Button size="sm" variant="ghost" disabled={revoke.isPending} onClick={() => revoke.mutate(feed.id)}>Odwołaj</Button>}
            >
              <b>{feed.label}</b>
              <small>utworzono {formatDate(feed.created_at)}{feed.last_used_at ? ` · ostatnie użycie ${formatDate(feed.last_used_at)}` : ' · jeszcze nieużyta'}</small>
            </ListRow>
          ))}
        </List>
      )}
    </section>
  )
}

export function MineScreen({ role, hasTeamMember, displayName }: {
  role?: UserRole
  hasTeamMember?: boolean
  displayName?: string
} = {}) {
  return (
    <div className="page">
      <PageHeader title="Moje" sub="Dyżury, dostępność i kalendarz jednej osoby: Twojej." />
      {hasTeamMember !== false && <MyDuties displayName={displayName ?? ''} />}
      <AvailabilityPanel role={role} hasTeamMember={hasTeamMember} displayName={displayName} />
      {hasTeamMember !== false && <CalendarFeedsPanel />}
    </div>
  )
}
