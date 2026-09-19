import { afterEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderScreen } from '../test/render'
import { AppShell } from './AppShell'
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
  return renderScreen(
    <Routes>
      <Route element={<AppShell displayName={displayName} access={access} share={share} />}>
        <Route path="*" element={<div>treść</div>} />
      </Route>
    </Routes>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('AppShell navigation', () => {
  it('hides entries the role cannot reach', async () => {
    vi.spyOn(api, 'swaps').mockResolvedValue([])
    renderShell({ role: 'viewer', hasTeamMember: false })
    expect(await screen.findByRole('link', { name: /Dyżury/ })).toBeInTheDocument()
    // docs/PLAN.md §6: a viewer must not see navigation to unavailable features.
    expect(screen.queryByRole('link', { name: /Zamiany/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Generator/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Administracja/ })).not.toBeInTheDocument()
  })

  it('gives a coordinator the generator and the administration menu', async () => {
    vi.spyOn(api, 'swaps').mockResolvedValue([])
    renderShell({ role: 'coordinator', hasTeamMember: false })
    expect(await screen.findByRole('link', { name: /Generator/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Administracja/ })).toBeInTheDocument()
    // "Moje" is also where a coordinator files availability on behalf of a
    // member who cannot reach the system (docs/PLAN-WYKONAWCZY-6.md tor D).
    expect(screen.getByRole('link', { name: /^Moje/ })).toBeInTheDocument()
  })

  it('does not query swaps for a viewer', async () => {
    const swaps = vi.spyOn(api, 'swaps').mockResolvedValue([])
    renderShell({ role: 'viewer', hasTeamMember: false })
    await screen.findByRole('link', { name: /Dyżury/ })
    expect(swaps).not.toHaveBeenCalled()
  })

  it('separates both dates in the viewer-link range', async () => {
    vi.spyOn(api, 'swaps').mockResolvedValue([])
    renderShell({ role: 'viewer', hasTeamMember: false }, 'Odbiorca', {
      label: 'Audyt',
      starts_on: '2026-09-05',
      ends_on: '2026-10-02',
      expires_at: '2026-10-03T00:00:00Z',
    })

    expect(await screen.findByText(/Zakres od 05-09-2026 do 02-10-2026/)).toBeInTheDocument()
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
    await waitFor(() => expect(link.textContent).toContain('2'))
  })

  it('shows no count when nothing awaits a decision', async () => {
    vi.spyOn(api, 'swaps').mockResolvedValue([swap({ id: '1', status: 'approved' })])
    renderShell({ role: 'member', hasTeamMember: true })
    const link = await screen.findByRole('link', { name: /Zamiany/ })
    await waitFor(() => expect(api.swaps).toHaveBeenCalled())
    expect(link.querySelector('.MuiBadge-root')).not.toBeInTheDocument()
  })
})

describe('AppShell mobile identity', () => {
  it('names the logged-in person in the drawer, where the topbar hides it', async () => {
    renderShell({ role: 'coordinator', hasTeamMember: true }, 'Ola Zielińska')
    fireEvent.click(await screen.findByRole('button', { name: 'Otwórz nawigację' }))
    const drawer = await screen.findByRole('dialog')
    // `.topbar-user` is display:none below the breakpoint, so the drawer has
    // to carry the name and the role (LOW5-10).
    expect(within(drawer).getByText('Ola Zielińska')).toBeInTheDocument()
    expect(within(drawer).getByText('Koordynator')).toBeInTheDocument()
  })

  it('does not repeat the role when the display name already reads as the role (QA7-L16)', async () => {
    renderShell({ role: 'admin', hasTeamMember: false }, 'Administrator')
    expect(await screen.findAllByText('Administrator')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Otwórz nawigację' }))
    const drawer = await screen.findByRole('dialog')
    expect(within(drawer).getAllByText('Administrator')).toHaveLength(1)
  })
})
