import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PublishedSchedule, UserRole, api } from '../api'
import { addDays, daysBetween, formatDate, formatRange, isIsoDate, warsawDate, weeksBetween, weeksWord } from '../lib/dates'
import { useMessages } from '../i18n'
import { CalendarMatrix, CalendarRange, MatrixZoom } from '../components/CalendarMatrix'
import { MatrixControls, ONLY_ON_DUTY, VIEW_KEY, VIEW_SLUGS, WEEKS, isZoom, viewOf } from '../components/MatrixControls'
import { useNarrow } from '../hooks/useMediaQuery'
import { useUrlParams } from '../hooks/useUrlParams'
import { Box, Button, EmptyState, LinkButton, PageHeader, SectionHeading } from '../ui'

/** The zoom the range fits; an arbitrary od/do still gets sensible cells. */
function zoomFor(range: CalendarRange): MatrixZoom {
  const days = daysBetween(range.starts_on, range.ends_on) + 1
  if (days <= 14) return '2'
  if (days <= 28) return '4'
  return '8'
}

/** The days a query names; with no start or day, those `published` covers. */
function rangeOf(query: URLSearchParams, today: string, published: PublishedSchedule | undefined): CalendarRange {
  const od = query.get('od')
  const legacyEnd = query.get('do')
  const dayParam = query.get('dzien')
  if (isIsoDate(od) && isIsoDate(legacyEnd)) return { starts_on: od, ends_on: legacyEnd }
  if (isIsoDate(od)) return { starts_on: od, ends_on: addDays(od, WEEKS[zoomOf(query, null)] * 7 - 1) }
  if (isIsoDate(dayParam)) return { starts_on: addDays(dayParam, -7), ends_on: addDays(dayParam, 20) }
  const coveredEnd = published?.ends_on
  const fourWeeks = addDays(today, 27)
  const defaultEnd = published?.is_published && coveredEnd && coveredEnd >= today && coveredEnd < fourWeeks
    ? coveredEnd
    : fourWeeks
  return { starts_on: today, ends_on: defaultEnd }
}

function zoomOf(query: URLSearchParams, range: CalendarRange | null): MatrixZoom {
  const zoom = query.get('zoom')
  return isZoom(zoom) ? zoom : range ? zoomFor(range) : '4'
}

/**
 * The full schedule: the same matrix as on "Teraz" without the risk row,
 * over any range, two to eight weeks per screen, as a matrix or a day list,
 * with the day inspector. The start, the zoom, the "only on duty" filter and
 * the view live in the URL (`grafik?od=2026-09-14&zoom=8&tylko=z-dyzurem&widok=lista`)
 * so a view survives a refresh and can be sent as a link; an older link with `od` and
 * `do` still works. `dzien` and `osoba` come from the command palette.
 */
export function ScheduleScreen({ role, displayName, hasTeamMember = false }: {
  role: UserRole
  displayName: string
  hasTeamMember?: boolean
}) {
  const today = warsawDate()
  const narrow = useNarrow()
  const t = useMessages()
  const canCoordinate = role === 'coordinator' || role === 'admin'
  const [searchParams, setSearchParams] = useUrlParams()
  const hideIdle = searchParams.get(ONLY_ON_DUTY.key) === ONLY_ON_DUTY.value
  const view = viewOf(searchParams.get(VIEW_KEY), narrow)
  // The default range ends where the published coverage ends (LOW5-05) rather
  // than painting weeks of "no coverage" over days nobody published yet; an
  // empty installation falls back to four weeks (QA7-L01).
  const published = useQuery({ queryKey: ['published-schedule'], queryFn: api.publishedSchedule })
  const drafts = useQuery({ queryKey: ['draft-schedules'], queryFn: api.draftSchedules, enabled: canCoordinate })
  const dayParam = searchParams.get('dzien')
  const focusDay = isIsoDate(dayParam) ? dayParam : null
  const focusPerson = searchParams.get('osoba')
  const explicitStart = isIsoDate(searchParams.get('od'))
  const range = useMemo(() => rangeOf(searchParams, today, published.data), [searchParams, today, published.data])
  const zoom = zoomOf(searchParams, range)
  // From the latest query, which a render of quick clicks may not show yet.
  const setStart = (startsOn: (current: CalendarRange) => string, nextZoom?: MatrixZoom) => {
    setSearchParams((latest) => {
      const current = rangeOf(latest, today, published.data)
      return { od: startsOn(current), zoom: nextZoom ?? zoomOf(latest, current), do: null, dzien: null }
    })
  }
  const ready = explicitStart || Boolean(focusDay) || published.isSuccess || published.isError
  const rangeValid = range.starts_on <= range.ends_on
  const weeks = weeksBetween(range.starts_on, range.ends_on)

  const publication = published.data?.is_published ? published.data : null
  // The proposal waiting for the coordinator, named in the subtitle and
  // opened by the primary action; a plain draft is mentioned but not pushed.
  const pending = drafts.data?.find((item) => item.status === 'proposed') ?? drafts.data?.find((item) => item.status === 'draft')
  // Once the last published day has passed nothing ahead is published, so the
  // generator link falls back to its own suggested range from today.
  const lastPublishedEnd = published.data?.last_published_ends_on
  const expiredOn = lastPublishedEnd && lastPublishedEnd < today ? lastPublishedEnd : null
  const generatorHref = publication?.ends_on
    ? `/generator?od=${addDays(publication.ends_on, 1)}&do=${addDays(publication.ends_on, 28)}`
    : '/generator'
  const nextStep = (size?: 'sm') => (pending
    ? <LinkButton to={`/generator?szkic=${pending.id}`} variant="primary" size={size} icon="wand">{t.schedule.actions.openProposal}</LinkButton>
    : <LinkButton to={generatorHref} variant="primary" size={size} icon="wand">{t.schedule.actions.generateNext}</LinkButton>)

  return (
    <div className="page">
      <PageHeader
        title={t.nav.screens.schedule}
        sub={published.data && (
          <span>
            {publication?.starts_on && publication.ends_on
              ? t.schedule.published(formatRange(publication.starts_on, publication.ends_on), publication.version)
              : t.schedule.noPublished}
            {pending && ` · ${pending.status === 'proposed'
              ? t.schedule.proposalWaiting(formatRange(pending.starts_on, pending.ends_on))
              : t.schedule.draftWaiting(formatRange(pending.starts_on, pending.ends_on))}`}
          </span>
        )}
        actions={(focusPerson || canCoordinate) && (
          <>
            {focusPerson && (
              <span className="filter-chip">
                {focusPerson}
                <button type="button" aria-label={t.schedule.clearHighlight(focusPerson)} onClick={() => setSearchParams({ osoba: null })}>×</button>
              </span>
            )}
            {canCoordinate && nextStep()}
          </>
        )}
      />
      {expiredOn && (
        <Box tone="warn" title={t.schedule.publicationExpired(formatDate(expiredOn))}>
          {canCoordinate && (
            <>
              {t.schedule.publicationExpiredHint}
              <div className="box-next">{nextStep('sm')}</div>
            </>
          )}
        </Box>
      )}
      {!rangeValid && (
        <div className="panel">
          <EmptyState
            icon="alert"
            title={t.schedule.rangeInvalid}
            action={<Button variant="primary" size="sm" onClick={() => setStart(() => today, '4')}>{t.schedule.showFromToday}</Button>}
          />
        </div>
      )}
      {rangeValid && (
        <CalendarMatrix
          role={role}
          displayName={displayName}
          range={range}
          view={view}
          hideIdle={hideIdle}
          zoom={zoom}
          focusDay={focusDay}
          focusPerson={focusPerson}
          enabled={ready}
          showRisks={false}
          heading={(summary) => (
            <SectionHeading
              title={formatRange(range.starts_on, range.ends_on)}
              meta={(
                <>
                  {weeksWord(weeks)}
                  {summary.people > 0 && ` · ${t.schedule.peopleInRotation(summary.people)}`}
                  {summary.firstGap && (
                    <> · <button type="button" className="link-btn" onClick={summary.firstGap.show}>
                      {t.schedule.firstGap(t.schedule.risks.gapDays(summary.firstGap.count), formatDate(summary.firstGap.date).slice(0, 5))}
                    </button></>
                  )}
                </>
              )}
              controls={(
                <MatrixControls
                  zoom={zoom}
                  onZoom={(value) => setStart((current) => current.starts_on, value)}
                  onShift={(days) => setStart((current) => addDays(current.starts_on, days))}
                  onToday={() => setStart(() => today)}
                  hideIdle={hideIdle}
                  onHideIdle={(value) => setSearchParams({ [ONLY_ON_DUTY.key]: value ? ONLY_ON_DUTY.value : null })}
                  view={view}
                  onView={(value) => setSearchParams({ [VIEW_KEY]: VIEW_SLUGS[value] })}
                  showAvailability={role !== 'viewer'}
                  icsExport={hasTeamMember}
                />
              )}
            />
          )}
        />
      )}
    </div>
  )
}
