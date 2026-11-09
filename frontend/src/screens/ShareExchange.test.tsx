import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { api, ApiError } from '../api'
import type { ShareExchangeResult } from '../api'
import { renderScreen } from '../test/render'
import { ShareExchange } from './ShareExchange'

function renderExchange(route: string) {
  return renderScreen(
    <Routes>
      <Route path="/share/:token" element={<ShareExchange />} />
      <Route path="/share" element={<ShareExchange />} />
      <Route path="/" element={<p>Ekran startowy</p>} />
    </Routes>,
    { route },
  )
}

const account = {
  username: 'admin', display_name: 'Administrator', role: 'admin' as const, has_team_member: false,
  email: null, phone: null, share: null, avatar_url: null,
}

beforeEach(() => {
  vi.spyOn(api, 'me').mockRejectedValue(new ApiError('Brak sesji', 401))
})

afterEach(() => vi.restoreAllMocks())

describe('ShareExchange', () => {
  it('trades the link token for a session once and opens the application', async () => {
    let finish: (value: ShareExchangeResult) => void = () => {}
    const exchange = vi.spyOn(api, 'exchangeShare').mockReturnValue(new Promise((resolve) => { finish = resolve }))
    renderExchange('/share/link-token-value')

    expect(screen.getByLabelText('Wymiana linku na sesję')).toBeInTheDocument()
    await waitFor(() => expect(exchange).toHaveBeenCalledWith('link-token-value'))
    finish({ display_name: 'Dla serwisu', role: 'viewer', starts_on: '2026-09-09', ends_on: '2026-09-22', expires_at: '2026-09-30T12:00:00Z' })
    expect(await screen.findByText('Ekran startowy')).toBeInTheDocument()
    expect(exchange).toHaveBeenCalledTimes(1)
  })

  it('explains a broken link and leads back to sign-in', async () => {
    vi.spyOn(api, 'exchangeShare').mockRejectedValue(new ApiError('Link wygasł', 410))
    renderExchange('/share/link-token-value')

    expect(await screen.findByRole('heading', { name: 'Ten link nie działa' })).toBeInTheDocument()
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Link wygasł')
    expect(alert).toHaveTextContent('Poproś o nowy osobę, która go wysłała.')
    fireEvent.click(screen.getByRole('button', { name: 'Przejdź do logowania' }))
    expect(await screen.findByText('Ekran startowy')).toBeInTheDocument()
  })

  it('asks before a preview link signs an account out of this browser', async () => {
    vi.spyOn(api, 'me').mockResolvedValue(account)
    const exchange = vi.spyOn(api, 'exchangeShare').mockResolvedValue({
      display_name: 'Dla serwisu', role: 'viewer', starts_on: '2026-09-09', ends_on: '2026-09-22', expires_at: '2026-09-30T12:00:00Z',
    })
    renderExchange('/share/link-token-value')

    expect(await screen.findByRole('heading', { name: 'Ta przeglądarka jest zalogowana' })).toBeInTheDocument()
    expect(screen.getByText(/zastąpi sesję konta Administrator we wszystkich kartach/)).toBeInTheDocument()
    expect(exchange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Otwórz podgląd i wyloguj' }))

    await waitFor(() => expect(exchange).toHaveBeenCalledWith('link-token-value'))
    expect(await screen.findByText('Ekran startowy')).toBeInTheDocument()
  })

  it('keeps the account signed in when asked to', async () => {
    vi.spyOn(api, 'me').mockResolvedValue(account)
    const exchange = vi.spyOn(api, 'exchangeShare')
    renderExchange('/share/link-token-value')

    fireEvent.click(await screen.findByRole('button', { name: 'Zostań na koncie' }))

    expect(await screen.findByText('Ekran startowy')).toBeInTheDocument()
    expect(exchange).not.toHaveBeenCalled()
  })

  it('replaces one preview with another without asking', async () => {
    vi.spyOn(api, 'me').mockResolvedValue({
      ...account, display_name: 'Dla serwisu', role: 'viewer',
      share: { label: 'Dla serwisu', starts_on: '2026-09-09', ends_on: '2026-09-22', expires_at: '2026-09-30T12:00:00Z' },
    })
    const exchange = vi.spyOn(api, 'exchangeShare').mockReturnValue(new Promise(() => {}))
    renderExchange('/share/link-token-value')

    await waitFor(() => expect(exchange).toHaveBeenCalledWith('link-token-value'))
    expect(screen.queryByRole('button', { name: 'Zostań na koncie' })).not.toBeInTheDocument()
  })

  it('does not call the API for a path without a token', async () => {
    const exchange = vi.spyOn(api, 'exchangeShare')
    renderExchange('/share')

    expect(screen.getByLabelText('Wymiana linku na sesję')).toBeInTheDocument()
    await waitFor(() => expect(exchange).not.toHaveBeenCalled())
  })
})
