import { afterEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderScreen } from '../test/render'
import { AppShell } from './AppShell'
import { MoreScreen } from '../screens/More'
import { api } from '../api'
import type { ShareSession, SwapRequest } from '../api'
import { Access } from '../lib/nav'

const swap = (over: Partial<SwapRequest> & { id: string }): SwapRequest => ({
  schedule_id: 's1',
  service_date: '2026-09-14',
  role: 'primary',
  requester_name: 'Anna Kowalska',
  replacement_name: 'Piotr Zieliński',
  status: 'pending_replacement',
  note: null,
  decision_note: null,
  created_at: '2026-09-01T10:00:00Z',
  ...over,
})

function renderShell(
  access: Access,
  displayName = 'Piotr Zieliński',
  share: ShareSession | null = null,
) {
  vi.spyOn(api, 'publishedSchedule').mockResolvedValue({
    generated_at: '2026-09-01T10:00:00Z',
    is_published: true,
    id: 's1',
    version: 1,
    starts_on: '2026-09-01',
    ends_on: '2026-09-30',
    assignments: [],
    current: [],
    today_is_day_off: false,
    today_holiday_name: null,
  })
  return renderScreen(
    <Routes>
      <Route element={<AppShell displayName={displayName} access={access} share={share} />}>
        <Route path="*" element={<div>treść</div>} />
      </Route>
    </Routes>,
  )
}

/** jsdom has no layout; the shell reads the viewport through matchMedia. */
function pretendNarrow(matches: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: query.includes('max-width: 900px') ? matches : false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }))
}

afterEach(() => vi.restoreAllMocks())

describe('AppShell navigation', () => {
  it('hides entries the role cannot reach', async () => {
    vi.spyOn(api, 'swaps').mockResolvedValue([])
    renderShell({ role: 'viewer', hasTeamMember: false })
    expect(await screen.findByRole('link', { name: /Teraz/ })).toBeInTheDocument()
    // A viewer must not see navigation to unavailable features.
    expect(screen.queryByRole('link', { name: /Zamiany/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Generator/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Osoby/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Administracja')).not.toBeInTheDocument()
  })

  it('gives a coordinator the coordination section but not the administration one', async () => {
    vi.spyOn(api, 'swaps').mockResolvedValue([])
    renderShell({ role: 'coordinator', hasTeamMember: false })
    expect(await screen.findByRole('link', { name: /Generator/ })).toBeInTheDocument()
    expect(screen.getByText('Koordynacja')).toBeInTheDocument()
    expect(screen.queryByText('Administracja')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Osoby/ })).not.toBeInTheDocument()
    // "Moje" is also where a coordinator files availability on behalf of a
    // member who cannot reach the system.
    expect(screen.getByRole('link', { name: /^Moje/ })).toBeInTheDocument()
  })

  it('gives an admin the administration section', async () => {
    vi.spyOn(api, 'swaps').mockResolvedValue([])
    renderShell({ role: 'admin', hasTeamMember: false })
    expect(await screen.findByRole('link', { name: /Osoby/ })).toBeInTheDocument()
    expect(screen.getByText('Administracja')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Audyt/ })).toBeInTheDocument()
  })

  it('does not query swaps for a viewer', async () => {
    const swaps = vi.spyOn(api, 'swaps').mockResolvedValue([])
    renderShell({ role: 'viewer', hasTeamMember: false })
    await screen.findByRole('link', { name: /Teraz/ })
    expect(swaps).not.toHaveBeenCalled()
  })

  it('names the viewer link and its range in a banner, with no rail', async () => {
    vi.spyOn(api, 'swaps').mockResolvedValue([])
    renderShell({ role: 'viewer', hasTeamMember: false }, 'Odbiorca', {
      label: 'Audyt',
      starts_on: '2026-09-05',
      ends_on: '2026-10-02',
      expires_at: '2026-10-03T00:00:00Z',
    })

    expect(await screen.findByText(/zakres 05-09-2026 – 02-10-2026/)).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Główna nawigacja' })).not.toBeInTheDocument()
  })

  it('badges the swaps entry with the count awaiting this person', async () => {
    vi.spyOn(api, 'swaps').mockResolvedValue([
      swap({ id: '1', replacement_name: 'Piotr Zieliński' }),
      swap({ id: '2', replacement_name: 'Piotr Zieliński' }),
      swap({ id: '3', replacement_name: 'Ktoś inny' }),
      swap({ id: '4', status: 'approved' }),
    ])
    renderShell({ role: 'member', hasTeamMember: true })
    const link = await screen.findByRole('link', { name: /Zamiany/ })
    await waitFor(() => expect(link.querySelector('.nav-cnt')?.textContent).toBe('2'))
  })

  it('shows no count when nothing awaits a decision', async () => {
    vi.spyOn(api, 'swaps').mockResolvedValue([swap({ id: '1', status: 'approved' })])
    renderShell({ role: 'member', hasTeamMember: true })
    const link = await screen.findByRole('link', { name: /Zamiany/ })
    await waitFor(() => expect(api.swaps).toHaveBeenCalled())
    expect(link.querySelector('.nav-cnt')).not.toBeInTheDocument()
  })
})

describe('AppShell documentation entrypoint', () => {
  it('links to the rendered documentation from the rail', async () => {
    vi.spyOn(api, 'swaps').mockResolvedValue([])
    renderShell({ role: 'viewer', hasTeamMember: false })
    const link = await screen.findByRole('link', { name: 'Dokumentacja' })
    // A real anchor, not a router NavLink: /docs/ is static HTML served by the
    // same nginx, and the router would bounce an unknown path to the dashboard.
    expect(link).toHaveAttribute('href', '/docs/')
  })

  it('offers it to every role, including one with no administration section', async () => {
    vi.spyOn(api, 'swaps').mockResolvedValue([])
    renderShell({ role: 'member', hasTeamMember: true })
    expect(await screen.findByRole('link', { name: 'Dokumentacja' })).toBeInTheDocument()
  })
})

describe('AppShell on a phone', () => {
  it('replaces the rail with bottom tabs and a „Więcej” screen', async () => {
    pretendNarrow(true)
    vi.spyOn(api, 'swaps').mockResolvedValue([])
    renderShell({ role: 'viewer', hasTeamMember: false })
    const tabs = await screen.findByRole('navigation', { name: 'Nawigacja dolna' })
    expect(tabs).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Główna nawigacja' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Więcej/ })).toHaveAttribute('href', '/wiecej')
  })

  it('renders no bottom tabs on a desktop', async () => {
    pretendNarrow(false)
    vi.spyOn(api, 'swaps').mockResolvedValue([])
    renderShell({ role: 'viewer', hasTeamMember: false })
    await screen.findByRole('navigation', { name: 'Główna nawigacja' })
    expect(screen.queryByRole('navigation', { name: 'Nawigacja dolna' })).not.toBeInTheDocument()
  })
})

describe('MoreScreen identity', () => {
  it('names the logged-in person and the role, and repeats the documentation link', async () => {
    renderScreen(<MoreScreen displayName="Ola Zielińska" access={{ role: 'coordinator', hasTeamMember: true }} />)
    expect(await screen.findByRole('heading', { name: /Ola Zielińska/ })).toBeInTheDocument()
    expect(screen.getByText('Koordynator')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Dokumentacja/ })).toHaveAttribute('href', '/docs/')
    // Screens the four tabs do not hold are listed here.
    expect(screen.getByRole('link', { name: /Generator/ })).toHaveAttribute('href', '/generator')
  })

  it('does not repeat the role when the display name already reads as the role (QA7-L16)', async () => {
    renderScreen(<MoreScreen displayName="Administrator" access={{ role: 'admin', hasTeamMember: false }} />)
    expect(await screen.findAllByText('Administrator')).toHaveLength(1)
  })
})

describe('AppShell account menu', () => {
  const openMenu = async () => {
    const trigger = await screen.findByRole('button', { name: /^Konto: / })
    fireEvent.click(trigger)
    return screen.findByRole('menu')
  }

  it('opens on the avatar with the theme, the density and the way out', async () => {
    vi.spyOn(api, 'swaps').mockResolvedValue([])
    renderShell({ role: 'admin', hasTeamMember: false }, 'Administrator')
    const menu = await openMenu()
    // The regression: Base UI threw on the group labels and React unmounted
    // the whole application, leaving a blank page after this click.
    expect(within(menu).getByText('Motyw')).toBeInTheDocument()
    expect(within(menu).getByRole('menuitemradio', { name: 'Ciemny' })).toHaveAttribute('aria-checked', 'true')
    expect(within(menu).getByRole('menuitemradio', { name: 'Zwarta' })).toHaveAttribute('aria-checked', 'false')
    expect(within(menu).getByRole('menuitem', { name: /Wyloguj/ })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Główna nawigacja' })).toBeInTheDocument()
  })

  it('switches the theme without closing the menu', async () => {
    vi.spyOn(api, 'swaps').mockResolvedValue([])
    renderShell({ role: 'member', hasTeamMember: true })
    const menu = await openMenu()
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Jasny' }))
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('light'))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(within(screen.getByRole('menu')).getByRole('menuitemradio', { name: 'Jasny' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitemradio', { name: 'Zwarta' }))
    await waitFor(() => expect(document.documentElement.getAttribute('data-density')).toBe('compact'))
  })

  it('logs out from the menu', async () => {
    vi.spyOn(api, 'swaps').mockResolvedValue([])
    const logout = vi.spyOn(api, 'logout').mockImplementation(() => new Promise(() => {}))
    renderShell({ role: 'member', hasTeamMember: true })
    const menu = await openMenu()
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Wyloguj/ }))
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1))
  })

  it('reaches the same menu from the phone top bar', async () => {
    pretendNarrow(true)
    vi.spyOn(api, 'swaps').mockResolvedValue([])
    renderShell({ role: 'member', hasTeamMember: true })
    // No "Teraz" strip on a phone: the dashboard carries the duties as cards.
    await screen.findByRole('navigation', { name: 'Nawigacja dolna' })
    expect(screen.queryByRole('region', { name: 'Dyżur teraz' })).not.toBeInTheDocument()
    expect(screen.getByRole('banner')).toHaveTextContent('Teraz')
    const menu = await openMenu()
    expect(within(menu).getByRole('menuitem', { name: /Wyloguj/ })).toBeInTheDocument()
  })
})

describe('AppShell error boundary', () => {
  function Broken(): never {
    throw new Error('kaboom')
  }

  it('keeps the rail and names the error when a screen throws', async () => {
    vi.spyOn(api, 'swaps').mockResolvedValue([])
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue({
      generated_at: '2026-09-01T10:00:00Z', is_published: false, id: null, version: null, starts_on: null, ends_on: null,
      assignments: [], current: [], today_is_day_off: false, today_holiday_name: null,
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    renderScreen(
      <Routes>
        <Route element={<AppShell displayName="Ola" access={{ role: 'member', hasTeamMember: true }} share={null} />}>
          <Route path="*" element={<Broken />} />
        </Route>
      </Routes>,
    )
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Ten ekran przestał działać')
    expect(alert).toHaveTextContent('Error: kaboom')
    expect(screen.getByRole('navigation', { name: 'Główna nawigacja' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Odśwież stronę' })).toBeInTheDocument()
  })

  it('renders the next screen after navigating away from one that threw', async () => {
    vi.spyOn(api, 'swaps').mockResolvedValue([])
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue({
      generated_at: '2026-09-01T10:00:00Z', is_published: false, id: null, version: null, starts_on: null, ends_on: null,
      assignments: [], current: [], today_is_day_off: false, today_holiday_name: null,
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    renderScreen(
      <Routes>
        <Route element={<AppShell displayName="Ola" access={{ role: 'member', hasTeamMember: true }} share={null} />}>
          <Route path="/zepsute" element={<Broken />} />
          <Route path="*" element={<div>ekran działa</div>} />
        </Route>
      </Routes>,
      { route: '/zepsute' },
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('Ten ekran przestał działać')
    // The rail stays usable; following it must reset the boundary, not keep the
    // fallback for the boundary's whole lifetime.
    fireEvent.click(screen.getByRole('link', { name: /Teraz/ }))
    expect(await screen.findByText('ekran działa')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
