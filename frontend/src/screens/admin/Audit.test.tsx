import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { api } from '../../api'
import type { AuditEvent, PublicConfig } from '../../api'
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
      'Wpisy starsze niż 730 dni są usuwane automatycznie, zwykłe logowania są usuwane po 31 dniach.',
    )
  })

  it('says so when a kind is kept for ever', async () => {
    vi.spyOn(api, 'auditEvents').mockResolvedValue([])
    vi.spyOn(api, 'publicConfig').mockResolvedValue(
      config({ audit_retention_days: 0, login_audit_retention_days: 0 }),
    )
    renderScreen(<AuditPanel />)

    expect(await screen.findByTestId('audit-retention')).toHaveTextContent(
      'Wpisy są przechowywane bezterminowo, zwykłe logowania są przechowywane bezterminowo.',
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

const auditEvent = (over: Partial<AuditEvent> = {}): AuditEvent => ({
  id: 'e1', occurred_at: '2026-09-09T10:15:00Z', actor_label: 'Anna Kowalska',
  action: 'swap.created', entity_type: null, entity_id: null,
  summary: 'Zamiana dyżuru primary', details: null, ...over,
})

describe('AuditPanel filters and list', () => {
  it('lists the events with their label, time, author and details', async () => {
    vi.spyOn(api, 'publicConfig').mockResolvedValue(config())
    vi.spyOn(api, 'auditEvents').mockResolvedValue([
      auditEvent(),
      auditEvent({ id: 'e2', action: 'auth.login', summary: 'Logowanie', details: { ip: '10.0.0.1' } }),
    ])
    renderScreen(<AuditPanel />)

    expect(await screen.findByText('Zamiana dyżuru PRIMARY')).toBeInTheDocument()
    expect(screen.getAllByText('Anna Kowalska')).toHaveLength(2)
    expect(screen.getByText('Zgłoszono zamianę', { selector: '.tag, span' })).toBeInTheDocument()
    expect(screen.getAllByText('Szczegóły')).toHaveLength(1)
    expect(screen.getByText(/"ip": "10.0.0.1"/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Załaduj więcej' })).not.toBeInTheDocument()
  })

  it('sends every filter to the API and turns on sign-ins when that action is chosen', async () => {
    vi.spyOn(api, 'publicConfig').mockResolvedValue(config())
    const auditEvents = vi.spyOn(api, 'auditEvents').mockResolvedValue([])
    renderScreen(<AuditPanel />)
    await screen.findByText('Zmień albo wyczyść filtry, żeby zobaczyć więcej zdarzeń.')

    fireEvent.change(screen.getByLabelText('Osoba'), { target: { value: 'anna' } })
    expect(await screen.findByText(/Rutynowe logowania są w tym widoku ukryte/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Szukaj'), { target: { value: 'grafik' } })
    fireEvent.change(screen.getByLabelText('Od'), { target: { value: '2026-09-01' } })
    fireEvent.change(screen.getByLabelText('Do'), { target: { value: '2026-09-30' } })
    fireEvent.change(screen.getByLabelText('Akcja'), { target: { value: 'swap.created' } })
    const logins = screen.getByLabelText('Pokaż zwykłe logowania')
    expect(logins).not.toBeChecked()

    await waitFor(() => expect(auditEvents).toHaveBeenLastCalledWith({
      action: 'swap.created', actor: 'anna', q: 'grafik', starts_on: '2026-09-01', ends_on: '2026-09-30',
      include_logins: false, limit: 50, offset: 0,
    }))

    fireEvent.click(logins)
    expect(logins).toBeChecked()
    expect(screen.queryByText(/Rutynowe logowania są w tym widoku ukryte/)).not.toBeInTheDocument()
    await waitFor(() => expect(auditEvents).toHaveBeenLastCalledWith(expect.objectContaining({ include_logins: true })))

    fireEvent.click(logins)
    fireEvent.change(screen.getByLabelText('Akcja'), { target: { value: 'auth.login' } })
    expect(logins).toBeChecked()
    expect(await screen.findByText('W wybranym zakresie nie ma zdarzeń „Logowanie”. Zmień zakres dat albo pozostałe filtry.')).toBeInTheDocument()
    await waitFor(() => expect(auditEvents).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'auth.login', include_logins: true })))
  })

  it('shows the error the API answered with', async () => {
    vi.spyOn(api, 'publicConfig').mockResolvedValue(config())
    vi.spyOn(api, 'auditEvents').mockRejectedValue(new Error('Brak uprawnień'))
    renderScreen(<AuditPanel />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Brak uprawnień')
  })

  it('loads the next page after a full one and appends it', async () => {
    vi.spyOn(api, 'publicConfig').mockResolvedValue(config())
    const firstPage = Array.from({ length: 50 }, (_, index) => auditEvent({ id: `p${index}`, summary: `Wpis ${index}` }))
    const auditEvents = vi.spyOn(api, 'auditEvents')
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([auditEvent({ id: 'last', summary: 'Ostatni wpis' })])
    renderScreen(<AuditPanel />)

    fireEvent.click(await screen.findByRole('button', { name: 'Załaduj więcej' }))

    expect(await screen.findByText('Ostatni wpis')).toBeInTheDocument()
    expect(screen.getByText('Wpis 0')).toBeInTheDocument()
    expect(auditEvents).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50 }))
    expect(screen.queryByRole('button', { name: 'Załaduj więcej' })).not.toBeInTheDocument()
  })

  it('exports the listed events as CSV with quotes escaped and details as JSON', async () => {
    vi.spyOn(api, 'publicConfig').mockResolvedValue(config())
    vi.spyOn(api, 'auditEvents').mockResolvedValue([
      auditEvent({ summary: 'Zmiana "grafiku"' }),
      auditEvent({ id: 'e2', action: 'auth.login', summary: 'Logowanie', details: { ip: '10.0.0.1' } }),
    ])
    let exported: Blob | undefined
    const createObjectURL = vi.fn((blob: Blob) => { exported = blob; return 'blob:audit' })
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('audyt.csv')
      expect(this.href).toBe('blob:audit')
    })
    renderScreen(<AuditPanel />)

    const exportButton = await screen.findByRole('button', { name: 'Eksportuj CSV' })
    await waitFor(() => expect(exportButton).toBeEnabled())
    fireEvent.click(exportButton)

    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:audit')
    // A byte-order mark first, so Excel reads the Polish letters as UTF-8.
    expect(Array.from(new Uint8Array(await exported!.slice(0, 3).arrayBuffer()))).toEqual([0xef, 0xbb, 0xbf])
    const text = await exported!.text()
    expect(text).toBe([
      '"czas_utc","akcja","aktor","opis","szczegoly"',
      '"2026-09-09T10:15:00Z","swap.created","Anna Kowalska","Zmiana ""grafiku""",""',
      '"2026-09-09T10:15:00Z","auth.login","Anna Kowalska","Logowanie","{""ip"":""10.0.0.1""}"',
    ].join('\n'))
  })

  it('offers no export while the list is empty', async () => {
    vi.spyOn(api, 'publicConfig').mockResolvedValue(config())
    vi.spyOn(api, 'auditEvents').mockResolvedValue([])
    renderScreen(<AuditPanel />)

    await screen.findByText('Brak zdarzeń dla wybranego filtra')
    expect(screen.getByRole('button', { name: 'Eksportuj CSV' })).toBeDisabled()
  })
})

describe('AuditPanel filter form', () => {
  it('filters as the fields change, so Enter does not submit the form away', async () => {
    vi.spyOn(api, 'publicConfig').mockResolvedValue(config())
    vi.spyOn(api, 'auditEvents').mockResolvedValue([])
    renderScreen(<AuditPanel />)

    const form = await screen.findByRole('form', { name: 'Filtry audytu' })
    expect(fireEvent.submit(form)).toBe(false)
  })
})
