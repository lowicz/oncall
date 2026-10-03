import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderScreen } from '../test/render'
import { AuthFrame } from './AuthFrame'
import { api } from '../api'
import type { PublicConfig } from '../api'

const config = (over: Partial<PublicConfig>): PublicConfig => ({
  ldap_enabled: false,
  app_name: 'Dyżury IT',
  app_subtitle: '',
  version: '1.0.0',
  audit_retention_days: 365,
  login_audit_retention_days: 90,
  ...over,
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AuthFrame', () => {
  it('shows the brand and the subtitle, and names the tab after the screen', async () => {
    vi.spyOn(api, 'publicConfig').mockResolvedValue(config({ app_subtitle: 'Zespół sieci' }))
    renderScreen(<AuthFrame title="Zaloguj się" screen="Logowanie"><p>Formularz</p></AuthFrame>)

    expect(screen.getByRole('heading', { name: 'Zaloguj się' })).toBeInTheDocument()
    expect(screen.getByText('Formularz')).toBeInTheDocument()
    expect(await screen.findByText('Dyżury IT · Zespół sieci')).toBeInTheDocument()
    await waitFor(() => expect(document.title).toBe('Logowanie · Dyżury IT'))
    expect(screen.getByRole('link', { name: 'Dokumentacja' })).toHaveAttribute('href', '/docs/')
  })

  it('shows only the name when there is no subtitle, and follows a language switch', async () => {
    vi.spyOn(api, 'publicConfig').mockResolvedValue(config({}))
    renderScreen(<AuthFrame title="Zaloguj się" screen="Logowanie"><p>Formularz</p></AuthFrame>)

    await waitFor(() => expect(document.querySelector('.login-sub')).toHaveTextContent(/^Dyżury IT$/))
    fireEvent.click(screen.getByRole('radio', { name: 'English' }))
    expect(await screen.findByRole('link', { name: 'Documentation' })).toHaveAttribute('href', '/docs/en/')
  })
})
