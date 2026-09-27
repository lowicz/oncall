import { afterEach, describe, expect, it, vi } from 'vitest'
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

  it('does not call the API for a path without a token', async () => {
    const exchange = vi.spyOn(api, 'exchangeShare')
    renderExchange('/share')

    expect(screen.getByLabelText('Wymiana linku na sesję')).toBeInTheDocument()
    await waitFor(() => expect(exchange).not.toHaveBeenCalled())
  })
})
