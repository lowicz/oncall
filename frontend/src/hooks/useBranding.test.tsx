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
      <span data-testid="version">{branding.version}</span>
    </div>
  )
}

afterEach(() => vi.restoreAllMocks())

describe('useBranding', () => {
  it('names the product from the deployment configuration and titles the tab with it', async () => {
    vi.spyOn(api, 'publicConfig').mockResolvedValue({
      ldap_enabled: true, app_name: 'Dyżury NOC', app_subtitle: 'Zespół utrzymania', version: '1.4.0', audit_retention_days: 365, login_audit_retention_days: 90,
    })
    renderScreen(<Probe screenName="Teraz" />)
    expect(await screen.findByText('Dyżury NOC')).toBeInTheDocument()
    expect(screen.getByTestId('subtitle')).toHaveTextContent('Zespół utrzymania')
    expect(screen.getByTestId('ldap')).toHaveTextContent('true')
    expect(screen.getByTestId('version')).toHaveTextContent('1.4.0')
    expect(document.title).toBe('Teraz · Dyżury NOC')
  })

  it('falls back to the neutral default while the configuration is missing or blank', async () => {
    vi.spyOn(api, 'publicConfig').mockResolvedValue({ ldap_enabled: false, app_name: '   ', app_subtitle: '', version: ' ', audit_retention_days: 365, login_audit_retention_days: 90 })
    renderScreen(<Probe screenName={null} />)
    expect(screen.getByTestId('name')).toHaveTextContent('On-call')
    await vi.waitFor(() => expect(api.publicConfig).toHaveBeenCalled())
    expect(screen.getByTestId('name')).toHaveTextContent('On-call')
    expect(screen.getByTestId('subtitle')).toHaveTextContent('')
    // No version line rather than a wrong one: the shell hides it while empty.
    expect(screen.getByTestId('version')).toHaveTextContent('')
    expect(document.title).toBe('On-call')
  })
})
