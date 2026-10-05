import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { focusManager } from '@tanstack/react-query'
import { renderScreen } from '../test/render'
import { MineScreen } from './Mine'
import { api, ApiError } from '../api'
import type { CalendarData, FairnessReport, SwapRequest } from '../api'

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

/** Every query the screen makes, so a test only overrides what it is about. */
function stub() {
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
    expect(within(saturday).getByText(/całodobowo · 2X · S Marek/)).toBeInTheDocument()
    expect(within(saturday).getByText(/koliduje z Twoją niedostępnością/)).toBeInTheDocument()
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
    expect(screen.getByText(/Próg ostrzeżenia to ±2,0 pkt/)).toBeInTheDocument()
    const table = await screen.findByRole('table', { name: 'Punkty miesiąc po miesiącu' })
    expect(within(table).getByText('wrzesień')).toBeInTheDocument()
    expect(within(table).getByText('sierpień')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ten miesiąc' }))
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
  })
})

describe('MineScreen availability calendar', () => {
  const cell = (label: RegExp) => screen.getByRole('gridcell', { name: label })

  it('paints an entry on the calendar and clears it around the painted day', async () => {
    stub()
    vi.spyOn(api, 'availability').mockResolvedValue([{
      id: 'a1', kind: 'unavailable', starts_on: '2026-09-20', ends_on: '2026-09-21', note: 'Wyjazd', created_at: '2026-09-01T10:00:00Z',
    }])
    const remove = vi.spyOn(api, 'deleteAvailability').mockResolvedValue(undefined)
    const create = vi.spyOn(api, 'createAvailability').mockResolvedValue({
      id: 'a2', kind: 'unavailable', starts_on: '2026-09-21', ends_on: '2026-09-21', note: 'Wyjazd', created_at: '2026-09-01T10:00:00Z',
    })
    renderScreen(<MineScreen displayName="Julia Nowak" />)
    await screen.findByRole('gridcell', { name: /niedz 20-09-2026, Nie mogę, powód: Wyjazd/ })

    fireEvent.click(screen.getByRole('radio', { name: 'wyczyść' }))
    fireEvent.click(cell(/niedz 20-09-2026/))

    await waitFor(() => expect(remove).toHaveBeenCalledWith('a1'))
    // The day after stays declared: the entry is re-created around the cleared day.
    await waitFor(() => expect(create).toHaveBeenCalledWith({ kind: 'unavailable', note: 'Wyjazd', starts_on: '2026-09-21', ends_on: '2026-09-21' }))
    expect(await screen.findByText('Wyczyszczono: niedz 20 wrz')).toBeInTheDocument()
  })

  it('saves a click at once with the brush kind and the optional reason', async () => {
    stub()
    const create = vi.spyOn(api, 'createAvailability').mockResolvedValue({
      id: 'a1', kind: 'prefer_not', starts_on: '2026-09-20', ends_on: '2026-09-20', note: 'szkolenie', created_at: '2026-09-01T10:00:00Z',
    })
    renderScreen(<MineScreen displayName="Julia Nowak" />)
    await screen.findByRole('grid', { name: /Kalendarz dostępności/ })

    fireEvent.click(screen.getByRole('radio', { name: 'wolę nie' }))
    fireEvent.change(screen.getByLabelText('Powód'), { target: { value: 'szkolenie' } })
    fireEvent.click(cell(/niedz 20-09-2026/))

    await waitFor(() => expect(create).toHaveBeenCalledWith({ kind: 'prefer_not', starts_on: '2026-09-20', ends_on: '2026-09-20', note: 'szkolenie' }))
    expect(await screen.findByText('Zapisano: niedz 20 wrz „wolę nie”')).toBeInTheDocument()
  })

  it('cannot paint a day that has passed', async () => {
    stub()
    renderScreen(<MineScreen displayName="Julia Nowak" />)
    await screen.findByRole('grid', { name: /Kalendarz dostępności/ })
    expect(cell(/wt 01-09-2026/)).toBeDisabled()
    expect(cell(/czw 10-09-2026/)).toBeEnabled()
  })

  it('warns when a saved hard unavailability overlaps an existing duty', async () => {
    stub()
    vi.spyOn(api, 'createAvailability').mockResolvedValue({
      id: 'a1', kind: 'unavailable', starts_on: '2026-09-20', ends_on: '2026-09-20', note: null, created_at: '2026-09-01T10:00:00Z',
      warning: 'Masz w tym czasie dyżur. Zgłoszenie go nie zdejmuje, poproś o zamianę albo skontaktuj się z koordynatorem.',
    })
    renderScreen(<MineScreen displayName="Julia Nowak" />)
    await screen.findByRole('grid', { name: /Kalendarz dostępności/ })

    fireEvent.click(cell(/niedz 20-09-2026/))

    expect(await screen.findByText(/Masz w tym czasie dyżur/)).toBeInTheDocument()
  })

  it('lets a coordinator file availability on behalf of another member', async () => {
    stub()
    vi.spyOn(api, 'team').mockResolvedValue(TEAM)
    const onBehalf = vi.spyOn(api, 'memberAvailability').mockResolvedValue([])
    const create = vi.spyOn(api, 'createMemberAvailability').mockResolvedValue({
      id: 'x1', kind: 'unavailable', starts_on: '2026-09-20', ends_on: '2026-09-20', note: null, created_at: '2026-09-01T10:00:00Z', created_by_name: 'Adam Nowicki',
    })
    renderScreen(<MineScreen role="coordinator" hasTeamMember displayName="Adam Nowicki" />)

    const picker = await screen.findByRole('combobox', { name: 'Osoba' })
    await screen.findByRole('option', { name: 'Beata Lis' })
    fireEvent.change(picker, { target: { value: 'm-beata' } })

    expect(await screen.findByText(/Wpisujesz w imieniu:/)).toHaveTextContent('Beata Lis')
    expect(screen.getByRole('heading', { name: 'Dostępność: Beata Lis' })).toBeInTheDocument()

    fireEvent.click(cell(/niedz 20-09-2026/))
    await vi.waitFor(() => expect(create).toHaveBeenCalledWith('m-beata', expect.objectContaining({ kind: 'unavailable' })))
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
    expect(await screen.findByRole('heading', { name: 'Subskrypcja kalendarza (ICS)' })).toBeInTheDocument()
    expect(await screen.findByText('Nie masz jeszcze subskrypcji')).toBeInTheDocument()
  })

  it('closes the subscriptions panel with its close button', async () => {
    stub()
    renderScreen(<MineScreen displayName="Julia Nowak" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Eksport ICS (tylko moje)' }))
    const panel = await screen.findByRole('dialog', { name: 'Subskrypcja kalendarza (ICS)' })

    fireEvent.click(within(panel).getByRole('button', { name: 'Zamknij panel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('creates a subscription and shows the one-time address', async () => {
    stub()
    vi.spyOn(api, 'createFeed').mockResolvedValue({ id: 'f1', url: 'http://localhost:8080/api/v1/calendar/feeds/secret.ics' })
    renderScreen(<MineScreen displayName="Julia Nowak" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Eksport ICS (tylko moje)' }))
    const panel = await screen.findByRole('dialog', { name: 'Subskrypcja kalendarza (ICS)' })
    fireEvent.change(within(panel).getByLabelText('Nazwa subskrypcji'), { target: { value: 'telefon' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Utwórz adres ICS' }))
    expect(await within(panel).findByText(/secret\.ics/)).toBeInTheDocument()
    expect(api.createFeed).toHaveBeenCalledWith('telefon')
  })

  const FEED = { id: 'f1', label: 'telefon', created_at: '2026-09-01T10:00:00Z', last_used_at: null, revoked_at: null }

  const openRevocation = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Eksport ICS (tylko moje)' }))
    const panel = await screen.findByRole('dialog', { name: 'Subskrypcja kalendarza (ICS)' })
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
    expect(within(today).getByText(/^trwa · całodobowo · 2X · S Marek, 11–19 Ola · Święto zakładowe/)).toBeInTheDocument()
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
})

describe('MineScreen points states', () => {
  it.each([
    ['above the share', 3, '+3,0', 'Generator da Ci mniej dyżurów w kolejnym zakresie.'],
    ['below the share', -3, '−3,0', 'Generator da Ci więcej dyżurów w kolejnym zakresie.'],
  ])('tells a member %s outside the norm what the generator will do', async (_, deviation, big, plan) => {
    stub()
    vi.spyOn(api, 'fairness').mockResolvedValue({ ...REPORT, members: [{ ...REPORT.members[0], primary: balance(4, deviation) }] })
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)

    expect(await screen.findByText(big, { selector: '.big' })).toBeInTheDocument()
    expect(screen.getByText('Poza normą')).toBeInTheDocument()
    expect(screen.getByText(plan, { exact: false })).toBeInTheDocument()
  })

  it('prints an even balance without a sign', async () => {
    stub()
    vi.spyOn(api, 'fairness').mockResolvedValue({ ...REPORT, members: [{ ...REPORT.members[0], primary: balance(4, 0) }] })
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)
    expect(await screen.findByText('0,0', { selector: '.big' })).toBeInTheDocument()
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

    fireEvent.click(screen.getByRole('button', { name: 'Ten miesiąc' }))
    expect(within(table).getByText('Brak dyżurów w tym okresie.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '12 mies.' }))
    expect(screen.getByRole('button', { name: '12 mies.' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(table).getByText('sierpień')).toBeInTheDocument()
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
    const create = vi.spyOn(api, 'createAvailability').mockResolvedValue(created('2026-09-22', '2026-09-25'))
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)
    await screen.findByRole('gridcell', { name: /śr 23-09-2026, dyżur: PRIMARY$/ })

    // Dragged from the later day back to the earlier one.
    fireEvent.pointerDown(cell(/pt 25-09-2026/), { button: 0 })
    fireEvent.pointerEnter(cell(/wt 22-09-2026/))
    expect(cell(/pon 21-09-2026/)).not.toHaveClass('avail-day-sel')
    expect(cell(/wt 22-09-2026/)).toHaveClass('avail-day-sel', 'avail-day-na')
    expect(cell(/wt 22-09-2026/)).toHaveTextContent('N')
    const duty = cell(/śr 23-09-2026/)
    expect(duty).toHaveClass('avail-day-conflict')
    expect(duty).toHaveAccessibleName('śr 23-09-2026, dyżur: PRIMARY, kolizja z dyżurem')

    fireEvent.pointerUp(window)
    await waitFor(() => expect(create).toHaveBeenCalledWith({ kind: 'unavailable', starts_on: '2026-09-22', ends_on: '2026-09-25', note: undefined }))
    expect(await screen.findByText('Zapisano: 22 – 25 wrz „nie mogę”')).toBeInTheDocument()
  })

  it('previews a cleared range without a colour', async () => {
    stub()
    const create = vi.spyOn(api, 'createAvailability')
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)
    await screen.findByRole('grid', { name: /Kalendarz dostępności/ })

    fireEvent.click(screen.getByRole('radio', { name: 'wyczyść' }))
    fireEvent.pointerDown(cell(/wt 22-09-2026/), { button: 0 })
    fireEvent.pointerEnter(cell(/śr 23-09-2026/))
    expect(cell(/śr 23-09-2026/)).toHaveClass('avail-day-sel')
    expect(cell(/śr 23-09-2026/)).not.toHaveClass('avail-day-na')
    expect(cell(/śr 23-09-2026/)).toHaveTextContent(/^23$/)

    fireEvent.pointerUp(window)
    expect(await screen.findByText('Wyczyszczono: 22 – 23 wrz')).toBeInTheDocument()
    expect(create).not.toHaveBeenCalled()
  })

  it('drops a drag that the browser cancels and ignores other buttons and stray hovers', async () => {
    stub()
    const create = vi.spyOn(api, 'createAvailability')
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)
    await screen.findByRole('grid', { name: /Kalendarz dostępności/ })

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
    expect(create).not.toHaveBeenCalled()
  })

  it('closes a range with Shift from the last painted day', async () => {
    stub()
    const create = vi.spyOn(api, 'createAvailability')
      .mockResolvedValueOnce(created('2026-09-20', '2026-09-20'))
      .mockResolvedValue(created('2026-09-20', '2026-09-24'))
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)
    await screen.findByRole('grid', { name: /Kalendarz dostępności/ })

    fireEvent.click(cell(/niedz 20-09-2026/))
    expect(await screen.findByText('Zapisano: niedz 20 wrz „nie mogę”')).toBeInTheDocument()
    await waitFor(() => expect(cell(/czw 24-09-2026/)).toBeEnabled())
    fireEvent.click(cell(/czw 24-09-2026/), { shiftKey: true })
    await waitFor(() => expect(create).toHaveBeenLastCalledWith({ kind: 'unavailable', starts_on: '2026-09-20', ends_on: '2026-09-24', note: undefined }))
  })

  it('reports a failed save', async () => {
    stub()
    vi.spyOn(api, 'createAvailability').mockRejectedValue(new ApiError('Nie można zapisać dostępności', 409))
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)
    await screen.findByRole('grid', { name: /Kalendarz dostępności/ })

    fireEvent.click(cell(/niedz 20-09-2026/))
    expect(await screen.findByText('Nie można zapisać dostępności')).toBeInTheDocument()
  })

  it('moves between months', async () => {
    stub()
    const calendarCall = vi.spyOn(api, 'calendar')
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)
    await screen.findByRole('grid', { name: 'Kalendarz dostępności, wrzesień 2026' })

    fireEvent.click(screen.getByRole('button', { name: 'Następny miesiąc' }))
    expect(await screen.findByRole('grid', { name: 'Kalendarz dostępności, październik 2026' })).toBeInTheDocument()
    await waitFor(() => expect(calendarCall).toHaveBeenCalledWith('2026-10-01', '2026-10-31'))
    fireEvent.click(screen.getByRole('button', { name: 'Poprzedni miesiąc' }))
    fireEvent.click(screen.getByRole('button', { name: 'Poprzedni miesiąc' }))
    expect(await screen.findByRole('grid', { name: 'Kalendarz dostępności, sierpień 2026' })).toBeInTheDocument()
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
    const create = vi.spyOn(api, 'createAvailability').mockResolvedValue(created('2026-09-20', '2026-09-20'))
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Dostępność niedostępna')
    fireEvent.click(cell(/niedz 20-09-2026/))
    await waitFor(() => expect(create).toHaveBeenCalledWith({ kind: 'unavailable', starts_on: '2026-09-20', ends_on: '2026-09-20', note: undefined }))
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })

  it('clears another member\'s entry on their behalf and keeps its remainder', async () => {
    stub()
    vi.spyOn(api, 'team').mockResolvedValue(TEAM)
    vi.spyOn(api, 'memberAvailability').mockResolvedValue([{
      id: 'b1', kind: 'prefer_not', starts_on: '2026-09-20', ends_on: '2026-09-22', note: null, created_at: '2026-09-01T10:00:00Z', created_by_name: 'Adam Nowicki',
    }])
    const remove = vi.spyOn(api, 'deleteMemberAvailability').mockResolvedValue(undefined)
    const create = vi.spyOn(api, 'createMemberAvailability').mockResolvedValue({
      id: 'b2', kind: 'prefer_not', starts_on: '2026-09-21', ends_on: '2026-09-22', note: null, created_at: '2026-09-01T10:00:00Z',
    })
    renderScreen(<MineScreen role="coordinator" hasTeamMember displayName="Adam Nowicki" />)
    const picker = await screen.findByRole('combobox', { name: 'Osoba' })
    await screen.findByRole('option', { name: 'Beata Lis' })
    fireEvent.change(picker, { target: { value: 'm-beata' } })

    const day = await screen.findByRole('gridcell', { name: 'niedz 20-09-2026, Wolę nie, wpis: Adam Nowicki' })
    fireEvent.click(screen.getByRole('radio', { name: 'wyczyść' }))
    fireEvent.click(day)
    await waitFor(() => expect(remove).toHaveBeenCalledWith('m-beata', 'b1'))
    await waitFor(() => expect(create).toHaveBeenCalledWith('m-beata', { kind: 'prefer_not', note: undefined, starts_on: '2026-09-21', ends_on: '2026-09-22' }))
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

describe('MineScreen ICS states', () => {
  const FEED = { id: 'f1', label: 'telefon', created_at: '2026-09-01T10:00:00Z', last_used_at: '2026-09-05T08:00:00Z', revoked_at: null }

  async function openFeeds() {
    fireEvent.click(await screen.findByRole('button', { name: 'Eksport ICS (tylko moje)' }))
    return screen.findByRole('dialog', { name: 'Subskrypcja kalendarza (ICS)' })
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
