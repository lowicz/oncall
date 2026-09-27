import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderScreen } from '../test/render'
import { DraftFocus, DraftScheduleMatrix } from './DraftScheduleMatrix'
import { ApiError, CalendarData, DraftFairnessImpact, DraftSchedule, FairnessCategory, FairnessMember, api } from '../api'

const category = (deviation: number): FairnessCategory => ({ actual: 20 + deviation, expected: 20, deviation })

const balance = (id: string, name: string, primary: number): FairnessMember => ({
  member_id: id,
  display_name: name,
  active_from: '2025-01-01',
  eligible_days: {},
  primary: category(primary),
  secondary: category(0),
  late_shift: category(0),
  weekends: category(0),
  holidays: category(0),
  total_points: 20 + primary,
})

const draft: DraftSchedule = {
  id: 'd1',
  name: 'Szkic',
  starts_on: '2026-09-21',
  ends_on: '2026-09-21',
  status: 'draft',
  version: 1,
  rotation_mode: 'daily',
  solver_status: 'OPTIMAL',
  acceptance_floor: null,
  assignments: [{ service_date: '2026-09-21', role: 'primary', assignee_name: 'Anna Kowalska', is_override: false }],
}

const calendar: CalendarData = {
  starts_on: '2026-09-21',
  ends_on: '2026-09-21',
  days: [{ service_date: '2026-09-21', weekday: 'pon', is_day_off: false, holiday_name: null, published: false, events: [] }],
  members: [
    { id: 'm1', display_name: 'Anna Kowalska' },
    { id: 'm2', display_name: 'Marek Nowak' },
  ],
  team_has_members: true,
  assignments: [],
  availability: [],
}

const impact: DraftFairnessImpact = {
  schedule_id: 'd1',
  schedule_version: 1,
  baseline_as_of: '2026-09-20',
  projected_as_of: '2026-09-21',
  baseline_members: [],
  projected_members: [balance('m1', 'Anna Kowalska', -0.5), balance('m2', 'Marek Nowak', 14.01)],
  late_shift_balanced: false,
  criterion_points: 3,
  criterion_met: true,
  spreads: [],
  acceptance_floor: null,
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('DraftScheduleMatrix correction', () => {
  it('writes the balance change with a decimal comma and names the day as every screen does', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(calendar)
    vi.spyOn(api, 'draftFairnessImpact').mockResolvedValue(impact)
    renderScreen(<DraftScheduleMatrix result={draft} onChange={() => {}} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Marek Nowak, pon 21-09-2026, brak dyżuru' }))

    const box = await screen.findByText('Bilans PRIMARY: Marek Nowak')
    expect(box.closest('.box')).toHaveTextContent('+14,01 → +15,01 (+1 punkt)')
  })
})

type Day = CalendarData['days'][number]

/** Every day from `from` to `to`, Saturdays and Sundays off. */
const range = (from: string, to: string, over: Record<string, Partial<Day>> = {}): Day[] => {
  const days: Day[] = []
  for (let date = new Date(`${from}T12:00:00Z`); date <= new Date(`${to}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + 1)) {
    const service_date = date.toISOString().slice(0, 10)
    const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6
    days.push({ service_date, weekday: '', is_day_off: weekend, holiday_name: null, published: false, events: [], ...over[service_date] })
  }
  return days
}

describe('DraftScheduleMatrix grid', () => {
  it('shows progress, then a failed load that can be retried', async () => {
    const load = vi.spyOn(api, 'calendar').mockRejectedValue(new ApiError('Serwer niedostępny', 503))
    vi.spyOn(api, 'draftFairnessImpact').mockResolvedValue(impact)
    renderScreen(<DraftScheduleMatrix result={draft} onChange={() => {}} />)

    expect(screen.getByRole('status', { name: 'Wczytywanie macierzy szkicu' })).toBeInTheDocument()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Serwer niedostępny')
    load.mockResolvedValue(calendar)
    fireEvent.click(within(alert).getByRole('button', { name: 'Spróbuj ponownie' }))
    expect(await screen.findByRole('region', { name: 'Macierz szkicu' })).toBeInTheDocument()
  })

  it('heads a long range with month names sized to their columns and marks days off, weeks, today and clashes', async () => {
    // 28-09 to 31-10: three days of September, the whole of October.
    const days = range('2026-09-28', '2026-10-31', {
      '2026-10-10': { holiday_name: 'Święto testowe' },
      '2026-10-12': { events: [{ id: 'e1', title: 'Migracja', color: 'blue' }] },
    })
    vi.spyOn(api, 'calendar').mockResolvedValue({
      ...calendar,
      starts_on: '2026-09-28',
      ends_on: '2026-10-31',
      days,
      availability: [{ member_id: 'm2', kind: 'prefer_not', starts_on: '2026-10-01', ends_on: '2026-10-01', note: null }],
    })
    vi.spyOn(api, 'draftFairnessImpact').mockResolvedValue(impact)
    renderScreen(
      <DraftScheduleMatrix
        result={{
          ...draft,
          starts_on: '2026-09-28',
          ends_on: '2026-10-31',
          assignments: [
            { service_date: '2026-10-01', role: 'primary', assignee_name: 'Anna Kowalska', is_override: true },
            { service_date: '2026-10-01', role: 'late_shift', assignee_name: 'Anna Kowalska', is_override: false },
          ],
          unavailability_conflicts: [{ service_date: '2026-10-01', role: 'primary', assignee_name: 'Anna Kowalska' }],
        }}
        onChange={() => {}}
      />,
    )
    const region = await screen.findByRole('region', { name: 'Macierz szkicu' })
    expect(region.querySelector('table')).toHaveAttribute('data-zoom', '8')
    expect(within(region).getByRole('columnheader', { name: 'wrz 2026' })).toHaveAttribute('colspan', '3')
    expect(within(region).getByRole('columnheader', { name: 'październik 2026' })).toHaveAttribute('colspan', '31')
    const headers = within(region).getAllByRole('columnheader')
    expect(headers.find((cell) => cell.getAttribute('title') === 'Święto testowe')).toHaveClass('we')
    expect(headers.find((cell) => cell.getAttribute('title') === 'Migracja')).toHaveClass('wk')

    const clash = within(region).getByRole('button', { name: 'Anna Kowalska, czw 01-10-2026, PRIMARY korekta kolizja z niedostępnością, 11–19 kolizja z niedostępnością' })
    expect(clash.closest('td')).toHaveClass('gap')
    expect(within(region).getByRole('button', { name: 'Marek Nowak, czw 01-10-2026, brak dyżuru, Wolę nie' })).toBeInTheDocument()
  })

  it('sizes a two-week range and names a short month by its abbreviation', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue({ ...calendar, days: range('2026-09-10', '2026-09-25') })
    vi.spyOn(api, 'draftFairnessImpact').mockResolvedValue(impact)
    renderScreen(<DraftScheduleMatrix result={draft} onChange={() => {}} />)

    const region = await screen.findByRole('region', { name: 'Macierz szkicu' })
    expect(region.querySelector('table')).toHaveAttribute('data-zoom', '4')
    // Today is 10-09-2026.
    expect(within(region).getAllByRole('columnheader').find((cell) => cell.textContent === 'czw10')).toHaveClass('td')
  })

  it('keeps a proposed draft read-only', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(calendar)
    vi.spyOn(api, 'draftFairnessImpact').mockResolvedValue(impact)
    renderScreen(<DraftScheduleMatrix result={{ ...draft, status: 'proposed' }} onChange={() => {}} />)
    expect(await screen.findByRole('button', { name: 'Anna Kowalska, pon 21-09-2026, PRIMARY' })).toBeDisabled()
  })
})

describe('DraftScheduleMatrix inspector', () => {
  const weekend: CalendarData = {
    ...calendar,
    starts_on: '2026-09-26',
    ends_on: '2026-09-27',
    days: range('2026-09-26', '2026-09-27', { '2026-09-27': { holiday_name: 'Święto testowe' } }),
    availability: [
      { member_id: 'm2', kind: 'unavailable', starts_on: '2026-09-26', ends_on: '2026-09-26', note: 'wyjazd' },
      { member_id: 'm2', kind: 'prefer', starts_on: '2026-09-27', ends_on: '2026-09-27', note: null },
    ],
  }
  const weekendDraft: DraftSchedule = {
    ...draft,
    starts_on: '2026-09-26',
    ends_on: '2026-09-27',
    assignments: [
      { service_date: '2026-09-26', role: 'primary', assignee_name: 'Anna Kowalska', is_override: false },
      { service_date: '2026-09-27', role: 'secondary', assignee_name: 'Anna Kowalska', is_override: false },
    ],
  }

  it('warns that an unavailable person will be refused and offers no day shift on a day off', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(weekend)
    vi.spyOn(api, 'draftFairnessImpact').mockResolvedValue(impact)
    renderScreen(<DraftScheduleMatrix result={weekendDraft} onChange={() => {}} />)

    fireEvent.click(await screen.findByRole('button', { name: /^Marek Nowak, sob 26-09-2026/ }))
    const panel = await screen.findByRole('dialog', { name: 'Marek Nowak · 26-09-2026' })
    expect(within(panel).getByText('2X · dzień wolny')).toBeInTheDocument()
    expect(within(panel).getByText('Dzień wolny / 2X - zmiana 11–19 nie występuje.')).toBeInTheDocument()
    const warning = within(panel).getByText('Marek Nowak: Nie mogę').closest('.box')
    expect(warning).toHaveTextContent('Przydział zostanie odrzucony. „wyjazd”')
    const role = within(panel).getByRole('combobox', { name: 'Rola do zmiany' })
    expect(within(role).getAllByRole('option').map((option) => option.textContent)).toEqual(['PRIMARY', 'SECONDARY'])
    expect(within(panel).getByRole('button', { name: 'Przypisz w szkicu' })).toBeDisabled()
  })

  it('opens on the role a person holds, prices a day off at two points and names the holiday', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(weekend)
    vi.spyOn(api, 'draftFairnessImpact').mockResolvedValue({
      ...impact,
      projected_members: [balance('m1', 'Anna Kowalska', 0), { ...balance('m2', 'Marek Nowak', 0), secondary: category(-1) }],
    })
    renderScreen(<DraftScheduleMatrix result={weekendDraft} onChange={() => {}} />)

    // Anna holds SECONDARY on Sunday: the inspector opens on it.
    fireEvent.click(await screen.findByRole('button', { name: /^Anna Kowalska, niedz 27-09-2026/ }))
    let panel = await screen.findByRole('dialog', { name: 'Anna Kowalska · 27-09-2026' })
    expect(within(panel).getByText('2X · Święto testowe')).toBeInTheDocument()
    expect(within(panel).getByRole('combobox', { name: 'Rola do zmiany' })).toHaveValue('secondary')
    // The person already holds the role: nothing to move.
    expect(within(panel).getByRole('button', { name: 'Przypisz w szkicu' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /^Marek Nowak, niedz 27-09-2026/ }))
    panel = await screen.findByRole('dialog', { name: 'Marek Nowak · 27-09-2026' })
    // Marek has no duty that day: the inspector starts on PRIMARY, which nobody holds.
    expect(within(panel).getByRole('combobox', { name: 'Rola do zmiany' })).toHaveValue('primary')
    expect(within(panel).getByText('brak przydziału')).toBeInTheDocument()
    expect(within(panel).getByText('-')).toBeInTheDocument()
    expect(within(panel).getByText(/nikt nie ma przydziału tego dnia/)).toBeInTheDocument()
    expect(within(panel).getByText('Marek Nowak: Chętnie wezmę').closest('.box')).toHaveTextContent(/^Marek Nowak: Chętnie wezmę$/)

    fireEvent.change(within(panel).getByRole('combobox', { name: 'Rola do zmiany' }), { target: { value: 'secondary' } })
    expect(within(panel).getByText('Anna Kowalska')).toBeInTheDocument()
    expect(within(panel).getByText('Bilans SECONDARY: Marek Nowak').closest('.box')).toHaveTextContent('-1 → +1 (+2 punkty za dzień 2X)')
  })

  it('prices a day shift at one point even on a working day', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(calendar)
    vi.spyOn(api, 'draftFairnessImpact').mockResolvedValue(impact)
    renderScreen(<DraftScheduleMatrix result={{ ...draft, assignments: [...draft.assignments, { service_date: '2026-09-21', role: 'late_shift', assignee_name: 'Anna Kowalska', is_override: false }] }} onChange={() => {}} />)

    fireEvent.click(await screen.findByRole('button', { name: /^Marek Nowak, pon 21-09-2026/ }))
    const panel = await screen.findByRole('dialog', { name: 'Marek Nowak · 21-09-2026' })
    fireEvent.change(within(panel).getByRole('combobox', { name: 'Rola do zmiany' }), { target: { value: 'late_shift' } })
    expect(within(panel).getByText('Bilans 11–19: Marek Nowak').closest('.box')).toHaveTextContent('0 → +1 (+1 punkt)')
  })

  it('saves the correction, hands the new draft over and closes', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(calendar)
    vi.spyOn(api, 'draftFairnessImpact').mockResolvedValue(impact)
    let finish: (value: DraftSchedule) => void = () => {}
    const save = vi.spyOn(api, 'overrideDraft').mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const onChange = vi.fn()
    renderScreen(<DraftScheduleMatrix result={draft} onChange={onChange} />)

    fireEvent.click(await screen.findByRole('button', { name: /^Marek Nowak, pon 21-09-2026/ }))
    const panel = await screen.findByRole('dialog', { name: 'Marek Nowak · 21-09-2026' })
    fireEvent.click(within(panel).getByRole('button', { name: 'Przypisz w szkicu' }))
    expect(await within(panel).findByRole('button', { name: /Zapisuję/ })).toBeDisabled()
    expect(save.mock.calls[0][0]).toEqual({ id: 'd1', expected_version: 1, service_date: '2026-09-21', role: 'primary', replacement_member_id: 'm2' })

    const next = { ...draft, version: 2 }
    finish(next)
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(next))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('shows a refused correction and closes on cancel or the close button', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(calendar)
    vi.spyOn(api, 'draftFairnessImpact').mockResolvedValue(impact)
    vi.spyOn(api, 'overrideDraft').mockRejectedValue(new ApiError('Szkic zmienił wersję', 409))
    renderScreen(<DraftScheduleMatrix result={draft} onChange={() => {}} />)

    const cell = await screen.findByRole('button', { name: /^Marek Nowak, pon 21-09-2026/ })
    fireEvent.click(cell)
    let panel = await screen.findByRole('dialog', { name: 'Marek Nowak · 21-09-2026' })
    expect(cell).toHaveClass('cell-sel')
    fireEvent.click(within(panel).getByRole('button', { name: 'Przypisz w szkicu' }))
    expect(await within(panel).findByRole('alert')).toHaveTextContent('Szkic zmienił wersję')

    fireEvent.click(within(panel).getByRole('button', { name: 'Anuluj' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    fireEvent.click(cell)
    panel = await screen.findByRole('dialog', { name: 'Marek Nowak · 21-09-2026' })
    fireEvent.click(within(panel).getByRole('button', { name: 'Zamknij panel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

describe('DraftScheduleMatrix focus from the problems table', () => {
  it('opens the cell once, and ignores a cell outside the matrix', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(calendar)
    vi.spyOn(api, 'draftFairnessImpact').mockResolvedValue(impact)
    const focus: DraftFocus = { service_date: '2026-09-21', assignee_name: 'Anna Kowalska', role: 'secondary' }
    function Harness() {
      const [current, setCurrent] = useState<DraftFocus>({ ...focus, assignee_name: 'Nieznany' })
      return (
        <>
          <button type="button" onClick={() => setCurrent(focus)}>Popraw</button>
          <button type="button" onClick={() => setCurrent({ ...focus })}>Popraw znowu</button>
          <DraftScheduleMatrix result={draft} onChange={() => {}} focus={current} />
        </>
      )
    }
    renderScreen(<Harness />)
    await screen.findByRole('region', { name: 'Macierz szkicu' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Popraw' }))
    const panel = await screen.findByRole('dialog', { name: 'Anna Kowalska · 21-09-2026' })
    expect(within(panel).getByRole('combobox', { name: 'Rola do zmiany' })).toHaveValue('secondary')
    fireEvent.click(within(panel).getByRole('button', { name: 'Anuluj' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    // A re-render keeps the consumed focus closed; a new request opens the cell again.
    fireEvent.click(screen.getByRole('button', { name: 'Popraw' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Popraw znowu' }))
    expect(await screen.findByRole('dialog', { name: 'Anna Kowalska · 21-09-2026' })).toBeInTheDocument()
  })
})
