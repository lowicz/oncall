import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { api } from '../../api'
import type { PublicConfig } from '../../api'
import { renderScreen } from '../../test/render'
import { AuditPanel } from './Audit'

const config = (over: Partial<PublicConfig> = {}): PublicConfig => ({
  ldap_enabled: false, app_name: 'On-call', app_subtitle: '', version: '1.4.0',
  audit_retention_days: 365, login_audit_retention_days: 90, ...over,
})

afterEach(() => vi.restoreAllMocks())

describe('AuditPanel retention footer', () => {
  it('states the ages the deployment configured, not ones built into the bundle', async () => {
    vi.spyOn(api, 'auditEvents').mockResolvedValue([])
    vi.spyOn(api, 'publicConfig').mockResolvedValue(
      config({ audit_retention_days: 730, login_audit_retention_days: 31 }),
    )
    renderScreen(<AuditPanel />)

    expect(await screen.findByTestId('audit-retention')).toHaveTextContent(
      'Wpisy starsze niż 730 dni są usuwane automatycznie, zwykłe logowania są usuwane po 31 dniach. '
      + 'Korekty grafiku są zachowywane bezterminowo.',
    )
  })

  it('says so when a kind is kept for ever', async () => {
    vi.spyOn(api, 'auditEvents').mockResolvedValue([])
    vi.spyOn(api, 'publicConfig').mockResolvedValue(
      config({ audit_retention_days: 0, login_audit_retention_days: 0 }),
    )
    renderScreen(<AuditPanel />)

    expect(await screen.findByTestId('audit-retention')).toHaveTextContent(
      'Wpisy są przechowywane bezterminowo, zwykłe logowania są przechowywane bezterminowo. '
      + 'Korekty grafiku są zachowywane bezterminowo.',
    )
  })

  it('shows no footer until the configuration has arrived, rather than a wrong one', async () => {
    vi.spyOn(api, 'auditEvents').mockResolvedValue([])
    vi.spyOn(api, 'publicConfig').mockRejectedValue(new Error('offline'))
    renderScreen(<AuditPanel />)

    await waitFor(() => expect(api.publicConfig).toHaveBeenCalled())
    expect(await screen.findByText('Brak zdarzeń dla wybranego filtra')).toBeInTheDocument()
    expect(screen.queryByTestId('audit-retention')).not.toBeInTheDocument()
  })
})
