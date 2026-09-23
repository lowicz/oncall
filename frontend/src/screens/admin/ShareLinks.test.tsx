import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderScreen } from '../../test/render'
import { ShareLinksPanel } from './ShareLinks'
import { api } from '../../api'

afterEach(() => vi.restoreAllMocks())

const LINK = {
  id: 'l1', label: 'dyspozytornia', starts_on: '2026-09-14', ends_on: '2026-09-27',
  expires_at: '2099-01-01T00:00:00Z', created_at: '2026-09-01T10:00:00Z', used_at: null, revoked_at: null,
}

const openRevocation = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Odwołaj' }))
  return screen.findByRole('dialog', { name: 'Odwołać link udostępnienia?' })
}

describe('ShareLinksPanel revocation', () => {
  it('keeps the link when the confirmation is cancelled', async () => {
    vi.spyOn(api, 'shareLinks').mockResolvedValue([LINK])
    const revoke = vi.spyOn(api, 'revokeShareLink').mockResolvedValue(undefined)
    renderScreen(<ShareLinksPanel />)

    const confirm = await openRevocation()
    expect(within(confirm).getByText(/Link dla „dyspozytornia” \(14-09-2026 – 27-09-2026\) przestanie działać/)).toBeInTheDocument()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Anuluj' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(revoke).not.toHaveBeenCalled()
  })

  it('revokes the link once confirmed', async () => {
    vi.spyOn(api, 'shareLinks').mockResolvedValue([LINK])
    const revoke = vi.spyOn(api, 'revokeShareLink').mockResolvedValue(undefined)
    renderScreen(<ShareLinksPanel />)

    const confirm = await openRevocation()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Odwołaj link' }))

    await waitFor(() => expect(revoke).toHaveBeenCalled())
    expect(revoke.mock.calls[0][0]).toBe('l1')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
