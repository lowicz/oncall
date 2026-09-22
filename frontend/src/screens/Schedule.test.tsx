import { afterEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes, useLocation } from 'react-router-dom'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderScreen } from '../test/render'
import { ScheduleScreen } from './Schedule'
import { api } from '../api'
import type { CalendarData, PublishedSchedule, ScheduleSummary } from '../api'

// The suite clock is 2026-09-10 (src/test/setup.ts).

const publication = (over: Partial<PublishedSchedule> = {}): PublishedSchedule => ({
  generated_at: '2026-09-01T10:00:00Z',
  is_published: true,
  id: 's1',
  version: 7,
  starts_on: '2026-09-14',
  ends_on: '2026-10-03',
  assignments: [],
  current: [],
  today_is_day_off: false,
  today_holiday_name: null,
  ...over,
})

const calendar = (startsOn: string, endsOn: string): CalendarData => ({
  starts_on: startsOn,
  ends_on: endsOn,
  days: [{ service_date: startsOn, weekday: 'czw', is_day_off: false, holiday_name: null, published: true, events: [] }],
  members: [
    { id: 'm1', display_name: 'Anna Kowalska' },
    { id: 'm2', display_name: 'Marek Nowak' },
    { id: 'm3', display_name: 'Ola Wiśniewska' },
    { id: 'm4', display_name: 'Piotr Zieliński' },
  ],
  assignments: [],
  availability: [],
})

const proposal: ScheduleSummary = {
  id: 'd8', name: 'Szkic', starts_on: '2026-10-04', ends_on: '2026-10-31', status: 'proposed', version: 8,
  rotation_mode: 'hybrid', solver_status: 'OPTIMAL', assignment_count: 84, created_at: '2026-09-09T09:12:00Z',
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="url">{location.pathname}{location.search}</output>
}

function renderSchedule(route: string, props: Partial<Parameters<typeof ScheduleScreen>[0]> = {}) {
  return renderScreen(
    <Routes>
      <Route path="/grafik" element={<><ScheduleScreen role="coordinator" displayName="Ewa Maj" {...props} /><LocationProbe /></>} />
    </Routes>,
    { route },
  )
}

afterEach(() => vi.restoreAllMocks())

describe('ScheduleScreen header', () => {
  it('is titled "Grafik" and names the publication and the waiting proposal', async () => {
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication())
    vi.spyOn(api, 'calendar').mockImplementation(async (a, b) => calendar(a, b))
    vi.spyOn(api, 'draftSchedules').mockResolvedValue([proposal])
    renderSchedule('/grafik')

    expect(await screen.findByRole('heading', { level: 1, name: 'Grafik' })).toBeInTheDocument()
    expect(await screen.findByText(/Opublikowany 14 wrz – 3 paź \(wersja 7\) · propozycja 4 – 31 paź czeka na publikację/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Otwórz propozycję/ })).toHaveAttribute('href', '/generator?szkic=d8')
  })

  it('offers the next range when no proposal waits, and no coordinator actions to a member', async () => {
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication())
    vi.spyOn(api, 'calendar').mockImplementation(async (a, b) => calendar(a, b))
    const drafts = vi.spyOn(api, 'draftSchedules').mockResolvedValue([])
    const { unmount } = renderSchedule('/grafik')
    expect(await screen.findByRole('link', { name: /Generuj kolejny zakres/ })).toHaveAttribute('href', '/generator?od=2026-10-04&do=2026-10-31')
    unmount()

    renderSchedule('/grafik', { role: 'member', hasTeamMember: true })
    expect(await screen.findByRole('link', { name: /Eksport ICS/ })).toHaveAttribute('href', '/moje#ics')
    expect(screen.queryByRole('link', { name: /Generuj kolejny zakres/ })).not.toBeInTheDocument()
    // A member's screen never asks for the drafts.
    expect(drafts).toHaveBeenCalledTimes(1)
  })
})

describe('ScheduleScreen range in the URL', () => {
  it('names the range and the rotation in the section heading, without a risk row', async () => {
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication())
    vi.spyOn(api, 'calendar').mockImplementation(async (a, b) => calendar(a, b))
    vi.spyOn(api, 'draftSchedules').mockResolvedValue([])
    renderSchedule('/grafik?od=2026-09-14&zoom=8')

    expect(await screen.findByRole('heading', { level: 2, name: '14 wrz – 8 lis' })).toBeInTheDocument()
    expect(await screen.findByText('8 tygodni · 4 osoby w rotacji')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '8 tyg.' })).toBeChecked()
    await waitFor(() => expect(api.calendar).toHaveBeenCalledWith('2026-09-14', '2026-11-08'))
    expect(screen.queryByRole('list', { name: 'Ryzyka w zakresie' })).not.toBeInTheDocument()
  })

  it('writes the start and the zoom to the address when the controls change', async () => {
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication())
    vi.spyOn(api, 'calendar').mockImplementation(async (a, b) => calendar(a, b))
    vi.spyOn(api, 'draftSchedules').mockResolvedValue([])
    renderSchedule('/grafik')
    await screen.findByRole('heading', { level: 2, name: '10 wrz – 3 paź' })

    fireEvent.click(screen.getByRole('radio', { name: '2 tyg.' }))
    expect(await screen.findByRole('heading', { level: 2, name: '10 – 23 wrz' })).toBeInTheDocument()
    expect(screen.getByTestId('url')).toHaveTextContent('/grafik?od=2026-09-10&zoom=2')

    fireEvent.click(screen.getByRole('button', { name: 'Cofnij o tydzień' }))
    expect(await screen.findByRole('heading', { level: 2, name: '3 – 16 wrz' })).toBeInTheDocument()
    expect(screen.getByTestId('url')).toHaveTextContent('/grafik?od=2026-09-03&zoom=2')

    fireEvent.click(screen.getByRole('button', { name: 'dziś' }))
    expect(await screen.findByRole('heading', { level: 2, name: '10 – 23 wrz' })).toBeInTheDocument()
    expect(screen.getByTestId('url')).toHaveTextContent('/grafik?od=2026-09-10&zoom=2')
  })

  it('still honours an older link with od and do', async () => {
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication())
    const calendarCall = vi.spyOn(api, 'calendar').mockImplementation(async (a, b) => calendar(a, b))
    vi.spyOn(api, 'draftSchedules').mockResolvedValue([])
    renderSchedule('/grafik?od=2026-09-01&do=2026-09-21')

    expect(await screen.findByRole('heading', { level: 2, name: '1 – 21 wrz' })).toBeInTheDocument()
    await waitFor(() => expect(calendarCall).toHaveBeenCalledWith('2026-09-01', '2026-09-21'))
    expect(screen.getByRole('radio', { name: '4 tyg.' })).toBeChecked()
  })

  it.each([
    ['a start', '/grafik?od=2026-13-45'],
    ['a focused day', '/grafik?dzien=2026-13-45'],
  ])('falls back to today on %s that looks like a date but does not exist', async (_, route) => {
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication())
    const calendarCall = vi.spyOn(api, 'calendar').mockImplementation(async (a, b) => calendar(a, b))
    vi.spyOn(api, 'draftSchedules').mockResolvedValue([])
    renderSchedule(route)

    expect(await screen.findByRole('heading', { level: 2, name: '10 wrz – 3 paź' })).toBeInTheDocument()
    await waitFor(() => expect(calendarCall).toHaveBeenCalledWith('2026-09-10', '2026-10-03'))
  })

  it('ignores an end that does not exist and keeps the start', async () => {
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication())
    const calendarCall = vi.spyOn(api, 'calendar').mockImplementation(async (a, b) => calendar(a, b))
    vi.spyOn(api, 'draftSchedules').mockResolvedValue([])
    renderSchedule('/grafik?od=2026-09-01&do=2026-13-45')

    expect(await screen.findByRole('heading', { level: 2, name: '1 – 28 wrz' })).toBeInTheDocument()
    await waitFor(() => expect(calendarCall).toHaveBeenCalledWith('2026-09-01', '2026-09-28'))
  })

  it('opens the legend from its link and toggles the day list', async () => {
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication())
    vi.spyOn(api, 'calendar').mockImplementation(async (a, b) => calendar(a, b))
    vi.spyOn(api, 'draftSchedules').mockResolvedValue([])
    renderSchedule('/grafik')
    await screen.findByRole('region', { name: 'Macierz grafiku' })

    fireEvent.click(screen.getByRole('button', { name: 'Legenda' }))
    const legend = await screen.findByRole('dialog', { name: 'Legenda' })
    expect(within(legend).getByText(/po korekcie koordynatora/)).toBeInTheDocument()

    const toggle = screen.getByRole('button', { name: 'Lista dni' })
    fireEvent.click(toggle)
    const list = await screen.findByRole('list', { name: 'Grafik dzień po dniu' })
    // The list is grouped by ISO week, each heading naming its Monday-Sunday span.
    expect(within(list).getByText('Tydzień 37 · 7 – 13 wrz')).toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(toggle)
    expect(await screen.findByRole('region', { name: 'Macierz grafiku' })).toBeInTheDocument()
  })
})
