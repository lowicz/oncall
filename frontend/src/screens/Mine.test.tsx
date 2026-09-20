import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { renderScreen } from '../test/render'
import { MineScreen } from './Mine'
import { api } from '../api'

afterEach(() => vi.restoreAllMocks())

const EMPTY_CALENDAR = {
  starts_on: '2026-09-01', ends_on: '2026-09-30', days: [], members: [], assignments: [], availability: [],
}

const TEAM = [
  {
    id: 'm-adam',
    user_id: 'u-adam',
    display_name: 'Adam Nowicki',
    active_from: '2025-01-01',
    active_until: null,
    eligibility: [],
  },
  {
    id: 'm-beata',
    user_id: 'u-beata',
    display_name: 'Beata Lis',
    active_from: '2025-01-01',
    active_until: null,
    eligibility: [],
  },
]

// /moje is unreachable for accounts that are not rotation members, so the admin
// session used for manual testing never renders these panels.
describe('MineScreen', () => {
  it('shows upcoming duties with points, collision and a swap link', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue({
      starts_on: '2026-09-10', ends_on: '2026-11-08',
      days: [{ service_date: '2026-09-19', weekday: 'sob', is_day_off: true, holiday_name: null, published: true, events: [] }],
      members: [{ id: 'm1', display_name: 'Julia Nowak' }],
      assignments: [{ schedule_id: 's1', schedule_version: 1, service_date: '2026-09-19', role: 'primary', assignee_name: 'Julia Nowak', member_id: 'm1', is_override: false, change_kind: null }],
      availability: [{ member_id: 'm1', kind: 'unavailable', starts_on: '2026-09-19', ends_on: '2026-09-19', note: null }],
    })
    vi.spyOn(api, 'availability').mockResolvedValue([])
    vi.spyOn(api, 'feeds').mockResolvedValue([])
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)
    expect(await screen.findByText('sob 19-09-2026')).toBeInTheDocument()
    // Saturday: round-the-clock cover (coverage.py), not the old hardcoded 08:00-08:00.
    expect(screen.getByText(/PRIMARY · całodobowo · 2X/)).toBeInTheDocument()
    expect(screen.getByText(/koliduje z Twoją niedostępnością/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Poproś o zamianę' })).toHaveAttribute(
      'href', '/zamiany?data=2026-09-19&rola=primary',
    )
  })

  it('shows the real duty hours and role label on a working day', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue({
      starts_on: '2026-09-10', ends_on: '2026-11-08',
      days: [{ service_date: '2026-09-21', weekday: 'pon', is_day_off: false, holiday_name: null, published: true, events: [] }],
      members: [{ id: 'm1', display_name: 'Julia Nowak' }],
      assignments: [
        { schedule_id: 's1', schedule_version: 1, service_date: '2026-09-21', role: 'secondary', assignee_name: 'Julia Nowak', member_id: 'm1', is_override: false, change_kind: null },
        { schedule_id: 's1', schedule_version: 1, service_date: '2026-09-21', role: 'late_shift', assignee_name: 'Julia Nowak', member_id: 'm1', is_override: false, change_kind: null },
      ],
      availability: [],
    })
    vi.spyOn(api, 'availability').mockResolvedValue([])
    vi.spyOn(api, 'feeds').mockResolvedValue([])
    renderScreen(<MineScreen hasTeamMember displayName="Julia Nowak" />)
    expect(await screen.findAllByText('pon 21-09-2026')).toHaveLength(2)
    expect(screen.getByText(/SECONDARY · 19:00–09:00 · 1X/)).toBeInTheDocument()
    expect(screen.getByText(/11–19 · 11:00–19:00 · 1X/)).toBeInTheDocument()
    expect(screen.queryByText(/LATE_SHIFT/)).not.toBeInTheDocument()
  })
  it('renders both the availability and the ICS panel', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(EMPTY_CALENDAR)
    vi.spyOn(api, 'availability').mockResolvedValue([])
    vi.spyOn(api, 'feeds').mockResolvedValue([])
    renderScreen(<MineScreen />)
    expect(await screen.findByRole('heading', { name: 'Moja dostępność' })).toBeInTheDocument()
    expect(
      await screen.findByRole('heading', { name: 'Subskrypcja kalendarza (ICS)' }),
    ).toBeInTheDocument()
  })

  it('shows empty states rather than a bare list', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(EMPTY_CALENDAR)
    vi.spyOn(api, 'availability').mockResolvedValue([])
    vi.spyOn(api, 'feeds').mockResolvedValue([])
    renderScreen(<MineScreen />)
    expect(await screen.findByText('Nie masz jeszcze zgłoszonych terminów')).toBeInTheDocument()
    expect(await screen.findByText('Nie masz jeszcze subskrypcji')).toBeInTheDocument()
    // The empty state explains what the list is for, not just that it is empty.
    expect(screen.getByText(/Generator uwzględni je/)).toBeInTheDocument()
  })

  it('lists an existing availability entry with a delete control', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(EMPTY_CALENDAR)
    vi.spyOn(api, 'availability').mockResolvedValue([
      {
        id: 'a1',
        kind: 'unavailable',
        starts_on: '2026-09-20',
        ends_on: '2026-09-21',
        note: 'Wyjazd',
        created_at: '2026-09-01T10:00:00Z',
      },
    ])
    vi.spyOn(api, 'feeds').mockResolvedValue([])
    renderScreen(<MineScreen />)
    expect(await screen.findByText('Wyjazd')).toBeInTheDocument()
    expect(await screen.findByText('20-09-2026 – 21-09-2026')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Usuń wpis od 20-09-2026' })).toBeInTheDocument()
  })

  it('warns when a saved hard unavailability overlaps an existing duty', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(EMPTY_CALENDAR)
    vi.spyOn(api, 'availability').mockResolvedValue([])
    vi.spyOn(api, 'feeds').mockResolvedValue([])
    vi.spyOn(api, 'createAvailability').mockResolvedValue({
      id: 'a1',
      kind: 'unavailable',
      starts_on: '2026-09-20',
      ends_on: '2026-09-20',
      note: null,
      created_at: '2026-09-01T10:00:00Z',
      warning: 'Masz w tym czasie dyżur. Zgłoszenie go nie zdejmuje, poproś o zamianę albo skontaktuj się z koordynatorem.',
    })
    renderScreen(<MineScreen />)

    fireEvent.click(await screen.findByRole('button', { name: /^Zapisz/ }))

    expect(await screen.findByText(/Masz w tym czasie dyżur/)).toBeInTheDocument()
  })

  it('lets a coordinator file availability on behalf of another member', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(EMPTY_CALENDAR)
    vi.spyOn(api, 'team').mockResolvedValue(TEAM)
    vi.spyOn(api, 'availability').mockResolvedValue([])
    vi.spyOn(api, 'feeds').mockResolvedValue([])
    const onBehalf = vi.spyOn(api, 'memberAvailability').mockResolvedValue([])
    const create = vi.spyOn(api, 'createMemberAvailability').mockResolvedValue({
      id: 'x1',
      kind: 'unavailable',
      starts_on: '2026-09-20',
      ends_on: '2026-09-20',
      note: null,
      created_at: '2026-09-01T10:00:00Z',
      created_by_name: 'Adam Nowicki',
    })
    renderScreen(
      <MineScreen role="coordinator" hasTeamMember displayName="Adam Nowicki" />,
    )

    const picker = await screen.findByRole('combobox', { name: 'Osoba' })
    await screen.findByRole('option', { name: 'Beata Lis' })
    fireEvent.change(picker, { target: { value: 'm-beata' } })

    expect(await screen.findByText(/Wpisujesz w imieniu:/)).toHaveTextContent('Beata Lis')

    fireEvent.click(screen.getByRole('button', { name: /^Zapisz/ }))
    await vi.waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        'm-beata',
        expect.objectContaining({ kind: 'unavailable' }),
      ),
    )
    expect(onBehalf).toHaveBeenCalledWith('m-beata')
  })

  it('opens in on-behalf mode for an admin who is not in the rotation', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(EMPTY_CALENDAR)
    vi.spyOn(api, 'team').mockResolvedValue(TEAM)
    vi.spyOn(api, 'feeds').mockResolvedValue([])
    const self = vi.spyOn(api, 'availability').mockResolvedValue([])
    renderScreen(<MineScreen role="admin" hasTeamMember={false} displayName="Administrator" />)

    expect(await screen.findByText('Wybierz osobę')).toBeInTheDocument()
    // Never calls the owner-only endpoint that would 409 for this account.
    expect(self).not.toHaveBeenCalled()
  })
})
