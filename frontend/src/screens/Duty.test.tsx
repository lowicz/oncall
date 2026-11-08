import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { useLocation } from 'react-router-dom'
import { renderScreen } from '../test/render'
import { chooseFromMenu, openMenu } from '../test/menu'
import { DutyScreen } from './Duty'
import { api } from '../api'
import type { CalendarData, CurrentDuty, FairnessMember, FairnessReport, ForwardingNow, HandoverPair, PublishedSchedule, ShareSession, SwapRequest } from '../api'

// The suite clock is 2026-09-10 (src/test/setup.ts), a Thursday.
const TODAY = '2026-09-10'

/** Thursday's pair, Anna and Marek, as the API tells it to `you`: one of them or a coordinator. */
const pairFor = (you: 'primary' | 'secondary' | 'coordinator', marekHasPhone = true): HandoverPair => ({
  primary: { name: 'Anna Kowalska', is_you: you === 'primary', has_phone: true },
  secondary: { name: 'Marek Nowak', is_you: you === 'secondary', has_phone: marekHasPhone },
})

const publication = (over: Partial<PublishedSchedule> = {}): PublishedSchedule => ({
  generated_at: '2026-09-01T10:00:00Z',
  is_published: true,
  id: 's1',
  version: 7,
  starts_on: '2026-09-01',
  ends_on: '2026-10-03',
  assignments: [
    { service_date: '2026-09-12', role: 'secondary', assignee_name: 'Anna Kowalska', is_override: false },
    { service_date: '2026-09-24', role: 'primary', assignee_name: 'Anna Kowalska', is_override: false },
  ],
  current: [
    {
      role: 'primary', service_date: TODAY, assignee_name: 'Anna Kowalska', member_id: 'm1',
      contact_email: 'anna@example.com', contact_phone: '+48 601 220 118',
      coverage_starts_at: '19:00', coverage_ends_at: '09:00', is_day_off: false, is_override: false,
      next_assignee_name: 'Marek Nowak', next_service_date: '2026-09-11',
    },
  ],
  today_is_day_off: false,
  today_holiday_name: null,
  ...over,
})

const calendar = (startsOn: string, endsOn: string): CalendarData => ({
  starts_on: startsOn,
  ends_on: endsOn,
  days: [{ service_date: startsOn, weekday: 'czw', is_day_off: false, holiday_name: null, published: true, events: [] }],
  members: [{ id: 'm1', display_name: 'Anna Kowalska' }],
  team_has_members: true,
  assignments: [],
  availability: [],
})

const swap = (over: Partial<SwapRequest> & { id: string }): SwapRequest => ({
  schedule_id: 's1', service_date: '2026-09-28', role: 'primary', requester_name: 'Anna Kowalska',
  replacement_name: 'Marek Nowak', status: 'pending_coordinator', note: null, decision_note: null,
  created_at: '2026-09-01T10:00:00Z', ...over,
})

const balance = { actual: 0, expected: 0, deviation: 0 }
const anna: FairnessMember = {
  member_id: 'm1', display_name: 'Anna Kowalska', active_from: '2025-01-01', eligible_days: {},
  primary: balance, secondary: balance, late_shift: balance, weekends: balance, holidays: balance, total_points: 0,
}

const fairness = (met: boolean, members: FairnessMember[] = [anna]): FairnessReport => ({
  as_of: TODAY, window_start: '2025-09-10', window_end: TODAY, totals: {}, members,
  late_shift_balanced: true, criterion_points: 3, criterion_met: met, spreads: [], latest_publish_end: '2026-10-03',
})

function pretendNarrow(matches: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: query.includes('max-width: 900px') ? matches : false,
    media: query, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }))
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="url">{location.pathname}</output>
}

afterEach(() => vi.restoreAllMocks())

describe('DutyScreen header', () => {
  it('titles the screen with the date and names the publication under it', async () => {
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication())
    vi.spyOn(api, 'calendar').mockImplementation(async (a, b) => calendar(a, b))
    renderScreen(<DutyScreen role="viewer" displayName="Podgląd" hasTeamMember={false} />)

    expect(await screen.findByRole('heading', { level: 1, name: 'Czwartek, 10 września' })).toBeInTheDocument()
    expect(await screen.findByText(/Opublikowany grafik do 3 paź · wersja 7/)).toBeInTheDocument()
    expect(screen.getByText('tylko odczyt')).toBeInTheDocument()
    // The strip above the page carries the current duties; the desktop page
    // does not repeat them as cards.
    expect(screen.queryByRole('article', { name: 'PRIMARY' })).not.toBeInTheDocument()
  })

  it('gives the coordinator the generator as the primary action, a member the availability and ICS', async () => {
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication())
    vi.spyOn(api, 'calendar').mockImplementation(async (a, b) => calendar(a, b))
    vi.spyOn(api, 'swaps').mockResolvedValue([])
    vi.spyOn(api, 'fairness').mockResolvedValue(fairness(true))
    const { unmount } = renderScreen(<DutyScreen role="coordinator" displayName="Ewa Maj" hasTeamMember={false} />)
    const generate = await screen.findByRole('link', { name: /Generuj kolejny zakres/ })
    // The next range starts the day after the published one ends.
    expect(generate).toHaveAttribute('href', '/generator?od=2026-10-04&do=2026-10-31')
    expect(screen.queryByRole('link', { name: /Zgłoś dostępność/ })).not.toBeInTheDocument()
    unmount()

    renderScreen(<DutyScreen role="member" displayName="Anna Kowalska" hasTeamMember />)
    expect(await screen.findByRole('link', { name: /Zgłoś dostępność/ })).toHaveAttribute('href', '/moje#dostepnosc')
    expect(screen.queryByRole('link', { name: /Generuj kolejny zakres/ })).not.toBeInTheDocument()
    // The ICS export is no header action here; it waits in the matrix's "more" menu.
    expect(screen.queryByRole('link', { name: /Subskrypcja ICS/ })).not.toBeInTheDocument()
    const menu = await openMenu('Więcej')
    expect(within(menu).getByRole('menuitem', { name: 'Subskrypcja ICS' })).toHaveAttribute('href', '/moje#ics')
  })

  it('says when nothing is published', async () => {
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication({ is_published: false, id: null, version: null, ends_on: null, current: [], assignments: [] }))
    vi.spyOn(api, 'calendar').mockImplementation(async (a, b) => calendar(a, b))
    vi.spyOn(api, 'swaps').mockResolvedValue([])
    vi.spyOn(api, 'fairness').mockResolvedValue(fairness(true))
    renderScreen(<DutyScreen role="coordinator" displayName="Ewa Maj" hasTeamMember={false} />)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Grafik na ten okres nie został jeszcze opublikowany'))
    expect(screen.getByRole('link', { name: /Generuj kolejny zakres/ })).toHaveAttribute('href', '/generator')
  })
})

describe('DutyScreen subtitle and risk row', () => {
  it('names the swaps waiting for this person and the fairness verdict in the subtitle, not among the risks', async () => {
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication())
    vi.spyOn(api, 'calendar').mockImplementation(async (a, b) => calendar(a, b))
    vi.spyOn(api, 'swaps').mockResolvedValue([
      swap({ id: '1' }),
      swap({ id: '2', service_date: '2026-09-29' }),
      swap({ id: '3', status: 'approved' }),
    ])
    vi.spyOn(api, 'fairness').mockResolvedValue(fairness(false))
    renderScreen(<DutyScreen role="coordinator" displayName="Ewa Maj" hasTeamMember={false} />)

    expect(await screen.findByRole('link', { name: '2 zamiany czekają na Ciebie' })).toHaveAttribute('href', '/zamiany')
    expect(await screen.findByText(/· kryterium sprawiedliwości niespełnione$/)).toBeInTheDocument()
    const risks = await screen.findByRole('list', { name: 'Ryzyka w zakresie' })
    expect(within(risks).queryByText(/zamian|sprawiedliwości/)).not.toBeInTheDocument()
  })

  it('asks nothing of the fairness report for a member and shows no swap chip when nothing waits', async () => {
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication())
    vi.spyOn(api, 'calendar').mockImplementation(async (a, b) => calendar(a, b))
    vi.spyOn(api, 'swaps').mockResolvedValue([swap({ id: '1', status: 'pending_replacement', replacement_name: 'Ktoś inny' })])
    const fairnessCall = vi.spyOn(api, 'fairness').mockResolvedValue(fairness(true))
    renderScreen(<DutyScreen role="member" displayName="Anna Kowalska" hasTeamMember />)

    await screen.findByRole('heading', { level: 2, name: 'Najbliższe 4 tygodnie' })
    await waitFor(() => expect(api.swaps).toHaveBeenCalled())
    expect(screen.queryByRole('link', { name: /czeka na Ciebie/ })).not.toBeInTheDocument()
    expect(fairnessCall).not.toHaveBeenCalled()
  })
})

describe('DutyScreen schedule section', () => {
  it('shows four weeks from today under a ruled heading with the range', async () => {
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication())
    const calendarCall = vi.spyOn(api, 'calendar').mockImplementation(async (a, b) => calendar(a, b))
    renderScreen(<DutyScreen role="viewer" displayName="Podgląd" hasTeamMember={false} />)

    expect(await screen.findByRole('heading', { level: 2, name: 'Najbliższe 4 tygodnie' })).toBeInTheDocument()
    expect(screen.getByText('10 wrz – 7 paź')).toBeInTheDocument()
    await waitFor(() => expect(calendarCall).toHaveBeenCalledWith('2026-09-10', '2026-10-07'))
  })

  it('changes the zoom and steps by a week from the heading controls', async () => {
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication())
    const calendarCall = vi.spyOn(api, 'calendar').mockImplementation(async (a, b) => calendar(a, b))
    renderScreen(<DutyScreen role="viewer" displayName="Podgląd" hasTeamMember={false} />)
    await screen.findByRole('heading', { level: 2, name: 'Najbliższe 4 tygodnie' })

    fireEvent.click(screen.getByRole('radio', { name: '8 tyg.' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Najbliższe 8 tygodni' })).toBeInTheDocument()
    await waitFor(() => expect(calendarCall).toHaveBeenCalledWith('2026-09-10', '2026-11-04'))

    fireEvent.click(screen.getByRole('button', { name: 'Do przodu o tydzień' }))
    // Away from today the heading is the range itself.
    expect(await screen.findByRole('heading', { level: 2, name: '17 wrz – 11 lis' })).toBeInTheDocument()
    await waitFor(() => expect(calendarCall).toHaveBeenCalledWith('2026-09-17', '2026-11-11'))

    fireEvent.click(screen.getByRole('button', { name: 'dziś' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Najbliższe 8 tygodni' })).toBeInTheDocument()
  })

  it('keeps every step of quick clicks made before the window renders', async () => {
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication())
    vi.spyOn(api, 'calendar').mockImplementation(async (a, b) => calendar(a, b))
    const { router } = renderScreen(<DutyScreen role="viewer" displayName="Podgląd" hasTeamMember={false} />)
    await screen.findByRole('heading', { level: 2, name: 'Najbliższe 4 tygodnie' })

    // Three clicks in one task: none of them sees the window the one before it moved.
    act(() => {
      for (let step = 0; step < 3; step += 1) fireEvent.click(screen.getByRole('button', { name: 'Do przodu o tydzień' }))
    })
    expect(await screen.findByRole('heading', { level: 2, name: '1 – 28 paź' })).toBeInTheDocument()
    expect(router.state.location.search).toBe('?od=2026-10-01')
  })

  it('keeps the window, the zoom and the filter in the URL, so a refresh shows the same view', async () => {
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication())
    const calendarCall = vi.spyOn(api, 'calendar').mockImplementation(async (a, b) => calendar(a, b))
    const { router } = renderScreen(
      <DutyScreen role="viewer" displayName="Podgląd" hasTeamMember={false} />,
      { route: '/?od=2026-09-17&zoom=8&tylko=z-dyzurem' },
    )

    expect(await screen.findByRole('heading', { level: 2, name: '17 wrz – 11 lis' })).toBeInTheDocument()
    expect(calendarCall).toHaveBeenCalledWith('2026-09-17', '2026-11-11')
    expect(screen.getByRole('radio', { name: '8 tyg.' })).toHaveAttribute('aria-checked', 'true')
    const menu = await openMenu('Więcej')
    const filter = within(menu).getByRole('menuitemcheckbox', { name: 'Tylko z dyżurem' })
    expect(filter).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(filter)
    fireEvent.keyDown(menu, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('radio', { name: '2 tyg.' }))
    await waitFor(() => expect(router.state.location.search).toBe('?od=2026-09-17&zoom=2'))
    fireEvent.click(screen.getByRole('button', { name: 'Cofnij o tydzień' }))
    await waitFor(() => expect(router.state.location.search).toBe('?od=2026-09-10&zoom=2'))
    expect(await screen.findByRole('heading', { level: 2, name: 'Najbliższe 2 tygodnie' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'dziś' }))
    await waitFor(() => expect(router.state.location.search).toBe('?zoom=2'))
    await chooseFromMenu('Więcej', 'Tylko z dyżurem')
    await waitFor(() => expect(router.state.location.search).toBe('?zoom=2&tylko=z-dyzurem'))
  })

  it('keeps the matrix or list view in the URL, so a refresh, Back and Forward show it again', async () => {
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication())
    vi.spyOn(api, 'calendar').mockImplementation(async (a, b) => calendar(a, b))
    const { router } = renderScreen(
      <DutyScreen role="viewer" displayName="Podgląd" hasTeamMember={false} />,
      { route: '/?widok=lista' },
    )
    expect(await screen.findByRole('list', { name: 'Grafik dzień po dniu' })).toBeInTheDocument()
    const menu = await openMenu('Więcej')
    const toggle = within(menu).getByRole('menuitemcheckbox', { name: 'Lista dni' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(toggle)
    await waitFor(() => expect(router.state.location.search).toBe('?widok=macierz'))
    expect(await screen.findByRole('region', { name: 'Macierz grafiku' })).toBeInTheDocument()

    await act(() => router.navigate('/?widok=lista'))
    expect(await screen.findByRole('list', { name: 'Grafik dzień po dniu' })).toBeInTheDocument()
    await act(() => router.navigate(-1))
    expect(await screen.findByRole('region', { name: 'Macierz grafiku' })).toBeInTheDocument()
    await act(() => router.navigate(1))
    expect(await screen.findByRole('list', { name: 'Grafik dzień po dniu' })).toBeInTheDocument()
  })

  it('opens the legend from its link and switches to the day list', async () => {
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication())
    vi.spyOn(api, 'calendar').mockImplementation(async (a, b) => calendar(a, b))
    renderScreen(<DutyScreen role="member" displayName="Anna Kowalska" hasTeamMember />)
    await screen.findByRole('heading', { level: 2, name: 'Najbliższe 4 tygodnie' })

    await chooseFromMenu('Więcej', 'Legenda')
    const legend = await screen.findByRole('dialog', { name: 'Legenda' })
    expect(within(legend).getByText(/po zamianie/)).toBeInTheDocument()
    expect(within(legend).getByText('Nie mogę')).toBeInTheDocument()
    fireEvent.keyDown(legend, { key: 'Escape' })

    await chooseFromMenu('Więcej', 'Lista dni')
    expect(await screen.findByRole('list', { name: 'Grafik dzień po dniu' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Macierz grafiku' })).not.toBeInTheDocument()
  })
})

describe('DutyScreen on a phone', () => {
  it('carries the duties as cards with a call button and names the next own duty', async () => {
    pretendNarrow(true)
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication())
    vi.spyOn(api, 'calendar').mockImplementation(async (a, b) => calendar(a, b))
    vi.spyOn(api, 'swaps').mockResolvedValue([])
    renderScreen(<DutyScreen role="member" displayName="Anna Kowalska" hasTeamMember />)

    const primary = await screen.findByRole('article', { name: 'PRIMARY' })
    // The role is the same pill as everywhere else, not a stripe on the card's edge.
    expect(within(primary).getByText('PRIMARY')).toHaveClass('lbl', 'lbl-p')
    expect(within(primary).getByText('teraz')).toBeInTheDocument()
    expect(primary).toHaveClass('dcard')
    expect(within(screen.getByRole('article', { name: 'SECONDARY' })).getByText('SECONDARY')).toHaveClass('lbl', 'lbl-s')
    expect(within(primary).getByText('Anna Kowalska')).toBeInTheDocument()
    expect(within(primary).getByRole('link', { name: /Zadzwoń \+48 601 220 118/ })).toHaveAttribute('href', 'tel:+48601220118')
    expect(within(primary).getByRole('link', { name: 'SMS' })).toHaveAttribute('href', 'sms:+48601220118')
    expect(within(primary).getByText(/Następny PRIMARY:/)).toHaveTextContent('Marek Nowak, jutro')
    expect(screen.getByRole('article', { name: '11–19' })).toHaveTextContent('nikt nie odbierze tej roli')
    expect(screen.getByText(/Twój następny dyżur:/)).toHaveTextContent('sob 12 wrz · SECONDARY')
    // The phone reads the schedule as a list.
    expect(await screen.findByRole('list', { name: 'Grafik dzień po dniu' })).toBeInTheDocument()
  })

  it('opens the matrix the URL names instead of the day list a phone starts with', async () => {
    pretendNarrow(true)
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication())
    vi.spyOn(api, 'calendar').mockImplementation(async (a, b) => calendar(a, b))
    vi.spyOn(api, 'swaps').mockResolvedValue([])
    renderScreen(<DutyScreen role="member" displayName="Anna Kowalska" hasTeamMember />, { route: '/?widok=macierz' })
    expect(await screen.findByRole('region', { name: 'Macierz grafiku' })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Grafik dzień po dniu' })).not.toBeInTheDocument()
  })

  it('lets a viewer call and text the person on duty without their e-mail', async () => {
    pretendNarrow(true)
    const base = publication()
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication({
      current: base.current.map((item) => ({ ...item, contact_email: null })),
    }))
    vi.spyOn(api, 'calendar').mockImplementation(async (a, b) => calendar(a, b))
    renderScreen(<DutyScreen role="viewer" displayName="Service Desk" hasTeamMember={false} />)

    const primary = await screen.findByRole('article', { name: 'PRIMARY' })
    expect(within(primary).getByRole('link', { name: /Zadzwoń \+48 601 220 118/ })).toHaveAttribute('href', 'tel:+48601220118')
    expect(within(primary).getByRole('link', { name: 'SMS' })).toHaveAttribute('href', 'sms:+48601220118')
    expect(within(primary).queryByRole('link', { name: 'E-mail' })).not.toBeInTheDocument()
  })

  it('names every role of the next own duty day', async () => {
    pretendNarrow(true)
    const base = publication()
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication({
      assignments: [
        ...base.assignments,
        { service_date: '2026-09-12', role: 'late_shift', assignee_name: 'Anna Kowalska', is_override: false },
      ],
    }))
    vi.spyOn(api, 'calendar').mockImplementation(async (a, b) => calendar(a, b))
    vi.spyOn(api, 'swaps').mockResolvedValue([])
    renderScreen(<DutyScreen role="member" displayName="Anna Kowalska" hasTeamMember />)
    expect(await screen.findByText(/Twój następny dyżur:/)).toHaveTextContent('sob 12 wrz · SECONDARY + 11–19')
  })

  it('marks the 11–19 shift as not applicable on a day off', async () => {
    pretendNarrow(true)
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication({ today_is_day_off: true, today_holiday_name: null }))
    vi.spyOn(api, 'calendar').mockImplementation(async (a, b) => calendar(a, b))
    renderScreen(<DutyScreen role="viewer" displayName="Podgląd" hasTeamMember={false} />)
    expect(await screen.findByRole('article', { name: '11–19' })).toHaveTextContent('nie dotyczy: dzień wolny')
    expect(screen.getByText(/dziś dzień wolny, stawka 2X/)).toBeInTheDocument()
  })
})

describe('DutyScreen with nobody in the rotation', () => {
  const noTeam = (startsOn: string, endsOn: string): CalendarData => ({ ...calendar(startsOn, endsOn), members: [], team_has_members: false })
  const noneInRange = (startsOn: string, endsOn: string): CalendarData => ({ ...calendar(startsOn, endsOn), members: [], team_has_members: true })

  it('tells the admin to add people instead of an empty panel, with no controls and no fairness verdict', async () => {
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication({ is_published: false, id: null, version: null, ends_on: null, current: [], assignments: [] }))
    vi.spyOn(api, 'calendar').mockImplementation(async (a, b) => noTeam(a, b))
    vi.spyOn(api, 'swaps').mockResolvedValue([])
    vi.spyOn(api, 'fairness').mockResolvedValue(fairness(true, []))
    renderScreen(<DutyScreen role="admin" displayName="Administrator" hasTeamMember={false} />)

    expect(await screen.findByText('Nikt nie jest jeszcze w rotacji')).toBeInTheDocument()
    expect(screen.getByText('Dodaj osoby na ekranie Osoby.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Otwórz Osoby' })).toHaveAttribute('href', '/osoby')
    expect(screen.getByRole('heading', { level: 2, name: 'Najbliższe 4 tygodnie' })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: '4 tyg.' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Do przodu o tydzień' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Lista dni' })).not.toBeInTheDocument()
    await waitFor(() => expect(api.fairness).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /Kryterium sprawiedliwości/ })).not.toBeInTheDocument()
  })

  it('says so to everyone else, on a phone too, without a day list', async () => {
    pretendNarrow(true)
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication({ current: [], assignments: [] }))
    vi.spyOn(api, 'calendar').mockImplementation(async (a, b) => noTeam(a, b))
    renderScreen(<DutyScreen role="viewer" displayName="Podgląd" hasTeamMember={false} />)

    expect(await screen.findByText('Brak osób w rotacji')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Otwórz Osoby' })).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Grafik dzień po dniu' })).not.toBeInTheDocument()
  })

  it('when the team has members but none in the shown range, keeps the controls and does not tell the admin to add people', async () => {
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication({ current: [], assignments: [] }))
    vi.spyOn(api, 'calendar').mockImplementation(async (a, b) => noneInRange(a, b))
    vi.spyOn(api, 'swaps').mockResolvedValue([])
    vi.spyOn(api, 'fairness').mockResolvedValue(fairness(true, []))
    renderScreen(<DutyScreen role="admin" displayName="Administrator" hasTeamMember={false} />)

    expect(await screen.findByText('Nikt nie jest w rotacji w tym zakresie')).toBeInTheDocument()
    expect(screen.queryByText('Nikt nie jest jeszcze w rotacji')).not.toBeInTheDocument()
    expect(screen.queryByText('Dodaj osoby na ekranie Osoby.')).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '4 tyg.' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Do przodu o tydzień' })).toBeInTheDocument()
  })

  it('keeps the controls while the range is still loading', async () => {
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication())
    vi.spyOn(api, 'calendar').mockImplementation(() => new Promise(() => {}))
    renderScreen(<DutyScreen role="viewer" displayName="Podgląd" hasTeamMember={false} />)

    expect(await screen.findByLabelText('Wczytywanie grafiku…')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '4 tyg.' })).toBeInTheDocument()
    expect(screen.queryByText('Brak osób w rotacji')).not.toBeInTheDocument()
  })
})

describe('DutyScreen in a share-link session', () => {
  const link = (startsOn: string, endsOn: string): ShareSession => ({
    label: 'Dla serwisu', starts_on: startsOn, ends_on: endsOn, expires_at: '2026-09-30T12:00:00Z',
  })

  it('shows a short link whole, names it the link range and offers no zoom or arrows', async () => {
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication())
    const calendarCall = vi.spyOn(api, 'calendar').mockImplementation(async (a, b) => calendar(a, b))
    renderScreen(<DutyScreen role="viewer" displayName="Dla serwisu" hasTeamMember={false} share={link('2026-09-09', '2026-09-22')} />)

    expect(await screen.findByRole('heading', { level: 2, name: '9 – 22 wrz' })).toBeInTheDocument()
    expect(screen.getByText('zakres linku')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Najbliższe/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: '4 tyg.' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cofnij o tydzień' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Do przodu o tydzień' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'dziś' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Więcej' })).toBeInTheDocument()
    await waitFor(() => expect(calendarCall).toHaveBeenCalledWith('2026-09-09', '2026-09-22'))
    expect(calendarCall).toHaveBeenCalledTimes(1)
  })

  it('keeps a long link navigable but never lets the window leave it', async () => {
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication())
    const calendarCall = vi.spyOn(api, 'calendar').mockImplementation(async (a, b) => calendar(a, b))
    renderScreen(<DutyScreen role="viewer" displayName="Dla serwisu" hasTeamMember={false} share={link('2026-09-01', '2026-10-31')} />)

    expect(await screen.findByRole('heading', { level: 2, name: '10 wrz – 7 paź' })).toBeInTheDocument()
    await waitFor(() => expect(calendarCall).toHaveBeenCalledWith('2026-09-10', '2026-10-07'))

    // Back once is still inside the link; the second step stops on its first day.
    fireEvent.click(screen.getByRole('button', { name: 'Cofnij o tydzień' }))
    expect(await screen.findByRole('heading', { level: 2, name: '3 – 30 wrz' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cofnij o tydzień' }))
    expect(await screen.findByRole('heading', { level: 2, name: '1 – 28 wrz' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cofnij o tydzień' })).toBeDisabled()

    // Eight weeks from today would run past the link: the window ends on its last day.
    fireEvent.click(screen.getByRole('button', { name: 'dziś' }))
    fireEvent.click(screen.getByRole('radio', { name: '8 tyg.' }))
    expect(await screen.findByRole('heading', { level: 2, name: '6 wrz – 31 paź' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Do przodu o tydzień' })).toBeDisabled()
    // One step back moves from the window shown, not from where today would put it.
    fireEvent.click(screen.getByRole('button', { name: 'Cofnij o tydzień' }))
    expect(await screen.findByRole('heading', { level: 2, name: '1 wrz – 26 paź' })).toBeInTheDocument()

    for (const [startsOn, endsOn] of calendarCall.mock.calls) {
      expect(startsOn >= '2026-09-01' && endsOn <= '2026-10-31').toBe(true)
    }
  })
})

describe('DutyScreen states not covered above', () => {
  it('tells a member the coordinator has not published yet', async () => {
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication({ is_published: false, id: null, version: null, ends_on: null, current: [], assignments: [] }))
    vi.spyOn(api, 'calendar').mockImplementation(async (a, b) => calendar(a, b))
    vi.spyOn(api, 'swaps').mockResolvedValue([])
    renderScreen(<DutyScreen role="member" displayName="Anna Kowalska" hasTeamMember />)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Koordynator jeszcze nie opublikował grafiku na ten okres.'))
    expect(screen.getByText('Grafik na ten okres nie jest opublikowany')).toBeInTheDocument()
  })

  it('names today when a publication carries no end date', async () => {
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication({ ends_on: null }))
    vi.spyOn(api, 'calendar').mockImplementation(async (a, b) => calendar(a, b))
    vi.spyOn(api, 'swaps').mockResolvedValue([])
    vi.spyOn(api, 'fairness').mockResolvedValue(fairness(true))
    renderScreen(<DutyScreen role="coordinator" displayName="Ewa Maj" hasTeamMember={false} />)
    expect(await screen.findByText(/^Opublikowany grafik do 10 wrz · wersja 7/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Generuj kolejny zakres/ })).toHaveAttribute('href', '/generator')
  })

  it('opens the swaps from the subtitle', async () => {
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication())
    vi.spyOn(api, 'calendar').mockImplementation(async (a, b) => calendar(a, b))
    vi.spyOn(api, 'swaps').mockResolvedValue([swap({ id: '1' })])
    vi.spyOn(api, 'fairness').mockResolvedValue(fairness(true))
    renderScreen(<><DutyScreen role="coordinator" displayName="Ewa Maj" hasTeamMember={false} /><LocationProbe /></>)

    fireEvent.click(await screen.findByRole('link', { name: '1 zamiana czeka na Ciebie' }))
    expect(screen.getByTestId('url')).toHaveTextContent('/zamiany')
    expect(screen.getByText(/· kryterium sprawiedliwości spełnione$/)).toBeInTheDocument()
  })

  it('marks an override, a day-off duty and a holiday on the phone cards', async () => {
    pretendNarrow(true)
    const [primary] = publication().current
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication({
      today_is_day_off: true,
      today_holiday_name: 'Dzień Niepodległości',
      current: [
        { ...primary, is_override: true, is_day_off: true, contact_phone: null, contact_email: null, next_assignee_name: null, next_service_date: null },
        { ...primary, role: 'secondary', assignee_name: 'Marek Nowak', contact_phone: '+48 600 100 200', contact_email: null, is_day_off: true },
      ],
    }))
    vi.spyOn(api, 'calendar').mockImplementation(async (a, b) => calendar(a, b))
    renderScreen(<DutyScreen role="viewer" displayName="Podgląd" hasTeamMember={false} />)

    expect(await screen.findByText(/dziś święto: Dzień Niepodległości, stawka 2X/)).toBeInTheDocument()
    const primaryCard = await screen.findByRole('article', { name: 'PRIMARY' })
    expect(within(primaryCard).getByText('korekta')).toBeInTheDocument()
    // The day-off rate is a neutral tag; salmon belongs to the 11–19 role.
    expect(within(primaryCard).getByText('2X').className).toBe('tag')
    expect(within(primaryCard).getByText(/całą dobę/)).toBeInTheDocument()
    expect(within(primaryCard).queryByRole('link')).not.toBeInTheDocument()
    expect(within(primaryCard).queryByText(/Następny/)).not.toBeInTheDocument()

    const secondaryCard = screen.getByRole('article', { name: 'SECONDARY' })
    expect(within(secondaryCard).getByRole('link', { name: /Zadzwoń \+48 600 100 200/ })).toHaveAttribute('href', 'tel:+48600100200')
    expect(within(secondaryCard).queryByRole('link', { name: 'E-mail' })).not.toBeInTheDocument()

    expect(screen.getByRole('article', { name: '11–19' })).toHaveTextContent('nie dotyczy: święto - Dzień Niepodległości')
  })
})

describe('DutyScreen and the on-call number', () => {
  const marek: CurrentDuty = {
    role: 'secondary', service_date: TODAY, assignee_name: 'Marek Nowak', member_id: 'm2',
    contact_email: null, contact_phone: '+48 602 345 678',
    coverage_starts_at: '19:00', coverage_ends_at: '09:00', is_day_off: false, is_override: false,
    next_assignee_name: null, next_service_date: null,
  }
  const atAnna: ForwardingNow = {
    mode: 'live', day: TODAY, day_ends_at: '2026-09-11T09:00:00+02:00',
    holder_member_id: 'm1', holder_name: 'Anna Kowalska', holder_role: 'primary',
    handover: null, status: 'confirmed', confirmed_at: '2026-09-10T06:55:00Z', pair: null,
  }
  const atMarek: ForwardingNow = {
    ...atAnna, holder_member_id: 'm2', holder_name: 'Marek Nowak', holder_role: 'secondary',
    handover: {
      id: 'h1', day: TODAY, from_member_id: 'm1', from_name: 'Anna Kowalska', to_member_id: 'm2', to_name: 'Marek Nowak',
      starts_at: '2026-09-10T07:00:00Z', until: '2026-09-10T09:00:00Z', started_by_name: 'Anna Kowalska',
    },
  }

  function stub(now: ForwardingNow, withSecondary = true) {
    const base = publication()
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication({ current: withSecondary ? [...base.current, marek] : base.current }))
    vi.spyOn(api, 'calendar').mockImplementation(async (a, b) => calendar(a, b))
    vi.spyOn(api, 'swaps').mockResolvedValue([])
    vi.spyOn(api, 'fairness').mockResolvedValue(fairness(true))
    vi.spyOn(api, 'forwardingNow').mockResolvedValue(now)
  }

  it('tells the PRIMARY the number is with them and offers to hand it over', async () => {
    stub({ ...atAnna, pair: pairFor('primary') })
    renderScreen(<DutyScreen role="member" displayName="Anna Kowalska" hasTeamMember />)
    expect(await screen.findByRole('button', { name: 'numer on-call u Ciebie' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Przekaż numer…' })).not.toHaveClass('btn-pri')
  })

  it('names the holder to a coordinator, who may act for the pair', async () => {
    stub({ ...atAnna, pair: pairFor('coordinator') })
    renderScreen(<DutyScreen role="coordinator" displayName="Ewa Maj" hasTeamMember={false} />)
    expect(await screen.findByRole('button', { name: 'numer on-call: Anna Kowalska' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Przekaż numer…' })).toBeInTheDocument()
  })

  it('offers no action to anyone outside the pair, nor while the day has no pair', async () => {
    stub(atAnna)
    const { unmount } = renderScreen(<DutyScreen role="member" displayName="Ola Wiśniewska" hasTeamMember />)
    expect(await screen.findByRole('button', { name: 'numer on-call: Anna Kowalska' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /numer…/ })).not.toBeInTheDocument()
    unmount()

    stub(atAnna, false)
    renderScreen(<DutyScreen role="coordinator" displayName="Ewa Maj" hasTeamMember={false} />)
    expect(await screen.findByRole('button', { name: 'numer on-call: Anna Kowalska' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /numer…/ })).not.toBeInTheDocument()
  })

  it('shows neither the pill nor the action while forwarding is off', async () => {
    stub({ ...atAnna, day: null, day_ends_at: null, holder_member_id: null, holder_name: null, holder_role: null, status: null, confirmed_at: null, mode: 'off' })
    renderScreen(<DutyScreen role="member" displayName="Anna Kowalska" hasTeamMember />)
    await screen.findByRole('link', { name: /Zgłoś dostępność/ })
    await waitFor(() => expect(api.forwardingNow).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /numer on-call/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Przekaż numer/ })).not.toBeInTheDocument()
  })

  it('puts the number on the card of the SECONDARY holding it on a phone, with a way to give it back', async () => {
    pretendNarrow(true)
    stub({ ...atMarek, pair: pairFor('secondary') })
    renderScreen(<DutyScreen role="member" displayName="Marek Nowak" hasTeamMember />)
    const card = await screen.findByRole('article', { name: 'SECONDARY' })
    expect(await within(card).findByRole('button', { name: 'numer on-call u Ciebie · do 11:00' })).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Oddaj numer' })).toHaveClass('btn-sm')
    expect(within(screen.getByRole('article', { name: 'PRIMARY' })).queryByRole('button', { name: /numer on-call/ })).not.toBeInTheDocument()
  })

  it('tells anyone else on a phone, on the PRIMARY card, where the number rings', async () => {
    pretendNarrow(true)
    stub(atMarek)
    renderScreen(<DutyScreen role="viewer" displayName="Service Desk" hasTeamMember={false} />)
    const card = await screen.findByRole('article', { name: 'PRIMARY' })
    expect(await within(card).findByRole('button', { name: 'numer on-call: Marek Nowak · do 11:00' })).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: /numer$/ })).not.toBeInTheDocument()
  })
})

describe('DutyScreen and the on-call number before the reminder hour', () => {
  // 02:00 on Friday: the calendar day's pair is Jan and Ola, but the number
  // still belongs to Thursday's duty day, Anna's and Marek's.
  const NIGHT = new Date('2026-09-11T02:00:00+02:00')
  const friday = (role: 'primary' | 'secondary', name: string, memberId: string, phone: string): CurrentDuty => ({
    role, service_date: '2026-09-11', assignee_name: name, member_id: memberId,
    contact_email: null, contact_phone: phone,
    coverage_starts_at: '19:00', coverage_ends_at: '09:00', is_day_off: false, is_override: false,
    next_assignee_name: null, next_service_date: null,
  })
  const atAnna = (pair: HandoverPair | null): ForwardingNow => ({
    mode: 'live', day: TODAY, day_ends_at: '2026-09-11T09:00:00+02:00',
    holder_member_id: 'm1', holder_name: 'Anna Kowalska', holder_role: 'primary',
    handover: null, status: 'confirmed', confirmed_at: '2026-09-10T17:00:00Z', pair,
  })
  const atMarek = (pair: HandoverPair | null): ForwardingNow => ({
    ...atAnna(pair), holder_member_id: 'm2', holder_name: 'Marek Nowak', holder_role: 'secondary',
    handover: {
      id: 'h1', day: TODAY, from_member_id: 'm1', from_name: 'Anna Kowalska', to_member_id: 'm2', to_name: 'Marek Nowak',
      starts_at: '2026-09-10T23:00:00Z', until: '2026-09-11T05:00:00Z', started_by_name: null,
    },
  })

  const FRIDAY_PAIR = [
    friday('primary', 'Jan Wiśniewski', 'm3', '+48 603 456 789'),
    friday('secondary', 'Ola Wiśniewska', 'm4', '+48 604 567 890'),
  ]

  function stub(now: ForwardingNow, current = FRIDAY_PAIR) {
    vi.setSystemTime(NIGHT)
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication({ current }))
    vi.spyOn(api, 'calendar').mockImplementation(async (a, b) => calendar(a, b))
    vi.spyOn(api, 'swaps').mockResolvedValue([])
    vi.spyOn(api, 'fairness').mockResolvedValue(fairness(true))
    vi.spyOn(api, 'forwardingNow').mockResolvedValue(now)
  }

  it('lets the night holder hand the number to the duty day\'s SECONDARY', async () => {
    stub(atAnna(pairFor('primary')))
    renderScreen(<DutyScreen role="member" displayName="Anna Kowalska" hasTeamMember />)
    expect(await screen.findByRole('button', { name: 'numer on-call u Ciebie' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Przekaż numer…' }))
    const popover = await screen.findByRole('dialog', { name: 'Przekaż numer on-call' })
    expect(popover).toHaveTextContent('Odbierze Marek Nowak · SECONDARY')
    expect(popover).not.toHaveTextContent('Ola')
    expect(popover).toHaveTextContent('Numer wraca do Ciebie o 04:00.')
  })

  it('offers nothing to the calendar day\'s PRIMARY, whom the API does not tell the pair', async () => {
    stub(atAnna(null))
    renderScreen(<DutyScreen role="member" displayName="Jan Wiśniewski" hasTeamMember />)
    expect(await screen.findByRole('button', { name: 'numer on-call: Anna Kowalska' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /numer…/ })).not.toBeInTheDocument()
  })

  it('names the duty day\'s receiver to a coordinator, with no number the duty list does not show', async () => {
    stub(atAnna(pairFor('coordinator')))
    renderScreen(<DutyScreen role="coordinator" displayName="Ewa Maj" hasTeamMember={false} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Przekaż numer…' }))
    const popover = await screen.findByRole('dialog', { name: 'Przekaż numer on-call' })
    expect(popover).toHaveTextContent('Odbierze Marek Nowak · SECONDARY')
    expect(popover).toHaveTextContent('Numer wraca do osoby na PRIMARY (Anna Kowalska) o 04:00.')
    expect(within(popover).queryByRole('link')).not.toBeInTheDocument()
    expect(within(popover).getByRole('button', { name: 'Przekaż numer' })).not.toHaveAttribute('aria-disabled')
  })

  it('gives the end of a night handover to the duty day\'s pair and not to the calendar day\'s', async () => {
    stub(atMarek(pairFor('primary')))
    const anna = renderScreen(<DutyScreen role="member" displayName="Anna Kowalska" hasTeamMember />)
    expect(await screen.findByRole('button', { name: 'Zabierz numer z powrotem' })).toBeInTheDocument()
    anna.unmount()

    stub(atMarek(pairFor('secondary')))
    const marek = renderScreen(<DutyScreen role="member" displayName="Marek Nowak" hasTeamMember />)
    expect(await screen.findByRole('button', { name: 'Oddaj numer' })).toBeInTheDocument()
    marek.unmount()

    stub(atMarek(null))
    renderScreen(<DutyScreen role="member" displayName="Jan Wiśniewski" hasTeamMember />)
    expect(await screen.findByRole('button', { name: 'numer on-call: Marek Nowak · do 07:00' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Zabierz numer|Oddaj numer|Zakończ przekazanie/ })).not.toBeInTheDocument()
  })

  it('blocks the handover by the duty day\'s receiver having no phone, whatever the calendar day\'s has', async () => {
    stub(atAnna(pairFor('coordinator', false)))
    renderScreen(<DutyScreen role="coordinator" displayName="Ewa Maj" hasTeamMember={false} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Przekaż numer…' }))
    const popover = await screen.findByRole('dialog', { name: 'Przekaż numer on-call' })
    expect(popover).toHaveTextContent('Marek Nowak nie ma numeru telefonu w Moje. Poproś o jego uzupełnienie.')
    expect(within(popover).getByRole('button', { name: 'Przekaż numer' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('keeps the night holder\'s number row on a phone when the calendar day has no duties', async () => {
    pretendNarrow(true)
    stub(atAnna(pairFor('primary')), [])
    renderScreen(<DutyScreen role="member" displayName="Anna Kowalska" hasTeamMember />)
    const pill = await screen.findByRole('button', { name: 'numer on-call u Ciebie' })
    const hand = screen.getByRole('button', { name: 'Przekaż numer…' })
    expect(pill.closest('article')).toBeNull()
    expect(hand.closest('article')).toBeNull()
  })

  it('keeps the number row of a night SECONDARY off the card of the calendar day\'s SECONDARY on a phone', async () => {
    pretendNarrow(true)
    stub(atMarek(pairFor('secondary')))
    renderScreen(<DutyScreen role="member" displayName="Marek Nowak" hasTeamMember />)
    const giveBack = await screen.findByRole('button', { name: 'Oddaj numer' })
    const olaCard = screen.getByRole('article', { name: 'SECONDARY' })
    expect(olaCard).toHaveTextContent('Ola Wiśniewska')
    expect(olaCard).not.toContainElement(giveBack)
    expect(within(olaCard).queryByRole('button', { name: /numer on-call/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'numer on-call u Ciebie · do 07:00' }).closest('article')).toBeNull()
  })
})
