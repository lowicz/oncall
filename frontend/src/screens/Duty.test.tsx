import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderScreen } from '../test/render'
import { DutyScreen } from './Duty'
import { api } from '../api'
import type { CalendarData, FairnessMember, FairnessReport, PublishedSchedule, ShareSession, SwapRequest } from '../api'

// The suite clock is 2026-09-10 (src/test/setup.ts), a Thursday.
const TODAY = '2026-09-10'

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
    expect(screen.getByRole('link', { name: /Eksport ICS/ })).toHaveAttribute('href', '/moje#ics')
    expect(screen.queryByRole('link', { name: /Generuj kolejny zakres/ })).not.toBeInTheDocument()
  })

  it('says when nothing is published', async () => {
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication({ is_published: false, id: null, version: null, ends_on: null, current: [], assignments: [] }))
    vi.spyOn(api, 'calendar').mockImplementation(async (a, b) => calendar(a, b))
    vi.spyOn(api, 'swaps').mockResolvedValue([])
    vi.spyOn(api, 'fairness').mockResolvedValue(fairness(true))
    renderScreen(<DutyScreen role="coordinator" displayName="Ewa Maj" hasTeamMember={false} />)
    expect(await screen.findByRole('status')).toHaveTextContent('Grafik na ten okres nie został jeszcze opublikowany')
    expect(screen.getByRole('link', { name: /Generuj kolejny zakres/ })).toHaveAttribute('href', '/generator')
  })
})

describe('DutyScreen risk row', () => {
  it('counts the swaps waiting for this person and reports the fairness verdict', async () => {
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication())
    vi.spyOn(api, 'calendar').mockImplementation(async (a, b) => calendar(a, b))
    vi.spyOn(api, 'swaps').mockResolvedValue([
      swap({ id: '1' }),
      swap({ id: '2', service_date: '2026-09-29' }),
      swap({ id: '3', status: 'approved' }),
    ])
    vi.spyOn(api, 'fairness').mockResolvedValue(fairness(false))
    renderScreen(<DutyScreen role="coordinator" displayName="Ewa Maj" hasTeamMember={false} />)

    const risks = await screen.findByRole('list', { name: 'Ryzyka w zakresie' })
    expect(await within(risks).findByRole('button', { name: /2 zamiany czekają na Ciebie/ })).toBeInTheDocument()
    expect(await within(risks).findByRole('button', { name: 'Kryterium sprawiedliwości niespełnione' })).toBeInTheDocument()
  })

  it('asks nothing of the fairness report for a member and shows no swap chip when nothing waits', async () => {
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication())
    vi.spyOn(api, 'calendar').mockImplementation(async (a, b) => calendar(a, b))
    vi.spyOn(api, 'swaps').mockResolvedValue([swap({ id: '1', status: 'pending_replacement', replacement_name: 'Ktoś inny' })])
    const fairnessCall = vi.spyOn(api, 'fairness').mockResolvedValue(fairness(true))
    renderScreen(<DutyScreen role="member" displayName="Anna Kowalska" hasTeamMember />)

    await screen.findByRole('heading', { level: 2, name: 'Najbliższe 4 tygodnie' })
    await waitFor(() => expect(api.swaps).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /czeka na Ciebie/ })).not.toBeInTheDocument()
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

  it('opens the legend from its link and switches to the day list', async () => {
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication())
    vi.spyOn(api, 'calendar').mockImplementation(async (a, b) => calendar(a, b))
    renderScreen(<DutyScreen role="member" displayName="Anna Kowalska" hasTeamMember />)
    await screen.findByRole('heading', { level: 2, name: 'Najbliższe 4 tygodnie' })

    fireEvent.click(screen.getByRole('button', { name: 'Legenda' }))
    const legend = await screen.findByRole('dialog', { name: 'Legenda' })
    expect(within(legend).getByText(/po zamianie/)).toBeInTheDocument()
    expect(within(legend).getByText('Nie mogę')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Lista dni' }))
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
    expect(within(primary).getByText('Anna Kowalska')).toBeInTheDocument()
    expect(within(primary).getByRole('link', { name: /Zadzwoń \+48 601 220 118/ })).toHaveAttribute('href', 'tel:+48601220118')
    expect(within(primary).getByRole('link', { name: 'SMS' })).toHaveAttribute('href', 'sms:+48601220118')
    expect(within(primary).getByText(/Następny PRIMARY:/)).toHaveTextContent('Marek Nowak, jutro')
    expect(screen.getByRole('article', { name: '11–19' })).toHaveTextContent('nikt nie odbierze tej roli')
    expect(screen.getByText(/Twój następny dyżur:/)).toHaveTextContent('so 12 wrz · SECONDARY')
    // The phone reads the schedule as a list.
    expect(await screen.findByRole('list', { name: 'Grafik dzień po dniu' })).toBeInTheDocument()
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
    expect(await screen.findByText(/Twój następny dyżur:/)).toHaveTextContent('so 12 wrz · SECONDARY + 11–19')
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
  const noTeam = (startsOn: string, endsOn: string): CalendarData => ({ ...calendar(startsOn, endsOn), members: [] })

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

  it('keeps the controls while the range is still loading', async () => {
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication())
    vi.spyOn(api, 'calendar').mockImplementation(() => new Promise(() => {}))
    renderScreen(<DutyScreen role="viewer" displayName="Podgląd" hasTeamMember={false} />)

    expect(await screen.findByLabelText('Wczytywanie grafiku')).toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: 'Lista dni' })).toBeInTheDocument()
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
