import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { UserRole, api } from '../api'
import { addDays, formatRange, isIsoDate, warsawDate, weeksBetween, weeksWord } from '../lib/dates'
import { pluralPl } from '../lib/plural'
import { CalendarMatrix, CalendarRange, MatrixZoom } from '../components/CalendarMatrix'
import { MatrixControls, MatrixView, WEEKS } from '../components/MatrixControls'
import { useNarrow } from '../hooks/useMediaQuery'
import { LinkButton, PageHeader, SectionHeading } from '../ui'

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000) + 1
}

/** The zoom the range fits; an arbitrary od/do still gets sensible cells. */
function zoomFor(range: CalendarRange): MatrixZoom {
  const days = daysBetween(range.starts_on, range.ends_on)
  if (days <= 14) return '2'
  if (days <= 28) return '4'
  return '8'
}

const isZoom = (value: string | null): value is MatrixZoom => value === '2' || value === '4' || value === '8'

/**
 * The full schedule: the same matrix as on "Teraz" without the risk row,
 * over any range, two to eight weeks per screen, as a matrix or a day list,
 * with the day inspector. The start and the zoom live in the URL
 * (`grafik?od=2026-09-14&zoom=8`) so a view can be sent as a link; an older
 * link with `od` and `do` still works. `dzien` and `osoba` come from the
 * command palette.
 */
export function ScheduleScreen({ role, displayName, hasTeamMember = false }: {
  role: UserRole
  displayName: string
  hasTeamMember?: boolean
}) {
  const today = warsawDate()
  const narrow = useNarrow()
  const canCoordinate = role === 'coordinator' || role === 'admin'
  const [searchParams, setSearchParams] = useSearchParams()
  const [hideIdle, setHideIdle] = useState(false)
  const [view, setView] = useState<MatrixView>(narrow ? 'list' : 'matrix')
  useEffect(() => { setView(narrow ? 'list' : 'matrix') }, [narrow])
  // The default range ends where the published coverage ends (LOW5-05) rather
  // than painting weeks of "no coverage" over days nobody published yet; an
  // empty installation falls back to four weeks (QA7-L01).
  const published = useQuery({ queryKey: ['published-schedule'], queryFn: api.publishedSchedule })
  const drafts = useQuery({ queryKey: ['draft-schedules'], queryFn: api.draftSchedules, enabled: canCoordinate })
  const dayParam = searchParams.get('dzien')
  const focusDay = isIsoDate(dayParam) ? dayParam : null
  const focusPerson = searchParams.get('osoba')
  const od = searchParams.get('od')
  const legacyEnd = searchParams.get('do')
  const zoomParam = searchParams.get('zoom')
  const explicitStart = isIsoDate(od)
  const range = useMemo<CalendarRange>(() => {
    if (explicitStart && isIsoDate(legacyEnd)) return { starts_on: od, ends_on: legacyEnd }
    if (explicitStart) {
      const weeks = WEEKS[isZoom(zoomParam) ? zoomParam : '4']
      return { starts_on: od, ends_on: addDays(od, weeks * 7 - 1) }
    }
    if (focusDay) {
      return { starts_on: addDays(focusDay, -7), ends_on: addDays(focusDay, 20) }
    }
    const coveredEnd = published.data?.ends_on
    const fourWeeks = addDays(today, 27)
    const defaultEnd = !published.data?.is_published
      ? fourWeeks
      : coveredEnd && coveredEnd >= today
        ? (coveredEnd < fourWeeks ? coveredEnd : fourWeeks)
        : today
    return { starts_on: today, ends_on: defaultEnd }
  }, [explicitStart, od, legacyEnd, zoomParam, focusDay, published.data, today])
  const zoom: MatrixZoom = isZoom(zoomParam) ? zoomParam : zoomFor(range)
  const setStart = (startsOn: string, nextZoom: MatrixZoom = zoom) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.set('od', startsOn)
      next.set('zoom', nextZoom)
      next.delete('do')
      next.delete('dzien')
      return next
    }, { replace: true })
  }
  const ready = explicitStart || Boolean(focusDay) || published.isSuccess || published.isError
  const rangeValid = range.starts_on <= range.ends_on
  const weeks = weeksBetween(range.starts_on, range.ends_on)

  const publication = published.data?.is_published ? published.data : null
  // The proposal waiting for the coordinator, named in the subtitle and
  // opened by the primary action; a plain draft is mentioned but not pushed.
  const pending = drafts.data?.find((item) => item.status === 'proposed') ?? drafts.data?.find((item) => item.status === 'draft')
  const generatorHref = publication?.ends_on
    ? `/generator?od=${addDays(publication.ends_on, 1)}&do=${addDays(publication.ends_on, 28)}`
    : '/generator'

  return (
    <div className="page">
      <PageHeader
        title="Grafik"
        sub={published.data && (
          <span>
            {publication && publication.starts_on && publication.ends_on
              ? `Opublikowany ${formatRange(publication.starts_on, publication.ends_on)}${publication.version ? ` (wersja ${publication.version})` : ''}`
              : 'Brak opublikowanego grafiku'}
            {pending && ` · ${pending.status === 'proposed' ? 'propozycja' : 'szkic'} ${formatRange(pending.starts_on, pending.ends_on)} czeka na ${pending.status === 'proposed' ? 'publikację' : 'akceptację'}`}
          </span>
        )}
        actions={(
          <>
            {focusPerson && (
              <span className="filter-chip">
                {focusPerson}
                <button type="button" aria-label={`Wyłącz podświetlenie: ${focusPerson}`} onClick={() => setSearchParams((current) => { const next = new URLSearchParams(current); next.delete('osoba'); return next }, { replace: true })}>×</button>
              </span>
            )}
            {hasTeamMember && <LinkButton to="/moje#ics" variant="ghost" icon="download">Eksport ICS</LinkButton>}
            {canCoordinate && (pending
              ? <LinkButton to={`/generator?szkic=${pending.id}`} variant="primary" icon="wand">Otwórz propozycję</LinkButton>
              : <LinkButton to={generatorHref} variant="primary" icon="wand">Generuj kolejny zakres</LinkButton>)}
          </>
        )}
      />
      {!rangeValid && <p className="muted">Data „do” jest wcześniejsza niż „od”.</p>}
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
              meta={`${weeksWord(weeks)}${summary.people > 0 ? ` · ${pluralPl(summary.people, ['osoba', 'osoby', 'osób'])} w rotacji` : ''}`}
              controls={(
                <MatrixControls
                  zoom={zoom}
                  onZoom={(value) => setStart(range.starts_on, value)}
                  onShift={(days) => setStart(addDays(range.starts_on, days))}
                  onToday={() => setStart(today)}
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
      )}
    </div>
  )
}
