import { ReactElement, useRef, useState } from 'react'
import { MatrixZoom } from './CalendarMatrix'
import { useMessages } from '../i18n'
import { AvailabilityMark, Button, IconButton, Menu, MenuCheckboxItem, MenuItem, MenuLink, MenuSeparator, Popover, RoleMark, Segmented } from '../ui'

export type MatrixView = 'matrix' | 'list'

export const WEEKS: Record<MatrixZoom, number> = { '2': 2, '4': 4, '8': 8 }

/** The legend as a popover hanging off the "Legend" link in a section heading,
 *  or, opened from a menu, off the menu's button. */
export function LegendPopover({ showAvailability, gridKeys = false, trigger, open, onOpenChange, anchor }: {
  showAvailability: boolean
  gridKeys?: boolean
  trigger?: ReactElement
  open?: boolean
  onOpenChange?: (open: boolean) => void
  anchor?: React.RefObject<HTMLElement | null>
}) {
  const t = useMessages().schedule
  return (
    <Popover title={t.controls.legend} trigger={trigger} open={open} onOpenChange={onOpenChange} anchor={anchor}>
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
        <div className="pop-row"><span className="pop-swatch pop-swatch-today" /> {t.legend.today}</div>
        <div className="pop-row"><span className="pop-swatch pop-swatch-gap" /> {t.legend.unstaffedDay}</div>
        <div className="pop-row"><span className="pop-swatch pop-swatch-weekend" /> {t.legend.weekendHoliday}</div>
        <div className="pop-row"><span className="pop-swatch pop-swatch-event" /> {t.legend.event}</div>
        {gridKeys && (
          <>
            <div className="pop-h">{t.legend.keys}</div>
            <div className="pop-row">{t.legend.keysText}</div>
          </>
        )}
      </div>
    </Popover>
  )
}

/**
 * The controls of the schedule matrix as one strip in a section heading:
 * zoom, a week back / today / a week forward, and a "more" menu with the
 * "only on duty" filter, the day list, the legend and, for a member of the
 * rotation, the ICS export. A screen whose range is fixed drops the zoom and
 * the arrows; one with a bounded range disables the arrow that would leave it.
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
  icsExport = false,
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
  /** Offers the ICS export of one's own duties, which lives on "Moje". */
  icsExport?: boolean
}) {
  const t = useMessages().schedule
  const more = useRef<HTMLButtonElement>(null)
  const [legendOpen, setLegendOpen] = useState(false)
  return (
    <>
      {showRange && (
        <>
          <Segmented<MatrixZoom>
            label={t.controls.rangeLength}
            value={zoom}
            onChange={onZoom}
            options={[
              { value: '2', label: t.controls.weeks(2) },
              { value: '4', label: t.controls.weeks(4) },
              { value: '8', label: t.controls.weeks(8) },
            ]}
          />
          <span className="row row-gap-4">
            <IconButton size="sm" label={t.controls.weekBack} icon="chevron-left" disabled={!canShiftBack} onClick={() => onShift(-7)} />
            <Button size="sm" onClick={onToday}>{t.controls.today}</Button>
            <IconButton size="sm" label={t.controls.weekForward} icon="chevron-right" disabled={!canShiftForward} onClick={() => onShift(7)} />
          </span>
        </>
      )}
      <Menu trigger={<IconButton ref={more} size="sm" label={t.controls.more} icon="more" />}>
        <MenuCheckboxItem checked={hideIdle} onChange={onHideIdle}>{t.controls.onlyOnDuty}</MenuCheckboxItem>
        <MenuCheckboxItem checked={view === 'list'} onChange={(list) => onView(list ? 'list' : 'matrix')}>{t.controls.dayList}</MenuCheckboxItem>
        <MenuItem onClick={() => setLegendOpen(true)}>{t.controls.legend}</MenuItem>
        {icsExport && (
          <>
            <MenuSeparator />
            <MenuLink to="/moje#ics">{t.actions.exportIcs}</MenuLink>
          </>
        )}
      </Menu>
      <LegendPopover showAvailability={showAvailability} gridKeys={view === 'matrix'} open={legendOpen} onOpenChange={setLegendOpen} anchor={more} />
    </>
  )
}
