import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { api } from '../api'
import { renderScreen } from '../test/render'
import { MoreScreen } from './More'

const config = (version: string) => ({
  app_name: 'On-call', app_subtitle: '', ldap_enabled: false, version, audit_retention_days: 365, login_audit_retention_days: 90,
})

afterEach(() => vi.restoreAllMocks())

describe('MoreScreen', () => {
  it('lists only the groups a member can open', async () => {
    vi.spyOn(api, 'publicConfig').mockResolvedValue(config('1.4.0'))
    renderScreen(<MoreScreen displayName="Ola Zielińska" access={{ role: 'member', hasTeamMember: true }} />)

    expect(await screen.findByRole('heading', { name: 'Koordynacja' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Sprawiedliwość/ })).toHaveAttribute('href', '/sprawiedliwosc')
    expect(screen.queryByRole('link', { name: /Generator/ })).not.toBeInTheDocument()
    // The four tabs hold every everyday screen, and a member has no administration.
    expect(screen.queryByRole('heading', { name: 'Codziennie' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Administracja' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Aplikacja' })).toBeInTheDocument()
  })

  it('gives an admin the administration screens', async () => {
    vi.spyOn(api, 'publicConfig').mockResolvedValue(config('1.4.0'))
    renderScreen(<MoreScreen displayName="Ewa Maj" access={{ role: 'admin', hasTeamMember: true }} />)

    expect(await screen.findByRole('heading', { name: 'Administracja' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Osoby/ })).toHaveAttribute('href', '/osoby')
    expect(screen.getByRole('link', { name: /Audyt/ })).toHaveAttribute('href', '/audyt')
  })

  it('names the role under the name, unless the name already reads as the role', async () => {
    vi.spyOn(api, 'publicConfig').mockResolvedValue(config('1.4.0'))
    const { unmount } = renderScreen(<MoreScreen displayName="Ewa Maj" access={{ role: 'admin', hasTeamMember: true }} />)
    expect(await screen.findByText('Administrator')).toBeInTheDocument()
    unmount()

    renderScreen(<MoreScreen displayName="Administrator" access={{ role: 'admin', hasTeamMember: false }} />)
    expect(await screen.findAllByText('Administrator')).toHaveLength(1)
  })

  it('shows no version row when the API names no version', async () => {
    const publicConfig = vi.spyOn(api, 'publicConfig').mockResolvedValue(config(''))
    renderScreen(<MoreScreen displayName="Ola Zielińska" access={{ role: 'member', hasTeamMember: true }} />)

    await waitFor(() => expect(publicConfig).toHaveBeenCalled())
    expect(await screen.findByText('Sesja')).toBeInTheDocument()
    expect(screen.queryByText('Wersja')).not.toBeInTheDocument()
  })

  it('signs out and reloads the application from its root', async () => {
    vi.spyOn(api, 'publicConfig').mockResolvedValue(config('1.4.0'))
    const logout = vi.spyOn(api, 'logout').mockResolvedValue(undefined)
    const assign = vi.fn()
    const original = window.location
    Object.defineProperty(window, 'location', { value: { ...original, assign }, configurable: true })
    try {
      renderScreen(<MoreScreen displayName="Ola Zielińska" access={{ role: 'member', hasTeamMember: true }} />)
      fireEvent.click(await screen.findByRole('button', { name: /Wyloguj/ }))
      await waitFor(() => expect(assign).toHaveBeenCalledWith('/'))
      expect(logout).toHaveBeenCalledTimes(1)
    } finally {
      Object.defineProperty(window, 'location', { value: original, configurable: true })
    }
  })
})
