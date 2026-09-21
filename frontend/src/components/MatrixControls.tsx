import { MatrixZoom } from './CalendarMatrix'
import { AvailabilityMark, Button, IconButton, Popover, RoleMark, Segmented, cx } from '../ui'

export type MatrixView = 'matrix' | 'list'

export const WEEKS: Record<MatrixZoom, number> = { '2': 2, '4': 4, '8': 8 }

/** The legend as a popover hanging off the "Legenda" link in a section heading. */
export function LegendPopover({ showAvailability, trigger }: { showAvailability: boolean; trigger: React.ReactElement }) {
  return (
    <Popover title="Legenda" trigger={trigger}>
      <div className="legend-grid small">
        <div className="pop-h">Role</div>
        <div className="pop-row"><RoleMark role="primary" /> PRIMARY · 19:00 → 09:00, weekend całą dobę</div>
        <div className="pop-row"><RoleMark role="secondary" /> SECONDARY · zastępstwo, ta sama pora</div>
        <div className="pop-row"><RoleMark role="late_shift" /> dyżur dzienny 11:00 → 19:00 w dni robocze</div>
        {showAvailability && (
          <>
            <div className="pop-h">Dostępność</div>
            <div className="pop-row"><AvailabilityMark kind="unavailable" withLabel /></div>
            <div className="pop-row"><AvailabilityMark kind="prefer_not" withLabel /></div>
            <div className="pop-row"><AvailabilityMark kind="prefer" withLabel /></div>
          </>
        )}
        <div className="pop-h">Oznaczenia</div>
        <div className="pop-row"><RoleMark role="primary" change="swap" /> po zamianie</div>
        <div className="pop-row"><RoleMark role="primary" change="manual_override" /> po korekcie koordynatora</div>
        <div className="pop-row"><span className="pop-swatch" style={{ background: 'var(--today)', borderColor: 'var(--sig-line)' }} /> dziś</div>
        <div className="pop-row"><span className="pop-swatch" style={{ background: 'var(--bad-bg)' }} /> dzień bez obsady</div>
        <div className="pop-row"><span className="pop-swatch" style={{ background: 'var(--wknd)' }} /> weekend / święto (2X)</div>
        <div className="pop-row"><span className="pop-swatch" style={{ background: 'var(--ev-blue)', width: 6, height: 6, borderRadius: '50%' }} /> wydarzenie (kropka w komórce)</div>
      </div>
    </Popover>
  )
}

/**
 * The controls of the schedule matrix, laid out in a section heading the way
 * the accepted design has them: zoom, a week back / today / a week forward,
 * then the "only on duty", "legend" and "day list" links.
 */
export function MatrixControls({ zoom, onZoom, onShift, onToday, hideIdle, onHideIdle, view, onView, showAvailability }: {
  zoom: MatrixZoom
  onZoom: (zoom: MatrixZoom) => void
  onShift: (days: number) => void
  onToday: () => void
  hideIdle: boolean
  onHideIdle: (value: boolean) => void
  view: MatrixView
  onView: (view: MatrixView) => void
  showAvailability: boolean
}) {
  return (
    <>
      <Segmented<MatrixZoom>
        size="sm"
        label="Długość zakresu"
        value={zoom}
        onChange={onZoom}
        options={[
          { value: '2', label: '2 tyg.' },
          { value: '4', label: '4 tyg.' },
          { value: '8', label: '8 tyg.' },
        ]}
      />
      <span className="row" style={{ gap: 4 }}>
        <IconButton size="sm" label="Cofnij o tydzień" icon="chevron-left" onClick={() => onShift(-7)} />
        <Button size="sm" onClick={onToday}>dziś</Button>
        <IconButton size="sm" label="Do przodu o tydzień" icon="chevron-right" onClick={() => onShift(7)} />
      </span>
      <button type="button" className="sech-link" aria-pressed={hideIdle} onClick={() => onHideIdle(!hideIdle)}>Tylko z dyżurem</button>
      <LegendPopover showAvailability={showAvailability} trigger={<button type="button" className="sech-link">Legenda</button>} />
      <button
        type="button"
        className={cx('sech-link', view === 'list' && 'on')}
        aria-pressed={view === 'list'}
        onClick={() => onView(view === 'list' ? 'matrix' : 'list')}
      >
        Lista dni
      </button>
    </>
  )
}
