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
  vi.spyOn(api, 'publicConfig').mockResolvedValue({ ldap_enabled: false, app_name: 'On-call', app_subtitle: '' })
}

const rowOf = async (username: string) => (await screen.findByText(username, { selector: 'td' })).closest('tr') as HTMLTableRowElement
const openRow = async (username: string) => {
  fireEvent.click(within(await rowOf(username)).getByRole('button', { name: 'Otwórz' }))
  return screen.findByRole('dialog', { name: /Anna Kowalska/ })
}

afterEach(() => vi.restoreAllMocks())

describe('PeoplePanel table', () => {
  it('joins accounts to rotation members by user id and reads the columns the admin needs', async () => {
    mockData(
      [
        user({ id: 'u1', phone: '+48 601 220 118' }),
        user({ id: 'u2', username: 'widz', personnel_number: null, first_name: 'Service',
          last_name: 'Desk', display_name: 'Service Desk', role: 'viewer', email: null,
          auth_source: 'ldap' }),
        user({ id: 'u3', username: 'tomasz', first_name: 'Tomasz', last_name: 'Lis', display_name: 'Tomasz Lis', email: 'tomasz@example.com' }),
      ],
      [
        member({ id: 'm1', user_id: 'u1', display_name: 'Anna K.' }),
        member({ id: 'm3', user_id: 'u3', display_name: 'Tomasz Lis', active_from: '2026-10-12', eligibility: [{ id: 'e9', role: 'primary', starts_on: '2026-10-12', ends_on: null }] }),
      ],
    )
    renderScreen(<PeoplePanel />)

    const anna = await rowOf('anna')
    expect(within(anna).getByText('w rotacji')).toBeInTheDocument()
    expect(within(anna).getByText('od 02-09-2025 · P · 11–19')).toBeInTheDocument()
    expect(within(anna).getByText('004512')).toBeInTheDocument()
    expect(within(anna).getByText('+48 601 220 118')).toBeInTheDocument()
    expect(within(anna).getByText('anna@example.com')).toBeInTheDocument()
    const viewer = await rowOf('widz')
    expect(within(viewer).getByText('nie dotyczy')).toBeInTheDocument()
    expect(within(viewer).getByText('LDAP / AD')).toBeInTheDocument()
    expect(within(viewer).getByText('pierwszy login 02-09-2025')).toBeInTheDocument()
    // Somebody entering the rotation is flagged with the date; a missing phone is a red "brak".
    const tomasz = await rowOf('tomasz')
    expect(within(tomasz).getByText('od 12 paź')).toBeInTheDocument()
    expect(within(tomasz).getByText('brak')).toHaveClass('who-bad')
    expect(screen.getByText(/3 konta · 1 w rotacji · 1 wchodzi 12 paź/)).toBeInTheDocument()
  })

  it('translates the account role instead of showing the raw enum', async () => {
    mockData([user({ id: 'u1', role: 'coordinator' })])
    renderScreen(<PeoplePanel />)
    const row = await rowOf('anna')
    expect(within(row).getByText('Koordynator')).toBeInTheDocument()
    expect(screen.queryByText('coordinator')).not.toBeInTheDocument()
  })

  it('filters by rotation state and by text from the section heading', async () => {
    mockData(
      [user({ id: 'u1' }), user({ id: 'u2', username: 'ewa', first_name: 'Ewa', last_name: 'Maj', display_name: 'Ewa Maj', is_active: false })],
      [member({ id: 'm1', user_id: 'u1' })],
    )
    renderScreen(<PeoplePanel />)
    await rowOf('anna')
    fireEvent.click(screen.getByRole('button', { name: 'Wyłączone' }))
    expect(screen.queryByText('anna', { selector: 'td' })).not.toBeInTheDocument()
    expect(screen.getByText('ewa', { selector: 'td' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'W rotacji' }))
    expect(screen.getByText('anna', { selector: 'td' })).toBeInTheDocument()
    expect(screen.queryByText('ewa', { selector: 'td' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Wszystkie' }))
    fireEvent.change(screen.getByRole('searchbox', { name: /Szukaj osoby/ }), { target: { value: 'maj' } })
    expect(screen.queryByText('anna', { selector: 'td' })).not.toBeInTheDocument()
    expect(screen.getByText('ewa', { selector: 'td' })).toBeInTheDocument()
  })
})

describe('PeoplePanel person panel', () => {
  it('edits local account details from the detail panel', async () => {
    mockData()
    const save = vi.spyOn(api, 'updateAdminUser').mockResolvedValue(
      user({ id: 'u1', email: 'new@example.com' }),
    )
    renderScreen(<PeoplePanel />)
    const dialog = await openRow('anna')
    fireEvent.change(within(dialog).getByLabelText('E-mail'), {
      target: { value: 'new@example.com' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: /Zapisz \(1\)/ }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0][0].input.email).toBe('new@example.com')
  })

  it('requires confirmation before changing a role on the access tab', async () => {
    mockData()
    const save = vi.spyOn(api, 'updateAdminUser').mockResolvedValue(user({ id: 'u1' }))
    renderScreen(<PeoplePanel />)
    const details = await openRow('anna')
    fireEvent.click(within(details).getByRole('tab', { name: 'Dostęp' }))
    fireEvent.click(within(details).getByRole('radio', { name: 'Administrator' }))
    fireEvent.click(within(details).getByRole('button', { name: /Zapisz \(1\)/ }))
    const confirmation = await screen.findByRole('dialog', { name: 'Potwierdź zmianę dostępu' })
    expect(save).not.toHaveBeenCalled()
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Potwierdź i zapisz' }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0][0].input.role).toBe('admin')
  })

  it('keeps LDAP personal data read-only and hides password reset', async () => {
    mockData([user({ id: 'u1', auth_source: 'ldap' })])
    const save = vi.spyOn(api, 'updateAdminUser').mockResolvedValue(
      user({ id: 'u1', auth_source: 'ldap', role: 'viewer' }),
    )
    renderScreen(<PeoplePanel />)
    const dialog = await openRow('anna')
    expect(within(dialog).getByText(/pochodzą z AD/)).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/^Imię/)).toBeDisabled()
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Dostęp' }))
    expect(within(dialog).queryByRole('button', { name: /reset hasła/i })).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Podgląd' }))
    fireEvent.click(within(dialog).getByRole('button', { name: /Zapisz \(1\)/ }))
    const confirmation = await screen.findByRole('dialog', { name: 'Potwierdź zmianę dostępu' })
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Potwierdź i zapisz' }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    // Phone travels even for an LDAP account (decision D8): unlike name/email
    // it is not an AD-managed identity field.
    expect(save.mock.calls[0][0].input).toEqual({ role: 'viewer', is_active: true, phone: null })
  })

  it('shows the qualifications as chips and ends a period when one is taken off', async () => {
    mockData([user({ id: 'u1' })], [member({ id: 'm1' })])
    const end = vi.spyOn(api, 'updateEligibility').mockResolvedValue({ id: 'e2', role: 'late_shift', starts_on: '2025-09-02', ends_on: '2026-09-09' })
    const add = vi.spyOn(api, 'createEligibility').mockResolvedValue({ id: 'e3', role: 'secondary', starts_on: '2026-09-10', ends_on: null })
    renderScreen(<PeoplePanel />)
    const dialog = await openRow('anna')
    fireEvent.click(within(dialog).getByRole('tab', { name: /Rotacja/ }))
    expect(within(dialog).getByText(/W rotacji od 02-09-2025/)).toBeInTheDocument()
    const chips = within(dialog).getByRole('group', { name: 'Kwalifikacje dyżurowe' })
    expect(within(chips).getByRole('button', { name: 'Zdejmij kwalifikację PRIMARY' })).toBeInTheDocument()
    expect(within(chips).getByRole('button', { name: 'Dodaj kwalifikację SECONDARY' })).toBeInTheDocument()

    fireEvent.click(within(chips).getByRole('button', { name: 'Zdejmij kwalifikację 11–19' }))
    // The open period ends yesterday: the published schedule keeps its duties, the next generation skips the role.
    await waitFor(() => expect(end).toHaveBeenCalledWith({ id: 'e2', input: { ends_on: '2026-09-09' } }))
    fireEvent.click(within(chips).getByRole('button', { name: 'Dodaj kwalifikację SECONDARY' }))
    await waitFor(() => expect(add).toHaveBeenCalledWith({ memberId: 'm1', input: { role: 'secondary', starts_on: '2026-09-10', ends_on: null } }))
  })

  it('edits both dates of an existing qualification period from the list', async () => {
    mockData([user({ id: 'u1' })], [member({ id: 'm1' })])
    const save = vi.spyOn(api, 'updateEligibility').mockResolvedValue({
      id: 'e1', role: 'primary', starts_on: '2025-10-01', ends_on: '2025-12-31',
    })
    renderScreen(<PeoplePanel />)
    const dialog = await openRow('anna')
    fireEvent.click(within(dialog).getByRole('tab', { name: /Rotacja/ }))
    const period = (await within(dialog).findAllByText('02-09-2025 → ∞'))[0].closest('.list-row') as HTMLElement
    expect(within(period).getByText('PRIMARY')).toBeInTheDocument()
    fireEvent.click(within(period).getByRole('button', { name: 'Edytuj' }))
    fireEvent.change(within(dialog).getByLabelText('Od'), { target: { value: '2025-10-01' } })
    fireEvent.change(within(dialog).getByLabelText('Do (opcjonalnie)'), { target: { value: '2025-12-31' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /Zapisz \(1\)/ }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({
      id: 'e1', input: { starts_on: '2025-10-01', ends_on: '2025-12-31' },
    }))
  })

  it('warns before closing the panel with unsaved changes', async () => {
    mockData()
    renderScreen(<PeoplePanel />)
    const dialog = await openRow('anna')
    fireEvent.change(within(dialog).getByLabelText('E-mail'), {
      target: { value: 'new@example.com' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Anuluj' }))
    const warning = await screen.findByRole('dialog', { name: 'Zamknąć bez zapisywania?' })
    expect(within(warning).getByText(/e-mail/)).toBeInTheDocument()
    fireEvent.click(within(warning).getByRole('button', { name: 'Zamknij bez zapisywania' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Anna Kowalska/ })).not.toBeInTheDocument())
  })

  it('deletes an account only after the login is typed into the red sheet', async () => {
    mockData([user({ id: 'u1' })], [member({ id: 'm1' })])
    const remove = vi.spyOn(api, 'deleteAdminUser').mockResolvedValue(undefined)
    renderScreen(<PeoplePanel />)
    const dialog = await openRow('anna')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Usuń konto…' }))
    const sheet = await screen.findByRole('dialog', { name: 'Usuwam konto Anna Kowalska i jego dane osobowe' })
    expect(within(sheet).getByText(/pozostaną bez obsady/)).toBeInTheDocument()
    const confirm = within(sheet).getByRole('button', { name: 'Usuń konto i dane' })
    expect(confirm).toBeDisabled()
    fireEvent.change(within(sheet).getByLabelText('Wpisz login, żeby potwierdzić'), { target: { value: 'ann' } })
    expect(confirm).toBeDisabled()
    fireEvent.change(within(sheet).getByLabelText('Wpisz login, żeby potwierdzić'), { target: { value: 'anna' } })
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)
    await waitFor(() => expect(remove).toHaveBeenCalledWith('u1'))
  })
})

describe('PeoplePanel new account', () => {
  it('creates a local account and presents its one-time activation link', async () => {
    mockData([])
    const created = user({ id: 'u2', username: 'ewa', first_name: 'Ewa', last_name: 'Nowak' })
    const create = vi.spyOn(api, 'createAdminUser').mockResolvedValue({
      user: created, activation_url: 'http://localhost:8080/activate?token=secret',
    })
    renderScreen(<PeoplePanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Nowe konto' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nowe konto lokalne' })
    const submit = within(dialog).getByRole('button', { name: 'Utwórz konto' })
    expect(submit).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText(/^Login/), { target: { value: 'ewa' } })
    fireEvent.change(within(dialog).getByLabelText(/^Imię/), { target: { value: 'Ewa' } })
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Koordynator' }))
    expect(submit).toBeEnabled()
    fireEvent.click(submit)
    expect(await within(dialog).findByText(/activate\?token=secret/)).toBeInTheDocument()
    expect(create.mock.calls[0][0]).toMatchObject({ username: 'ewa', first_name: 'Ewa', role: 'coordinator' })
  })
})
