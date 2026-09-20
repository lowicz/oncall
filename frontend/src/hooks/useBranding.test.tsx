import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { api } from '../api'
import { renderScreen } from '../test/render'
import { useBranding, useDocumentTitle } from './useBranding'

function Probe({ screenName }: { screenName: string | null }) {
  const branding = useBranding()
  useDocumentTitle(screenName, branding.name)
  return (
    <div>
      <span data-testid="name">{branding.name}</span>
      <span data-testid="subtitle">{branding.subtitle}</span>
      <span data-testid="ldap">{String(branding.ldapEnabled)}</span>
    </div>
  )
}

afterEach(() => vi.restoreAllMocks())

describe('useBranding', () => {
  it('names the product from the deployment configuration and titles the tab with it', async () => {
    vi.spyOn(api, 'publicConfig').mockResolvedValue({
      ldap_enabled: true, app_name: 'Dyżury NOC', app_subtitle: 'Zespół utrzymania',
    })
    renderScreen(<Probe screenName="Teraz" />)
    expect(await screen.findByText('Dyżury NOC')).toBeInTheDocument()
    expect(screen.getByTestId('subtitle')).toHaveTextContent('Zespół utrzymania')
    expect(screen.getByTestId('ldap')).toHaveTextContent('true')
    expect(document.title).toBe('Teraz · Dyżury NOC')
  })

  it('falls back to the neutral default while the configuration is missing or blank', async () => {
    vi.spyOn(api, 'publicConfig').mockResolvedValue({ ldap_enabled: false, app_name: '   ', app_subtitle: '' })
    renderScreen(<Probe screenName={null} />)
    expect(screen.getByTestId('name')).toHaveTextContent('On-call')
    await vi.waitFor(() => expect(api.publicConfig).toHaveBeenCalled())
    expect(screen.getByTestId('name')).toHaveTextContent('On-call')
    expect(screen.getByTestId('subtitle')).toHaveTextContent('')
    expect(document.title).toBe('On-call')
  })
})
