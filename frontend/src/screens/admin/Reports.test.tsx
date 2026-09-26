import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { renderScreen } from '../../test/render'
import { loadRealStylesheet } from '../../test/stylesheet'
import { MonthlyReportsPanel } from './Reports'
import { MonthlyReportPreview, api } from '../../api'

const row = (name: string, points: number): MonthlyReportPreview['rows'][number] => ({
  name,
  primary_workdays: 5,
  primary_weekends: 2,
  primary_holidays: 0,
  secondary_workdays: 6,
  secondary_weekends: 1,
  secondary_holidays: 1,
  oncall_workdays: 11,
  oncall_weekends: 3,
  oncall_holidays: 1,
  oncall_days_off: 4,
  oncall_total: 15,
  late_shifts: 5,
  primary_points: points,
  secondary_points: 10,
  total_points: points + 10,
})

// The clock is pinned to September 2026 (`src/test/setup.ts`), so the screen
// opens on that month and the fixture describes it.
const preview: MonthlyReportPreview = {
  month: '2026-09',
  days_in_month: 30,
  staffed_days: 30,
  rows: [row('Małgorzata Wiśniewska-Kowalczyk', 9), row('Marek Nowak', 11)],
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('MonthlyReportsPanel', () => {
  it('opens on the current month', async () => {
    const spy = vi.spyOn(api, 'monthlyReportPreview').mockResolvedValue(preview)
    renderScreen(<MonthlyReportsPanel />)

    await screen.findByRole('table', { name: 'Raport za wrzesień 2026' })
    expect(screen.getByLabelText('Miesiąc rozliczenia')).toHaveValue('2026-09')
    expect(spy).toHaveBeenCalledWith('2026-09')
  })

  it('follows the month the coordinator picks', async () => {
    const spy = vi.spyOn(api, 'monthlyReportPreview').mockResolvedValue({ ...preview, month: '2026-07' })
    renderScreen(<MonthlyReportsPanel />)
    await screen.findByRole('table', { name: 'Raport za wrzesień 2026' })

    fireEvent.change(screen.getByLabelText('Miesiąc rozliczenia'), { target: { value: '2026-07' } })

    await screen.findByRole('table', { name: 'Raport za lipiec 2026' })
    expect(spy).toHaveBeenLastCalledWith('2026-07')
  })

  it('leads with the duty days of both on-call roles, split into workdays and days off, before the role columns', async () => {
    vi.spyOn(api, 'monthlyReportPreview').mockResolvedValue(preview)
    renderScreen(<MonthlyReportsPanel />)

    const table = await screen.findByRole('table', { name: 'Raport za wrzesień 2026' })
    expect(within(table).getByRole('columnheader', { name: 'Dni dyżurowe primary + secondary' })).toHaveClass('key')
    const [firstGroup] = within(table).getAllByRole('columnheader', { name: 'robocze' })
    expect(firstGroup).toHaveClass('key')
    expect(within(table).getByRole('columnheader', { name: 'weekendy i święta' })).toHaveClass('key')
    expect(within(table).getAllByRole('columnheader', { name: 'razem' })).toHaveLength(2)

    const marek = within(table).getByRole('row', { name: /^Marek Nowak/ })
    const cells = within(marek).getAllByRole('cell')
    expect(cells.slice(0, 3).map((cell) => cell.textContent)).toEqual(['11', '4', '15'])
    for (const cell of cells.slice(0, 3)) expect(cell).toHaveClass('key')
    expect(cells[3]).not.toHaveClass('key')
    // The late shift stays in its own column, outside the duty days.
    expect(cells[9]).toHaveTextContent('5')
  })

  it('keeps the totals row and a person column that stays in view', async () => {
    vi.spyOn(api, 'monthlyReportPreview').mockResolvedValue(preview)
    renderScreen(<MonthlyReportsPanel />)

    const table = await screen.findByRole('table', { name: 'Raport za wrzesień 2026' })
    expect(screen.getByRole('region', { name: 'Raport za wrzesień 2026' })).toContainElement(table)
    const total = within(table).getByRole('row', { name: /^Razem/ })
    expect(within(total).getByRole('rowheader')).toHaveClass('person')
    const cells = within(total).getAllByRole('cell')
    expect(cells.slice(0, 3).map((cell) => cell.textContent)).toEqual(['22', '8', '30'])
    expect(cells.at(-1)).toHaveTextContent('40')
    for (const name of ['Małgorzata Wiśniewska-Kowalczyk', 'Marek Nowak']) {
      expect(within(table).getByRole('rowheader', { name })).toHaveClass('person')
    }
  })

  it('says the table scrolls sideways when it is wider than the screen', async () => {
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(981)
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(360)
    vi.spyOn(api, 'monthlyReportPreview').mockResolvedValue(preview)
    renderScreen(<MonthlyReportsPanel />)

    const region = await screen.findByRole('region', { name: 'Raport za wrzesień 2026' })
    expect(screen.getByText(/przewiń ją w bok, aby zobaczyć wszystkie kolumny, w tym punkty/)).toBeInTheDocument()
    expect(region).toHaveAttribute('tabindex', '0')
  })

  it('keeps the "11–19" header on the header type scale, not the body\'s numeric one', async () => {
    // The real stylesheet, so this exercises actual cascade/specificity rather
    // than asserting a class name: table.lg gives numeric cells (.n) a larger
    // font-size for body readability, and that rule used to also catch this
    // header cell, so its rowspan-2 box centered on a taller line than
    // "Osoba"'s (jsdom can't resolve the `font` shorthand's var(--mono) that
    // "Osoba" relies on, so it is compared against the 9.5px literal instead).
    loadRealStylesheet()

    vi.spyOn(api, 'monthlyReportPreview').mockResolvedValue(preview)
    renderScreen(<MonthlyReportsPanel />)

    const table = await screen.findByRole('table', { name: 'Raport za wrzesień 2026' })
    const lateShift = within(table).getByRole('columnheader', { name: '11–19' })
    const [dataCell] = within(table).getAllByRole('cell', { name: '5' })

    expect(getComputedStyle(lateShift).fontSize).toBe('9.5px')
    expect(getComputedStyle(dataCell).fontSize).toBe('11.5px')
  })

  it('lines up the rowspan-2 headers on the leaf baseline and closes the header with one divider', async () => {
    // The real stylesheet, as above. Centred across both header rows,
    // "Osoba" and "11–19" used to sit on a third text line of their own, and
    // the generic last-row rule stripped the divider from the leaf row only,
    // so the header's closing line zig-zagged. jsdom cannot see the group
    // bracket drawn by ::after; that stays a visual check.
    loadRealStylesheet()

    vi.spyOn(api, 'monthlyReportPreview').mockResolvedValue(preview)
    renderScreen(<MonthlyReportsPanel />)

    const table = await screen.findByRole('table', { name: 'Raport za wrzesień 2026' })
    const person = within(table).getByRole('columnheader', { name: 'Osoba' })
    const lateShift = within(table).getByRole('columnheader', { name: '11–19' })
    const [dutyDaysGroup] = within(table).getAllByRole('columnheader', { name: /Dni dyżurowe/ })
    const [razem] = within(table).getAllByRole('columnheader', { name: 'razem' })
    const total = within(table).getByRole('row', { name: /^Razem/ })
    const [lastFooterCell] = within(total).getAllByRole('cell').slice(-1)

    // Rowspan-2 headers sit on the leaf row's baseline, not centered across both rows.
    expect(getComputedStyle(person).verticalAlign).toBe('bottom')
    expect(getComputedStyle(lateShift).verticalAlign).toBe('bottom')
    // Group headers are centered over their columns instead of hugging the last one.
    expect(getComputedStyle(dutyDaysGroup).textAlign).toBe('center')
    // The header's own divider closes the full width on the leaf row and the rowspan cells...
    expect(getComputedStyle(person).borderBottomWidth).toBe('1px')
    expect(getComputedStyle(lateShift).borderBottomWidth).toBe('1px')
    expect(getComputedStyle(razem).borderBottomWidth).toBe('1px')
    // ...but not doubled under the group row, which draws its own inset bracket instead.
    expect(getComputedStyle(dutyDaysGroup).borderBottomWidth).toBe('0px')
    // The footer's last row keeps no bottom line.
    expect(getComputedStyle(lastFooterCell).borderBottomWidth).toBe('0px')
  })
})
