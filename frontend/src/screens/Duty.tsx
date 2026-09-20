import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AssignmentRole, CurrentDuty, UserRole, api } from '../api'
import { roleLabels } from '../lib/labels'
import { pluralPl } from '../lib/plural'
import { groupSwaps } from '../lib/swaps'
import { addDays, formatDateLong, formatDayShort, formatRange, formatShortDate, relativeDay, warsawDate, weeksWord } from '../lib/dates'
import { useNarrow } from '../hooks/useMediaQuery'
import { CalendarMatrix, MatrixZoom } from '../components/CalendarMatrix'
import { MatrixControls, MatrixView, WEEKS } from '../components/MatrixControls'
import { AnchorButton, Box, Chip, LinkButton, PageHeader, SectionHeading, StatusBadge, Tag, cx } from '../ui'

const roleClass: Record<AssignmentRole, string> = { primary: '', secondary: 'dcard-s', late_shift: 'dcard-l' }

/**
 * One role's duty right now, as a card for a phone: who, until when, a
 * "call" button, who is next. The 11–19 shift does not exist on days off
 * (PLAN.md §3), so an empty card there says "not applicable", not "somebody
 * forgot to staff it".
 */
export function DutyCard({ duty, role, todayDayOff, holidayName }: {
  duty?: CurrentDuty
  role: AssignmentRole
  todayDayOff?: boolean
  holidayName?: string | null
}) {
  const notApplicable = !duty && role === 'late_shift' && Boolean(todayDayOff)
  const phone = duty?.contact_phone?.replace(/\s+/g, '')
  return (
    <article className={cx('dcard', roleClass[role], !duty && 'dcard-none')} aria-label={roleLabels[role]}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="dcard-role">{roleLabels[role]}{role === 'primary' && duty ? ' · teraz' : ''}</span>
        {duty?.is_override && <Tag tone="sig">korekta</Tag>}
        {duty?.is_day_off && <Tag tone="late">2X</Tag>}
      </div>
      <div className="dcard-name">
        {notApplicable
          ? `nie dotyczy: ${holidayName ? `święto - ${holidayName}` : 'dzień wolny'}`
          : duty?.assignee_name ?? 'Brak przydziału'}
      </div>
      {duty && !notApplicable ? (
        <>
          <div className="dcard-win">
            {duty.is_day_off ? 'całą dobę' : `${duty.coverage_starts_at} → ${duty.coverage_ends_at}`}
            {' · '}{formatDayShort(duty.service_date)}
          </div>
          {(phone || duty.contact_email) && (
            <div className="dcard-acts">
              {phone && (
                <AnchorButton href={`tel:${phone}`} size="sm" icon="phone" variant={role === 'primary' ? 'primary' : undefined}>
                  Zadzwoń {duty.contact_phone}
                </AnchorButton>
              )}
              {phone && <AnchorButton href={`sms:${phone}`} size="sm" icon="sms">SMS</AnchorButton>}
              {duty.contact_email && (
                <AnchorButton href={`mailto:${duty.contact_email}`} size="sm" icon="mail">E-mail</AnchorButton>
              )}
            </div>
          )}
          {duty.next_assignee_name && duty.next_service_date && (
            <div className="dcard-next">
              Następny {roleLabels[role]}: <b>{duty.next_assignee_name}</b>, {relativeDay(duty.next_service_date)}
            </div>
          )}
        </>
      ) : (
        <div className="dcard-win">{notApplicable ? '' : 'nikt nie odbierze tej roli'}</div>
      )}
    </article>
  )
}

/**
 * The landing screen. The title is today's date and the subtitle the state
 * of the published schedule; the strip above the page already says who is
 * on duty, so on a desktop the page goes straight to the risks and the
 * next weeks of the schedule. A phone has no strip and gets the duties as
 * cards with a call button instead.
 */
export function DutyScreen({ role, displayName, hasTeamMember }: {
  role: UserRole
  displayName: string
  hasTeamMember: boolean
}) {
  const navigate = useNavigate()
  const narrow = useNarrow()
  const today = warsawDate()
  const canCoordinate = role === 'coordinator' || role === 'admin'
  const inRotation = hasTeamMember || canCoordinate
  const schedule = useQuery({ queryKey: ['published-schedule'], queryFn: api.publishedSchedule })
  const swaps = useQuery({ queryKey: ['swaps'], queryFn: () => api.swaps(), enabled: inRotation })
  const fairness = useQuery({ queryKey: ['fairness', undefined], queryFn: () => api.fairness(), enabled: canCoordinate })
  const [zoom, setZoom] = useState<MatrixZoom>('4')
  const [offset, setOffset] = useState(0)
  const [hideIdle, setHideIdle] = useState(false)
  const [view, setView] = useState<MatrixView>(narrow ? 'list' : 'matrix')
  useEffect(() => { setView(narrow ? 'list' : 'matrix') }, [narrow])

  const start = addDays(today, offset)
  const range = { starts_on: start, ends_on: addDays(start, WEEKS[zoom] * 7 - 1) }
  const current = schedule.data?.current ?? []
  const byRole = (value: AssignmentRole) => current.find((item) => item.role === value)
  // Not `Boolean(schedule.data?.id)`: imported history is stored as a
  // superseded schedule and fills `id` too (MED5-01).
  const published = schedule.data?.is_published ? schedule.data : null
  const actionable = groupSwaps(swaps.data ?? [], { displayName, role }).actionable.length
  const nextOwn = hasTeamMember
    ? (schedule.data?.assignments ?? [])
      .filter((item) => item.assignee_name === displayName && item.service_date >= today)
      .sort((a, b) => a.service_date.localeCompare(b.service_date))[0]
    : undefined
  const generatorHref = published?.ends_on
    ? `/generator?od=${addDays(published.ends_on, 1)}&do=${addDays(published.ends_on, 28)}`
    : '/generator'

  const subtitle = schedule.data && (
    <>
      <span>
        {published
          ? `Opublikowany grafik do ${formatShortDate(published.ends_on ?? today)}${published.version ? ` · wersja ${published.version}` : ''}`
          : 'Grafik na ten okres nie jest opublikowany'}
        {schedule.data.today_is_day_off && ` · dziś ${schedule.data.today_holiday_name ? `święto: ${schedule.data.today_holiday_name}` : 'dzień wolny'}, stawka 2X`}
      </span>
      {role === 'viewer' && <StatusBadge>tylko odczyt</StatusBadge>}
    </>
  )

  return (
    <div className="page">
      <PageHeader
        title={formatDateLong(today)}
        sub={subtitle}
        actions={(inRotation || canCoordinate) && (
          <>
            {hasTeamMember && <LinkButton to="/moje#ics" variant="ghost" icon="download">Eksport ICS</LinkButton>}
            {hasTeamMember && <LinkButton to="/moje#dostepnosc" icon="calendar">Zgłoś dostępność</LinkButton>}
            {canCoordinate && <LinkButton to={generatorHref} variant="primary" icon="wand">Generuj kolejny zakres</LinkButton>}
          </>
        )}
      />
      {schedule.data && !published && (
        <Box tone="warn" role="status" title="Grafik na ten okres nie został jeszcze opublikowany.">
          {canCoordinate
            ? 'Wygeneruj i opublikuj grafik w Generatorze, żeby dyżury pojawiły się tutaj.'
            : 'Koordynator jeszcze nie opublikował grafiku na ten okres.'}
        </Box>
      )}
      {narrow && schedule.data && (
        <div className="dcards">
          <DutyCard role="primary" duty={byRole('primary')} />
          <DutyCard role="secondary" duty={byRole('secondary')} />
          <DutyCard
            role="late_shift"
            duty={byRole('late_shift')}
            todayDayOff={schedule.data.today_is_day_off}
            holidayName={schedule.data.today_holiday_name}
          />
        </div>
      )}
      {narrow && nextOwn && (
        <p className="muted small">
          Twój następny dyżur: <b>{formatDayShort(nextOwn.service_date)} · {roleLabels[nextOwn.role]}</b>
        </p>
      )}
      <CalendarMatrix
        role={role}
        displayName={displayName}
        range={range}
        zoom={zoom}
        view={view}
        hideIdle={hideIdle}
        extraChips={(
          <>
            {actionable > 0 && (
              <Chip tone="warn" onClick={() => navigate('/zamiany')} title="Otwórz zamiany">
                {pluralPl(actionable, ['zamiana czeka', 'zamiany czekają', 'zamian czeka'])} na Ciebie
              </Chip>
            )}
            {fairness.data && (
              <Chip tone={fairness.data.criterion_met ? 'ok' : 'warn'} onClick={() => navigate('/sprawiedliwosc')} title="Otwórz raport sprawiedliwości">
                {fairness.data.criterion_met ? 'Kryterium sprawiedliwości spełnione' : 'Kryterium sprawiedliwości niespełnione'}
              </Chip>
            )}
          </>
        )}
        heading={(
          <SectionHeading
            title={offset === 0 ? `Najbliższe ${weeksWord(WEEKS[zoom])}` : formatRange(range.starts_on, range.ends_on)}
            meta={offset === 0 ? formatRange(range.starts_on, range.ends_on) : weeksWord(WEEKS[zoom])}
            controls={(
              <MatrixControls
                zoom={zoom}
                onZoom={setZoom}
                onShift={(days) => setOffset((value) => value + days)}
                onToday={() => setOffset(0)}
                hideIdle={hideIdle}
                onHideIdle={setHideIdle}
                view={view}
                onView={setView}
                showAvailability={role !== 'viewer'}
              />
            )}
          />
        )}
      />
    </div>
  )
}
