import { useQuery } from '@tanstack/react-query'
import { AssignmentRole, CurrentDuty, PublishedSchedule, UserRole, api } from '../api'
import { roleLabels } from '../lib/labels'
import { addDays, formatDate, formatDay, relativeDay, warsawDate } from '../lib/dates'
import { CalendarMatrix } from '../components/CalendarMatrix'
import { AnchorButton, Box, ErrorState, LinkButton, PageHeader, SectionHeading, Skeleton, StatusBadge, Tag, cx } from '../ui'

const roleClass: Record<AssignmentRole, string> = { primary: '', secondary: 'dcard-s', late_shift: 'dcard-l' }

/**
 * One role's duty right now: who, until when, how to reach them, who is next.
 * The 11–19 shift does not exist on days off (PLAN.md §3), so an empty card
 * there says "not applicable", not "somebody forgot to staff it".
 */
export function DutyCard({ duty, role, todayDayOff, holidayName }: {
  duty?: CurrentDuty
  role: AssignmentRole
  todayDayOff?: boolean
  holidayName?: string | null
}) {
  const notApplicable = !duty && role === 'late_shift' && Boolean(todayDayOff)
  return (
    <article className={cx('dcard', roleClass[role], !duty && 'dcard-none')} aria-label={roleLabels[role]}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="dcard-role">{roleLabels[role]}</span>
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
            {duty.is_day_off ? 'całą dobę' : `${duty.coverage_starts_at}–${duty.coverage_ends_at}`}
            {' · '}{formatDay(duty.service_date)}
          </div>
          {(duty.contact_phone || duty.contact_email) && (
            <div className="dcard-acts">
              {duty.contact_phone && (
                <AnchorButton href={`tel:${duty.contact_phone}`} size="sm" icon="phone">{duty.contact_phone}</AnchorButton>
              )}
              {duty.contact_email && (
                <AnchorButton href={`mailto:${duty.contact_email}`} size="sm" icon="mail">E-mail</AnchorButton>
              )}
            </div>
          )}
          {duty.next_assignee_name && duty.next_service_date && (
            <div className="dcard-next">
              Następnie: <b>{duty.next_assignee_name}</b> ({relativeDay(duty.next_service_date)})
            </div>
          )}
        </>
      ) : (
        <div className="dcard-win">{notApplicable ? '' : 'nikt nie odbierze tej roli'}</div>
      )}
    </article>
  )
}

function publicationBadge(schedule: PublishedSchedule | undefined) {
  if (!schedule) return null
  if (!schedule.is_published) return <StatusBadge tone="warn">brak publikacji</StatusBadge>
  return (
    <StatusBadge tone="pub">
      opublikowany{schedule.ends_on ? ` do ${formatDate(schedule.ends_on)}` : ''}
      {schedule.version ? ` · v${schedule.version}` : ''}
    </StatusBadge>
  )
}

/** The landing screen: the three duties of the moment and the next two weeks. */
export function DutyScreen({ role, displayName, hasTeamMember }: {
  role: UserRole
  displayName: string
  hasTeamMember: boolean
}) {
  const schedule = useQuery({ queryKey: ['published-schedule'], queryFn: api.publishedSchedule })
  const today = warsawDate()
  const current = schedule.data?.current ?? []
  // Not `Boolean(schedule.data?.id)`: imported history is stored as a
  // superseded schedule and fills `id` too (MED5-01).
  const hasPublishedSchedule = schedule.data?.is_published ?? false
  const byRole = (value: AssignmentRole) => current.find((item) => item.role === value)
  const range = { starts_on: today, ends_on: addDays(today, 13) }
  const inRotation = hasTeamMember || role === 'coordinator' || role === 'admin'

  return (
    <div className="page">
      <PageHeader
        eyebrow={<>{formatDay(today)} {schedule.data && publicationBadge(schedule.data)} {role === 'viewer' && <StatusBadge>tylko odczyt</StatusBadge>}</>}
        title="Kto ma dyżur"
        sub={schedule.data?.today_is_day_off
          ? `Dziś ${schedule.data.today_holiday_name ? `święto: ${schedule.data.today_holiday_name}` : 'dzień wolny'} · stawka 2X, PRIMARY i SECONDARY całą dobę.`
          : 'Dzień roboczy · on-call 19:00–09:00, zmiana 11–19 w godzinach pracy.'}
        actions={(
          <>
            {inRotation && <LinkButton to="/moje" icon="user">Moje dyżury</LinkButton>}
            <LinkButton to="/grafik" variant="primary" icon="calendar">Pełny grafik</LinkButton>
          </>
        )}
      />
      {schedule.error && <ErrorState error={schedule.error} onRetry={() => schedule.refetch()} />}
      {schedule.isLoading && (
        <div className="dcards" aria-busy="true" aria-label="Wczytywanie dyżurów">
          <Skeleton height={118} /><Skeleton height={118} /><Skeleton height={118} />
        </div>
      )}
      {schedule.data && !hasPublishedSchedule && (
        <Box tone="warn" role="status" title="Grafik na ten okres nie został jeszcze opublikowany.">
          {role === 'coordinator' || role === 'admin'
            ? 'Wygeneruj i opublikuj grafik w Generatorze, żeby dyżury pojawiły się tutaj.'
            : 'Koordynator jeszcze nie opublikował grafiku na ten okres.'}
        </Box>
      )}
      {schedule.data && (
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
      <SectionHeading
        title="Najbliższe 14 dni"
        meta={`${formatDate(range.starts_on)} – ${formatDate(range.ends_on)}`}
        controls={<LinkButton to="/grafik" size="sm" variant="ghost">Pełny grafik →</LinkButton>}
      />
      <CalendarMatrix role={role} displayName={displayName} range={range} zoom="2" />
      <p className="muted small">
        {role === 'viewer'
          ? 'Widzisz wyłącznie zatwierdzony harmonogram. Preferencje, urlopy i rozliczenia zespołu są prywatne.'
          : role === 'coordinator' || role === 'admin'
            ? 'To jest opublikowana wersja harmonogramu. Kliknij komórkę, żeby zobaczyć szczegóły dnia albo zmienić obsadę.'
            : hasTeamMember
              ? 'To jest opublikowana wersja harmonogramu. Kliknij swoją komórkę, żeby poprosić o zamianę; dostępności zgłaszasz w „Moje”.'
              : 'To jest opublikowana wersja harmonogramu.'}
      </p>
    </div>
  )
}
