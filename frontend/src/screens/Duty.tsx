import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AssignmentRole, CurrentDuty, ShareSession, UserRole, api } from '../api'
import { roleLabels } from '../lib/labels'
import { groupSwaps } from '../lib/swaps'
import { addDays, daysBetween, formatDateLong, formatDayShort, formatRange, formatShortDate, relativeDay, warsawDate, weeksWord } from '../lib/dates'
import { useMessages } from '../i18n'
import { useNarrow } from '../hooks/useMediaQuery'
import { CalendarMatrix, CalendarRange, MatrixSummary, MatrixZoom } from '../components/CalendarMatrix'
import { MatrixControls, MatrixView, WEEKS } from '../components/MatrixControls'
import { AnchorButton, Box, Chip, LinkButton, PageHeader, SectionHeading, StatusBadge, Tag, cx } from '../ui'

const roleClass: Record<AssignmentRole, string> = { primary: '', secondary: 'dcard-s', late_shift: 'dcard-l' }
const ROLE_ORDER: AssignmentRole[] = ['primary', 'secondary', 'late_shift']

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
  const t = useMessages().duty.card
  const notApplicable = !duty && role === 'late_shift' && Boolean(todayDayOff)
  // The number as printed and, without its spaces, as dialled.
  const contactPhone = duty?.contact_phone ?? null
  const phone = contactPhone?.replace(/\s+/g, '')
  const roleLabel = roleLabels()[role]
  return (
    <article className={cx('dcard', roleClass[role], !duty && 'dcard-none')} aria-label={roleLabel}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="dcard-role">{role === 'primary' && duty ? t.roleNow(roleLabel) : roleLabel}</span>
        {duty?.is_override && <Tag tone="sig">{t.override}</Tag>}
        {duty?.is_day_off && <Tag tone="late">{t.dayOffRate}</Tag>}
      </div>
      <div className="dcard-name">
        {notApplicable
          ? t.notApplicable(holidayName ? t.holiday(holidayName) : t.dayOff)
          : duty?.assignee_name ?? t.unassigned}
      </div>
      {duty && !notApplicable ? (
        <>
          <div className="dcard-win">
            {duty.is_day_off ? t.allDay : `${duty.coverage_starts_at} → ${duty.coverage_ends_at}`}
            {' · '}{formatDayShort(duty.service_date)}
          </div>
          {(phone || duty.contact_email) && (
            <div className="dcard-acts">
              {contactPhone && phone && (
                <AnchorButton href={`tel:${phone}`} size="sm" icon="phone" variant={role === 'primary' ? 'primary' : undefined}>
                  {t.call(contactPhone)}
                </AnchorButton>
              )}
              {phone && <AnchorButton href={`sms:${phone}`} size="sm" icon="sms">{t.sms}</AnchorButton>}
              {duty.contact_email && (
                <AnchorButton href={`mailto:${duty.contact_email}`} size="sm" icon="mail">{t.email}</AnchorButton>
              )}
            </div>
          )}
          {duty.next_assignee_name && duty.next_service_date && (
            <div className="dcard-next">
              {t.next(roleLabel)} <b>{duty.next_assignee_name}</b>, {relativeDay(duty.next_service_date)}
            </div>
          )}
        </>
      ) : (
        <div className="dcard-win">{notApplicable ? '' : t.nobody}</div>
      )}
    </article>
  )
}

/**
 * The days the matrix shows. A share link reads only its own range: a link
 * that fits the widest zoom is shown whole with nothing to move, a longer one
 * keeps the zoom and the arrows but its window never leaves the link.
 */
function matrixWindow(today: string, offset: number, zoom: MatrixZoom, share: ShareSession | null): {
  range: CalendarRange
  wholeLink: boolean
  canShiftBack: boolean
  canShiftForward: boolean
} {
  const length = WEEKS[zoom] * 7
  if (share && daysBetween(share.starts_on, share.ends_on) < WEEKS['8'] * 7) {
    return {
      range: { starts_on: share.starts_on, ends_on: share.ends_on },
      wholeLink: true,
      canShiftBack: false,
      canShiftForward: false,
    }
  }
  const wanted = addDays(today, offset)
  if (!share) {
    return { range: { starts_on: wanted, ends_on: addDays(wanted, length - 1) }, wholeLink: false, canShiftBack: true, canShiftForward: true }
  }
  const latest = addDays(share.ends_on, 1 - length)
  const start = wanted < share.starts_on ? share.starts_on : wanted > latest ? latest : wanted
  return {
    range: { starts_on: start, ends_on: addDays(start, length - 1) },
    wholeLink: false,
    canShiftBack: start > share.starts_on,
    canShiftForward: start < latest,
  }
}

/**
 * The landing screen. The title is today's date and the subtitle the state
 * of the published schedule; the strip above the page already says who is
 * on duty, so on a desktop the page goes straight to the risks and the
 * next weeks of the schedule. A phone has no strip and gets the duties as
 * cards with a call button instead.
 */
export function DutyScreen({ role, displayName, hasTeamMember, share = null }: {
  role: UserRole
  displayName: string
  hasTeamMember: boolean
  /** A share-link session, which can read only the link's range. */
  share?: ShareSession | null
}) {
  const navigate = useNavigate()
  const narrow = useNarrow()
  const t = useMessages()
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

  const { range, wholeLink, canShiftBack, canShiftForward } = matrixWindow(today, offset, zoom, share)
  // From the window actually shown: a share link may have clamped it away
  // from where the offset alone would put it.
  const shift = (days: number) => setOffset(daysBetween(today, range.starts_on) + days)
  // The team holds nobody at all: no range has a row to zoom, filter or list,
  // so the empty state stands alone. A team that simply has no member active in
  // this window keeps its controls, so the view can move to where duties are.
  const nobodyNow = (summary: MatrixSummary) => summary.loaded && summary.people === 0 && !summary.teamHasMembers
  // "The next four weeks" only while the window starts today and is not a link's.
  const upcoming = offset === 0 && !share
  const current = schedule.data?.current ?? []
  const byRole = (value: AssignmentRole) => current.find((item) => item.role === value)
  // Not `Boolean(schedule.data?.id)`: imported history is stored as a
  // superseded schedule and fills `id` too (MED5-01).
  const published = schedule.data?.is_published ? schedule.data : null
  const actionable = groupSwaps(swaps.data ?? [], { displayName, role }).actionable.length
  const ownAhead = hasTeamMember
    ? (schedule.data?.assignments ?? []).filter((item) => item.assignee_name === displayName && item.service_date >= today)
    : []
  const nextOwnDate = ownAhead.map((item) => item.service_date).sort()[0]
  // Every role of that day, the way Moje names it ("SECONDARY + 11–19").
  const nextOwnRoles = ROLE_ORDER.filter((value) => ownAhead.some((item) => item.service_date === nextOwnDate && item.role === value))
  const generatorHref = published?.ends_on
    ? `/generator?od=${addDays(published.ends_on, 1)}&do=${addDays(published.ends_on, 28)}`
    : '/generator'

  const subtitle = schedule.data && (
    <>
      <span>
        {published
          ? t.duty.published(formatShortDate(published.ends_on ?? today), published.version)
          : t.duty.notPublished}
        {schedule.data.today_is_day_off && ` · ${t.duty.todayIs(schedule.data.today_holiday_name ? t.duty.todayHoliday(schedule.data.today_holiday_name) : t.duty.todayDayOff)}`}
      </span>
      {role === 'viewer' && <StatusBadge>{t.duty.readOnly}</StatusBadge>}
    </>
  )

  return (
    <div className="page">
      <PageHeader
        title={formatDateLong(today)}
        sub={subtitle}
        actions={(inRotation || canCoordinate) && (
          <>
            {hasTeamMember && <LinkButton to="/moje#ics" variant="ghost" icon="download">{t.schedule.actions.exportIcs}</LinkButton>}
            {hasTeamMember && <LinkButton to="/moje#dostepnosc" icon="calendar">{t.duty.reportAvailability}</LinkButton>}
            {canCoordinate && <LinkButton to={generatorHref} variant="primary" icon="wand">{t.schedule.actions.generateNext}</LinkButton>}
          </>
        )}
      />
      {schedule.data && !published && (
        <Box tone="warn" role="status" title={t.duty.notPublishedYet}>
          {canCoordinate ? t.duty.notPublishedCoordinator : t.duty.notPublishedMember}
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
      {narrow && nextOwnDate && (
        <p className="muted small">
          {t.duty.nextOwnDuty} <b>{formatDayShort(nextOwnDate)} · {nextOwnRoles.map((value) => roleLabels()[value]).join(' + ')}</b>
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
              <Chip tone="warn" onClick={() => navigate('/zamiany')} title={t.duty.openSwaps}>
                {t.duty.swapsWaiting(actionable)}
              </Chip>
            )}
            {/* An empty team meets any criterion; saying so would mislead. */}
            {fairness.data && fairness.data.members.length > 0 && (
              <Chip tone={fairness.data.criterion_met ? 'ok' : 'warn'} onClick={() => navigate('/sprawiedliwosc')} title={t.duty.openFairness}>
                {fairness.data.criterion_met ? t.duty.fairnessMet : t.duty.fairnessNotMet}
              </Chip>
            )}
          </>
        )}
        heading={(summary) => (
          <SectionHeading
            title={upcoming ? t.duty.upcoming(weeksWord(WEEKS[zoom])) : formatRange(range.starts_on, range.ends_on)}
            meta={wholeLink ? t.duty.linkRange : upcoming ? formatRange(range.starts_on, range.ends_on) : weeksWord(WEEKS[zoom])}
            controls={!nobodyNow(summary) && (
              <MatrixControls
                zoom={zoom}
                onZoom={setZoom}
                onShift={shift}
                onToday={() => setOffset(0)}
                hideIdle={hideIdle}
                onHideIdle={setHideIdle}
                view={view}
                onView={setView}
                showAvailability={role !== 'viewer'}
                showRange={!wholeLink}
                canShiftBack={canShiftBack}
                canShiftForward={canShiftForward}
              />
            )}
          />
        )}
      />
    </div>
  )
}
