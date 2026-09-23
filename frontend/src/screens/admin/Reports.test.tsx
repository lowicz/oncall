import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderScreen } from '../../test/render'
import { MonthlyReportsPanel } from './Reports'
import { MonthlyReportPreview, api } from '../../api'

const row = (name: string, points: number): MonthlyReportPreview['rows'][number] => ({
  name,
  primary_workdays: 5,
  primary_weekends: 2,
  primary_holidays: 0,
  secondary_workdays: 6,
  secondary_weekends: 2,
  secondary_holidays: 0,
  oncall_workdays: 11,
  oncall_weekends: 4,
  oncall_holidays: 0,
  late_shifts: 5,
  primary_points: points,
  secondary_points: 10,
  total_points: points + 10,
})

const preview: MonthlyReportPreview = {
  month: '2026-08',
  days_in_month: 31,
  staffed_days: 31,
  rows: [row('Małgorzata Wiśniewska-Kowalczyk', 9), row('Marek Nowak', 11)],
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('MonthlyReportsPanel', () => {
  it('keeps the points and their totals in the table, next to a person column that stays in view', async () => {
    vi.spyOn(api, 'monthlyReportPreview').mockResolvedValue(preview)
    renderScreen(<MonthlyReportsPanel />)

    const table = await screen.findByRole('table', { name: 'Raport za sierpień 2026' })
    expect(screen.getByRole('region', { name: 'Raport za sierpień 2026' })).toContainElement(table)
    expect(within(table).getByRole('columnheader', { name: 'razem' })).toBeInTheDocument()
    const total = within(table).getByRole('row', { name: /^Razem/ })
    expect(within(total).getByRole('rowheader')).toHaveClass('person')
    expect(within(total).getAllByRole('cell').at(-1)).toHaveTextContent('40')
    for (const name of ['Małgorzata Wiśniewska-Kowalczyk', 'Marek Nowak']) {
      expect(within(table).getByRole('rowheader', { name })).toHaveClass('person')
    }
  })

  it('says the table scrolls sideways when it is wider than the screen', async () => {
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(981)
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(360)
    vi.spyOn(api, 'monthlyReportPreview').mockResolvedValue(preview)
    renderScreen(<MonthlyReportsPanel />)

    const region = await screen.findByRole('region', { name: 'Raport za sierpień 2026' })
    expect(screen.getByText(/przewiń ją w bok, aby zobaczyć wszystkie kolumny, w tym punkty/)).toBeInTheDocument()
    expect(region).toHaveAttribute('tabindex', '0')
  })
})
