import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderScreen } from '../test/render'
import { MineScreen } from './Mine'
import { api } from '../api'
import type { FairnessReport, SwapRequest } from '../api'

afterEach(() => vi.restoreAllMocks())

const EMPTY_CALENDAR = {
  starts_on: '2026-09-01', ends_on: '2026-09-30', days: [], members: [], assignments: [], availability: [],
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
    const saturday = (await screen.findByText('so 19 wrz · PRIMARY')).closest('.list-row') as HTMLElement
    expect(within(saturday).getByText(/całodobowo · 2X · S Marek/)).toBeInTheDocument()
    expect(within(saturday).getByText(/koliduje z Twoją niedostępnością/)).toBeInTheDocument()
    expect(within(saturday).getByRole('link', { name: 'Zamień' })).toHaveAttribute('href', '/zamiany?data=2026-09-19&rola=primary')
    // Two roles on one day are one row, with both windows.
    const monday = screen.getByText('pn 21 wrz · SECONDARY + 11–19').closest('.list-row') as HTMLElement
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
    const incoming = (await screen.findByText('Piotr → Ty · so 3 paź PRIMARY')).closest('.list-row') as HTMLElement
    expect(within(incoming).getByText('prośba do Ciebie · odpowiedz')).toBeInTheDocument()
    expect(within(incoming).getByRole('link', { name: 'Zdecyduj' })).toHaveAttribute('href', '/zamiany?skrzynka=do-mnie')
    const outgoing = screen.getByText('Ty → Marek · pn 28 wrz PRIMARY').closest('.list-row') as HTMLElement
    expect(within(outgoing).getByText(/czeka na: Marek/)).toBeInTheDocument()
    // A swap between two other people is not mine.
    expect(screen.queryByText(/Ola/)).not.toBeInTheDocument()
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
    expect(await screen.findByText('Wyczyszczono: nd 20 wrz')).toBeInTheDocument()
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
    expect(await screen.findByText('Zapisano: nd 20 wrz „wolę nie”')).toBeInTheDocument()
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
