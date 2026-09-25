import { MatrixZoom } from './CalendarMatrix'
import { useMessages } from '../i18n'
import { AvailabilityMark, Button, IconButton, Popover, RoleMark, Segmented, cx } from '../ui'

export type MatrixView = 'matrix' | 'list'

export const WEEKS: Record<MatrixZoom, number> = { '2': 2, '4': 4, '8': 8 }

/** The legend as a popover hanging off the "Legend" link in a section heading. */
export function LegendPopover({ showAvailability, trigger }: { showAvailability: boolean; trigger: React.ReactElement }) {
  const t = useMessages().schedule
  return (
    <Popover title={t.controls.legend} trigger={trigger}>
      <div className="legend-grid small">
        <div className="pop-h">{t.legend.roles}</div>
        <div className="pop-row"><RoleMark role="primary" /> {t.legend.primary}</div>
        <div className="pop-row"><RoleMark role="secondary" /> {t.legend.secondary}</div>
        <div className="pop-row"><RoleMark role="late_shift" /> {t.legend.lateShift}</div>
        {showAvailability && (
          <>
            <div className="pop-h">{t.legend.availability}</div>
            <div className="pop-row"><AvailabilityMark kind="unavailable" withLabel /></div>
            <div className="pop-row"><AvailabilityMark kind="prefer_not" withLabel /></div>
            <div className="pop-row"><AvailabilityMark kind="prefer" withLabel /></div>
          </>
        )}
        <div className="pop-h">{t.legend.marks}</div>
        <div className="pop-row"><RoleMark role="primary" change="swap" /> {t.legend.afterSwap}</div>
        <div className="pop-row"><RoleMark role="primary" change="manual_override" /> {t.legend.afterOverride}</div>
        <div className="pop-row"><span className="pop-swatch" style={{ background: 'var(--today)', borderColor: 'var(--sig-line)' }} /> {t.legend.today}</div>
        <div className="pop-row"><span className="pop-swatch" style={{ background: 'var(--bad-bg)' }} /> {t.legend.unstaffedDay}</div>
        <div className="pop-row"><span className="pop-swatch" style={{ background: 'var(--wknd)' }} /> {t.legend.weekendHoliday}</div>
        <div className="pop-row"><span className="pop-swatch" style={{ background: 'var(--ev-blue)', width: 6, height: 6, borderRadius: '50%' }} /> {t.legend.event}</div>
      </div>
    </Popover>
  )
}

/**
 * The controls of the schedule matrix, laid out in a section heading the way
 * the accepted design has them: zoom, a week back / today / a week forward,
 * then the "only on duty", "legend" and "day list" links. A screen whose range
 * is fixed drops the zoom and the arrows; one with a bounded range disables
 * the arrow that would leave it.
 */
export function MatrixControls({
  zoom,
  onZoom,
  onShift,
  onToday,
  hideIdle,
  onHideIdle,
  view,
  onView,
  showAvailability,
  showRange = true,
  canShiftBack = true,
  canShiftForward = true,
}: {
  zoom: MatrixZoom
  onZoom: (zoom: MatrixZoom) => void
  onShift: (days: number) => void
  onToday: () => void
  hideIdle: boolean
  onHideIdle: (value: boolean) => void
  view: MatrixView
  onView: (view: MatrixView) => void
  showAvailability: boolean
  showRange?: boolean
  canShiftBack?: boolean
  canShiftForward?: boolean
}) {
  const t = useMessages().schedule.controls
  return (
    <>
      {showRange && (
        <>
          <Segmented<MatrixZoom>
            size="sm"
            label={t.rangeLength}
            value={zoom}
            onChange={onZoom}
            options={[
              { value: '2', label: t.weeks(2) },
              { value: '4', label: t.weeks(4) },
              { value: '8', label: t.weeks(8) },
            ]}
          />
          <span className="row" style={{ gap: 4 }}>
            <IconButton size="sm" label={t.weekBack} icon="chevron-left" disabled={!canShiftBack} onClick={() => onShift(-7)} />
            <Button size="sm" onClick={onToday}>{t.today}</Button>
            <IconButton size="sm" label={t.weekForward} icon="chevron-right" disabled={!canShiftForward} onClick={() => onShift(7)} />
          </span>
        </>
      )}
      <button type="button" className="sech-link" aria-pressed={hideIdle} onClick={() => onHideIdle(!hideIdle)}>{t.onlyOnDuty}</button>
      <LegendPopover showAvailability={showAvailability} trigger={<button type="button" className="sech-link">{t.legend}</button>} />
      <button
        type="button"
        className={cx('sech-link', view === 'list' && 'on')}
        aria-pressed={view === 'list'}
        onClick={() => onView(view === 'list' ? 'matrix' : 'list')}
      >
        {t.dayList}
      </button>
    </>
  )
}
