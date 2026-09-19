import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { api } from '../../api'
import type { AdminUser, TeamMember } from '../../api'
import { renderScreen } from '../../test/render'
import { PeoplePanel } from './People'

const user = (over: Partial<AdminUser> & { id: string }): AdminUser => ({
  username: 'anna', personnel_number: '004512', first_name: 'Anna', last_name: 'Kowalska',
  display_name: 'Anna Kowalska', auth_source: 'local', role: 'member',
  email: 'anna@example.com', phone: null, is_active: true, created_at: '2025-09-02T10:00:00Z', ...over,
})

const member = (over: Partial<TeamMember> & { id: string }): TeamMember => ({
  user_id: 'u1', display_name: 'Anna Kowalska', active_from: '2025-09-02', active_until: null,
  eligibility: [
    { id: 'e1', role: 'primary', starts_on: '2025-09-02', ends_on: null },
    { id: 'e2', role: 'late_shift', starts_on: '2025-09-02', ends_on: null },
  ],
  ...over,
})

function mockData(users: AdminUser[] = [user({ id: 'u1' })], members: TeamMember[] = []) {
  vi.spyOn(api, 'adminUsers').mockResolvedValue(users)
  vi.spyOn(api, 'team').mockResolvedValue(members)
  vi.spyOn(api, 'publicConfig').mockResolvedValue({ ldap_enabled: false })
}

afterEach(() => vi.restoreAllMocks())

describe('PeoplePanel', () => {
  it('joins accounts to rotation members by user id, not by display name', async () => {
    mockData(
      [
        user({ id: 'u1' }),
        user({ id: 'u2', username: 'widz', personnel_number: null, first_name: 'Service',
          last_name: 'Desk', display_name: 'Service Desk', role: 'viewer', email: null,
          auth_source: 'ldap' }),
      ],
      [member({ id: 'm1', user_id: 'u1', display_name: 'Anna K.' })],
    )
    renderScreen(<PeoplePanel />)

    const anna = (await screen.findByText('anna')).closest('tr')!
    expect(within(anna).getByText(/PRIMARY od 02-09-2025/)).toBeInTheDocument()
    expect(within(anna).getByText(/11–19 od 02-09-2025/)).toBeInTheDocument()
    const viewer = screen.getByText('widz').closest('tr')!
    expect(within(viewer).getByText('Poza rotacją')).toBeInTheDocument()
    expect(within(viewer).getByText('LDAP / AD')).toBeInTheDocument()
    expect(within(viewer).getByText('pierwszy login 02-09-2025')).toBeInTheDocument()
    expect(within(anna).getByText('004512')).toBeInTheDocument()
  })

  it('translates the account role instead of showing the raw enum', async () => {
    mockData([user({ id: 'u1', role: 'coordinator' })])
    renderScreen(<PeoplePanel />)
    expect(await screen.findByText('Koordynator')).toBeInTheDocument()
    expect(screen.queryByText('coordinator')).not.toBeInTheDocument()
  })

  it('edits local account details from the detail panel', async () => {
    mockData()
    const save = vi.spyOn(api, 'updateAdminUser').mockResolvedValue(
      user({ id: 'u1', email: 'new@example.com' }),
    )
    renderScreen(<PeoplePanel />)
    const row = (await screen.findByText('anna')).closest('tr')!
    fireEvent.click(within(row).getByRole('button', { name: 'Szczegóły' }))
    const dialog = await screen.findByRole('dialog', { name: 'Anna Kowalska' })
    fireEvent.change(within(dialog).getByLabelText('E-mail'), {
      target: { value: 'new@example.com' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: /Zapisz zmiany/ }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0][0].input.email).toBe('new@example.com')
  })

  it('requires confirmation before changing a role', async () => {
    mockData()
    const save = vi.spyOn(api, 'updateAdminUser').mockResolvedValue(user({ id: 'u1' }))
    renderScreen(<PeoplePanel />)
    fireEvent.click(within((await screen.findByText('anna')).closest('tr')!).getByText('Szczegóły'))
    const details = await screen.findByRole('dialog', { name: 'Anna Kowalska' })
    fireEvent.mouseDown(within(details).getByLabelText('Rola konta'))
    fireEvent.click(await screen.findByRole('option', { name: 'Administrator' }))
    fireEvent.click(within(details).getByRole('button', { name: /Zapisz zmiany/ }))
    const confirmation = await screen.findByRole('dialog', { name: 'Potwierdź zmianę dostępu' })
    expect(save).not.toHaveBeenCalled()
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Potwierdź i zapisz' }))
    await waitFor(() => expect(save).toHaveBeenCalled())
  })

  it('keeps LDAP personal data read-only and hides password reset', async () => {
    mockData([user({ id: 'u1', auth_source: 'ldap' })])
    const save = vi.spyOn(api, 'updateAdminUser').mockResolvedValue(
      user({ id: 'u1', auth_source: 'ldap', role: 'viewer' }),
    )
    renderScreen(<PeoplePanel />)
    fireEvent.click(within((await screen.findByText('anna')).closest('tr')!).getByText('Szczegóły'))
    const dialog = await screen.findByRole('dialog', { name: 'Anna Kowalska' })
    expect(within(dialog).getByText(/pochodzą z AD/)).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/^Imię/)).toBeDisabled()
    expect(within(dialog).queryByRole('button', { name: /reset hasła/i })).not.toBeInTheDocument()
    fireEvent.mouseDown(within(dialog).getByLabelText('Rola konta'))
    fireEvent.click(await screen.findByRole('option', { name: 'Podgląd' }))
    fireEvent.click(within(dialog).getByRole('button', { name: /Zapisz zmiany/ }))
    const confirmation = await screen.findByRole('dialog', { name: 'Potwierdź zmianę dostępu' })
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Potwierdź i zapisz' }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    // Phone travels even for an LDAP account (decision D8): unlike name/email
    // it is not an AD-managed identity field.
    expect(save.mock.calls[0][0].input).toEqual({ role: 'viewer', is_active: true, phone: null })
  })

  it('edits both dates of an existing eligibility period', async () => {
    mockData([user({ id: 'u1' })], [member({ id: 'm1' })])
    const save = vi.spyOn(api, 'updateEligibility').mockResolvedValue({
      id: 'e1', role: 'primary', starts_on: '2025-10-01', ends_on: '2025-12-31',
    })
    renderScreen(<PeoplePanel />)
    fireEvent.click(within((await screen.findByText('anna')).closest('tr')!).getByText('Szczegóły'))
    const dialog = await screen.findByRole('dialog', { name: 'Anna Kowalska' })
    const startsOn = within(dialog).getAllByLabelText('Od')[0]
    const endsOn = within(dialog).getAllByLabelText('Do (opcjonalnie)')[0]
    fireEvent.change(startsOn, { target: { value: '01-10-2025' } })
    fireEvent.change(endsOn, { target: { value: '31-12-2025' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /Zapisz zmiany/ }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({
      id: 'e1', input: { starts_on: '2025-10-01', ends_on: '2025-12-31' },
    }))
  })

  it('warns before closing the dialog with unsaved changes', async () => {
    mockData()
    renderScreen(<PeoplePanel />)
    fireEvent.click(within((await screen.findByText('anna')).closest('tr')!).getByText('Szczegóły'))
    const dialog = await screen.findByRole('dialog', { name: 'Anna Kowalska' })
    fireEvent.change(within(dialog).getByLabelText('E-mail'), {
      target: { value: 'new@example.com' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zamknij' }))
    const warning = await screen.findByRole('dialog', { name: 'Zamknąć bez zapisywania?' })
    expect(within(warning).getByText(/e-mail/)).toBeInTheDocument()
    fireEvent.click(within(warning).getByRole('button', { name: 'Zamknij bez zapisywania' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Anna Kowalska' })).not.toBeInTheDocument())
  })

  it('creates a local account and presents its one-time activation link', async () => {
    mockData([])
    const created = user({ id: 'u2', username: 'ewa', first_name: 'Ewa', last_name: 'Nowak' })
    vi.spyOn(api, 'createAdminUser').mockResolvedValue({
      user: created, activation_url: 'http://localhost:8080/activate?token=secret',
    })
    renderScreen(<PeoplePanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Nowe konto' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nowe konto lokalne' })
    fireEvent.change(within(dialog).getByLabelText(/^Login/), { target: { value: 'ewa' } })
    fireEvent.change(within(dialog).getByLabelText(/^Imię/), { target: { value: 'Ewa' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Utwórz konto' }))
    expect(await within(dialog).findByText(/activate\?token=secret/)).toBeInTheDocument()
  })
})
