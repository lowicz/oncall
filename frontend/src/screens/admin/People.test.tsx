import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { focusManager } from '@tanstack/react-query'
import { api } from '../../api'
import type { AdminUser, TeamMember } from '../../api'
import { renderScreen } from '../../test/render'
import { PeoplePanel } from './People'

const user = (over: Partial<AdminUser> & { id: string }): AdminUser => ({
  username: 'anna', personnel_number: '004512', first_name: 'Anna', last_name: 'Kowalska',
  display_name: 'Anna Kowalska', auth_source: 'local', role: 'member',
  email: 'anna@example.com', phone: null, is_active: true, created_at: '2025-09-02T10:00:00Z',
  pending_activation: null, ...over,
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
  vi.spyOn(api, 'publicConfig').mockResolvedValue({ ldap_enabled: false, app_name: 'On-call', app_subtitle: '', version: '1.4.0', audit_retention_days: 365, login_audit_retention_days: 90 })
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
    expect(within(sheet).getByText(/pojawi się jako „Osoba usunięta #…”/)).toBeInTheDocument()
    expect(within(sheet).getByText(/Audyt zachowuje imię i nazwisko/)).toBeInTheDocument()
    const confirm = within(sheet).getByRole('button', { name: 'Usuń konto i dane' })
    expect(confirm).toBeDisabled()
    fireEvent.change(within(sheet).getByLabelText('Wpisz login, żeby potwierdzić'), { target: { value: 'ann' } })
    expect(confirm).toBeDisabled()
    fireEvent.change(within(sheet).getByLabelText('Wpisz login, żeby potwierdzić'), { target: { value: 'anna' } })
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)
    await waitFor(() => expect(remove).toHaveBeenCalledWith('u1'))
  })

  it('promises no pseudonym for an account that never joined the rotation', async () => {
    mockData()
    renderScreen(<PeoplePanel />)
    const dialog = await openRow('anna')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Usuń konto…' }))
    const sheet = await screen.findByRole('dialog', { name: 'Usuwam konto Anna Kowalska i jego dane osobowe' })
    expect(within(sheet).getByText(/zostaną usunięte/)).toBeInTheDocument()
    expect(within(sheet).queryByText(/Osoba usunięta/)).not.toBeInTheDocument()
  })
})

// TEST_NOW is 10-09-2026 09:00 in Warsaw.
const waiting = { link_expires_at: '2026-09-11T07:30:00Z' }
const expired = { link_expires_at: '2026-09-09T22:15:00Z' }
const pendingAccounts = () => [
  user({ id: 'u1', pending_activation: waiting }),
  user({ id: 'u2', username: 'ewa', first_name: 'Ewa', last_name: 'Maj', display_name: 'Ewa Maj', email: null, pending_activation: expired }),
  user({ id: 'u3', username: 'olek', first_name: 'Olek', last_name: 'Wyłączony', display_name: 'Olek Wyłączony', email: null, is_active: false, pending_activation: { link_expires_at: null } }),
  user({ id: 'u4', username: 'tomasz', first_name: 'Tomasz', last_name: 'Lis', display_name: 'Tomasz Lis' }),
  user({ id: 'u5', username: 'widz', first_name: 'Service', last_name: 'Desk', display_name: 'Service Desk', auth_source: 'ldap' }),
]

describe('PeoplePanel pending activation', () => {
  it('marks accounts waiting for their first password, with how long the link lasts', async () => {
    mockData(pendingAccounts())
    renderScreen(<PeoplePanel />)

    const anna = await rowOf('anna')
    expect(within(anna).getByText('oczekuje na aktywację')).toHaveClass('st-warn')
    expect(within(anna).getByText(/link aktywacyjny ważny do 11-09-2026, 09:30/)).toBeInTheDocument()
    const ewa = await rowOf('ewa')
    expect(within(ewa).getByText('oczekuje na aktywację')).toHaveClass('st-bad')
    // 22:15 UTC is already the next day in Warsaw.
    expect(within(ewa).getByText(/link aktywacyjny wygasł 10-09-2026, 00:15/)).toBeInTheDocument()
    const olek = await rowOf('olek')
    expect(within(olek).getByText('oczekuje na aktywację')).toBeInTheDocument()
    expect(within(olek).getByText(/brak ważnego linku aktywacyjnego/)).toBeInTheDocument()
    expect(within(olek).getByText('konto wyłączone')).toBeInTheDocument()
    for (const username of ['tomasz', 'widz']) {
      expect(within(await rowOf(username)).queryByText('oczekuje na aktywację')).not.toBeInTheDocument()
    }
    expect(screen.getByText(/5 kont · 0 w rotacji · 1 wyłączone · 3 oczekują na aktywację/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Oczekujące' }))
    expect(screen.getByText('anna', { selector: 'td' })).toBeInTheDocument()
    expect(screen.getByText('ewa', { selector: 'td' })).toBeInTheDocument()
    expect(screen.getByText('olek', { selector: 'td' })).toBeInTheDocument()
    expect(screen.queryByText('tomasz', { selector: 'td' })).not.toBeInTheDocument()
    expect(screen.queryByText('widz', { selector: 'td' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Wyłączone' }))
    expect(screen.queryByText('anna', { selector: 'td' })).not.toBeInTheDocument()
    expect(screen.getByText('olek', { selector: 'td' })).toBeInTheDocument()
  })

  it('reissues the activation link from the access tab after a confirmation', async () => {
    mockData([user({ id: 'u1', pending_activation: expired })])
    const reissue = vi.spyOn(api, 'reissueActivation').mockResolvedValue({
      url: 'http://localhost:8080/activate?token=fresh', expires_at: '2026-09-11T07:00:00Z',
    })
    const reset = vi.spyOn(api, 'issuePasswordReset')
    renderScreen(<PeoplePanel />)
    const dialog = await openRow('anna')
    expect(within(dialog).getByText('oczekuje na aktywację')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Dostęp' }))
    expect(within(dialog).getByText(/nie ustawiła jeszcze hasła/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Link aktywacyjny wygasł 10-09-2026, 00:15\./)).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /reset hasła/i })).not.toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Wygeneruj nowy link aktywacyjny' }))
    const confirmation = await screen.findByRole('dialog', { name: 'Wygenerować nowy link aktywacyjny?' })
    expect(reissue).not.toHaveBeenCalled()
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Wygeneruj link' }))
    await waitFor(() => expect(reissue).toHaveBeenCalledWith('u1'))
    expect(await within(dialog).findByText(/activate\?token=fresh/)).toBeInTheDocument()
    await waitFor(() => expect(api.adminUsers).toHaveBeenCalledTimes(2))
    expect(reset).not.toHaveBeenCalled()
  })

  it('shows why a refused reissue failed', async () => {
    mockData([user({ id: 'u1', pending_activation: waiting })])
    vi.spyOn(api, 'reissueActivation').mockRejectedValue(new Error('Konto ma już hasło; zamiast linku aktywacyjnego wygeneruj reset hasła'))
    renderScreen(<PeoplePanel />)
    const dialog = await openRow('anna')
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Dostęp' }))
    expect(within(dialog).getByText(/Link aktywacyjny ważny do 11-09-2026, 09:30\./)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Wygeneruj nowy link aktywacyjny' }))
    const confirmation = await screen.findByRole('dialog', { name: 'Wygenerować nowy link aktywacyjny?' })
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Wygeneruj link' }))
    expect(await within(confirmation).findByText(/Konto ma już hasło/)).toBeInTheDocument()
  })

  it('asks to enable a disabled account before reissuing its link', async () => {
    mockData([user({ id: 'u1', is_active: false, pending_activation: { link_expires_at: null } })])
    renderScreen(<PeoplePanel />)
    const dialog = await openRow('anna')
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Dostęp' }))
    expect(within(dialog).getByText(/Brak ważnego linku aktywacyjnego\./)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Wygeneruj nowy link aktywacyjny' })).toBeDisabled()
    expect(within(dialog).getByText(/włącz je, żeby wysłać link/)).toBeInTheDocument()
  })

  it('offers an activated local account a password reset instead', async () => {
    mockData()
    renderScreen(<PeoplePanel />)
    const dialog = await openRow('anna')
    expect(within(dialog).queryByText('oczekuje na aktywację')).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Dostęp' }))
    expect(within(dialog).getByRole('checkbox', { name: /Konto włączone/ })).toBeChecked()
    expect(within(dialog).queryByRole('button', { name: 'Wygeneruj nowy link aktywacyjny' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Wygeneruj reset hasła' })).toBeInTheDocument()
  })
})

describe('PeoplePanel new account', () => {
  it('closes the new account panel with its close button', async () => {
    mockData([])
    renderScreen(<PeoplePanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Nowe konto' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nowe konto lokalne' })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Zamknij panel' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nowe konto lokalne' })).not.toBeInTheDocument())
  })

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

const ldapConfig = () => vi.spyOn(api, 'publicConfig').mockResolvedValue({
  ldap_enabled: true, app_name: 'On-call', app_subtitle: '', version: '1.4.0', audit_retention_days: 365, login_audit_retention_days: 90,
})

// Anna is in the rotation until the end of the year with one open and one
// closed qualification, Ewa's rotation has ended, Olek never joined it.
const mixedAccounts = () => [
  user({ id: 'u1', phone: '+48 601 220 118', pending_activation: waiting }),
  user({ id: 'u2', username: 'ewa', personnel_number: null, first_name: 'Ewa', last_name: 'Maj', display_name: 'Ewa "Ewka" Maj',
    email: null, is_active: false, pending_activation: expired }),
  user({ id: 'u3', username: 'olek', personnel_number: '7', first_name: 'Olek', last_name: 'Zych', display_name: 'Olek Zych',
    auth_source: 'ldap', role: 'viewer', email: 'olek@example.com', phone: '+48 500 100 200' }),
]
const mixedMembers = () => [
  member({ id: 'm1', user_id: 'u1', active_until: '2026-12-31', eligibility: [
    { id: 'e1', role: 'primary', starts_on: '2025-09-02', ends_on: null },
    { id: 'e2', role: 'late_shift', starts_on: '2025-09-02', ends_on: '2026-01-31' },
  ] }),
  member({ id: 'm2', user_id: 'u2', display_name: 'Ewa Maj', active_until: '2026-06-30', eligibility: [] }),
]

describe('PeoplePanel table states and export', () => {
  it('reads an exit date, an ended rotation and a person outside the rotation', async () => {
    mockData(mixedAccounts(), mixedMembers())
    renderScreen(<PeoplePanel />)

    const anna = await rowOf('anna')
    expect(within(anna).getByText('od 02-09-2025 do 31-12-2026 · P')).toBeInTheDocument()
    const ewa = await rowOf('ewa')
    expect(within(ewa).getByText('zakończona')).toBeInTheDocument()
    expect(within(ewa).getByText('do 30-06-2026')).toBeInTheDocument()
    expect(within(ewa).getByText('–', { selector: 'small' })).toBeInTheDocument()
    // No phone is only a problem for somebody who takes duties.
    expect(within(ewa).queryByText('brak')).not.toBeInTheDocument()
    const olek = await rowOf('olek')
    expect(within(olek).getByText('nie dotyczy')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Poza rotacją' }))
    expect(screen.queryByText('anna', { selector: 'td' })).not.toBeInTheDocument()
    expect(screen.getByText('ewa', { selector: 'td' })).toBeInTheDocument()
    expect(screen.getByText('olek', { selector: 'td' })).toBeInTheDocument()
  })

  it('says a member in the rotation has no qualifications', async () => {
    mockData([user({ id: 'u1', role: 'viewer', phone: '+48 1' })], [member({ id: 'm1', eligibility: [] })])
    renderScreen(<PeoplePanel />)

    const anna = await rowOf('anna')
    expect(within(anna).getByText('od 02-09-2025 · bez kwalifikacji')).toBeInTheDocument()
  })

  it('finds people by phone and personnel number and says when nobody matches', async () => {
    mockData(mixedAccounts(), mixedMembers())
    renderScreen(<PeoplePanel />)
    await rowOf('anna')
    const search = screen.getByRole('searchbox', { name: /Szukaj osoby/ })

    fireEvent.change(search, { target: { value: '500 100' } })
    expect(screen.getByText('olek', { selector: 'td' })).toBeInTheDocument()
    expect(screen.queryByText('anna', { selector: 'td' })).not.toBeInTheDocument()
    fireEvent.change(search, { target: { value: '004512' } })
    expect(screen.getByText('anna', { selector: 'td' })).toBeInTheDocument()
    expect(screen.queryByText('olek', { selector: 'td' })).not.toBeInTheDocument()

    fireEvent.change(search, { target: { value: 'nikt taki' } })
    expect(screen.getByText('Brak kont dla wybranego filtra')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Eksport CSV' })).toBeDisabled()
  })

  it('shows why the accounts could not be loaded', async () => {
    vi.spyOn(api, 'adminUsers').mockRejectedValue(new Error('Brak uprawnień'))
    vi.spyOn(api, 'team').mockResolvedValue([])
    vi.spyOn(api, 'publicConfig').mockRejectedValue(new Error('offline'))
    renderScreen(<PeoplePanel />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Brak uprawnień')
    expect(screen.getByText('Konta, dostęp do systemu i okresy uczestnictwa w rotacji.')).toBeInTheDocument()
  })

  it('exports the listed accounts as a semicolon CSV with their rotation and activation', async () => {
    mockData(mixedAccounts(), mixedMembers())
    let exported: Blob | undefined
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL: vi.fn((blob: Blob) => { exported = blob; return 'blob:people' }), revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('osoby-2026-09-10.csv')
    })
    renderScreen(<PeoplePanel />)
    await rowOf('anna')

    fireEvent.click(screen.getByRole('button', { name: 'Eksport CSV' }))

    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:people')
    expect(Array.from(new Uint8Array(await exported!.slice(0, 3).arrayBuffer()))).toEqual([0xef, 0xbb, 0xbf])
    expect((await exported!.text()).split('\n')).toEqual([
      'osoba;login;numer;email;telefon;rola;logowanie;aktywne;aktywacja;rotacja;wejscie;wyjscie;kwalifikacje',
      '"Anna Kowalska";"anna";"004512";"anna@example.com";"+48 601 220 118";"Członek zespołu";"lokalne";"tak";"oczekuje";"active";"2025-09-02";"2026-12-31";"PRIMARY"',
      '"Ewa ""Ewka"" Maj";"ewa";"";"";"";"Członek zespołu";"lokalne";"nie";"oczekuje, link wygasł";"ended";"2025-09-02";"2026-06-30";""',
      '"Olek Zych";"olek";"7";"olek@example.com";"+48 500 100 200";"Podgląd";"LDAP / AD";"tak";"";"outside";"";"";""',
    ])
  })
})

describe('PeoplePanel new account form', () => {
  it('sends every field, clears emptied ones to null and explains the directory link', async () => {
    mockData([])
    ldapConfig()
    const create = vi.spyOn(api, 'createAdminUser').mockResolvedValue({
      user: user({ id: 'u2' }), activation_url: 'http://localhost:8080/activate?token=secret',
    })
    renderScreen(<PeoplePanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Nowe konto' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nowe konto lokalne' })
    expect(await within(dialog).findByText('Konta AD logują się loginem domenowym.')).toBeInTheDocument()
    expect(within(dialog).getByText('Klucz dowiązania z AD: zgodny z employeeNumber.')).toBeInTheDocument()
    expect(within(dialog).getByText(/Przy pierwszym logowaniu LDAP z tym numerem pracownika/)).toBeInTheDocument()

    fireEvent.change(within(dialog).getByLabelText(/^Imię/), { target: { value: 'Ewa' } })
    fireEvent.change(within(dialog).getByLabelText('Nazwisko'), { target: { value: 'Nowak' } })
    fireEvent.change(within(dialog).getByLabelText(/^Login/), { target: { value: 'ewa' } })
    fireEvent.change(within(dialog).getByLabelText('Numer pracownika'), { target: { value: '0042' } })
    fireEvent.change(within(dialog).getByLabelText('E-mail'), { target: { value: 'ewa@example.com' } })
    fireEvent.change(within(dialog).getByLabelText(/^Telefon/), { target: { value: '+48 1' } })
    fireEvent.change(within(dialog).getByLabelText('E-mail'), { target: { value: '' } })
    fireEvent.change(within(dialog).getByLabelText(/^Telefon/), { target: { value: '' } })
    fireEvent.change(within(dialog).getByLabelText('Numer pracownika'), { target: { value: '' } })
    fireEvent.change(within(dialog).getByLabelText('Numer pracownika'), { target: { value: '0042' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Utwórz konto' }))

    expect(await within(dialog).findByText(/activate\?token=secret/)).toBeInTheDocument()
    expect(create.mock.calls[0][0]).toEqual({
      username: 'ewa', personnel_number: '0042', first_name: 'Ewa', last_name: 'Nowak', email: null, phone: null, role: 'member',
    })
    expect(within(dialog).queryByRole('button', { name: 'Utwórz konto' })).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zamknij' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nowe konto lokalne' })).not.toBeInTheDocument())

    // Opening it again starts from an empty form, not from the link.
    fireEvent.click(screen.getByRole('button', { name: 'Nowe konto' }))
    const again = await screen.findByRole('dialog', { name: 'Nowe konto lokalne' })
    expect(within(again).getByLabelText(/^Login/)).toHaveValue('')
    expect(within(again).queryByText(/activate\?token=secret/)).not.toBeInTheDocument()
  })

  it('shows why an account could not be created and can be cancelled', async () => {
    mockData([])
    vi.spyOn(api, 'createAdminUser').mockRejectedValue(new Error('Login jest już zajęty'))
    renderScreen(<PeoplePanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Nowe konto' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nowe konto lokalne' })
    expect(within(dialog).queryByText(/Przy pierwszym logowaniu LDAP/)).not.toBeInTheDocument()

    fireEvent.change(within(dialog).getByLabelText(/^Imię/), { target: { value: 'Ewa' } })
    fireEvent.change(within(dialog).getByLabelText(/^Login/), { target: { value: 'anna' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Utwórz konto' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Login jest już zajęty')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Anuluj' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nowe konto lokalne' })).not.toBeInTheDocument())
  })
})

describe('PeoplePanel account tab', () => {
  it('opens from the name too, and closes at once while nothing changed', async () => {
    mockData()
    const save = vi.spyOn(api, 'updateAdminUser')
    const { container } = renderScreen(<PeoplePanel />)
    fireEvent.click(within(await rowOf('anna')).getByRole('button', { name: /Anna Kowalska/ }))
    const dialog = await screen.findByRole('dialog', { name: /Anna Kowalska/ })

    expect(within(dialog).getByRole('button', { name: 'Zapisz' })).toBeDisabled()
    fireEvent.submit(document.getElementById('person-form')!)
    expect(save).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zamknij' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Anna Kowalska/ })).not.toBeInTheDocument())
    expect(container.querySelector('tr.on')).toBeNull()
  })

  it('closes on Escape while nothing changed', async () => {
    mockData()
    renderScreen(<PeoplePanel />)
    const dialog = await openRow('anna')

    fireEvent.keyDown(dialog, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Anna Kowalska/ })).not.toBeInTheDocument())
  })

  it('tells how a local account will link to the directory', async () => {
    mockData([user({ id: 'u1' }), user({ id: 'u2', username: 'ewa', personnel_number: null, display_name: 'Ewa Maj' })])
    ldapConfig()
    renderScreen(<PeoplePanel />)

    const dialog = await openRow('anna')
    expect(await within(dialog).findByText(/zgadza się z employeeNumber w AD \(obecnie: 004512\)/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zamknij' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Anna Kowalska/ })).not.toBeInTheDocument())

    fireEvent.click(within(await rowOf('ewa')).getByRole('button', { name: 'Otwórz' }))
    const ewa = await screen.findByRole('dialog', { name: /Ewa Maj/ })
    expect(within(ewa).getByText(/\(obecnie brak - bez numeru dowiązanie nie nastąpi\)/)).toBeInTheDocument()
  })

  it('lists every pending change and saves the whole account form', async () => {
    mockData([user({ id: 'u1' })], [member({ id: 'm1' })])
    let saved: () => void = () => {}
    const save = vi.spyOn(api, 'updateAdminUser').mockReturnValue(new Promise((done) => { saved = () => done(user({ id: 'u1' })) }))
    renderScreen(<PeoplePanel />)
    const dialog = await openRow('anna')
    expect(within(dialog).getByText('Wymagany dla osób w rotacji.')).toBeInTheDocument()

    fireEvent.change(within(dialog).getByLabelText(/^Imię/), { target: { value: 'Anna Maria' } })
    fireEvent.change(within(dialog).getByLabelText('Nazwisko'), { target: { value: 'Nowak' } })
    fireEvent.change(within(dialog).getByLabelText('Numer pracownika'), { target: { value: '' } })
    fireEvent.change(within(dialog).getByLabelText('E-mail'), { target: { value: '' } })
    fireEvent.change(within(dialog).getByLabelText(/^Telefon/), { target: { value: '+48 601 000 000' } })
    expect(within(dialog).queryByText('Wymagany dla osób w rotacji.')).not.toBeInTheDocument()
    expect(within(dialog).getByText('Niezapisane: imię · nazwisko · numer pracownika · e-mail · telefon')).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText(/^Telefon/), { target: { value: '' } })
    fireEvent.change(within(dialog).getByLabelText(/^Telefon/), { target: { value: '+48 601 000 000' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz (5)' }))

    expect(await within(dialog).findByRole('button', { name: /Zapisuję…/ })).toBeDisabled()
    expect(save.mock.calls[0][0]).toEqual({ id: 'u1', input: {
      first_name: 'Anna Maria', last_name: 'Nowak', personnel_number: null, email: null, phone: '+48 601 000 000',
      role: 'member', is_active: true,
    } })
    saved()
    await waitFor(() => expect(api.adminUsers).toHaveBeenCalledTimes(2))
  })

  it('shows why the account could not be saved and keeps the changes', async () => {
    mockData()
    vi.spyOn(api, 'updateAdminUser').mockRejectedValue(new Error('E-mail jest już używany'))
    renderScreen(<PeoplePanel />)
    const dialog = await openRow('anna')

    fireEvent.change(within(dialog).getByLabelText('E-mail'), { target: { value: 'ewa@example.com' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz (1)' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('E-mail jest już używany')
    expect(within(dialog).getByLabelText('E-mail')).toHaveValue('ewa@example.com')
  })

  it('stays open with the changes when closing is not confirmed', async () => {
    mockData()
    renderScreen(<PeoplePanel />)
    const dialog = await openRow('anna')
    fireEvent.change(within(dialog).getByLabelText('Nazwisko'), { target: { value: 'Nowak' } })

    fireEvent.keyDown(dialog, { key: 'Escape' })
    const warning = await screen.findByRole('dialog', { name: 'Zamknąć bez zapisywania?' })
    expect(within(warning).getByText(/Masz niezapisane zmiany: nazwisko\./)).toBeInTheDocument()
    fireEvent.click(within(warning).getByRole('button', { name: 'Anuluj' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Zamknąć bez zapisywania?' })).not.toBeInTheDocument())
    expect(screen.getByRole('dialog', { name: /Anna Kowalska/ })).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Nazwisko')).toHaveValue('Nowak')
  })
})

describe('PeoplePanel access tab', () => {
  const openAccess = async () => {
    const dialog = await openRow('anna')
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Dostęp' }))
    return dialog
  }

  it('asks before disabling an account and saves nothing when that is cancelled', async () => {
    mockData()
    const save = vi.spyOn(api, 'updateAdminUser')
    renderScreen(<PeoplePanel />)
    const dialog = await openAccess()

    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Konto włączone/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz (1)' }))
    const confirmation = await screen.findByRole('dialog', { name: 'Potwierdź zmianę dostępu' })
    expect(within(confirmation).getByText(/Do zapisania: wyłączenie konta/)).toBeInTheDocument()
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Anuluj' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Potwierdź zmianę dostępu' })).not.toBeInTheDocument())
    expect(save).not.toHaveBeenCalled()
  })

  it('shows a refused access change inside the confirmation', async () => {
    mockData()
    vi.spyOn(api, 'updateAdminUser').mockRejectedValue(new Error('Nie można wyłączyć ostatniego administratora'))
    renderScreen(<PeoplePanel />)
    const dialog = await openAccess()

    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Konto włączone/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz (1)' }))
    const confirmation = await screen.findByRole('dialog', { name: 'Potwierdź zmianę dostępu' })
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Potwierdź i zapisz' }))

    expect(await within(confirmation).findByText('Nie można wyłączyć ostatniego administratora')).toBeInTheDocument()
  })

  it('enables a disabled account without a confirmation', async () => {
    mockData([user({ id: 'u1', is_active: false })])
    const save = vi.spyOn(api, 'updateAdminUser').mockResolvedValue(user({ id: 'u1' }))
    renderScreen(<PeoplePanel />)
    const dialog = await openAccess()
    expect(within(dialog).getByText('wyłączone')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Konto włączone/ }))
    expect(within(dialog).getByText('Niezapisane: włączenie konta')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz (1)' }))

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save.mock.calls[0][0].input.is_active).toBe(true)
    expect(screen.queryByRole('dialog', { name: 'Potwierdź zmianę dostępu' })).not.toBeInTheDocument()
  })

  it('issues a password reset link only after a confirmation', async () => {
    mockData()
    const reset = vi.spyOn(api, 'issuePasswordReset').mockResolvedValue({
      url: 'http://localhost:8080/reset?token=once', expires_at: '2026-09-10T08:00:00Z',
    })
    renderScreen(<PeoplePanel />)
    const dialog = await openAccess()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Wygeneruj reset hasła' }))
    let confirmation = await screen.findByRole('dialog', { name: 'Wygenerować reset hasła?' })
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Anuluj' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Wygenerować reset hasła?' })).not.toBeInTheDocument())
    expect(reset).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Wygeneruj reset hasła' }))
    confirmation = await screen.findByRole('dialog', { name: 'Wygenerować reset hasła?' })
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Wygeneruj link' }))

    expect(await within(dialog).findByText('http://localhost:8080/reset?token=once')).toBeInTheDocument()
    expect(within(dialog).getByText('Link resetu hasła (ważny godzinę)')).toBeInTheDocument()
    expect(reset).toHaveBeenCalledWith('u1')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Wygenerować reset hasła?' })).not.toBeInTheDocument())
  })

  it('shows a refused password reset inside the confirmation', async () => {
    mockData()
    vi.spyOn(api, 'issuePasswordReset').mockRejectedValue(new Error('Konto jest wyłączone'))
    renderScreen(<PeoplePanel />)
    const dialog = await openAccess()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Wygeneruj reset hasła' }))
    const confirmation = await screen.findByRole('dialog', { name: 'Wygenerować reset hasła?' })
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Wygeneruj link' }))

    expect(await within(confirmation).findByText('Konto jest wyłączone')).toBeInTheDocument()
  })

  it('cancels a reissue of the activation link', async () => {
    mockData([user({ id: 'u1', pending_activation: waiting })])
    const reissue = vi.spyOn(api, 'reissueActivation')
    renderScreen(<PeoplePanel />)
    const dialog = await openAccess()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Wygeneruj nowy link aktywacyjny' }))
    const confirmation = await screen.findByRole('dialog', { name: 'Wygenerować nowy link aktywacyjny?' })
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Anuluj' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Wygenerować nowy link aktywacyjny?' })).not.toBeInTheDocument())
    expect(reissue).not.toHaveBeenCalled()
  })
})

describe('PeoplePanel account deletion', () => {
  const openSheet = async () => {
    const dialog = await openRow('anna')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Usuń konto…' }))
    return screen.findByRole('dialog', { name: 'Usuwam konto Anna Kowalska i jego dane osobowe' })
  }

  it('keeps the account when the sheet is cancelled or dismissed', async () => {
    mockData()
    const remove = vi.spyOn(api, 'deleteAdminUser')
    renderScreen(<PeoplePanel />)

    fireEvent.click(within(await openSheet()).getByRole('button', { name: 'Anuluj' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Usuwam konto/ })).not.toBeInTheDocument())
    fireEvent.click(within(screen.getByRole('dialog', { name: /Anna Kowalska/ })).getByRole('button', { name: 'Usuń konto…' }))
    const sheet = await screen.findByRole('dialog', { name: /Usuwam konto/ })
    expect(within(sheet).getByLabelText('Wpisz login, żeby potwierdzić')).toHaveValue('')
    fireEvent.keyDown(sheet, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Usuwam konto/ })).not.toBeInTheDocument())
    expect(screen.getByRole('dialog', { name: /Anna Kowalska/ })).toBeInTheDocument()
    expect(remove).not.toHaveBeenCalled()
  })

  it('shows why the account could not be deleted', async () => {
    mockData()
    vi.spyOn(api, 'deleteAdminUser').mockRejectedValue(new Error('Nie można usunąć własnego konta'))
    renderScreen(<PeoplePanel />)
    const sheet = await openSheet()

    fireEvent.change(within(sheet).getByLabelText('Wpisz login, żeby potwierdzić'), { target: { value: ' anna ' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Usuń konto i dane' }))

    expect(await within(sheet).findByRole('alert')).toHaveTextContent('Nie można usunąć własnego konta')
  })
})

const openRotation = async (username = 'anna', name: RegExp = /Anna Kowalska/) => {
  fireEvent.click(within(await rowOf(username)).getByRole('button', { name: 'Otwórz' }))
  const dialog = await screen.findByRole('dialog', { name })
  fireEvent.click(within(dialog).getByRole('tab', { name: /Rotacja/ }))
  return dialog
}

describe('PeoplePanel rotation tab', () => {
  it('adds a person outside the rotation from the chosen date', async () => {
    mockData()
    const add = vi.spyOn(api, 'createTeamMember').mockResolvedValue(member({ id: 'm1', active_from: '2026-10-01' }))
    renderScreen(<PeoplePanel />)
    const dialog = await openRotation()
    expect(within(dialog).getByText('Poza rotacją')).toBeInTheDocument()

    fireEvent.change(within(dialog).getByLabelText('Wejście od'), { target: { value: '2026-10-01' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dodaj do rotacji' }))

    await waitFor(() => expect(add).toHaveBeenCalledWith({ user_id: 'u1', active_from: '2026-10-01' }))
    await waitFor(() => expect(api.team).toHaveBeenCalledTimes(2))
  })

  it('shows why a person could not be added to the rotation', async () => {
    mockData()
    vi.spyOn(api, 'createTeamMember').mockRejectedValue(new Error('Osoba jest już w rotacji'))
    renderScreen(<PeoplePanel />)
    const dialog = await openRotation()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Dodaj do rotacji' }))

    expect(await screen.findByText('Osoba jest już w rotacji')).toBeInTheDocument()
  })

  it('describes somebody entering the rotation with an exit date already set', async () => {
    mockData([user({ id: 'u1', phone: '+48 1' })], [member({ id: 'm1', active_from: '2026-10-12', active_until: '2026-12-31', eligibility: [
      { id: 'e1', role: 'primary', starts_on: '2026-10-12', ends_on: '2026-12-31' },
    ] })])
    renderScreen(<PeoplePanel />)
    const dialog = await openRotation()

    expect(within(dialog).getByText('Wchodzi do rotacji 12-10-2026')).toBeInTheDocument()
    expect(within(dialog).getByText(/Wyjście do 31-12-2026\. Kwalifikacje: brak - generator nie przydzieli tej osobie żadnej roli\./)).toBeInTheDocument()
    expect(within(dialog).getByText('12-10-2026 → 31-12-2026')).toBeInTheDocument()
    expect(within(dialog).getByText('Skutek dla grafiku')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Zapisz' })).toBeDisabled()
  })

  it('describes an ended rotation with its past periods as history', async () => {
    mockData([user({ id: 'u1' })], [member({ id: 'm1', active_until: '2026-06-30', eligibility: [
      { id: 'e1', role: 'primary', starts_on: '2025-09-02', ends_on: '2026-06-30' },
    ] })])
    renderScreen(<PeoplePanel />)
    const dialog = await openRotation()

    expect(within(dialog).getByText('Rotacja zakończona 30-06-2026')).toBeInTheDocument()
    expect(within(dialog).queryByText(/Wyjście do 30-06-2026\.|Bez daty wyjścia/)).not.toBeInTheDocument()
    const period = within(dialog).getByText('02-09-2025 → 30-06-2026').closest('.list-row') as HTMLElement
    expect(within(period).getByText('historia')).toBeInTheDocument()
    expect(within(period).queryByRole('button', { name: 'Edytuj' })).not.toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Usuń konto…' }))
    const sheet = await screen.findByRole('dialog', { name: /Usuwam konto/ })
    expect(within(sheet).getByText(/Osoba usunięta/)).toBeInTheDocument()
    expect(within(sheet).queryByText(/pozostaną bez obsady/)).not.toBeInTheDocument()
  })

  it('says a member without any period gets no duties', async () => {
    mockData([user({ id: 'u1' })], [member({ id: 'm1', eligibility: [] })])
    renderScreen(<PeoplePanel />)
    const dialog = await openRotation()

    expect(within(dialog).getByText(/Bez daty wyjścia\. Kwalifikacje: brak/)).toBeInTheDocument()
    expect(within(dialog).getByText('Brak okresów; generator nie przydzieli tej osobie żadnej roli.')).toBeInTheDocument()
  })

  it('saves new rotation dates for the member', async () => {
    mockData([user({ id: 'u1', phone: '+48 1' })], [member({ id: 'm1' })])
    const save = vi.spyOn(api, 'updateTeamMember').mockResolvedValue(member({ id: 'm1' }))
    renderScreen(<PeoplePanel />)
    const dialog = await openRotation()
    expect(within(dialog).queryByText('Skutek dla grafiku')).not.toBeInTheDocument()

    fireEvent.change(within(dialog).getByLabelText('Wejście od'), { target: { value: '2025-10-01' } })
    fireEvent.change(within(dialog).getByLabelText(/^Wyjście do/), { target: { value: '2026-12-31' } })

    expect(within(dialog).getByText('Niezapisane: wejście do rotacji: 01-10-2025 · wyjście z rotacji: 31-12-2026')).toBeInTheDocument()
    expect(within(dialog).getByText(/Dyżury opublikowane po 31-12-2026 zostaną bez obsady/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz (2)' }))

    await waitFor(() => expect(save).toHaveBeenCalledWith({ id: 'm1', input: { active_from: '2025-10-01', active_until: '2026-12-31' } }))
  })

  it('removes an exit date', async () => {
    mockData([user({ id: 'u1', phone: '+48 1' })], [member({ id: 'm1', active_until: '2026-12-31' })])
    const save = vi.spyOn(api, 'updateTeamMember').mockResolvedValue(member({ id: 'm1' }))
    renderScreen(<PeoplePanel />)
    const dialog = await openRotation()

    fireEvent.change(within(dialog).getByLabelText(/^Wyjście do/), { target: { value: '' } })
    expect(within(dialog).getByText('Niezapisane: usunięcie daty wyjścia z rotacji')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz (1)' }))

    await waitFor(() => expect(save).toHaveBeenCalledWith({ id: 'm1', input: { active_from: '2025-09-02', active_until: null } }))
  })

  it('opens the offboarding from the exit date and closes the panel once it is done', async () => {
    mockData([user({ id: 'u1', phone: '+48 1' })], [member({ id: 'm1', active_until: '2026-12-31' })])
    vi.spyOn(api, 'calendar').mockResolvedValue({
      starts_on: '2027-01-01', ends_on: '2027-03-31', days: [], members: [], team_has_members: true, assignments: [], availability: [],
    })
    const endPeriod = vi.spyOn(api, 'updateEligibility').mockResolvedValue({ id: 'e1', role: 'primary', starts_on: '2025-09-02', ends_on: '2026-12-31' })
    const finish = vi.spyOn(api, 'updateTeamMember').mockResolvedValue(member({ id: 'm1', active_until: '2026-12-31' }))
    renderScreen(<PeoplePanel />)
    const dialog = await openRotation()
    const offboard = () => fireEvent.click(within(dialog).getByRole('button', { name: 'Przepisz przyszłe dyżury i zakończ rotację…' }))

    offboard()
    let sheet = await screen.findByRole('dialog', { name: 'Zakończenie rotacji: Anna Kowalska' })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Anuluj' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Zakończenie rotacji/ })).not.toBeInTheDocument())
    expect(finish).not.toHaveBeenCalled()

    offboard()
    sheet = await screen.findByRole('dialog', { name: 'Zakończenie rotacji: Anna Kowalska' })
    expect(await within(sheet).findByText(/Brak dyżurów po dacie wyjścia/)).toBeInTheDocument()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Przepisz dyżury i zakończ rotację' }))
    fireEvent.click(within(sheet).getByRole('button', { name: 'Potwierdź zakończenie rotacji' }))

    await waitFor(() => expect(finish).toHaveBeenCalledWith({ id: 'm1', input: { active_until: '2026-12-31' } }))
    expect(endPeriod).toHaveBeenCalledWith({ id: 'e1', input: { ends_on: '2026-12-31' } })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Anna Kowalska/ })).not.toBeInTheDocument())
  })
})

describe('PeoplePanel qualification periods', () => {
  it('adds a period for the chosen role and dates, open-ended when no end is given', async () => {
    mockData([user({ id: 'u1', phone: '+48 1' })], [member({ id: 'm1' })])
    const add = vi.spyOn(api, 'createEligibility').mockResolvedValue({ id: 'e3', role: 'secondary', starts_on: '2026-10-01', ends_on: '2026-12-31' })
    renderScreen(<PeoplePanel />)
    const dialog = await openRotation()
    const toggle = within(dialog).getByRole('button', { name: 'Dodaj okres', pressed: false })

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(toggle)
    expect(within(dialog).queryByRole('radiogroup', { name: 'Rola dyżurowa' })).not.toBeInTheDocument()
    fireEvent.click(toggle)
    fireEvent.click(within(within(dialog).getByRole('radiogroup', { name: 'Rola dyżurowa' })).getByRole('radio', { name: 'SECONDARY' }))
    fireEvent.change(within(dialog).getByLabelText('Od'), { target: { value: '2026-10-01' } })
    fireEvent.change(within(dialog).getByLabelText('Do (opcjonalnie)'), { target: { value: '2026-12-31' } })
    const submitPeriod = () => fireEvent.click(within(dialog).getAllByRole('button', { name: 'Dodaj okres' }).find((button) => !button.hasAttribute('aria-pressed'))!)
    submitPeriod()

    await waitFor(() => expect(add).toHaveBeenCalledWith({ memberId: 'm1', input: { role: 'secondary', starts_on: '2026-10-01', ends_on: '2026-12-31' } }))
    await waitFor(() => expect(within(dialog).queryByRole('radiogroup', { name: 'Rola dyżurowa' })).not.toBeInTheDocument())

    fireEvent.click(toggle)
    expect(within(dialog).getByLabelText('Do (opcjonalnie)')).toHaveValue('')
    submitPeriod()
    await waitFor(() => expect(add).toHaveBeenLastCalledWith({ memberId: 'm1', input: { role: 'secondary', starts_on: '2026-10-01', ends_on: null } }))
  })

  it('shows why a period could not be added', async () => {
    mockData([user({ id: 'u1', phone: '+48 1' })], [member({ id: 'm1' })])
    vi.spyOn(api, 'createEligibility').mockRejectedValue(new Error('Okresy nakładają się'))
    renderScreen(<PeoplePanel />)
    const dialog = await openRotation()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Dodaj kwalifikację SECONDARY' }))

    expect(await screen.findByText('Okresy nakładają się')).toBeInTheDocument()
  })

  it('marks an edited period as unsaved until it is edited back', async () => {
    mockData([user({ id: 'u1', phone: '+48 1' })], [member({ id: 'm1', eligibility: [
      { id: 'e1', role: 'primary', starts_on: '2025-09-02', ends_on: null },
      { id: 'e2', role: 'late_shift', starts_on: '2025-09-02', ends_on: '2026-12-31' },
    ] })])
    renderScreen(<PeoplePanel />)
    const dialog = await openRotation()
    const lateShift = within(dialog).getByText('02-09-2025 → 31-12-2026').closest('.list-row') as HTMLElement

    fireEvent.click(within(lateShift).getByRole('button', { name: 'Edytuj' }))
    fireEvent.change(within(dialog).getByLabelText('Do (opcjonalnie)'), { target: { value: '' } })
    expect(within(dialog).getByText('Niezapisane: okres 11–19')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Gotowe' }))
    const edited = within(dialog).getAllByText('02-09-2025 → ∞').map((row) => row.closest('.list-row') as HTMLElement)
      .find((row) => within(row).queryByText(/zmieniony, niezapisany/))!
    expect(within(edited).getByText('11–19 · zmieniony, niezapisany')).toBeInTheDocument()

    fireEvent.click(within(edited).getByRole('button', { name: 'Edytuj' }))
    fireEvent.change(within(dialog).getByLabelText('Do (opcjonalnie)'), { target: { value: '2026-12-31' } })
    expect(within(dialog).queryByText(/Niezapisane/)).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Zapisz' })).toBeDisabled()
  })

  it('saves a new start alone and refuses a period left without a start', async () => {
    mockData([user({ id: 'u1', phone: '+48 1' })], [member({ id: 'm1' })])
    const save = vi.spyOn(api, 'updateEligibility').mockResolvedValue({ id: 'e1', role: 'primary', starts_on: '2025-10-01', ends_on: null })
    renderScreen(<PeoplePanel />)
    const dialog = await openRotation()
    const primary = within(dialog).getAllByText('02-09-2025 → ∞')[0].closest('.list-row') as HTMLElement

    fireEvent.click(within(primary).getByRole('button', { name: 'Edytuj' }))
    fireEvent.change(within(dialog).getByLabelText('Od'), { target: { value: '' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz (1)' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Każdy okres kwalifikacji musi mieć datę początku')
    expect(save).not.toHaveBeenCalled()

    fireEvent.change(within(dialog).getByLabelText('Od'), { target: { value: '2025-10-01' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz (1)' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ id: 'e1', input: { starts_on: '2025-10-01', ends_on: null } }))
  })

  it('deletes a period from its editor and shows a refusal', async () => {
    mockData([user({ id: 'u1', phone: '+48 1' })], [member({ id: 'm1' })])
    const remove = vi.spyOn(api, 'deleteEligibility')
      .mockRejectedValueOnce(new Error('Okres ma opublikowane dyżury'))
      .mockResolvedValue(undefined)
    renderScreen(<PeoplePanel />)
    const dialog = await openRotation()
    const primary = within(dialog).getAllByText('02-09-2025 → ∞')[0].closest('.list-row') as HTMLElement

    fireEvent.click(within(primary).getByRole('button', { name: 'Edytuj' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Usuń' }))
    expect(await screen.findByText('Okres ma opublikowane dyżury')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Usuń' }))

    await waitFor(() => expect(remove).toHaveBeenCalledTimes(2))
    expect(remove).toHaveBeenLastCalledWith('e1')
    await waitFor(() => expect(screen.queryByText('Okres ma opublikowane dyżury')).not.toBeInTheDocument())
  })

  it('drops a qualification that has not started yet instead of ending it', async () => {
    mockData([user({ id: 'u1', phone: '+48 1' })], [member({ id: 'm1', eligibility: [
      { id: 'e1', role: 'secondary', starts_on: '2025-01-01', ends_on: '2025-12-31' },
      { id: 'e3', role: 'secondary', starts_on: '2026-09-10', ends_on: null },
    ] })])
    const remove = vi.spyOn(api, 'deleteEligibility').mockResolvedValue(undefined)
    const end = vi.spyOn(api, 'updateEligibility')
    renderScreen(<PeoplePanel />)
    const dialog = await openRotation()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Zdejmij kwalifikację SECONDARY' }))

    await waitFor(() => expect(remove).toHaveBeenCalledWith('e3'))
    expect(remove).toHaveBeenCalledTimes(1)
    expect(end).not.toHaveBeenCalled()
  })

  it('shows why a qualification could not be dropped', async () => {
    mockData([user({ id: 'u1', phone: '+48 1' })], [member({ id: 'm1' })])
    vi.spyOn(api, 'updateEligibility').mockRejectedValue(new Error('Konflikt wersji'))
    renderScreen(<PeoplePanel />)
    const dialog = await openRotation()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Zdejmij kwalifikację PRIMARY' }))

    expect(await screen.findByText('Konflikt wersji')).toBeInTheDocument()
  })

  it('does not resend a period edit the server already holds', async () => {
    // Adding a chip reloads the team while a period edit is still pending;
    // the reloaded period already starts where the edit moved it.
    vi.spyOn(api, 'adminUsers').mockResolvedValue([user({ id: 'u1', phone: '+48 1' })])
    vi.spyOn(api, 'publicConfig').mockRejectedValue(new Error('offline'))
    vi.spyOn(api, 'team')
      .mockResolvedValueOnce([member({ id: 'm1' })])
      .mockResolvedValue([member({ id: 'm1', eligibility: [
        { id: 'e1', role: 'primary', starts_on: '2025-10-01', ends_on: null },
        { id: 'e2', role: 'late_shift', starts_on: '2025-09-02', ends_on: null },
        { id: 'e3', role: 'secondary', starts_on: '2026-09-10', ends_on: null },
      ] })])
    vi.spyOn(api, 'createEligibility').mockResolvedValue({ id: 'e3', role: 'secondary', starts_on: '2026-09-10', ends_on: null })
    const period = vi.spyOn(api, 'updateEligibility')
    const account = vi.spyOn(api, 'updateAdminUser').mockResolvedValue(user({ id: 'u1' }))
    renderScreen(<PeoplePanel />)
    const dialog = await openRotation()
    const primary = within(dialog).getAllByText('02-09-2025 → ∞')[0].closest('.list-row') as HTMLElement
    fireEvent.click(within(primary).getByRole('button', { name: 'Edytuj' }))
    fireEvent.change(within(dialog).getByLabelText('Od'), { target: { value: '2025-10-01' } })
    expect(within(dialog).getByText('Niezapisane: okres PRIMARY')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Dodaj kwalifikację SECONDARY' }))
    await waitFor(() => expect(within(dialog).queryByText('Niezapisane: okres PRIMARY')).not.toBeInTheDocument())
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Konto' }))
    fireEvent.change(within(dialog).getByLabelText('E-mail'), { target: { value: 'nowy@example.com' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz (1)' }))

    await waitFor(() => expect(account).toHaveBeenCalledTimes(1))
    expect(period).not.toHaveBeenCalled()
  })
})

describe('PeoplePanel account removed meanwhile', () => {
  afterEach(() => focusManager.setFocused(undefined))

  it('refuses to save an access change for an account that disappeared while it was being confirmed', async () => {
    // Another administrator deletes the account; returning to the tab reloads
    // the list while the confirmation is still open.
    vi.spyOn(api, 'adminUsers').mockResolvedValueOnce([user({ id: 'u1' })]).mockResolvedValue([])
    vi.spyOn(api, 'team').mockResolvedValue([])
    vi.spyOn(api, 'publicConfig').mockRejectedValue(new Error('offline'))
    const save = vi.spyOn(api, 'updateAdminUser')
    renderScreen(<PeoplePanel />)
    const dialog = await openRow('anna')
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Dostęp' }))
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Administrator' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz (1)' }))
    const confirmation = await screen.findByRole('dialog', { name: 'Potwierdź zmianę dostępu' })

    act(() => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
    })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Anna Kowalska/ })).not.toBeInTheDocument())
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Potwierdź i zapisz' }))

    expect(await within(confirmation).findByText('Nie wybrano konta')).toBeInTheDocument()
    expect(save).not.toHaveBeenCalled()
  })
})
