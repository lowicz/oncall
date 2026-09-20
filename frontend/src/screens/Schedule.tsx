import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { UserRole, api } from '../api'
import { addDays, formatDate, warsawDate } from '../lib/dates'
import { CalendarMatrix, CalendarRange, MatrixZoom } from '../components/CalendarMatrix'
import { DateField } from '../components/DateField'
import { useNarrow } from '../hooks/useMediaQuery'
import { AvailabilityMark, Button, Checkbox, IconButton, PageHeader, Popover, RoleMark, Segmented, StatusBadge } from '../ui'

const WEEKS: Record<MatrixZoom, number> = { '2': 2, '4': 4, '8': 8 }

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

function Legend({ showAvailability }: { showAvailability: boolean }) {
  return (
    <Popover
      title="Legenda"
      trigger={<IconButton label="Legenda oznaczeń" icon="help" />}
    >
      <div className="legend-grid small">
        <div className="pop-row"><RoleMark role="primary" /> PRIMARY, on-call</div>
        <div className="pop-row"><RoleMark role="secondary" /> SECONDARY, on-call</div>
        <div className="pop-row"><RoleMark role="late_shift" /> zmiana 11–19</div>
        <div className="pop-row"><RoleMark role="primary" change="swap" /> po zamianie</div>
        <div className="pop-row"><RoleMark role="primary" change="manual_override" /> korekta koordynatora</div>
        {showAvailability && (
          <>
            <div className="pop-h">Dostępność</div>
            <div className="pop-row"><AvailabilityMark kind="unavailable" withLabel /></div>
            <div className="pop-row"><AvailabilityMark kind="prefer_not" withLabel /></div>
            <div className="pop-row"><AvailabilityMark kind="prefer" withLabel /></div>
          </>
        )}
        <div className="pop-h">Dni</div>
        <div className="pop-row"><span className="pop-swatch" style={{ background: 'var(--wknd)' }} /> weekend lub święto, stawka 2X</div>
        <div className="pop-row"><span className="pop-swatch" style={{ background: 'var(--today)' }} /> dziś</div>
        <div className="pop-row"><span className="pop-swatch" style={{ background: 'var(--bad-bg)' }} /> dzień bez pełnej obsady</div>
        <div className="pop-row"><span className="pop-swatch" style={{ background: 'var(--ev-blue)', width: 6, height: 6, borderRadius: '50%' }} /> wydarzenie (kropka w komórce)</div>
      </div>
    </Popover>
  )
}

/**
 * The full schedule: any range, two to eight weeks per screen, a matrix or a
 * day list, the day inspector. `od`/`do` live in the URL so a range can be
 * shared; `dzien` and `osoba` come from the command palette.
 */
export function ScheduleScreen({ role, displayName }: { role: UserRole; displayName: string }) {
  const today = warsawDate()
  const narrow = useNarrow()
  const [searchParams, setSearchParams] = useSearchParams()
  const [hideIdle, setHideIdle] = useState(false)
  const [view, setView] = useState<'matrix' | 'list'>(narrow ? 'list' : 'matrix')
  useEffect(() => { setView(narrow ? 'list' : 'matrix') }, [narrow])
  // The default range ends where the published coverage ends (LOW5-05) rather
  // than painting weeks of "no coverage" over days nobody published yet; an
  // empty installation falls back to four weeks (QA7-L01).
  const published = useQuery({ queryKey: ['published-schedule'], queryFn: api.publishedSchedule })
  const focusDay = searchParams.get('dzien')
  const focusPerson = searchParams.get('osoba')
  const explicitRange = searchParams.has('od') && searchParams.has('do')
  const range = useMemo<CalendarRange>(() => {
    if (explicitRange) return { starts_on: searchParams.get('od')!, ends_on: searchParams.get('do')! }
    if (focusDay && /^\d{4}-\d{2}-\d{2}$/.test(focusDay)) {
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
  }, [explicitRange, searchParams, focusDay, published.data, today])
  const setRange = (value: CalendarRange) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.set('od', value.starts_on)
      next.set('do', value.ends_on)
      next.delete('dzien')
      return next
    }, { replace: true })
  }
  const zoom = zoomFor(range)
  const setZoom = (value: MatrixZoom) => setRange({ starts_on: range.starts_on, ends_on: addDays(range.starts_on, WEEKS[value] * 7 - 1) })
  const shiftRange = (days: number) => setRange({ starts_on: addDays(range.starts_on, days), ends_on: addDays(range.ends_on, days) })
  const ready = explicitRange || Boolean(focusDay) || published.isSuccess || published.isError
  const rangeValid = range.starts_on <= range.ends_on

  return (
    <div className="page">
      <PageHeader
        eyebrow={<>Grafik {published.data?.is_published && published.data.version ? <StatusBadge tone="pub">v{published.data.version} · do {formatDate(published.data.ends_on ?? '')}</StatusBadge> : published.data && <StatusBadge tone="warn">brak publikacji</StatusBadge>}</>}
        title={<>{formatDate(range.starts_on)} <span className="muted">–</span> {formatDate(range.ends_on)}</>}
        sub={view === 'matrix'
          ? 'Osoby w wierszach, dni w kolumnach. Strzałkami przechodzisz po siatce, PageUp i PageDown przeskakują o tydzień.'
          : 'Dzień po dniu, z obsadą każdej roli. Dotknij roli, aby zobaczyć szczegóły.'}
        actions={(
          <>
            {focusPerson && (
              <span className="filter-chip">
                {focusPerson}
                <button type="button" aria-label={`Wyłącz podświetlenie: ${focusPerson}`} onClick={() => setSearchParams((current) => { const next = new URLSearchParams(current); next.delete('osoba'); return next }, { replace: true })}>×</button>
              </span>
            )}
            <Legend showAvailability={role !== 'viewer'} />
          </>
        )}
      />
      <form className="toolbar panel" onSubmit={(event) => event.preventDefault()} aria-label="Zakres grafiku">
        <IconButton label="Cofnij o tydzień" icon="chevron-left" onClick={() => shiftRange(-7)} />
        <IconButton label="Do przodu o tydzień" icon="chevron-right" onClick={() => shiftRange(7)} />
        <Button size="sm" onClick={() => setRange({ starts_on: today, ends_on: addDays(today, WEEKS[zoom] * 7 - 1) })}>Dziś</Button>
        <Segmented<MatrixZoom>
          size="sm"
          label="Długość zakresu"
          value={zoom}
          onChange={setZoom}
          options={[
            { value: '2', label: '2 tyg.' },
            { value: '4', label: '4 tyg.' },
            { value: '8', label: '8 tyg.' },
          ]}
        />
        <DateField id="calendar-from" label="Od" value={range.starts_on} onChange={(value) => value && setRange({ ...range, starts_on: value })} />
        <DateField id="calendar-to" label="Do" value={range.ends_on} onChange={(value) => value && setRange({ ...range, ends_on: value })} />
        <span className="sp" />
        <Checkbox label="Tylko osoby z dyżurem" checked={hideIdle} onChange={(event) => setHideIdle(event.target.checked)} />
        <Segmented<'matrix' | 'list'>
          size="sm"
          label="Widok"
          value={view}
          onChange={setView}
          options={[
            { value: 'matrix', label: 'Macierz' },
            { value: 'list', label: 'Lista dni' },
          ]}
        />
      </form>
      {!rangeValid && <p className="muted">Data „Do” jest wcześniejsza niż „Od”.</p>}
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
        />
      )}
    </div>
  )
}
