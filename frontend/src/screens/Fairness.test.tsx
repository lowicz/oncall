import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { renderScreen } from '../test/render'
import { FairnessPanel } from './Fairness'
import { api } from '../api'
import type { FairnessReport } from '../api'

const balance = (actual: number, deviation: number) => ({ actual, expected: 1, deviation })
const member = (name: string) => ({
  member_id: name,
  display_name: name,
  active_from: '2024-01-01',
  eligible_days: { primary: 10, secondary: 10, late_shift: 10, weekends: 4, holidays: 1 },
  primary: balance(3, 0.5),
  secondary: balance(2, -0.5),
  late_shift: balance(1, 0),
  weekends: balance(1, 0),
  holidays: balance(0, 0),
  total_points: 6,
})

const report = (lateShiftBalanced: boolean): FairnessReport => ({
  as_of: '2026-09-06',
  window_start: '2025-09-06',
  window_end: '2026-09-06',
  totals: {
    primary_points: 6,
    secondary_points: 4,
    late_shift_count: 2,
    weekend_duties: 2,
    holiday_duties: 0,
  },
  members: [member('Anna Kowalska'), member('Marek Nowak')],
  late_shift_balanced: lateShiftBalanced,
  criterion_points: 3,
  criterion_met: true,
  spreads: ['primary', 'secondary', 'weekends', 'holidays', ...(lateShiftBalanced ? ['late_shift'] : [])]
    .map((lens) => ({ lens, spread: 1.5, meets_criterion: true })),
  latest_publish_end: null,
})

afterEach(() => vi.restoreAllMocks())

/** The row of one person in the team table. */
const rowOf = (name: string) => screen.getByText(name, { selector: 'th' }).closest('tr') as HTMLTableRowElement

describe('FairnessPanel 11-19 column', () => {
  it('shows the 11-19 column when the shift is balanced on its own', async () => {
    vi.spyOn(api, 'fairness').mockResolvedValue(report(true))
    renderScreen(<FairnessPanel />)
    expect(await screen.findByRole('columnheader', { name: /11–19/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '11–19' })).toBeInTheDocument()
  })

  it('hides the 11-19 column when the shift follows the anchor role', async () => {
    vi.spyOn(api, 'fairness').mockResolvedValue(report(false))
    renderScreen(<FairnessPanel />)
    expect(await screen.findByText('Anna Kowalska')).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: /11–19/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '11–19' })).not.toBeInTheDocument()
    // The other lenses stay put.
    expect(screen.getByRole('columnheader', { name: /PRIMARY/ })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /Weekendy/ })).toBeInTheDocument()
  })
})

describe('FairnessPanel default "Stan na dzień" (QA7 par. 8, C2 review)', () => {
  it('defaults to the real end of the latest publication, not the 90-day-capped one', async () => {
    const future = report(false)
    future.latest_publish_end = '2030-12-27'
    const fairness = vi.spyOn(api, 'fairness').mockResolvedValue(future)
    renderScreen(<FairnessPanel />)
    await screen.findByText('Anna Kowalska')
    await vi.waitFor(() => expect(fairness).toHaveBeenLastCalledWith('2030-12-27'))
    // The window now reaches into the future, so the subtitle stops claiming
    // every duty in it has actually been served.
    expect(screen.getByText(/dyżury już zaplanowane do tego dnia/)).toBeInTheDocument()
  })

  it('keeps the "actually served" wording when there is no future publication', async () => {
    vi.spyOn(api, 'fairness').mockResolvedValue(report(false))
    renderScreen(<FairnessPanel />)
    expect(await screen.findByText(/faktycznie odbytych dyżurów/)).toBeInTheDocument()
  })
})

describe('FairnessPanel criterion summary', () => {
  it('states the criterion and its verdict in the subtitle and the spread per lens in chips', async () => {
    vi.spyOn(api, 'fairness').mockResolvedValue(report(false))
    renderScreen(<FairnessPanel />)
    expect(await screen.findByText(/kryterium: nikt poza ±3,0 pkt od udziału/)).toBeInTheDocument()
    expect(screen.getByText('spełnione')).toBeInTheDocument()
    // Every lens shown with its textual state, not colour alone.
    expect(screen.getAllByText(/rozpiętość 1,5 · spełnia$/).length).toBeGreaterThanOrEqual(4)
    expect(screen.getByText(/Średnia 5,0 pkt \/ os\./)).toBeInTheDocument()
    expect(screen.getByText(/Weekendy: 2 \/ 2 os\. = 1,0/)).toBeInTheDocument()
  })

  it('marks an unmet lens in words and names the outliers', async () => {
    const failing = report(false)
    failing.criterion_met = false
    failing.spreads = failing.spreads.map((item) =>
      item.lens === 'secondary' ? { ...item, spread: 4.5, meets_criterion: false } : item,
    )
    failing.outliers = [{
      lens: 'secondary',
      highest: { member_id: 'anna', display_name: 'Anna Kowalska', deviation: 2.5 },
      lowest: { member_id: 'marek', display_name: 'Marek Nowak', deviation: -2 },
    }]
    vi.spyOn(api, 'fairness').mockResolvedValue(failing)
    renderScreen(<FairnessPanel />)
    expect(await screen.findByText('niespełnione')).toBeInTheDocument()
    expect(screen.getAllByText(/· nie spełnia$/)).toHaveLength(1)
    expect(screen.getByTitle(/najwyżej: Anna Kowalska \(\+2,5\).*najniżej: Marek Nowak \(-2\)/)).toBeInTheDocument()
  })

  it('puts departed people in a separate section', async () => {
    const withFormer = report(false)
    withFormer.members[1].in_criterion = false
    vi.spyOn(api, 'fairness').mockResolvedValue(withFormer)
    renderScreen(<FairnessPanel />)
    expect(await screen.findByText('Poza rotacją')).toBeInTheDocument()
    expect(screen.getByText('Marek Nowak')).toBeInTheDocument()
  })

  it('hides the summary for a member seeing only their own row', async () => {
    const solo = report(false)
    solo.members = [member('Anna Kowalska')]
    vi.spyOn(api, 'fairness').mockResolvedValue(solo)
    renderScreen(<FairnessPanel />)
    expect(await screen.findByText('Anna Kowalska')).toBeInTheDocument()
    expect(screen.queryByText(/kryterium 3 pkt/)).not.toBeInTheDocument()
    expect(screen.queryByText('spełnione')).not.toBeInTheDocument()
  })
})

describe('FairnessPanel lens links', () => {
  it('sorts by the chosen lens and moves the bar to it', async () => {
    const low = {
      ...member('Jakub Polak'),
      primary: { actual: 1, expected: 2, deviation: -1 },
      secondary: { actual: 3, expected: 1, deviation: 2 },
    }
    vi.spyOn(api, 'fairness').mockResolvedValue({ ...report(false), members: [member('Anna Kowalska'), low] })
    renderScreen(<FairnessPanel />)
    await screen.findByText('Jakub Polak')
    // Razem: Jakub is +1 (−1 + 2), Anna 0 (+0.5 − 0.5): Jakub first.
    const names = () => screen.getAllByRole('rowheader').map((cell) => cell.textContent)
    expect(names()[0]).toContain('Jakub Polak')
    expect(within(rowOf('Jakub Polak')).getByRole('img', { name: '1 ponad udział' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'PRIMARY' }))
    expect(screen.getByRole('columnheader', { name: /Odchylenie · PRIMARY/ })).toBeInTheDocument()
    expect(within(rowOf('Jakub Polak')).getByRole('img', { name: '1 poniżej udziału' })).toBeInTheDocument()
    expect(within(rowOf('Anna Kowalska')).getByRole('img', { name: '0,5 ponad udział' })).toBeInTheDocument()
  })

  it('unfolds a row into the months and the reasons', async () => {
    vi.spyOn(api, 'fairness').mockResolvedValue(report(false))
    const duties = vi.spyOn(api, 'fairnessDuties').mockResolvedValue([
      { service_date: '2026-08-15', role: 'primary', points: 2, is_day_off: true },
      { service_date: '2026-07-02', role: 'secondary', points: 1, is_day_off: false },
    ])
    renderScreen(<FairnessPanel />)
    await screen.findByText('Anna Kowalska')
    fireEvent.click(screen.getByRole('button', { name: 'Rozwiń: Anna Kowalska' }))
    expect(await screen.findByRole('img', { name: /Punkty miesiąc po miesiącu: .*sie 2, wrz 0/ })).toBeInTheDocument()
    expect(duties).toHaveBeenCalledWith('Anna Kowalska', undefined)
    expect(screen.getByText('Co zrobi generator')).toBeInTheDocument()
    expect(screen.getByText(/Anna jest zgodnie z udziałem/)).toBeInTheDocument()
    expect(screen.getByText('sob 15 sie')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Zwiń: Anna Kowalska' }))
    expect(screen.queryByText('Co zrobi generator')).not.toBeInTheDocument()
  })
})

describe('FairnessPanel Razem reconciliation (D4/MED6-01)', () => {
  // Both the per-person „Razem" cell and the summary cell mark the actual
  // with the same class, next to the fair share.
  const actualOf = (cell: Element) => Number(cell.querySelector('.f-actual')?.textContent?.trim())
  const razemColumn = (container: HTMLElement) => {
    const table = container.querySelector('table.fairness-table') as HTMLTableElement
    const index = Array.from(table.tHead!.rows[0].cells).findIndex((cell) => cell.textContent?.startsWith('Razem'))
    const perPerson = Array.from(table.tBodies[0].rows).map((row) => actualOf(row.cells[index]))
    const totalsRow = Array.from(table.tFoot!.rows).find(
      (row) => row.cells[0].textContent?.trim() === 'Razem',
    )!
    const summary = actualOf(totalsRow.cells[index])
    return { perPerson, summary }
  }

  it('sums the per-person column to the summary row with 11-19 anchored', async () => {
    vi.spyOn(api, 'fairness').mockResolvedValue(report(false))
    const { container } = renderScreen(<FairnessPanel />)
    await screen.findByText('Anna Kowalska')

    const { perPerson, summary } = razemColumn(container)
    expect(perPerson).toEqual([5, 5]) // primary 3 + secondary 2, no hidden 11-19
    expect(perPerson.reduce((sum, value) => sum + value, 0)).toBe(summary)
  })

  it('sums the per-person column to the summary row with 11-19 as its own lens', async () => {
    vi.spyOn(api, 'fairness').mockResolvedValue(report(true))
    const { container } = renderScreen(<FairnessPanel />)
    await screen.findByText('Anna Kowalska')

    const { perPerson, summary } = razemColumn(container)
    expect(perPerson).toEqual([6, 6]) // primary 3 + secondary 2 + 11-19 count 1
    expect(perPerson.reduce((sum, value) => sum + value, 0)).toBe(summary)
  })

  it('names the hidden 11-19 total under the table when anchored', async () => {
    vi.spyOn(api, 'fairness').mockResolvedValue(report(false))
    renderScreen(<FairnessPanel />)
    expect(
      await screen.findByText(/łączna liczba zmian 11–19 w oknie: 2/),
    ).toBeInTheDocument()
  })

  it('drops the footnote when 11-19 is shown as its own column', async () => {
    vi.spyOn(api, 'fairness').mockResolvedValue(report(true))
    renderScreen(<FairnessPanel />)
    await screen.findByText('Anna Kowalska')
    expect(screen.queryByText(/łączna liczba zmian 11–19/)).not.toBeInTheDocument()
  })
})

describe('FairnessPanel Razem context (MED6-02)', () => {
  it('gives the total column a fair share and a spoken deviation like every other column', async () => {
    // primary -1 and secondary -1 -> total 2 below the fair share.
    const low = {
      ...member('Jakub Polak'),
      primary: { actual: 1, expected: 2, deviation: -1 },
      secondary: { actual: 1, expected: 2, deviation: -1 },
    }
    vi.spyOn(api, 'fairness').mockResolvedValue({
      ...report(false),
      members: [member('Anna Kowalska'), low],
    })
    renderScreen(<FairnessPanel />)
    await screen.findByText('Jakub Polak')

    const row = rowOf('Jakub Polak')
    expect(row.textContent).toContain('/ 4')
    expect(within(row).getByRole('img', { name: '2 poniżej udziału' })).toBeInTheDocument()
  })

  it('explains a low total for someone who joined mid-window', async () => {
    const joined = {
      ...member('Jakub Polak'),
      active_from: '2026-04-01',
      primary: { actual: 1, expected: 1, deviation: 0 },
      secondary: { actual: 1, expected: 1, deviation: 0 },
    }
    vi.spyOn(api, 'fairness').mockResolvedValue({
      ...report(false),
      members: [member('Anna Kowalska'), joined],
    })
    renderScreen(<FairnessPanel />)
    expect(await screen.findByText(/w rotacji od 01-04-2026/)).toBeInTheDocument()
  })

  it('does not add the join note for a member present from the window start', async () => {
    vi.spyOn(api, 'fairness').mockResolvedValue(report(false))
    renderScreen(<FairnessPanel />)
    await screen.findByText('Anna Kowalska')
    expect(screen.queryByText(/w rotacji od/)).not.toBeInTheDocument()
  })

  it('flags a member with no 11-19 eligibility when the shift is its own lens', async () => {
    const noLate = {
      ...member('Emil Zając'),
      eligible_days: { primary: 10, secondary: 10, late_shift: 0, weekends: 4, holidays: 1 },
      late_shift: { actual: 0, expected: 0, deviation: 0 },
    }
    vi.spyOn(api, 'fairness').mockResolvedValue({
      ...report(true),
      members: [member('Anna Kowalska'), noLate],
    })
    renderScreen(<FairnessPanel />)
    expect(await screen.findByText(/bez zmian 11–19/)).toBeInTheDocument()
  })
})

describe('FairnessPanel roles a person does not hold', () => {
  it('says so instead of reporting 0 / 0 as being in line with the fair share', async () => {
    const withoutPrimary = {
      ...member('Rafał Kamiński'),
      eligible_days: { primary: 0, secondary: 10, late_shift: 10, weekends: 4, holidays: 1 },
      primary: { actual: 0, expected: 0, deviation: 0 },
    }
    vi.spyOn(api, 'fairness').mockResolvedValue({
      ...report(true),
      members: [withoutPrimary],
    })
    renderScreen(<FairnessPanel />)

    expect(await screen.findByText('Rafał Kamiński')).toBeInTheDocument()
    // Exactly the wording DraftFairnessPanel has always used (MED5-05).
    expect(screen.getByText('nie pełni tej roli')).toBeInTheDocument()
    // The roles they do hold still get a verdict when the bar follows them.
    fireEvent.click(screen.getByRole('button', { name: 'SECONDARY' }))
    expect(screen.getByRole('img', { name: '0,5 poniżej udziału' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'PRIMARY' }))
    expect(screen.getAllByText('nie pełni tej roli')).toHaveLength(2)
  })
})
