import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { focusManager } from '@tanstack/react-query'
import { renderScreen } from '../test/render'
import { MineScreen } from './Mine'
import { api, ApiError } from '../api'
import type { AvailabilityRangeInput, CalendarData, CurrentUser, FairnessReport, SwapRequest } from '../api'

afterEach(() => {
  vi.restoreAllMocks()
  focusManager.setFocused(undefined)
})

const EMPTY_CALENDAR = {
  starts_on: '2026-09-01', ends_on: '2026-09-30', days: [], members: [], team_has_members: false, assignments: [], availability: [],
}

const TEAM = [
  { id: 'm-adam', user_id: 'u-adam', display_name: 'Adam Nowicki', active_from: '2025-01-01', active_until: null, eligibility: [] },
  { id: 'm-beata', user_id: 'u-beata', display_name: 'Beata Lis', active_from: '2025-01-01', active_until: null, eligibility: [] },
]

const balance = (actual: number, deviation: number) => ({ actual, expected: actual - deviation, deviation })
const REPORT: FairnessReport = {
  as_of: '2026-09-10',
  window_start: '2025-09-10',
  window_end: '2026-09-10',
  totals: {},
  members: [{
    member_id: 'm1',
    display_name: 'Julia Nowak',
    active_from: '2025-01-01',
    eligible_days: { primary: 10, secondary: 10, late_shift: 10 },
    primary: balance(4, 0.5),
    secondary: balance(3, 0),
    late_shift: balance(1, 0),
    weekends: balance(2, 0),
    holidays: balance(0, 0),
    total_points: 7,
  }],
  late_shift_balanced: false,
  criterion_points: 2,
  criterion_met: true,
  spreads: [],
  latest_publish_end: null,
}

const swap = (over: Partial<SwapRequest> & { id: string }): SwapRequest => ({
  schedule_id: 's1',
  service_date: '2026-10-03',
  role: 'primary',
  requester_name: 'Piotr Zieliński',
  replacement_name: 'Julia Nowak',
  status: 'pending_replacement',
  note: null,
  decision_note: null,
  created_at: '2026-09-08T10:00:00Z',
  ...over,
})

const ME: CurrentUser = {
  username: 'julia', display_name: 'Julia Nowak', role: 'member', has_team_member: true,
  email: 'julia@example.com', phone: '+48600100200', share: null, avatar_url: null,
}

// The calendar ignores input while it loads, so a test paints only once it is idle.
async function idleCalendar() {
  const grid = await screen.findByRole('grid', { name: /Kalendarz dostępności/ })
  await waitFor(() => expect(grid).not.toHaveAttribute('aria-busy'))
  return grid
}

/** Every query the screen makes, so a test only overrides what it is about. */
function stub() {
  vi.spyOn(api, 'me').mockResolvedValue(ME)
  vi.spyOn(api, 'calendar').mockResolvedValue(EMPTY_CALENDAR)
  vi.spyOn(api, 'availability').mockResolvedValue([])
  vi.spyOn(api, 'feeds').mockResolvedValue([])
  vi.spyOn(api, 'fairness').mockResolvedValue(REPORT)
  vi.spyOn(api, 'fairnessDuties').mockResolvedValue([
    { service_date: '2026-09-05', role: 'primary', points: 2, is_day_off: true },
    { service_date: '2026-08-12', role: 'secondary', points: 1, is_day_off: false },
  ])
  vi.spyOn(api, 'swaps').mockResolvedValue([])
}

// /moje is unreachable for accounts that are not rotation members, so the admin
// session used for manual testing never renders these panels.
describe('MineScreen duties', () => {
  it('leads from a clash in the list to its day in the availability calendar', async () => {
    stub()
    const scroll = stubScroll()
    vi.spyOn(api, 'calendar').mockResolvedValue({
      ...EMPTY_CALENDAR,
      days: [{ service_date: '2026-09-19', weekday: 'sob', is_day_off: true, holiday_name: null, published: true, events: [] }],
      members: [{ id: 'm1', display_name: 'Julia Nowak' }],
      team_has_members: true,
      assignments: [{ schedule_id: 's1', schedule_version: 1, service_date: '2026-09-19', role: 'primary', assignee_name: 'Julia Nowak', member_id: 'm1', is_override: false, change_kind: null }],
      availability: [{ member_id: 'm1', kind: 'unavailable', starts_on: '2026-09-19', ends_on: '2026-09-19', note: null }],
    })
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)
    await screen.findByRole('grid', { name: 'Kalendarz dostępności, wrzesień 2026' })
    fireEvent.click(screen.getByRole('button', { name: 'Następny miesiąc' }))
    await screen.findByRole('grid', { name: 'Kalendarz dostępności, październik 2026' })

    fireEvent.click(await screen.findByRole('button', { name: /^Kolizja z Twoją niedostępnością sob 19 wrz/ }))
    expect(await screen.findByRole('grid', { name: 'Kalendarz dostępności, wrzesień 2026' })).toBeInTheDocument()
    expect(scroll).toHaveBeenCalled()
  })

  it('leads a coordinator from their own clash back to their own calendar while a colleague is picked', async () => {
    stub()
    stubScroll()
    vi.spyOn(api, 'team').mockResolvedValue(TEAM)
    vi.spyOn(api, 'memberAvailability').mockResolvedValue([])
    vi.spyOn(api, 'calendar').mockResolvedValue({
      ...EMPTY_CALENDAR,
      days: [{ service_date: '2026-09-19', weekday: 'sob', is_day_off: true, holiday_name: null, published: true, events: [] }],
      members: [{ id: 'm-adam', display_name: 'Adam Nowicki' }],
      team_has_members: true,
      assignments: [{ schedule_id: 's1', schedule_version: 1, service_date: '2026-09-19', role: 'primary', assignee_name: 'Adam Nowicki', member_id: 'm-adam', is_override: false, change_kind: null }],
      availability: [{ member_id: 'm-adam', kind: 'unavailable', starts_on: '2026-09-19', ends_on: '2026-09-19', note: null }],
    })
    renderScreen(<MineScreen role="coordinator" hasTeamMember displayName="Adam Nowicki" />)
    const picker = await screen.findByRole('combobox', { name: 'Osoba' })
    await screen.findByRole('option', { name: 'Beata Lis' })
    fireEvent.change(picker, { target: { value: 'm-beata' } })
    expect(await screen.findByRole('heading', { name: 'Dostępność: Beata Lis' })).toBeInTheDocument()

    fireEvent.click(await screen.findByRole('button', { name: /^Kolizja z Twoją niedostępnością sob 19 wrz/ }))
    expect(await screen.findByRole('heading', { name: 'Moja dostępność' })).toBeInTheDocument()
    expect(picker).toHaveValue('')
  })

  it('lists the upcoming duties with hours, multiplier, partner and a swap link', async () => {
    stub()
    vi.spyOn(api, 'calendar').mockResolvedValue({
      starts_on: '2026-06-12', ends_on: '2026-11-08',
      days: [
        { service_date: '2026-09-19', weekday: 'sob', is_day_off: true, holiday_name: null, published: true, events: [] },
        { service_date: '2026-09-21', weekday: 'pon', is_day_off: false, holiday_name: null, published: true, events: [] },
      ],
      members: [{ id: 'm1', display_name: 'Julia Nowak' }, { id: 'm2', display_name: 'Marek Nowak' }],
      team_has_members: true,
      assignments: [
        { schedule_id: 's1', schedule_version: 1, service_date: '2026-09-19', role: 'primary', assignee_name: 'Julia Nowak', member_id: 'm1', is_override: false, change_kind: null },
        { schedule_id: 's1', schedule_version: 1, service_date: '2026-09-19', role: 'secondary', assignee_name: 'Marek Nowak', member_id: 'm2', is_override: false, change_kind: null },
        { schedule_id: 's1', schedule_version: 1, service_date: '2026-09-21', role: 'secondary', assignee_name: 'Julia Nowak', member_id: 'm1', is_override: false, change_kind: null },
        { schedule_id: 's1', schedule_version: 1, service_date: '2026-09-21', role: 'late_shift', assignee_name: 'Julia Nowak', member_id: 'm1', is_override: false, change_kind: null },
      ],
      availability: [{ member_id: 'm1', kind: 'unavailable', starts_on: '2026-09-19', ends_on: '2026-09-19', note: null }],
    })
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)
    // Saturday: round-the-clock cover (coverage.py), 2X, the SECONDARY partner named.
    const saturday = (await screen.findByText('sob 19 wrz · PRIMARY')).closest('.list-row') as HTMLElement
    expect(within(saturday).getByText(/całodobowo · 2X · Secondary: Marek/)).toBeInTheDocument()
    expect(within(saturday).getByRole('button', { name: 'Kolizja z Twoją niedostępnością sob 19 wrz: pokaż w kalendarzu' })).toHaveTextContent(/^kolizja$/)
    expect(within(saturday).getByRole('link', { name: 'Zamień' })).toHaveAttribute('href', '/zamiany?data=2026-09-19&rola=primary')
    // Two roles on one day are one row, with both windows.
    const monday = screen.getByText('pon 21 wrz · SECONDARY + 11–19').closest('.list-row') as HTMLElement
    expect(within(monday).getByText(/19:00–09:00 \+ 11:00–19:00 · 1X/)).toBeInTheDocument()
    expect(screen.queryByText(/LATE_SHIFT/)).not.toBeInTheDocument()
    // The header names the next duty and the primary action starts a swap from it.
    expect(screen.getByText(/następny:/)).toHaveTextContent('za 9 dni, PRIMARY')
    expect(screen.getByRole('link', { name: 'Zaproponuj zamianę' })).toHaveAttribute('href', '/zamiany?data=2026-09-19&rola=primary')
  })

  it('shows an empty state rather than a bare list', async () => {
    stub()
    renderScreen(<MineScreen displayName="Julia Nowak" />)
    expect(await screen.findByText('Brak nadchodzących dyżurów')).toBeInTheDocument()
  })
})

describe('MineScreen points and swaps', () => {
  it('shows the deviation as one number with the verdict and the months under it', async () => {
    stub()
    renderScreen(<MineScreen displayName="Julia Nowak" />)
    expect(await screen.findByText('+0,5', { selector: '.big' })).toBeInTheDocument()
    expect(screen.getByText('W normie')).toBeInTheDocument()
    expect(screen.getByText('W normie').closest('.box')).toHaveTextContent(/^W normieMasz o 0,5 pkt więcej niż Twój sprawiedliwy udział\. Norma to ±2,0 pkt od udziału należnego\. Generator wyrówna to w kolejnym zakresie\.$/)
    const table = await screen.findByRole('table', { name: 'Punkty miesiąc po miesiącu' })
    expect(within(table).getByText('wrzesień')).toBeInTheDocument()
    expect(within(table).getByText('sierpień')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Ten miesiąc' }))
    expect(within(table).queryByText('sierpień')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Pełny raport sprawiedliwości' })).toHaveAttribute('href', '/sprawiedliwosc')
  })

  it('offers one-click decisions on swaps waiting for me and names the stage of my own', async () => {
    stub()
    vi.spyOn(api, 'swaps').mockResolvedValue([
      swap({ id: 'w1' }),
      swap({ id: 'w2', service_date: '2026-09-28', requester_name: 'Julia Nowak', replacement_name: 'Marek Nowak' }),
      swap({ id: 'w3', service_date: '2026-08-01', requester_name: 'Ola Wiśniewska', replacement_name: 'Ewa Maj' }),
    ])
    renderScreen(<MineScreen displayName="Julia Nowak" />)
    const incoming = (await screen.findByText('Piotr → Ty · sob 3 paź PRIMARY')).closest('.list-row') as HTMLElement
    expect(within(incoming).getByText('prośba do Ciebie · odpowiedz')).toBeInTheDocument()
    expect(within(incoming).getByRole('link', { name: 'Zdecyduj' })).toHaveAttribute('href', '/zamiany?skrzynka=do-mnie')
    const outgoing = screen.getByText('Ty → Marek · pon 28 wrz PRIMARY').closest('.list-row') as HTMLElement
    expect(within(outgoing).getByText(/czeka na: Marek/)).toBeInTheDocument()
    // A screen reader hears words, not the arrow.
    expect(within(incoming).getByText('Piotr przekazuje Ci dyżur · sob 3 paź PRIMARY')).toHaveClass('sr-only')
    expect(within(outgoing).getByText('Przekazujesz dyżur, przejmuje go Marek · pon 28 wrz PRIMARY')).toHaveClass('sr-only')
    // A swap between two other people is not mine.
    expect(screen.queryByText(/Ola/)).not.toBeInTheDocument()
  })

  it('says the date passed on a pending swap whose day is over, whichever side of it I am on', async () => {
    stub()
    vi.spyOn(api, 'swaps').mockResolvedValue([
      swap({ id: 'l1', service_date: '2026-09-09' }),
      swap({ id: 'l2', service_date: '2026-09-08', requester_name: 'Julia Nowak', replacement_name: 'Marek Nowak' }),
    ])
    renderScreen(<MineScreen displayName="Julia Nowak" />)
    const incoming = (await screen.findByText('Piotr → Ty · śr 9 wrz PRIMARY')).closest('.list-row') as HTMLElement
    expect(within(incoming).getByText('termin minął')).toBeInTheDocument()
    expect(within(incoming).queryByRole('link', { name: 'Zdecyduj' })).not.toBeInTheDocument()
    expect(within(incoming).getByText('oczekuje')).toBeInTheDocument()
    const outgoing = screen.getByText('Ty → Marek · wt 8 wrz PRIMARY').closest('.list-row') as HTMLElement
    expect(within(outgoing).getByText('termin minął')).toBeInTheDocument()
  })

  it('names both duties of an exchange, whichever side of it I am on', async () => {
    stub()
    const taken = [{ service_date: '2026-09-30', role: 'secondary' as const }]
    vi.spyOn(api, 'swaps').mockResolvedValue([
      swap({ id: 'w1', return_slots: taken }),
      swap({ id: 'w2', service_date: '2026-09-28', requester_name: 'Julia Nowak', replacement_name: 'Marek Nowak', return_slots: taken }),
    ])
    renderScreen(<MineScreen displayName="Julia Nowak" />)

    expect(await screen.findByText('Piotr ⇄ Ty · sob 3 paź PRIMARY ⇄ śr 30 wrz SECONDARY')).toBeInTheDocument()
    expect(screen.getByText('Ty ⇄ Marek · pon 28 wrz PRIMARY ⇄ śr 30 wrz SECONDARY')).toBeInTheDocument()
    expect(screen.getByText('Zamiana: Piotr i Ty · sob 3 paź PRIMARY zamiana z śr 30 wrz SECONDARY')).toHaveClass('sr-only')
    expect(screen.getByText('Zamiana: Ty i Marek · pon 28 wrz PRIMARY zamiana z śr 30 wrz SECONDARY')).toHaveClass('sr-only')
  })
})

describe('MineScreen availability calendar', () => {
  const cell = (label: RegExp) => screen.getByRole('gridcell', { name: label })

  it('paints an entry on the calendar and clears it around the painted day', async () => {
    stub()
    vi.spyOn(api, 'availability').mockResolvedValue([{
      id: 'a1', kind: 'unavailable', starts_on: '2026-09-20', ends_on: '2026-09-21', note: 'Wyjazd', created_at: '2026-09-01T10:00:00Z',
    }])
    const replace = vi.spyOn(api, 'replaceAvailabilityRange').mockResolvedValue(null)
    renderScreen(<MineScreen displayName="Julia Nowak" />)
    const painted = await screen.findByRole('gridcell', { name: /niedz 20-09-2026, Nie mogę, powód: Wyjazd/ })
    expect(painted).toHaveAttribute('title', 'Nie mogę: Wyjazd')

    fireEvent.click(screen.getByRole('button', { name: 'Wyczyść zaznaczenie' }))
    fireEvent.click(cell(/niedz 20-09-2026/))

    await waitFor(() => expect(replace).toHaveBeenCalledWith({
      kind: null, starts_on: '2026-09-20', ends_on: '2026-09-20', note: undefined, undo_id: expect.any(String),
    }))
    expect(await screen.findByText('Wyczyszczono: niedz 20 wrz')).toBeInTheDocument()
  })

  it('saves a click at once with the brush kind and the optional reason', async () => {
    stub()
    const replace = vi.spyOn(api, 'replaceAvailabilityRange').mockResolvedValue({
      id: 'a1', kind: 'prefer_not', starts_on: '2026-09-20', ends_on: '2026-09-20', note: 'szkolenie', created_at: '2026-09-01T10:00:00Z',
    })
    renderScreen(<MineScreen displayName="Julia Nowak" />)
    await idleCalendar()

    fireEvent.click(screen.getByRole('radio', { name: 'wolę nie' }))
    fireEvent.change(screen.getByLabelText('Powód do kolejnych wpisów'), { target: { value: 'szkolenie' } })
    fireEvent.click(cell(/niedz 20-09-2026/))

    await waitFor(() => expect(replace).toHaveBeenCalledWith({ kind: 'prefer_not', starts_on: '2026-09-20', ends_on: '2026-09-20', note: 'szkolenie', undo_id: expect.any(String) }))
    expect(await screen.findByText('Zapisano: niedz 20 wrz „wolę nie”')).toBeInTheDocument()
    // The toast repeats the reason, so it is plain the reason went with the entry.
    expect(screen.getByText('powód: szkolenie')).toBeInTheDocument()
  })

  it('marks a day whose entry has a reason', async () => {
    stub()
    vi.spyOn(api, 'availability').mockResolvedValue([
      { id: 'a1', kind: 'unavailable', starts_on: '2026-09-20', ends_on: '2026-09-20', note: 'urlop', created_at: '2026-09-01T10:00:00Z' },
      { id: 'a2', kind: 'prefer', starts_on: '2026-09-21', ends_on: '2026-09-21', note: null, created_at: '2026-09-01T10:00:00Z' },
    ])
    renderScreen(<MineScreen displayName="Julia Nowak" />)

    const noted = await screen.findByRole('gridcell', { name: /niedz 20-09-2026, Nie mogę, powód: urlop/ })
    expect(noted.querySelector('.avail-day-note')).not.toBeNull()
    expect(cell(/pon 21-09-2026/).querySelector('.avail-day-note')).toBeNull()
  })

  it('names the brush "Zaznaczam jako", keeps the eraser apart and lights it only while it is the brush', async () => {
    stub()
    renderScreen(<MineScreen displayName="Julia Nowak" />)
    await idleCalendar()

    const kinds = screen.getByRole('radiogroup', { name: 'Zaznaczam jako' })
    expect(within(kinds).getAllByRole('radio').map((radio) => radio.textContent)).toEqual(['nie mogę', 'wolę nie', 'chętnie'])
    const eraser = screen.getByRole('button', { name: 'Wyczyść zaznaczenie' })
    expect(eraser).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(eraser)
    expect(eraser).toHaveAttribute('aria-pressed', 'true')
    expect(within(kinds).getAllByRole('radio').every((radio) => radio.getAttribute('aria-checked') === 'false')).toBe(true)

    fireEvent.click(screen.getByRole('radio', { name: 'chętnie' }))
    expect(eraser).toHaveAttribute('aria-pressed', 'false')
  })

  it('says it in one sentence and keeps the dot, the outline and the letters in a legend', async () => {
    stub()
    renderScreen(<MineScreen displayName="Julia Nowak" />)
    await idleCalendar()

    expect(screen.getByText('Kliknij dzień albo przeciągnij po kilku. Zapisujemy od razu.', { exact: false })).toBeInTheDocument()
    // Shift is for a keyboard and a mouse; a phone hides the sentence.
    expect(screen.getByText('Shift+klik zaznacza zakres.')).toHaveClass('only-pointer')
    fireEvent.click(screen.getByRole('button', { name: 'Legenda' }))
    const legend = await screen.findByRole('dialog', { name: 'Legenda kalendarza' })
    expect(within(legend).getByText('Kropka: masz w tym dniu dyżur.')).toBeInTheDocument()
    expect(within(legend).getByText('Bursztynowa obwódka: wpis „nie mogę” w dniu z dyżurem.')).toBeInTheDocument()
    expect(within(legend).getAllByText(/^(N|W|C)$/).map((mark) => mark.textContent)).toEqual(['N', 'W', 'C'])
    expect(within(legend).getByText('Chętnie wezmę')).toBeInTheDocument()
  })

  it('says which days were not saved and why, in the toast, when a paint fails', async () => {
    stub()
    vi.spyOn(api, 'replaceAvailabilityRange').mockRejectedValue(new ApiError('Brak połączenia', 503))
    renderScreen(<MineScreen displayName="Julia Nowak" />)
    await idleCalendar()

    fireEvent.click(cell(/niedz 20-09-2026/))
    expect(await screen.findByText('Nie zapisano: niedz 20 wrz. Spróbuj ponownie.')).toBeInTheDocument()
    expect(screen.getByText('Brak połączenia')).toBeInTheDocument()
  })

  it('keeps focus on the day while a save runs', async () => {
    stub()
    const replace = vi.spyOn(api, 'replaceAvailabilityRange').mockReturnValue(new Promise(() => {}))
    renderScreen(<MineScreen displayName="Julia Nowak" />)
    await idleCalendar()

    cell(/niedz 20-09-2026/).focus()
    fireEvent.click(cell(/niedz 20-09-2026/))

    await waitFor(() => expect(replace).toHaveBeenCalledOnce())
    expect(cell(/niedz 20-09-2026/)).toBeEnabled()
    expect(cell(/niedz 20-09-2026/)).toHaveFocus()
  })

  it('ignores painting while the entries load', async () => {
    stub()
    vi.spyOn(api, 'availability').mockReturnValue(new Promise(() => {}))
    const replace = vi.spyOn(api, 'replaceAvailabilityRange')
    renderScreen(<MineScreen displayName="Julia Nowak" />)
    const grid = await screen.findByRole('grid', { name: /Kalendarz dostępności/ })

    fireEvent.pointerDown(cell(/niedz 20-09-2026/), { button: 0 })
    fireEvent.pointerEnter(cell(/pon 21-09-2026/))
    fireEvent.click(cell(/niedz 20-09-2026/))

    expect(grid).toHaveAttribute('aria-busy', 'true')
    expect(replace).not.toHaveBeenCalled()
  })

  it('cannot paint a day that has passed', async () => {
    stub()
    renderScreen(<MineScreen displayName="Julia Nowak" />)
    await screen.findByRole('grid', { name: /Kalendarz dostępności/ })
    expect(cell(/wt 01-09-2026/)).toBeDisabled()
    expect(cell(/czw 10-09-2026/)).toBeEnabled()
  })

  it('enters the calendar once, moves by day and week, and paints with Enter and Space', async () => {
    const user = userEvent.setup()
    stub()
    const replace = vi.spyOn(api, 'replaceAvailabilityRange').mockImplementation(async (input) => ({
      id: input.starts_on,
      kind: input.kind ?? 'unavailable',
      starts_on: input.starts_on,
      ends_on: input.ends_on,
      note: input.note ?? null,
      created_at: '2026-09-10T10:00:00Z',
    }))
    renderScreen(<MineScreen displayName="Julia Nowak" />)
    const grid = await idleCalendar()
    const enabled = within(grid).getAllByRole('gridcell').filter((item) => !item.hasAttribute('disabled'))
    expect(enabled.filter((item) => item.tabIndex === 0)).toHaveLength(1)
    expect(cell(/czw 10-09-2026/)).toHaveAttribute('tabindex', '0')

    cell(/czw 10-09-2026/).focus()
    await user.keyboard('{ArrowRight}{ArrowDown}{Home}{End}')
    expect(cell(/niedz 20-09-2026/)).toHaveFocus()
    // A Sunday runs on to the next Monday, and back.
    await user.keyboard('{ArrowRight}')
    expect(cell(/pon 21-09-2026/)).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(cell(/niedz 20-09-2026/)).toHaveFocus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(replace).toHaveBeenCalledWith(expect.objectContaining({ starts_on: '2026-09-20', ends_on: '2026-09-20' })))

    await idleCalendar()
    await user.keyboard('{ArrowLeft} ')
    await waitFor(() => expect(replace).toHaveBeenCalledWith(expect.objectContaining({ starts_on: '2026-09-19', ends_on: '2026-09-19' })))
  })

  it('names a duty on an unavailable day and leads to a swap of that day', async () => {
    stub()
    vi.spyOn(api, 'calendar').mockResolvedValue({ ...EMPTY_CALENDAR, assignments: [
      assignment('2026-09-20', 'primary', 'Julia Nowak'),
      assignment('2026-09-22', 'secondary', 'Julia Nowak'),
      assignment('2026-09-20', 'secondary', 'Ola Wiśniewska'),
    ] })
    vi.spyOn(api, 'availability').mockResolvedValue([])
    vi.spyOn(api, 'replaceAvailabilityRange').mockResolvedValue(null)
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)
    await idleCalendar()
    expect(screen.queryByText(/a zgłaszasz/)).not.toBeInTheDocument()

    fireEvent.click(cell(/niedz 20-09-2026/))

    const frame = (await screen.findByText('Masz dyżur PRIMARY 20 wrz, a zgłaszasz „nie mogę”')).closest('.box') as HTMLElement
    expect(frame).toHaveClass('box-warn')
    expect(frame).toHaveTextContent('Wpis nie zdejmuje dyżuru. Poproś kogoś o zamianę tego dnia.')
    expect(within(frame).getByRole('link', { name: 'Poproś o zamianę · 20 wrz' })).toHaveAttribute('href', '/zamiany?data=2026-09-20&rola=primary')
  })

  it('lists every future collision of the month and leaves the past ones out', async () => {
    stub()
    vi.spyOn(api, 'calendar').mockResolvedValue({ ...EMPTY_CALENDAR, assignments: [
      assignment('2026-09-05', 'primary', 'Julia Nowak'),
      assignment('2026-09-20', 'late_shift', 'Julia Nowak'),
      assignment('2026-09-20', 'secondary', 'Julia Nowak'),
      assignment('2026-09-22', 'primary', 'Julia Nowak'),
    ] })
    vi.spyOn(api, 'availability').mockResolvedValue([
      { id: 'a1', kind: 'unavailable', starts_on: '2026-09-01', ends_on: '2026-09-25', note: null, created_at: '2026-08-20T10:00:00Z' },
    ])
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)

    const frame = (await screen.findByText('Masz 3 dyżury w dni „nie mogę”')).closest('.box') as HTMLElement
    expect(frame).toHaveTextContent('Wpis nie zdejmuje dyżurów. Poproś kogoś o zamianę tych dni.')
    expect(within(frame).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/zamiany?data=2026-09-20&rola=secondary',
      '/zamiany?data=2026-09-22&rola=primary',
    ])
  })

  it('lets a coordinator file availability on behalf of another member', async () => {
    stub()
    vi.spyOn(api, 'team').mockResolvedValue(TEAM)
    const onBehalf = vi.spyOn(api, 'memberAvailability').mockResolvedValue([])
    const replace = vi.spyOn(api, 'replaceMemberAvailabilityRange').mockResolvedValue({
      id: 'x1', kind: 'unavailable', starts_on: '2026-09-20', ends_on: '2026-09-20', note: null, created_at: '2026-09-01T10:00:00Z', created_by_name: 'Adam Nowicki',
    })
    renderScreen(<MineScreen role="coordinator" hasTeamMember displayName="Adam Nowicki" />)

    const picker = await screen.findByRole('combobox', { name: 'Osoba' })
    await screen.findByRole('option', { name: 'Beata Lis' })
    fireEvent.change(picker, { target: { value: 'm-beata' } })

    expect(await screen.findByText(/Wpisujesz w imieniu:/)).toHaveTextContent('Beata Lis')
    expect(screen.getByRole('heading', { name: 'Dostępność: Beata Lis' })).toBeInTheDocument()

    await idleCalendar()
    fireEvent.click(cell(/niedz 20-09-2026/))
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('m-beata', expect.objectContaining({ kind: 'unavailable' })))
    expect(onBehalf).toHaveBeenCalledWith('m-beata')
  })

  it('returns to the own availability when the person picked leaves the team', async () => {
    stub()
    const team = vi.spyOn(api, 'team').mockResolvedValue(TEAM)
    vi.spyOn(api, 'memberAvailability').mockResolvedValue([])
    renderScreen(<MineScreen role="coordinator" hasTeamMember displayName="Adam Nowicki" />)

    const picker = await screen.findByRole('combobox', { name: 'Osoba' })
    await screen.findByRole('option', { name: 'Beata Lis' })
    fireEvent.change(picker, { target: { value: 'm-beata' } })
    expect(await screen.findByRole('heading', { name: 'Dostępność: Beata Lis' })).toBeInTheDocument()

    // Another coordinator removes her; returning to the tab reloads the team.
    team.mockResolvedValue(TEAM.filter((member) => member.id !== 'm-beata'))
    act(() => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
    })
    expect(await screen.findByRole('heading', { name: 'Moja dostępność' })).toBeInTheDocument()
    expect(screen.queryByText(/Wpisujesz w imieniu:/)).not.toBeInTheDocument()
  })

  it('opens in on-behalf mode for an admin who is not in the rotation', async () => {
    stub()
    vi.spyOn(api, 'team').mockResolvedValue(TEAM)
    const self = vi.spyOn(api, 'availability').mockResolvedValue([])
    renderScreen(<MineScreen role="admin" hasTeamMember={false} displayName="Administrator" />)

    expect(await screen.findByText('Wybierz osobę')).toBeInTheDocument()
    // Never calls the owner-only endpoint that would 409 for this account.
    expect(self).not.toHaveBeenCalled()
    // Nothing else of "Moje" applies to an account outside the rotation.
    expect(screen.queryByRole('heading', { name: 'Najbliższe dyżury' })).not.toBeInTheDocument()
  })
})

describe('MineScreen ICS', () => {
  it('keeps the subscriptions behind the export action and opens them from the #ics link', async () => {
    stub()
    renderScreen(<MineScreen displayName="Julia Nowak" />, { route: '/moje#ics' })
    expect(await screen.findByRole('heading', { name: 'Subskrypcja ICS' })).toBeInTheDocument()
    expect(await screen.findByText('Nie masz jeszcze subskrypcji')).toBeInTheDocument()
  })

  it('closes the subscriptions panel with its close button', async () => {
    stub()
    renderScreen(<MineScreen displayName="Julia Nowak" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Subskrypcja ICS' }))
    const panel = await screen.findByRole('dialog', { name: 'Subskrypcja ICS' })

    fireEvent.click(within(panel).getByRole('button', { name: 'Zamknij panel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('creates a subscription and shows the one-time address', async () => {
    stub()
    vi.spyOn(api, 'createFeed').mockResolvedValue({ id: 'f1', url: 'http://localhost:8080/api/v1/calendar/feeds/secret.ics' })
    renderScreen(<MineScreen displayName="Julia Nowak" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Subskrypcja ICS' }))
    const panel = await screen.findByRole('dialog', { name: 'Subskrypcja ICS' })
    fireEvent.change(within(panel).getByLabelText('Nazwa subskrypcji'), { target: { value: 'telefon' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Utwórz adres ICS' }))
    expect(await within(panel).findByText(/secret\.ics/)).toBeInTheDocument()
    expect(api.createFeed).toHaveBeenCalledWith('telefon')
  })

  const FEED = { id: 'f1', label: 'telefon', created_at: '2026-09-01T10:00:00Z', last_used_at: null, revoked_at: null }

  const openRevocation = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Subskrypcja ICS' }))
    const panel = await screen.findByRole('dialog', { name: 'Subskrypcja ICS' })
    fireEvent.click(await within(panel).findByRole('button', { name: 'Odwołaj' }))
    return screen.findByRole('dialog', { name: 'Odwołać subskrypcję ICS?' })
  }

  it('keeps the subscription when the revocation is cancelled', async () => {
    stub()
    vi.spyOn(api, 'feeds').mockResolvedValue([FEED])
    const revoke = vi.spyOn(api, 'revokeFeed').mockResolvedValue(undefined)
    renderScreen(<MineScreen displayName="Julia Nowak" />)

    const confirm = await openRevocation()
    expect(within(confirm).getByText(/Adres „telefon” przestanie działać/)).toBeInTheDocument()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Anuluj' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Odwołać subskrypcję ICS?' })).not.toBeInTheDocument())
    expect(revoke).not.toHaveBeenCalled()
  })

  it('revokes the subscription once confirmed', async () => {
    stub()
    vi.spyOn(api, 'feeds')
      .mockResolvedValueOnce([FEED])
      .mockResolvedValue([{ ...FEED, revoked_at: '2026-09-10T10:00:00Z' }])
    const revoke = vi.spyOn(api, 'revokeFeed').mockResolvedValue(undefined)
    renderScreen(<MineScreen displayName="Julia Nowak" />)

    const confirm = await openRevocation()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Odwołaj subskrypcję' }))

    await waitFor(() => expect(revoke).toHaveBeenCalledWith('f1'))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Odwołać subskrypcję ICS?' })).not.toBeInTheDocument())
    expect(await screen.findByText('Nie masz jeszcze subskrypcji')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pokaż odwołane' }))
    expect(await screen.findByText('odwołana')).toBeInTheDocument()
  })
})

function pretendNarrow() {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: query.includes('max-width: 900px'),
    media: query, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }))
}

/** jsdom has no scrollIntoView; the screen scrolls to the availability section. */
function stubScroll() {
  const scrollIntoView = vi.fn()
  Element.prototype.scrollIntoView = scrollIntoView
  return scrollIntoView
}

afterEach(() => {
  delete (Element.prototype as Partial<Element>).scrollIntoView
})

const assignment = (service_date: string, role: 'primary' | 'secondary' | 'late_shift', assignee_name: string, over: Partial<CalendarData['assignments'][number]> = {}) => ({
  schedule_id: 's1', schedule_version: 1, service_date, role, assignee_name, member_id: assignee_name, is_override: false, change_kind: null, ...over,
})

describe('MineScreen phone', () => {
  it('shows the stored number and, after a save, the form the API stored what was typed in', async () => {
    stub()
    const update = vi.spyOn(api, 'updateMyPhone').mockResolvedValue({ ...ME, phone: '+48600100300' })
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)
    const input = await screen.findByLabelText('Numer telefonu')
    await waitFor(() => expect(input).toHaveValue('+48600100200'))
    const save = screen.getByRole('button', { name: 'Zapisz numer' })
    expect(save).toBeDisabled()
    fireEvent.change(input, { target: { value: '600 100 300' } })
    expect(save).toBeEnabled()
    fireEvent.click(save)
    await waitFor(() => expect(update).toHaveBeenCalledWith('600 100 300'))
    await waitFor(() => expect(input).toHaveValue('+48600100300'))
    expect(await screen.findByText('Zapisano numer telefonu')).toBeInTheDocument()
    expect(save).toBeDisabled()
    // The idle button cannot hold focus, so it goes back to the number.
    expect(input).toHaveFocus()
  })

  it('asks a rotation member for a number, flags one that is not Polish and shows the refusal', async () => {
    stub()
    vi.spyOn(api, 'me').mockResolvedValue({ ...ME, phone: null })
    const update = vi.spyOn(api, 'updateMyPhone').mockRejectedValue(new ApiError('Numer telefonu to +48 i dziewięć cyfr', 422))
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)
    const input = await screen.findByLabelText('Numer telefonu')
    // Nothing is judged before the field is left: no alarm as the screen opens.
    await waitFor(() => expect(input).toBeEnabled())
    expect(screen.queryByText('Wymagany dla osób w rotacji.')).not.toBeInTheDocument()
    fireEvent.blur(input)
    expect(await screen.findByText('Wymagany dla osób w rotacji.')).toBeInTheDocument()
    // Typing again withdraws the verdict until the field is left once more.
    fireEvent.change(input, { target: { value: '+49 170 1234567' } })
    expect(screen.queryByText('Wymagany dla osób w rotacji.')).not.toBeInTheDocument()
    expect(screen.queryByText('Popraw numer: +48 i dziewięć cyfr.')).not.toBeInTheDocument()
    fireEvent.blur(input)
    expect(screen.getByText('Popraw numer: +48 i dziewięć cyfr.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz numer' }))
    const refusal = await screen.findByText('Numer telefonu to +48 i dziewięć cyfr')
    expect(refusal.closest('[role="alert"]')).toHaveFocus()
    expect(update).toHaveBeenCalledWith('+49 170 1234567')
  })

  it('waits for the field to be left or saved before calling a number wrong', async () => {
    stub()
    vi.spyOn(api, 'me').mockResolvedValue({ ...ME, phone: null })
    vi.spyOn(api, 'updateMyPhone').mockRejectedValue(new ApiError('Numer telefonu to +48 i dziewięć cyfr', 422))
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)
    const input = await screen.findByLabelText('Numer telefonu')
    await waitFor(() => expect(input).toBeEnabled())
    fireEvent.change(input, { target: { value: '+49 17' } })
    expect(screen.queryByText('Popraw numer: +48 i dziewięć cyfr.')).not.toBeInTheDocument()
    expect(input).not.toHaveAttribute('aria-invalid', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz numer' }))
    expect(await screen.findByText('Popraw numer: +48 i dziewięć cyfr.')).toBeInTheDocument()
  })

  it('needs no number from an account outside the rotation and clears one with an empty field', async () => {
    stub()
    vi.spyOn(api, 'me').mockResolvedValue({ ...ME, role: 'viewer', has_team_member: false })
    const update = vi.spyOn(api, 'updateMyPhone').mockResolvedValue({ ...ME, role: 'viewer', has_team_member: false, phone: null })
    renderScreen(<MineScreen role="viewer" hasTeamMember={false} displayName="Julia Nowak" />)
    const input = await screen.findByLabelText('Numer telefonu')
    await waitFor(() => expect(input).toHaveValue('+48600100200'))
    fireEvent.change(input, { target: { value: ' ' } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz numer' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith(null))
    await waitFor(() => expect(input).toHaveValue(''))
  })
})

describe('MineScreen duty rows', () => {
  it('highlights today, names the holiday, the correction and every partner in role order', async () => {
    stub()
    vi.spyOn(api, 'calendar').mockResolvedValue({
      ...EMPTY_CALENDAR,
      days: [{ service_date: '2026-09-10', weekday: 'czw', is_day_off: true, holiday_name: 'Święto zakładowe', published: true, events: [] }],
      members: [{ id: 'm1', display_name: 'Julia Nowak' }],
      assignments: [
        assignment('2026-09-10', 'primary', 'Julia Nowak', { change_kind: 'swap' }),
        assignment('2026-09-10', 'late_shift', 'Ola Wiśniewska'),
        assignment('2026-09-10', 'secondary', 'Marek Nowak'),
        // A day the calendar has no metadata for still gets a row, as a working day.
        assignment('2026-09-15', 'secondary', 'Julia Nowak', { is_override: true }),
      ],
    })
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)

    const today = (await screen.findByText('dziś, czw 10 wrz · PRIMARY')).closest('.list-row') as HTMLElement
    expect(within(today).getByText('dziś, czw 10 wrz · PRIMARY')).toHaveClass('who-you')
    expect(within(today).getByText(/^trwa · całodobowo · 2X · Secondary: Marek, 11–19: Ola · Święto zakładowe/)).toBeInTheDocument()
    expect(within(today).getByText('po korekcie')).toBeInTheDocument()
    expect(within(today).getByRole('link', { name: 'Szczegóły' })).toHaveAttribute('href', '/grafik?dzien=2026-09-10')

    const later = screen.getByText('wt 15 wrz · SECONDARY').closest('.list-row') as HTMLElement
    expect(within(later).getByText(/^19:00–09:00 · 1X/)).toBeInTheDocument()
    expect(within(later).getByText('po korekcie')).toBeInTheDocument()
    expect(within(later).getByRole('link', { name: 'Zamień' })).toHaveAttribute('href', '/zamiany?data=2026-09-15&rola=secondary')
  })

  it('counts the duties of the last 90 days in the subtitle', async () => {
    stub()
    vi.spyOn(api, 'calendar').mockImplementation(async (startsOn) => ({
      ...EMPTY_CALENDAR,
      assignments: startsOn === '2026-06-12'
        ? [assignment('2026-08-01', 'primary', 'Julia Nowak'), assignment('2026-08-20', 'secondary', 'Julia Nowak')]
        : [],
    }))
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)
    expect(await screen.findByText(/Julia Nowak · członek zespołu · 2 dyżury w ostatnich 90 dniach/)).toBeInTheDocument()
  })

  it('shows a failed duty list and loads it again on retry', async () => {
    stub()
    let failed = false
    const calendarCall = vi.spyOn(api, 'calendar').mockImplementation(async (startsOn, endsOn) => {
      if (startsOn === '2026-09-10' && endsOn === '2026-11-08' && !failed) {
        failed = true
        throw new ApiError('Kalendarz niedostępny', 503)
      }
      return EMPTY_CALENDAR
    })
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Kalendarz niedostępny')
    fireEvent.click(within(alert).getByRole('button', { name: 'Spróbuj ponownie' }))
    expect(await screen.findByText('Brak nadchodzących dyżurów')).toBeInTheDocument()
    expect(calendarCall.mock.calls.filter(([a, b]) => a === '2026-09-10' && b === '2026-11-08')).toHaveLength(2)
  })

  it('scrolls to the availability calendar from the #dostepnosc link', async () => {
    stub()
    const scrollIntoView = stubScroll()
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />, { route: '/moje#dostepnosc' })
    await screen.findByRole('grid', { name: /Kalendarz dostępności/ })
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
  })
})

describe('MineScreen on a phone', () => {
  it('puts the points right after the duties and leads to the calendar from them', async () => {
    pretendNarrow()
    stub()
    const scrollIntoView = stubScroll()
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)

    expect(await screen.findByRole('heading', { name: 'Punkty' })).toBeInTheDocument()
    expect(await screen.findByText('w normie (±2,0)')).toBeInTheDocument()
    // No month table and no period switch on the phone.
    expect(screen.queryByRole('button', { name: 'Ten miesiąc' })).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    const headings = screen.getAllByRole('heading', { level: 2 }).map((item) => item.textContent)
    expect(headings.indexOf('Punkty')).toBe(headings.indexOf('Najbliższe dyżury') + 1)

    fireEvent.click(screen.getByRole('button', { name: /Zgłoś dostępność/ }))
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' })
  })

  it('says a balance is outside the norm in the compact form', async () => {
    pretendNarrow()
    stub()
    vi.spyOn(api, 'fairness').mockResolvedValue({ ...REPORT, members: [{ ...REPORT.members[0], primary: balance(1, -3) }] })
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)
    expect(await screen.findByText('poza normą (±2,0)')).toBeInTheDocument()
    expect(screen.getByText('−3,0', { selector: '.big' })).toBeInTheDocument()
  })

  it('judges the printed balance, so a printed 3,0 is within a printed ±3,0', async () => {
    pretendNarrow()
    stub()
    vi.spyOn(api, 'fairness').mockResolvedValue({ ...REPORT, criterion_points: 3, members: [{ ...REPORT.members[0], primary: balance(4, 3.04) }] })
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)
    expect(await screen.findByText('w normie (±3,0)')).toBeInTheDocument()
    expect(screen.getByText('+3,0', { selector: '.big' })).toBeInTheDocument()
  })
})

describe('MineScreen points states', () => {
  it('keeps a balance that prints as the norm within it', async () => {
    stub()
    vi.spyOn(api, 'fairness').mockResolvedValue({ ...REPORT, criterion_points: 3, members: [{ ...REPORT.members[0], primary: balance(4, 3.04) }] })
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)
    const box = (await screen.findByText('W normie')).closest('.box')
    expect(box).toHaveClass('box-ok')
    expect(box).toHaveTextContent(/^W normieMasz o 3,0 pkt więcej niż Twój sprawiedliwy udział\. Norma to ±3,0 pkt od udziału należnego\. Generator wyrówna to w kolejnym zakresie\.$/)
  })

  it.each([
    ['above the fair share', 3, '+3,0', 'Masz o 3,0 pkt więcej niż Twój sprawiedliwy udział.', 'Generator da Ci mniej dyżurów w kolejnym zakresie.'],
    ['below the fair share', -3, '−3,0', 'Masz o 3,0 pkt mniej niż Twój sprawiedliwy udział.', 'Generator da Ci więcej dyżurów w kolejnym zakresie.'],
  ])('tells a member %s outside the norm what the generator will do', async (_, deviation, big, sentence, plan) => {
    stub()
    vi.spyOn(api, 'fairness').mockResolvedValue({ ...REPORT, members: [{ ...REPORT.members[0], primary: balance(4, deviation) }] })
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)

    expect(await screen.findByText(big, { selector: '.big' })).toBeInTheDocument()
    expect(screen.getByText(big, { selector: '.dev-v' })).toBeInTheDocument()
    expect(screen.getByText(sentence, { exact: false })).toBeInTheDocument()
    expect(screen.getByText('Poza normą')).toBeInTheDocument()
    expect(screen.getByText(plan, { exact: false })).toBeInTheDocument()
  })

  it.each([0, 0.03, -0.04])('prints a balance of %s, which rounds to zero, as even and without a sign', async (deviation) => {
    stub()
    vi.spyOn(api, 'fairness').mockResolvedValue({ ...REPORT, members: [{ ...REPORT.members[0], primary: balance(4, deviation) }] })
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)
    expect(await screen.findByText('0,0', { selector: '.big' })).toBeInTheDocument()
    // The bar agrees with the big number: no sign, read as on share.
    expect(screen.getByRole('img', { name: 'zgodnie z udziałem' })).toHaveTextContent(/^0,0$/)
    // Nothing to even out: the box stops at the norm.
    expect(screen.getByText('W normie').closest('.box')).toHaveTextContent(/^W normieMasz dokładnie tyle punktów, ile wynosi Twój sprawiedliwy udział\. Norma to ±2,0 pkt od udziału należnego\.$/)
  })

  it('says when the month has no duties and switches back to twelve months', async () => {
    stub()
    vi.spyOn(api, 'fairnessDuties').mockResolvedValue([
      { service_date: '2026-08-12', role: 'secondary', points: 1, is_day_off: false },
      { service_date: '2025-12-12', role: 'primary', points: 1, is_day_off: false },
    ])
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)
    const table = await screen.findByRole('table', { name: 'Punkty miesiąc po miesiącu' })
    // A month of another year carries its year.
    expect(within(table).getByText('grudzień 2025')).toBeInTheDocument()

    const period = screen.getByRole('radiogroup', { name: 'Okres' })
    fireEvent.click(within(period).getByRole('radio', { name: 'Ten miesiąc' }))
    expect(await within(table).findByText('Brak dyżurów w tym okresie.')).toBeInTheDocument()
    fireEvent.click(within(period).getByRole('radio', { name: '12 mies.' }))
    expect(await within(table).findByText('sierpień')).toBeInTheDocument()
    expect(within(period).getByRole('radio', { name: '12 mies.' })).toHaveAttribute('aria-checked', 'true')
  })

  it('keeps the period in the URL, so a refresh, Back and Forward show it again', async () => {
    stub()
    vi.spyOn(api, 'fairnessDuties').mockResolvedValue([
      { service_date: '2026-08-12', role: 'secondary', points: 1, is_day_off: false },
    ])
    const { router } = renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />, { route: '/moje?okres=miesiac' })
    const table = await screen.findByRole('table', { name: 'Punkty miesiąc po miesiącu' })
    expect(within(table).getByText('Brak dyżurów w tym okresie.')).toBeInTheDocument()
    const period = screen.getByRole('radiogroup', { name: 'Okres' })
    expect(within(period).getByRole('radio', { name: 'Ten miesiąc' })).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(within(period).getByRole('radio', { name: '12 mies.' }))
    await waitFor(() => expect(router.state.location.search).toBe(''))
    expect(await within(table).findByText('sierpień')).toBeInTheDocument()

    await act(() => router.navigate('/moje?okres=miesiac'))
    expect(await within(table).findByText('Brak dyżurów w tym okresie.')).toBeInTheDocument()
    await act(() => router.navigate(-1))
    expect(await within(table).findByText('sierpień')).toBeInTheDocument()
    await act(() => router.navigate(1))
    expect(await within(table).findByText('Brak dyżurów w tym okresie.')).toBeInTheDocument()
  })

  it('shows failed points and loads them again on retry', async () => {
    stub()
    const fairness = vi.spyOn(api, 'fairness')
      .mockRejectedValueOnce(new ApiError('Raport niedostępny', 500))
      .mockResolvedValue(REPORT)
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Raport niedostępny')
    fireEvent.click(within(alert).getByRole('button', { name: 'Spróbuj ponownie' }))
    expect(await screen.findByText('+0,5', { selector: '.big' })).toBeInTheDocument()
    expect(fairness).toHaveBeenCalledTimes(2)
  })
})

describe('MineScreen swap stages', () => {
  it('names every stage and lists the settled swaps newest first', async () => {
    stub()
    vi.spyOn(api, 'swaps').mockResolvedValue([
      swap({ id: 'c1', requester_name: 'Julia Nowak', replacement_name: 'Marek Nowak', status: 'pending_coordinator' }),
      swap({ id: 'a1', service_date: '2026-08-10', status: 'approved', created_at: '2026-08-01T10:00:00Z' }),
      swap({ id: 'r1', service_date: '2026-08-11', status: 'rejected', decision_note: 'Urlop', created_at: '2026-08-05T10:00:00Z' }),
      swap({ id: 'x1', service_date: '2026-08-12', status: 'cancelled', created_at: '2026-07-01T10:00:00Z' }),
    ])
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)

    const section = (await screen.findByRole('heading', { name: 'Zamiany' })).closest('section') as HTMLElement
    const rows = await within(section).findAllByText(/→/)
    expect(rows.map((row) => row.textContent)).toEqual([
      'Ty → Marek · sob 3 paź PRIMARY',
      'Piotr → Ty · wt 11 sie PRIMARY',
      'Piotr → Ty · pon 10 sie PRIMARY',
      'Piotr → Ty · śr 12 sie PRIMARY',
    ])
    expect(within(section).getByText('czeka na koordynatora')).toBeInTheDocument()
    expect(within(section).getByText('odrzucona · „Urlop”')).toBeInTheDocument()
    expect(within(section).getByText('wpisana do grafiku')).toBeInTheDocument()
    expect(within(section).getByText('wycofana', { selector: 'small' })).toBeInTheDocument()
  })

  it('asks a coordinator to approve a swap waiting for the coordinator', async () => {
    stub()
    vi.spyOn(api, 'team').mockResolvedValue(TEAM)
    vi.spyOn(api, 'swaps').mockResolvedValue([
      swap({ id: 'c1', requester_name: 'Julia Nowak', replacement_name: 'Marek Nowak', status: 'pending_coordinator' }),
    ])
    renderScreen(<MineScreen role="coordinator" hasTeamMember displayName="Julia Nowak" />)

    const row = (await screen.findByText('czeka na Twoje zatwierdzenie')).closest('.list-row') as HTMLElement
    expect(within(row).getByRole('link', { name: 'Zdecyduj' })).toHaveAttribute('href', '/zamiany?skrzynka=do-mnie')
  })

  it('shows failed swaps and loads them again on retry', async () => {
    stub()
    vi.spyOn(api, 'swaps')
      .mockRejectedValueOnce(new ApiError('Zamiany niedostępne', 503))
      .mockResolvedValue([])
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Zamiany niedostępne')
    fireEvent.click(within(alert).getByRole('button', { name: 'Spróbuj ponownie' }))
    expect(await screen.findByText('Brak zamian z Twoim udziałem')).toBeInTheDocument()
  })
})

describe('MineScreen availability painting', () => {
  const cell = (label: RegExp) => screen.getByRole('gridcell', { name: label })
  const created = (starts_on: string, ends_on: string) => ({
    id: 'n1', kind: 'unavailable' as const, starts_on, ends_on, note: null, created_at: '2026-09-01T10:00:00Z',
  })

  it('previews a dragged range, flags the duty under it and saves it on release', async () => {
    stub()
    vi.spyOn(api, 'calendar').mockResolvedValue({ ...EMPTY_CALENDAR, assignments: [assignment('2026-09-23', 'primary', 'Julia Nowak')] })
    const replace = vi.spyOn(api, 'replaceAvailabilityRange').mockResolvedValue(created('2026-09-22', '2026-09-25'))
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)
    await screen.findByRole('gridcell', { name: /śr 23-09-2026, dyżur: PRIMARY$/ })
    await idleCalendar()

    // Dragged from the later day back to the earlier one.
    fireEvent.pointerDown(cell(/pt 25-09-2026/), { button: 0 })
    fireEvent.pointerEnter(cell(/wt 22-09-2026/))
    expect(cell(/pon 21-09-2026/)).not.toHaveClass('avail-day-sel')
    expect(cell(/pon 21-09-2026/)).toHaveAttribute('aria-selected', 'false')
    expect(cell(/wt 22-09-2026/)).toHaveClass('avail-day-sel', 'avail-day-na')
    expect(cell(/wt 22-09-2026/)).toHaveAttribute('aria-selected', 'true')
    expect(cell(/wt 22-09-2026/)).toHaveTextContent('N')
    const duty = cell(/śr 23-09-2026/)
    expect(duty).toHaveClass('avail-day-conflict')
    expect(duty).toHaveAccessibleName('śr 23-09-2026, dyżur: PRIMARY, kolizja z dyżurem')

    fireEvent.pointerUp(window)
    await waitFor(() => expect(replace).toHaveBeenCalledWith({ kind: 'unavailable', starts_on: '2026-09-22', ends_on: '2026-09-25', note: undefined, undo_id: expect.any(String) }))
    expect(await screen.findByText('Zapisano: 22 – 25 wrz „nie mogę”')).toBeInTheDocument()
  })

  it('previews a cleared range without a colour', async () => {
    stub()
    const replace = vi.spyOn(api, 'replaceAvailabilityRange').mockResolvedValue(null)
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)
    await idleCalendar()

    fireEvent.click(screen.getByRole('button', { name: 'Wyczyść zaznaczenie' }))
    fireEvent.pointerDown(cell(/wt 22-09-2026/), { button: 0 })
    fireEvent.pointerEnter(cell(/śr 23-09-2026/))
    expect(cell(/śr 23-09-2026/)).toHaveClass('avail-day-sel')
    expect(cell(/śr 23-09-2026/)).not.toHaveClass('avail-day-na')
    expect(cell(/śr 23-09-2026/)).toHaveTextContent(/^23$/)

    fireEvent.pointerUp(window)
    expect(await screen.findByText('Wyczyszczono: 22 – 23 wrz')).toBeInTheDocument()
    expect(replace).toHaveBeenCalledWith({
      kind: null, starts_on: '2026-09-22', ends_on: '2026-09-23', note: undefined, undo_id: expect.any(String),
    })
  })

  it('drops a drag that the browser cancels and ignores other buttons and stray hovers', async () => {
    stub()
    const replace = vi.spyOn(api, 'replaceAvailabilityRange')
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)
    await idleCalendar()

    fireEvent.pointerEnter(cell(/śr 23-09-2026/))
    expect(cell(/śr 23-09-2026/)).not.toHaveClass('avail-day-sel')
    fireEvent.pointerDown(cell(/wt 22-09-2026/), { button: 2 })
    expect(cell(/wt 22-09-2026/)).not.toHaveClass('avail-day-sel')

    fireEvent.pointerDown(cell(/wt 22-09-2026/), { button: 0 })
    fireEvent.pointerEnter(cell(/śr 23-09-2026/))
    expect(cell(/śr 23-09-2026/)).toHaveClass('avail-day-sel')
    fireEvent.pointerCancel(window)
    await waitFor(() => expect(cell(/śr 23-09-2026/)).not.toHaveClass('avail-day-sel'))
    fireEvent.pointerUp(window)
    // A pointer click reaches onClick too, after pointerup has already committed it.
    fireEvent.click(cell(/śr 23-09-2026/), { detail: 1 })
    expect(replace).not.toHaveBeenCalled()
  })

  it('closes a range with Shift from the last painted day', async () => {
    stub()
    const replace = vi.spyOn(api, 'replaceAvailabilityRange')
      .mockResolvedValueOnce(created('2026-09-20', '2026-09-20'))
      .mockResolvedValue(created('2026-09-20', '2026-09-24'))
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)
    await idleCalendar()

    fireEvent.click(cell(/niedz 20-09-2026/))
    expect(await screen.findByText('Zapisano: niedz 20 wrz „nie mogę”')).toBeInTheDocument()
    await idleCalendar()
    fireEvent.click(cell(/czw 24-09-2026/), { shiftKey: true })
    await waitFor(() => expect(replace).toHaveBeenLastCalledWith({ kind: 'unavailable', starts_on: '2026-09-20', ends_on: '2026-09-24', note: undefined, undo_id: expect.any(String) }))
  })

  it('closes a range with a mouse Shift+click from the last painted day in one save', async () => {
    stub()
    const replace = vi.spyOn(api, 'replaceAvailabilityRange')
      .mockResolvedValueOnce(created('2026-09-20', '2026-09-20'))
      .mockResolvedValue(created('2026-09-20', '2026-09-24'))
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)
    await idleCalendar()

    fireEvent.pointerDown(cell(/niedz 20-09-2026/), { button: 0 })
    fireEvent.pointerUp(window)
    fireEvent.click(cell(/niedz 20-09-2026/), { detail: 1 })
    expect(await screen.findByText('Zapisano: niedz 20 wrz „nie mogę”')).toBeInTheDocument()
    await idleCalendar()

    fireEvent.pointerDown(cell(/czw 24-09-2026/), { button: 0, shiftKey: true })
    expect(cell(/pon 21-09-2026/)).toHaveClass('avail-day-sel')
    fireEvent.pointerUp(window)
    fireEvent.click(cell(/czw 24-09-2026/), { detail: 1, shiftKey: true })
    expect(await screen.findByText('Zapisano: 20 – 24 wrz „nie mogę”')).toBeInTheDocument()
    expect(replace).toHaveBeenCalledTimes(2)
    expect(replace).toHaveBeenLastCalledWith({ kind: 'unavailable', starts_on: '2026-09-20', ends_on: '2026-09-24', note: undefined, undo_id: expect.any(String) })
  })

  it('saves paints one after another and keeps the elapsed part of a cut entry', async () => {
    stub()
    const list = vi.spyOn(api, 'availability').mockResolvedValue([
      { id: 'a1', kind: 'unavailable', starts_on: '2026-09-01', ends_on: '2026-09-25', note: null, created_at: '2026-08-20T10:00:00Z' },
    ])
    let finishFirst: (value: null) => void = () => {}
    const replace = vi.spyOn(api, 'replaceAvailabilityRange')
      .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve }))
      .mockResolvedValue(null)
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)
    await screen.findByRole('gridcell', { name: 'niedz 20-09-2026, Nie mogę' })

    fireEvent.click(screen.getByRole('button', { name: 'Wyczyść zaznaczenie' }))
    fireEvent.click(cell(/niedz 20-09-2026/))
    fireEvent.click(cell(/wt 22-09-2026/))

    expect(await screen.findByRole('gridcell', { name: 'wt 22-09-2026' })).toBeInTheDocument()
    expect(cell(/niedz 20-09-2026/)).toHaveAccessibleName('niedz 20-09-2026')
    expect(cell(/sob 05-09-2026/)).toHaveAccessibleName('sob 05-09-2026, Nie mogę')
    expect(replace).toHaveBeenCalledTimes(1)

    finishFirst(null)
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(2))
    expect(replace.mock.calls.map(([input]) => input.starts_on)).toEqual(['2026-09-20', '2026-09-22'])
    expect(await screen.findByText('Wyczyszczono: wt 22 wrz')).toBeInTheDocument()
    await waitFor(() => expect(list).toHaveBeenCalledTimes(3))
  })

  it('rolls a failed paint back without dropping the paint still waiting behind it', async () => {
    stub()
    vi.spyOn(api, 'availability')
      .mockResolvedValueOnce([
        { id: 'a1', kind: 'unavailable', starts_on: '2026-09-01', ends_on: '2026-09-25', note: null, created_at: '2026-08-20T10:00:00Z' },
      ])
      .mockRejectedValue(new ApiError('Brak połączenia', 503))
    const failures: Array<(error: Error) => void> = []
    vi.spyOn(api, 'replaceAvailabilityRange')
      .mockImplementation(() => new Promise((_resolve, reject) => { failures.push(reject) }))
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)
    await screen.findByRole('gridcell', { name: 'niedz 20-09-2026, Nie mogę' })

    fireEvent.click(screen.getByRole('button', { name: 'Wyczyść zaznaczenie' }))
    fireEvent.click(cell(/niedz 20-09-2026/))
    fireEvent.click(cell(/wt 22-09-2026/))
    expect(await screen.findByRole('gridcell', { name: 'wt 22-09-2026' })).toBeInTheDocument()

    failures[0](new ApiError('Nie zapisano', 503))
    expect(await screen.findByRole('gridcell', { name: 'niedz 20-09-2026, Nie mogę' })).toBeInTheDocument()
    expect(cell(/wt 22-09-2026/)).toHaveAccessibleName('wt 22-09-2026')

    await waitFor(() => expect(failures).toHaveLength(2))
    failures[1](new ApiError('Nie zapisano', 503))
    expect(await screen.findByRole('gridcell', { name: 'wt 22-09-2026, Nie mogę' })).toBeInTheDocument()
    expect(cell(/niedz 20-09-2026/)).toHaveAccessibleName('niedz 20-09-2026, Nie mogę')
  })

  it('keeps drawing a waiting paint after the screen is mounted again', async () => {
    stub()
    vi.spyOn(api, 'availability').mockResolvedValue([])
    let finish: (value: null) => void = () => {}
    vi.spyOn(api, 'replaceAvailabilityRange').mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    function Host() {
      const [mount, setMount] = useState(0)
      return (
        <>
          <button type="button" onClick={() => setMount(mount + 1)}>remount</button>
          <MineScreen key={mount} hasTeamMember displayName="Julia Nowak" />
        </>
      )
    }
    renderScreen(<Host />)
    await screen.findByRole('gridcell', { name: 'niedz 20-09-2026' })

    fireEvent.click(cell(/niedz 20-09-2026/))
    expect(await screen.findByRole('gridcell', { name: 'niedz 20-09-2026, Nie mogę' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'remount' }))
    expect(await screen.findByRole('gridcell', { name: 'niedz 20-09-2026, Nie mogę' })).toBeInTheDocument()

    finish(null)
    expect(await screen.findByRole('gridcell', { name: 'niedz 20-09-2026' })).toBeInTheDocument()
  })

  it('reports a failed save', async () => {
    stub()
    vi.spyOn(api, 'replaceAvailabilityRange').mockRejectedValue(new ApiError('Nie można zapisać dostępności', 409))
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)
    await idleCalendar()

    fireEvent.click(cell(/niedz 20-09-2026/))
    expect(await screen.findByText('Nie można zapisać dostępności')).toBeInTheDocument()
  })

  it('moves between months', async () => {
    stub()
    const calendarCall = vi.spyOn(api, 'calendar')
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)
    await screen.findByRole('grid', { name: 'Kalendarz dostępności, wrzesień 2026' })
    // The month is the calendar's heading, between its arrows.
    expect(screen.getByRole('heading', { level: 3, name: 'wrzesień 2026' })).toHaveClass('month-title')

    fireEvent.click(screen.getByRole('button', { name: 'Następny miesiąc' }))
    expect(await screen.findByRole('grid', { name: 'Kalendarz dostępności, październik 2026' })).toBeInTheDocument()
    await waitFor(() => expect(calendarCall).toHaveBeenCalledWith('2026-10-01', '2026-10-31'))
    fireEvent.click(screen.getByRole('button', { name: 'Poprzedni miesiąc' }))
    fireEvent.click(screen.getByRole('button', { name: 'Poprzedni miesiąc' }))
    expect(await screen.findByRole('grid', { name: 'Kalendarz dostępności, sierpień 2026' })).toBeInTheDocument()
  })

  it('keeps the month and the person in the URL, so a refresh shows the same calendar', async () => {
    stub()
    vi.spyOn(api, 'team').mockResolvedValue(TEAM)
    vi.spyOn(api, 'memberAvailability').mockResolvedValue([])
    const { router } = renderScreen(
      <MineScreen role="coordinator" hasTeamMember displayName="Adam Nowicki" />,
      { route: '/moje?miesiac=2026-11&osoba=m-beata' },
    )
    // The calendar is keyed by the person, so it settles once the team names her.
    expect(await screen.findByRole('heading', { name: 'Dostępność: Beata Lis' })).toBeInTheDocument()
    expect(await screen.findByRole('grid', { name: 'Kalendarz dostępności, listopad 2026' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Następny miesiąc' }))
    await waitFor(() => expect(router.state.location.search).toBe('?miesiac=2026-12&osoba=m-beata'))
    fireEvent.change(screen.getByRole('combobox', { name: 'Osoba' }), { target: { value: '' } })
    await waitFor(() => expect(router.state.location.search).toBe('?miesiac=2026-12'))
    expect(await screen.findByRole('heading', { name: 'Moja dostępność' })).toBeInTheDocument()
  })

  it('paints nobody while the person named by the URL waits for the team', async () => {
    stub()
    let resolveTeam: (team: typeof TEAM) => void = () => {}
    vi.spyOn(api, 'team').mockReturnValue(new Promise((resolve) => { resolveTeam = resolve }))
    const own = vi.spyOn(api, 'availability')
    vi.spyOn(api, 'memberAvailability').mockResolvedValue([])
    const replace = vi.spyOn(api, 'replaceAvailabilityRange').mockResolvedValue(null)
    const replaceMember = vi.spyOn(api, 'replaceMemberAvailabilityRange').mockResolvedValue(null)
    renderScreen(
      <MineScreen role="coordinator" hasTeamMember displayName="Adam Nowicki" />,
      { route: '/moje?miesiac=2026-09&osoba=m-beata' },
    )
    const grid = await screen.findByRole('grid', { name: 'Kalendarz dostępności, wrzesień 2026' })
    expect(grid).toHaveAttribute('aria-busy', 'true')
    fireEvent.click(screen.getByRole('gridcell', { name: /niedz 20-09-2026/ }))
    expect(own).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
    expect(replaceMember).not.toHaveBeenCalled()

    await act(async () => resolveTeam(TEAM))
    expect(await screen.findByRole('heading', { name: 'Dostępność: Beata Lis' })).toBeInTheDocument()
    await idleCalendar()
    expect(own).not.toHaveBeenCalled()
  })

  it('opens on the current month when the URL names no real one', async () => {
    stub()
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />, { route: '/moje?miesiac=2026-13' })
    expect(await screen.findByRole('grid', { name: 'Kalendarz dostępności, wrzesień 2026' })).toBeInTheDocument()
  })

  it('loads failed entries again on retry', async () => {
    stub()
    const list = vi.spyOn(api, 'availability')
      .mockRejectedValueOnce(new ApiError('Dostępność niedostępna', 503))
      .mockResolvedValue([{ id: 'a1', kind: 'prefer', starts_on: '2026-09-20', ends_on: '2026-09-20', note: null, created_at: '2026-09-01T10:00:00Z' }])
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)

    const alert = await screen.findByRole('alert')
    fireEvent.click(within(alert).getByRole('button', { name: 'Spróbuj ponownie' }))
    expect(await screen.findByRole('gridcell', { name: 'niedz 20-09-2026, Chętnie wezmę' })).toBeInTheDocument()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('shows failed entries, still lets a day be painted and reloads them after the save', async () => {
    stub()
    const list = vi.spyOn(api, 'availability')
      .mockRejectedValueOnce(new ApiError('Dostępność niedostępna', 503))
      .mockResolvedValue([])
    const replace = vi.spyOn(api, 'replaceAvailabilityRange').mockResolvedValue(created('2026-09-20', '2026-09-20'))
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Dostępność niedostępna')
    fireEvent.click(cell(/niedz 20-09-2026/))
    await waitFor(() => expect(replace).toHaveBeenCalledWith({ kind: 'unavailable', starts_on: '2026-09-20', ends_on: '2026-09-20', note: undefined, undo_id: expect.any(String) }))
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('clears another member\'s entry on their behalf and keeps its remainder', async () => {
    stub()
    vi.spyOn(api, 'team').mockResolvedValue(TEAM)
    vi.spyOn(api, 'memberAvailability').mockResolvedValue([{
      id: 'b1', kind: 'prefer_not', starts_on: '2026-09-20', ends_on: '2026-09-22', note: null, created_at: '2026-09-01T10:00:00Z', created_by_name: 'Adam Nowicki',
    }])
    const replace = vi.spyOn(api, 'replaceMemberAvailabilityRange').mockResolvedValue(null)
    renderScreen(<MineScreen role="coordinator" hasTeamMember displayName="Adam Nowicki" />)
    const picker = await screen.findByRole('combobox', { name: 'Osoba' })
    await screen.findByRole('option', { name: 'Beata Lis' })
    fireEvent.change(picker, { target: { value: 'm-beata' } })

    const day = await screen.findByRole('gridcell', { name: 'niedz 20-09-2026, Wolę nie, wpis: Adam Nowicki' })
    fireEvent.click(screen.getByRole('button', { name: 'Wyczyść zaznaczenie' }))
    fireEvent.click(day)
    await waitFor(() => expect(replace).toHaveBeenCalledWith('m-beata', {
      kind: null, note: undefined, starts_on: '2026-09-20', ends_on: '2026-09-20', undo_id: expect.any(String),
    }))
  })

  it('asks a coordinator outside the team list to pick a person', async () => {
    stub()
    vi.spyOn(api, 'team').mockResolvedValue(TEAM)
    renderScreen(<MineScreen role="coordinator" hasTeamMember displayName="Ewa Maj" />)

    expect(await screen.findByText('Twoje konto nie jest w rotacji - wskaż osobę, w imieniu której wpisujesz.')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Wskaż osobę' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Adam Nowicki' })).toBeInTheDocument()
  })
})

describe('MineScreen availability Undo', () => {
  const cell = (label: RegExp) => screen.getByRole('gridcell', { name: label })
  const echo = vi.fn(async (input: AvailabilityRangeInput) => (input.kind ? {
    id: `${input.starts_on}:${input.kind}`, kind: input.kind, starts_on: input.starts_on, ends_on: input.ends_on, note: input.note ?? null, created_at: '2026-09-10T10:00:00Z',
  } : null))

  it('undoes a paint in one request that names the save', async () => {
    stub()
    vi.spyOn(api, 'publicConfig').mockResolvedValue({
      ldap_enabled: false, sso_enabled: false, app_name: 'On-call', app_subtitle: '', version: 'dev',
      audit_retention_days: 365, login_audit_retention_days: 90, undo_window_seconds: 30,
    })
    const replace = vi.spyOn(api, 'replaceAvailabilityRange').mockImplementation(echo)
    const undo = vi.spyOn(api, 'undoAvailabilityRange').mockResolvedValue(undefined)
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)
    await idleCalendar()

    fireEvent.click(cell(/niedz 20-09-2026/))
    const toast = (await screen.findByText('Zapisano: niedz 20 wrz „nie mogę”')).closest('.toast') as HTMLElement
    fireEvent.click(within(toast).getByRole('button', { name: 'Cofnij' }))

    await waitFor(() => expect(undo).toHaveBeenCalledTimes(1))
    const [{ undo_id: undoId }] = replace.mock.calls[0]
    expect(undoId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(undo).toHaveBeenCalledWith(undoId)
    expect(replace).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByText('Zapisano: niedz 20 wrz „nie mogę”')).not.toBeInTheDocument())
  })

  it('draws back the part of every entry the paint cut into while the server restores it', async () => {
    stub()
    vi.spyOn(api, 'availability').mockResolvedValue([
      { id: 'a1', kind: 'prefer_not', starts_on: '2026-09-18', ends_on: '2026-09-22', note: 'szkolenie', created_at: '2026-08-20T10:00:00Z' },
      { id: 'a2', kind: 'prefer', starts_on: '2026-09-24', ends_on: '2026-09-27', note: null, created_at: '2026-08-20T10:00:00Z' },
    ])
    vi.spyOn(api, 'replaceAvailabilityRange').mockImplementation(echo)
    vi.spyOn(api, 'undoAvailabilityRange').mockReturnValue(new Promise(() => {}))
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)
    await screen.findByRole('gridcell', { name: /niedz 20-09-2026, Wolę nie/ })
    await idleCalendar()

    fireEvent.change(screen.getByLabelText('Powód do kolejnych wpisów'), { target: { value: 'urlop' } })
    fireEvent.pointerDown(cell(/pon 21-09-2026/), { button: 0 })
    fireEvent.pointerEnter(cell(/pt 25-09-2026/))
    fireEvent.pointerUp(window)
    const toast = (await screen.findByText('Zapisano: 21 – 25 wrz „nie mogę”')).closest('.toast') as HTMLElement
    expect(toast).toHaveTextContent('powód: urlop')
    fireEvent.click(within(toast).getByRole('button', { name: 'Cofnij' }))

    expect(await screen.findByRole('gridcell', { name: /pon 21-09-2026, Wolę nie/ })).toBeInTheDocument()
    expect(cell(/czw 24-09-2026/)).toHaveAccessibleName(expect.stringContaining('Chętnie wezmę'))
    expect(cell(/śr 23-09-2026/)).not.toHaveAccessibleName(expect.stringContaining('Nie mogę'))
  })

  it('runs a paint made during an Undo after that Undo', async () => {
    stub()
    let finishUndo: () => void = () => {}
    const undo = vi.spyOn(api, 'undoAvailabilityRange').mockImplementation(
      () => new Promise<void>((resolve) => { finishUndo = resolve }),
    )
    const replace = vi.spyOn(api, 'replaceAvailabilityRange').mockImplementation(echo)
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)
    await idleCalendar()

    fireEvent.click(cell(/pon 21-09-2026/))
    const toast = (await screen.findByText('Zapisano: pon 21 wrz „nie mogę”')).closest('.toast') as HTMLElement
    fireEvent.click(within(toast).getByRole('button', { name: 'Cofnij' }))
    await waitFor(() => expect(undo).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('radio', { name: 'chętnie' }))
    fireEvent.click(cell(/pon 21-09-2026/))
    expect(replace).toHaveBeenCalledTimes(1)
    finishUndo()

    expect(await screen.findByText('Zapisano: pon 21 wrz „chętnie”')).toBeInTheDocument()
    expect(replace.mock.calls.map(([input]) => input.kind)).toEqual(['unavailable', 'prefer'])
  })

  it('keeps Undo after a failed attempt and says what was not undone', async () => {
    stub()
    vi.spyOn(api, 'replaceAvailabilityRange').mockResolvedValue(null)
    const undo = vi.spyOn(api, 'undoAvailabilityRange')
      .mockRejectedValueOnce(new ApiError('Brak połączenia', 503))
      .mockResolvedValue(undefined)
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)
    await idleCalendar()

    fireEvent.click(screen.getByRole('button', { name: 'Wyczyść zaznaczenie' }))
    fireEvent.change(screen.getByLabelText('Powód do kolejnych wpisów'), { target: { value: 'urlop' } })
    fireEvent.click(cell(/niedz 20-09-2026/))
    const toast = (await screen.findByText('Wyczyszczono: niedz 20 wrz')).closest('.toast') as HTMLElement
    // Clearing writes no reason, so the toast names none.
    expect(toast).not.toHaveTextContent('powód')
    fireEvent.click(within(toast).getByRole('button', { name: 'Cofnij' }))

    expect(await screen.findByText('Nie cofnięto: niedz 20 wrz. Spróbuj ponownie.')).toBeInTheDocument()
    fireEvent.click(within(toast).getByRole('button', { name: 'Cofnij' }))
    await waitFor(() => expect(undo).toHaveBeenCalledTimes(2))
  })

  it('undoes a paint on behalf of another member through that member', async () => {
    stub()
    vi.spyOn(api, 'team').mockResolvedValue(TEAM)
    vi.spyOn(api, 'memberAvailability').mockResolvedValue([])
    const replace = vi.spyOn(api, 'replaceMemberAvailabilityRange').mockResolvedValue(null)
    const undo = vi.spyOn(api, 'undoMemberAvailabilityRange').mockResolvedValue(undefined)
    renderScreen(<MineScreen role="coordinator" hasTeamMember displayName="Adam Nowicki" />)
    const picker = await screen.findByRole('combobox', { name: 'Osoba' })
    await screen.findByRole('option', { name: 'Beata Lis' })
    fireEvent.change(picker, { target: { value: 'm-beata' } })
    await screen.findByRole('heading', { name: 'Dostępność: Beata Lis' })
    await idleCalendar()

    fireEvent.click(cell(/niedz 20-09-2026/))
    const toast = (await screen.findByText('Zapisano: niedz 20 wrz „nie mogę”')).closest('.toast') as HTMLElement
    fireEvent.click(within(toast).getByRole('button', { name: 'Cofnij' }))

    await waitFor(() => expect(undo).toHaveBeenCalledWith('m-beata', replace.mock.calls[0][1].undo_id))
  })

  it('points a coordinator to the schedule for a duty on a day filed as unavailable', async () => {
    stub()
    vi.spyOn(api, 'team').mockResolvedValue(TEAM)
    vi.spyOn(api, 'calendar').mockResolvedValue({ ...EMPTY_CALENDAR, assignments: [assignment('2026-09-20', 'primary', 'Beata Lis')] })
    vi.spyOn(api, 'memberAvailability').mockResolvedValue([
      { id: 'b1', kind: 'unavailable', starts_on: '2026-09-20', ends_on: '2026-09-20', note: null, created_at: '2026-08-20T10:00:00Z' },
    ])
    renderScreen(<MineScreen role="coordinator" hasTeamMember displayName="Adam Nowicki" />)
    const picker = await screen.findByRole('combobox', { name: 'Osoba' })
    await screen.findByRole('option', { name: 'Beata Lis' })
    fireEvent.change(picker, { target: { value: 'm-beata' } })

    const frame = (await screen.findByText('Beata Lis ma dyżur PRIMARY 20 wrz, a wpis to „nie mogę”')).closest('.box') as HTMLElement
    expect(frame).toHaveTextContent('Wpis nie zdejmuje dyżuru. Zmień obsadę tego dnia w grafiku.')
    expect(within(frame).getByRole('link', { name: 'Otwórz dzień · 20 wrz' })).toHaveAttribute('href', '/grafik?dzien=2026-09-20')
  })
})

describe('MineScreen availability on a phone', () => {
  const cell = (label: RegExp) => screen.getByRole('gridcell', { name: label })

  it('says the reason of the day a range starts on, which a phone cannot hover', async () => {
    pretendNarrow()
    stub()
    vi.spyOn(api, 'availability').mockResolvedValue([
      { id: 'a1', kind: 'prefer_not', starts_on: '2026-09-22', ends_on: '2026-09-23', note: 'szkolenie', created_at: '2026-08-20T10:00:00Z' },
    ])
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)
    await screen.findByRole('gridcell', { name: /wt 22-09-2026, Wolę nie/ })
    await idleCalendar()

    fireEvent.click(cell(/wt 22-09-2026/), { detail: 1 })
    const frame = screen.getByText('Zakres: od 22 wrz').closest('.box') as HTMLElement
    expect(frame).toHaveTextContent('Ten dzień: „wolę nie”, powód: szkolenie.')
    fireEvent.click(within(frame).getByRole('button', { name: 'Anuluj' }))
    fireEvent.click(cell(/czw 24-09-2026/), { detail: 1 })
    expect(screen.getByText('Zakres: od 24 wrz').closest('.box')).not.toHaveTextContent('powód')
  })

  it('starts a range with the first tap and saves it with the second', async () => {
    pretendNarrow()
    stub()
    const replace = vi.spyOn(api, 'replaceAvailabilityRange').mockResolvedValue(null)
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)
    await idleCalendar()
    expect(screen.getByText(/Dotknij pierwszego i ostatniego dnia zakresu/)).toBeInTheDocument()

    // A drag scrolls the page on a phone; it paints nothing.
    fireEvent.pointerDown(cell(/wt 22-09-2026/), { button: 0 })
    fireEvent.pointerUp(window)
    expect(replace).not.toHaveBeenCalled()

    fireEvent.click(cell(/wt 22-09-2026/), { detail: 1 })
    expect(cell(/wt 22-09-2026/)).toHaveClass('avail-day-sel', 'avail-day-na')
    const frame = screen.getByText('Zakres: od 22 wrz').closest('.box') as HTMLElement
    expect(frame).toHaveTextContent('Dotknij ostatni dzień, żeby zapisać „nie mogę” dla całego zakresu.')
    // A passed day never joins the range, even if the browser reports the pointer over it.
    fireEvent.pointerEnter(cell(/wt 08-09-2026/))
    expect(cell(/pt 18-09-2026/)).not.toHaveClass('avail-day-sel')
    fireEvent.pointerEnter(cell(/czw 24-09-2026/))
    expect(cell(/śr 23-09-2026/)).toHaveClass('avail-day-sel', 'avail-day-na')
    expect(replace).not.toHaveBeenCalled()

    fireEvent.click(cell(/pt 25-09-2026/), { detail: 1 })
    await waitFor(() => expect(replace).toHaveBeenCalledWith({ kind: 'unavailable', starts_on: '2026-09-22', ends_on: '2026-09-25', note: undefined, undo_id: expect.any(String) }))
    expect(replace).toHaveBeenCalledOnce()
    expect(screen.queryByText('Zakres: od 22 wrz')).not.toBeInTheDocument()
    expect(await screen.findByText('Zapisano: 22 – 25 wrz „nie mogę”')).toBeInTheDocument()
  })

  it('drops a started range when the person changes', async () => {
    pretendNarrow()
    stub()
    vi.spyOn(api, 'team').mockResolvedValue(TEAM)
    vi.spyOn(api, 'memberAvailability').mockResolvedValue([])
    const replace = vi.spyOn(api, 'replaceMemberAvailabilityRange').mockResolvedValue(null)
    renderScreen(<MineScreen role="coordinator" hasTeamMember displayName="Adam Nowicki" />)
    const picker = await screen.findByRole('combobox', { name: 'Osoba' })
    await screen.findByRole('option', { name: 'Beata Lis' })
    await idleCalendar()

    fireEvent.click(cell(/wt 22-09-2026/), { detail: 1 })
    expect(screen.getByText('Zakres: od 22 wrz')).toBeInTheDocument()
    fireEvent.change(picker, { target: { value: 'm-beata' } })
    await screen.findByRole('heading', { name: 'Dostępność: Beata Lis' })
    expect(screen.queryByText(/Zakres: od/)).not.toBeInTheDocument()
    await idleCalendar()

    fireEvent.click(cell(/pt 25-09-2026/), { detail: 1 })
    expect(screen.getByText('Zakres: od 25 wrz')).toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
  })

  it('drops a started range on Cancel and says a cleared range is cleared', async () => {
    pretendNarrow()
    stub()
    const replace = vi.spyOn(api, 'replaceAvailabilityRange').mockResolvedValue(null)
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)
    await idleCalendar()

    fireEvent.click(screen.getByRole('button', { name: 'Wyczyść zaznaczenie' }))
    fireEvent.click(cell(/wt 22-09-2026/), { detail: 1 })
    expect(screen.getByText('Dotknij ostatni dzień, żeby wyczyścić cały zakres.', { exact: false })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Anuluj' }))

    expect(screen.queryByText(/Zakres: od/)).not.toBeInTheDocument()
    expect(cell(/wt 22-09-2026/)).not.toHaveClass('avail-day-sel')
    expect(replace).not.toHaveBeenCalled()
  })
})

describe('MineScreen ICS states', () => {
  const FEED = { id: 'f1', label: 'telefon', created_at: '2026-09-01T10:00:00Z', last_used_at: '2026-09-05T08:00:00Z', revoked_at: null }

  async function openFeeds() {
    fireEvent.click(await screen.findByRole('button', { name: 'Subskrypcja ICS' }))
    return screen.findByRole('dialog', { name: 'Subskrypcja ICS' })
  }

  it('names a subscription without a label after the default and says when one was last used', async () => {
    stub()
    vi.spyOn(api, 'feeds').mockResolvedValue([FEED])
    const create = vi.spyOn(api, 'createFeed').mockResolvedValue({ id: 'f2', url: 'http://localhost/feeds/two.ics' })
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)
    const panel = await openFeeds()

    expect(await within(panel).findByText('utworzono 01-09-2026 · ostatnie użycie 05-09-2026')).toBeInTheDocument()
    fireEvent.change(within(panel).getByLabelText('Nazwa subskrypcji'), { target: { value: '   ' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Utwórz adres ICS' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith('Mój kalendarz'))
  })

  it('shows why a subscription could not be created', async () => {
    stub()
    vi.spyOn(api, 'createFeed').mockRejectedValue(new ApiError('Za dużo subskrypcji', 409))
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)
    const panel = await openFeeds()

    fireEvent.click(within(panel).getByRole('button', { name: 'Utwórz adres ICS' }))
    expect(await within(panel).findByRole('alert')).toHaveTextContent('Za dużo subskrypcji')
  })

  it('shows why a revocation failed in the confirmation and the panel', async () => {
    stub()
    vi.spyOn(api, 'feeds').mockResolvedValue([FEED])
    vi.spyOn(api, 'revokeFeed').mockRejectedValue(new ApiError('Subskrypcja już odwołana', 409))
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)
    const panel = await openFeeds()

    fireEvent.click(await within(panel).findByRole('button', { name: 'Odwołaj' }))
    const confirm = await screen.findByRole('dialog', { name: 'Odwołać subskrypcję ICS?' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Odwołaj subskrypcję' }))
    expect(await within(confirm).findByText('Subskrypcja już odwołana')).toBeInTheDocument()
    // The panel behind the modal confirmation keeps the error too, hidden from the tree while the confirmation is up.
    expect(within(panel).getByRole('alert', { hidden: true })).toHaveTextContent('Subskrypcja już odwołana')
  })
})
