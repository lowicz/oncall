import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  vi.spyOn(api, 'publicConfig').mockResolvedValue({ ldap_enabled: false, app_name: 'On-call', app_subtitle: '', version: '1.4.0', audit_retention_days: 365, login_audit_retention_days: 90, undo_window_seconds: 10, sso_enabled: false })
}

const rowOf = async (username: string) => (await screen.findByText(username, { selector: 'td' })).closest('tr') as HTMLTableRowElement
/** The row of the rotation tab's qualification list whose role is `role`. */
const qualification = (dialog: HTMLElement, role: string, index = 0) =>
  within(dialog).getAllByText(role, { selector: '.list-main > b' })[index].closest('.list-row') as HTMLElement
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
    fireEvent.click(screen.getByRole('radio', { name: 'Wyłączone' }))
    expect(screen.queryByText('anna', { selector: 'td' })).not.toBeInTheDocument()
    expect(screen.getByText('ewa', { selector: 'td' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'W rotacji' }))
    expect(screen.getByText('anna', { selector: 'td' })).toBeInTheDocument()
    expect(screen.queryByText('ewa', { selector: 'td' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Wszystkie' }))
    fireEvent.change(screen.getByRole('searchbox', { name: /Szukaj osoby/ }), { target: { value: 'maj' } })
    expect(screen.queryByText('anna', { selector: 'td' })).not.toBeInTheDocument()
    expect(screen.getByText('ewa', { selector: 'td' })).toBeInTheDocument()
  })

  it('keeps the search and the filter in the URL, so a refresh, Back and Forward show the same list', async () => {
    mockData(
      [
        user({ id: 'u1' }),
        user({ id: 'u2', username: 'ewa', first_name: 'Ewa', last_name: 'Maj', display_name: 'Ewa Maj', is_active: false }),
        user({ id: 'u3', username: 'olek', first_name: 'Olek', last_name: 'Maj', display_name: 'Olek Maj' }),
      ],
      [member({ id: 'm1', user_id: 'u1' })],
    )
    const { router } = renderScreen(<PeoplePanel />, { route: '/osoby?szukaj=maj&filtr=wylaczone' })
    await rowOf('ewa')
    expect(screen.getByRole('searchbox', { name: /Szukaj osoby/ })).toHaveValue('maj')
    expect(screen.getByRole('radio', { name: 'Wyłączone' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByText('olek', { selector: 'td' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: 'Wszystkie' }))
    await waitFor(() => expect(router.state.location.search).toBe('?szukaj=maj'))
    await rowOf('olek')
    expect(screen.queryByText('anna', { selector: 'td' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: /Szukaj osoby/ }), { target: { value: '' } })
    await waitFor(() => expect(router.state.location.search).toBe(''))
    await rowOf('anna')

    await act(() => router.navigate('/osoby?filtr=w-rotacji'))
    await waitFor(() => expect(screen.queryByText('olek', { selector: 'td' })).not.toBeInTheDocument())
    expect(screen.getByText('anna', { selector: 'td' })).toBeInTheDocument()
    await act(() => router.navigate(-1))
    await rowOf('olek')
    await act(() => router.navigate(1))
    await waitFor(() => expect(screen.queryByText('olek', { selector: 'td' })).not.toBeInTheDocument())
  })

  it('keeps every character typed quickly in a row, in the box and in the URL', async () => {
    mockData([user({ id: 'u1' }), user({ id: 'u2', username: 'ewa', first_name: 'Ewa', last_name: 'Maj', display_name: 'Ewa Maj' })])
    const { router } = renderScreen(<PeoplePanel />, { route: '/osoby' })
    await rowOf('anna')

    // Each key lands on what the box holds, before the router has caught up.
    const box = screen.getByRole('searchbox', { name: /Szukaj osoby/ }) as HTMLInputElement
    for (const key of 'ewa maj') fireEvent.change(box, { target: { value: box.value + key } })
    expect(box).toHaveValue('ewa maj')
    await waitFor(() => expect(router.state.location.search).toBe('?szukaj=ewa+maj'))
    expect(screen.queryByText('anna', { selector: 'td' })).not.toBeInTheDocument()
    expect(screen.getByText('ewa', { selector: 'td' })).toBeInTheDocument()
  })

  it('clears the search when the address drops it, as the side navigation does', async () => {
    mockData([user({ id: 'u1' }), user({ id: 'u2', username: 'ewa', first_name: 'Ewa', last_name: 'Maj', display_name: 'Ewa Maj' })])
    const { router } = renderScreen(<PeoplePanel />, { route: '/osoby?szukaj=maj' })
    await rowOf('ewa')
    expect(screen.queryByText('anna', { selector: 'td' })).not.toBeInTheDocument()

    await act(() => router.navigate('/osoby'))
    expect(screen.getByRole('searchbox', { name: /Szukaj osoby/ })).toHaveValue('')
    await rowOf('anna')
  })

  it('clears the search typed back and forth quickly when the address drops it, and Back brings it again', async () => {
    mockData([user({ id: 'u1' }), user({ id: 'u2', username: 'ewa', first_name: 'Ewa', last_name: 'Maj', display_name: 'Ewa Maj' })])
    const { router } = renderScreen(<PeoplePanel />, { route: '/osoby' })
    await rowOf('anna')
    const box = screen.getByRole('searchbox', { name: /Szukaj osoby/ }) as HTMLInputElement
    for (const value of ['e', '', 'e']) fireEvent.change(box, { target: { value } })
    await waitFor(() => expect(router.state.location.search).toBe('?szukaj=e'))
    expect(box).toHaveValue('e')

    await act(() => router.navigate('/osoby'))
    expect(box).toHaveValue('')
    await rowOf('anna')
    await act(() => router.navigate(-1))
    expect(box).toHaveValue('e')
  })

  it('shows every account for a filter the URL names but the screen does not know', async () => {
    mockData([user({ id: 'u1' }), user({ id: 'u2', username: 'ewa', first_name: 'Ewa', last_name: 'Maj', display_name: 'Ewa Maj', is_active: false })])
    renderScreen(<PeoplePanel />, { route: '/osoby?filtr=nieznany' })
    await rowOf('ewa')
    expect(screen.getByText('anna', { selector: 'td' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Wszystkie' })).toHaveAttribute('aria-checked', 'true')
  })

  it('uses one tab stop and arrow keys for the account filters', async () => {
    const user = userEvent.setup()
    mockData()
    renderScreen(<PeoplePanel />)
    const filters = await screen.findByRole('radiogroup', { name: 'Konta' })
    const choices = within(filters).getAllByRole('radio')
    expect(choices.filter((choice) => choice.tabIndex === 0)).toHaveLength(1)

    screen.getByRole('radio', { name: 'Wszystkie' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'W rotacji' })).toHaveFocus()
    expect(screen.getByRole('radio', { name: 'W rotacji' })).toHaveAttribute('aria-checked', 'true')
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

  it('saves a role change at once and puts the role back with Undo', async () => {
    mockData()
    const save = vi.spyOn(api, 'updateAdminUser').mockResolvedValue(user({ id: 'u1' }))
    renderScreen(<PeoplePanel />)
    const details = await openRow('anna')
    fireEvent.change(within(details).getByLabelText(/^Telefon/), { target: { value: '+48500100200' } })
    fireEvent.click(within(details).getByRole('tab', { name: 'Dostęp' }))
    fireEvent.click(within(details).getByRole('radio', { name: 'Administrator' }))
    fireEvent.click(within(details).getByRole('button', { name: /Zapisz \(2\)/ }))

    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(screen.queryByRole('dialog', { name: 'Potwierdź zmianę dostępu' })).not.toBeInTheDocument()
    expect(save.mock.calls[0][0].input.role).toBe('admin')
    expect(await screen.findByText('Zmieniono rolę: Anna Kowalska → Administrator')).toBeInTheDocument()
    expect(screen.getByText('Zapisano też: telefon')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cofnij' }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    // Undo restores the access only; the panel follows it, so nothing is left unsaved.
    expect(save.mock.calls[1][0]).toEqual({ id: 'u1', input: { role: 'member', is_active: true } })
    await waitFor(() => expect(within(details).getByRole('radio', { name: 'Członek zespołu' })).toBeChecked())
  })

  it('leaves the panel of another person alone when an access change is undone', async () => {
    const tomasz = user({ id: 'u2', username: 'tomasz', first_name: 'Tomasz', last_name: 'Lis', display_name: 'Tomasz Lis' })
    mockData([user({ id: 'u1' }), tomasz])
    const save = vi.spyOn(api, 'updateAdminUser').mockImplementation(async ({ input }) => {
      const saved = user({ id: 'u1', role: input.role })
      vi.mocked(api.adminUsers).mockResolvedValue([saved, tomasz])
      return saved
    })
    renderScreen(<PeoplePanel />)
    const details = await openRow('anna')
    fireEvent.click(within(details).getByRole('tab', { name: 'Dostęp' }))
    fireEvent.click(within(details).getByRole('radio', { name: 'Koordynator' }))
    fireEvent.click(within(details).getByRole('button', { name: /Zapisz \(1\)/ }))
    expect(await screen.findByText('Zmieniono rolę: Anna Kowalska → Koordynator')).toBeInTheDocument()
    await waitFor(() => expect(within(details).getByRole('button', { name: 'Zamknij' })).toBeInTheDocument())
    fireEvent.click(within(details).getByRole('button', { name: 'Zamknij' }))
    await waitFor(() => expect(screen.queryByRole('tab', { name: 'Dostęp' })).not.toBeInTheDocument())

    fireEvent.click(within(await rowOf('tomasz')).getByRole('button', { name: 'Otwórz' }))
    const other = await screen.findByRole('dialog', { name: /Tomasz Lis/ })
    fireEvent.click(within(other).getByRole('tab', { name: 'Dostęp' }))
    fireEvent.click(within(other).getByRole('radio', { name: 'Podgląd' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cofnij' }))

    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(within(other).getByRole('radio', { name: 'Podgląd' })).toBeChecked()
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
    fireEvent.change(within(dialog).getByLabelText(/^Telefon/), { target: { value: '+48500100200' } })
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Dostęp' }))
    expect(within(dialog).queryByRole('button', { name: /reset hasła/i })).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Podgląd' }))
    fireEvent.click(within(dialog).getByRole('button', { name: /Zapisz \(2\)/ }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    // Phone travels even for an LDAP account (decision D8): unlike name/email
    // it is not an AD-managed identity field.
    expect(save.mock.calls[0][0].input).toEqual({ role: 'viewer', is_active: true, phone: '+48500100200' })
  })

  it('leaves an untouched legacy number out of an access change', async () => {
    mockData([user({ id: 'u1', phone: '+49170123456' })])
    const save = vi.spyOn(api, 'updateAdminUser').mockResolvedValue(user({ id: 'u1', role: 'viewer', phone: '+49170123456' }))
    renderScreen(<PeoplePanel />)
    const dialog = await openRow('anna')
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Dostęp' }))
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Podgląd' }))
    fireEvent.click(within(dialog).getByRole('button', { name: /Zapisz \(1\)/ }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0][0].input).not.toHaveProperty('phone')
    expect(save.mock.calls[0][0].input).toMatchObject({ role: 'viewer', is_active: true })
  })

  it('shows the number as the server stored it, so a saved panel is not left unsaved', async () => {
    mockData()
    const saved = user({ id: 'u1', phone: '+48600100200' })
    const save = vi.spyOn(api, 'updateAdminUser').mockImplementation(async () => {
      vi.mocked(api.adminUsers).mockResolvedValue([saved])
      return saved
    })
    renderScreen(<PeoplePanel />)
    const dialog = await openRow('anna')
    fireEvent.change(within(dialog).getByLabelText(/^Telefon/), { target: { value: '600100200' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /Zapisz \(1\)/ }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    await waitFor(() => expect(within(dialog).getByLabelText(/^Telefon/)).toHaveValue('+48600100200'))
    expect(within(dialog).queryByText(/Niezapisane/)).not.toBeInTheDocument()
  })

  it('lists the qualifications by role and edits both dates of a period, sent only on save', async () => {
    mockData([user({ id: 'u1' })], [member({ id: 'm1' })])
    const save = vi.spyOn(api, 'updateEligibility').mockResolvedValue({
      id: 'e1', role: 'primary', starts_on: '2025-10-01', ends_on: '2026-12-31',
    })
    renderScreen(<PeoplePanel />)
    const dialog = await openRow('anna')
    expect(within(dialog).getByText('w rotacji', { selector: '.st' })).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('tab', { name: /Rotacja/ }))
    expect(within(dialog).getByText('zapis z przyciskiem „Zapisz”')).toBeInTheDocument()
    expect(within(qualification(dialog, 'PRIMARY')).getByText('od 02-09-2025 · bez daty końca')).toBeInTheDocument()
    expect(within(dialog).getByText('SECONDARY: brak kwalifikacji')).toBeInTheDocument()

    fireEvent.click(within(qualification(dialog, 'PRIMARY')).getByRole('button', { name: 'Edytuj: PRIMARY' }))
    fireEvent.change(within(dialog).getByLabelText('Od'), { target: { value: '2025-10-01' } })
    fireEvent.change(within(dialog).getByLabelText('Do (opcjonalnie)'), { target: { value: '2026-12-31' } })
    expect(save).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: /Zapisz \(1\)/ }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({
      id: 'e1', input: { starts_on: '2025-10-01', ends_on: '2026-12-31' },
    }))
  })

  it('warns before closing the panel with unsaved changes', async () => {
    mockData()
    renderScreen(<PeoplePanel />)
    const dialog = await openRow('anna')
    fireEvent.change(within(dialog).getByLabelText('E-mail'), {
      target: { value: 'new@example.com' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zamknij panel' }))
    const warning = await screen.findByRole('dialog', { name: 'Odrzucić niezapisane zmiany?' })
    expect(within(warning).getByText(/e-mail/)).toBeInTheDocument()
    fireEvent.click(within(warning).getByRole('button', { name: 'Odrzuć zmiany' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Anna Kowalska/ })).not.toBeInTheDocument())
  })

  it('keeps the open person and tab in the URL, so a refresh or a link opens the same panel', async () => {
    mockData([user({ id: 'u1', phone: '+48 601 220 118' })], [member({ id: 'm1' })])
    const { router } = renderScreen(<PeoplePanel />, { route: '/osoby?osoba=u1&karta=rotacja' })

    const dialog = await screen.findByRole('dialog', { name: /Anna Kowalska/ })
    expect(within(dialog).getByRole('tab', { name: /^Rotacja/ })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Konto' }))
    // The form is filled from the account the URL named.
    expect(await within(dialog).findByLabelText(/^Telefon/)).toHaveValue('+48 601 220 118')
    await waitFor(() => expect(router.state.location.search).toBe('?osoba=u1&karta=konto'))

    fireEvent.click(within(dialog).getByRole('button', { name: 'Zamknij' }))
    await waitFor(() => expect(router.state.location.search).toBe(''))
    fireEvent.click(within(await rowOf('anna')).getByRole('button', { name: 'Otwórz' }))
    await waitFor(() => expect(router.state.location.search).toBe('?osoba=u1&karta=konto'))
  })

  it('opens no panel for a person the URL names but the list does not hold', async () => {
    mockData()
    renderScreen(<PeoplePanel />, { route: '/osoby?osoba=gone&karta=nieznana' })
    await rowOf('anna')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('fills the panel afresh when Back reopens a person whose edits were discarded on leaving', async () => {
    mockData()
    const { router } = renderScreen(<PeoplePanel />, { route: '/osoby' })
    const dialog = await openRow('anna')
    fireEvent.change(within(dialog).getByLabelText('E-mail'), { target: { value: 'new@example.com' } })

    act(() => { void router.navigate('/osoby') })
    const warning = await screen.findByRole('dialog', { name: 'Odrzucić niezapisane zmiany?' })
    fireEvent.click(within(warning).getByRole('button', { name: 'Odrzuć zmiany' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Anna Kowalska/ })).not.toBeInTheDocument())

    await act(() => router.navigate(-1))
    const reopened = await screen.findByRole('dialog', { name: /Anna Kowalska/ })
    expect(within(reopened).getByLabelText('E-mail')).toHaveValue('anna@example.com')
  })

  it('does not switch rows until unsaved edits are explicitly discarded', async () => {
    mockData([
      user({ id: 'u1' }),
      user({ id: 'u2', username: 'ewa', first_name: 'Ewa', last_name: 'Maj', display_name: 'Ewa Maj' }),
    ])
    renderScreen(<PeoplePanel />)
    const anna = await openRow('anna')
    fireEvent.change(within(anna).getByLabelText('E-mail'), { target: { value: 'changed@example.com' } })

    fireEvent.click(within(await rowOf('ewa')).getByRole('button', { name: 'Otwórz' }))
    const warning = await screen.findByRole('dialog', { name: 'Odrzucić niezapisane zmiany?' })
    fireEvent.click(within(warning).getByRole('button', { name: 'Anuluj' }))
    expect(screen.getByRole('dialog', { name: /Anna Kowalska/ })).toBeInTheDocument()
    expect(within(anna).getByLabelText('E-mail')).toHaveValue('changed@example.com')

    fireEvent.click(within(await rowOf('ewa')).getByRole('button', { name: 'Otwórz' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Odrzucić niezapisane zmiany?' })).getByRole('button', { name: 'Odrzuć zmiany' }))
    expect(await screen.findByRole('dialog', { name: /Ewa Maj/ })).toBeInTheDocument()
  })

  it('discards unsaved changes from the footer without asking, keeping the person open', async () => {
    mockData()
    renderScreen(<PeoplePanel />)
    const dialog = await openRow('anna')
    const email = within(dialog).getByLabelText('E-mail')
    const saved = (email as HTMLInputElement).value
    fireEvent.change(email, { target: { value: 'new@example.com' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Odrzuć zmiany' }))
    expect(screen.getByRole('dialog', { name: /Anna Kowalska/ })).toBeInTheDocument()
    expect(within(dialog).getByLabelText('E-mail')).toHaveValue(saved)
    expect(within(dialog).queryByRole('button', { name: 'Odrzuć zmiany' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('heading', { name: /Anna Kowalska/ })).toHaveFocus()
    expect(screen.queryByRole('dialog', { name: 'Odrzucić niezapisane zmiany?' })).not.toBeInTheDocument()
  })

  it('deletes an account only after the login is typed into the red sheet', async () => {
    mockData([user({ id: 'u1' })], [member({ id: 'm1' })])
    const remove = vi.spyOn(api, 'deleteAdminUser').mockImplementation(async () => {
      vi.mocked(api.team).mockResolvedValue([member({ id: 'm1', user_id: null, display_name: 'Osoba usunięta #12' })])
    })
    renderScreen(<PeoplePanel />)
    const dialog = await openRow('anna')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Usuń konto…' }))
    const sheet = await screen.findByRole('dialog', { name: 'Usuwam konto Anna Kowalska i jego dane osobowe' })
    expect(within(sheet).getByText(/pozostaną bez obsady/)).toBeInTheDocument()
    expect(within(sheet).getByText(/pojawi się jako „Osoba usunięta #…”/)).toBeInTheDocument()
    expect(within(sheet).getByText(/imię i nazwisko zostają przy starych wpisach/)).toBeInTheDocument()
    const confirm = within(sheet).getByRole('button', { name: 'Usuń konto i dane' })
    expect(confirm).toBeDisabled()
    expect(within(sheet).getByLabelText('Wpisz login, żeby potwierdzić')).toHaveAttribute('placeholder', 'wpisz login')
    fireEvent.change(within(sheet).getByLabelText('Wpisz login, żeby potwierdzić'), { target: { value: 'ann' } })
    expect(confirm).toBeDisabled()
    fireEvent.change(within(sheet).getByLabelText('Wpisz login, żeby potwierdzić'), { target: { value: 'anna' } })
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)
    await waitFor(() => expect(remove).toHaveBeenCalledWith('u1'))
    // The API answers without the pseudonym; the team list knows it by the member's id.
    expect(await screen.findByText('Usunięto konto Anna Kowalska')).toBeInTheDocument()
    expect(screen.getByText('W grafiku: Osoba usunięta #12')).toBeInTheDocument()
  })

  it('reports a delete that went through even when the pseudonym cannot be read back', async () => {
    mockData([user({ id: 'u1' })], [member({ id: 'm1' })])
    const remove = vi.spyOn(api, 'deleteAdminUser').mockImplementation(async () => {
      vi.mocked(api.team).mockRejectedValueOnce(new Error('Failed to fetch'))
    })
    renderScreen(<PeoplePanel />)
    fireEvent.click(within(await openRow('anna')).getByRole('button', { name: 'Usuń konto…' }))
    const sheet = await screen.findByRole('dialog', { name: 'Usuwam konto Anna Kowalska i jego dane osobowe' })

    fireEvent.change(within(sheet).getByLabelText('Wpisz login, żeby potwierdzić'), { target: { value: 'anna' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Usuń konto i dane' }))

    expect(await screen.findByText('Usunięto konto Anna Kowalska')).toBeInTheDocument()
    expect(screen.queryByText(/W grafiku:/)).not.toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Usuwam konto Anna Kowalska i jego dane osobowe' })).not.toBeInTheDocument())
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it('names no pseudonym after deleting an account outside the rotation', async () => {
    mockData()
    vi.spyOn(api, 'deleteAdminUser').mockResolvedValue(undefined)
    renderScreen(<PeoplePanel />)
    fireEvent.click(within(await openRow('anna')).getByRole('button', { name: 'Usuń konto…' }))
    const sheet = await screen.findByRole('dialog', { name: 'Usuwam konto Anna Kowalska i jego dane osobowe' })

    fireEvent.change(within(sheet).getByLabelText('Wpisz login, żeby potwierdzić'), { target: { value: 'anna' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Usuń konto i dane' }))

    expect(await screen.findByText('Usunięto konto Anna Kowalska')).toBeInTheDocument()
    expect(screen.queryByText(/W grafiku:/)).not.toBeInTheDocument()
    expect(api.team).toHaveBeenCalledTimes(2)
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

    fireEvent.click(screen.getByRole('radio', { name: 'Oczekujące' }))
    expect(screen.getByText('anna', { selector: 'td' })).toBeInTheDocument()
    expect(screen.getByText('ewa', { selector: 'td' })).toBeInTheDocument()
    expect(screen.getByText('olek', { selector: 'td' })).toBeInTheDocument()
    expect(screen.queryByText('tomasz', { selector: 'td' })).not.toBeInTheDocument()
    expect(screen.queryByText('widz', { selector: 'td' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Wyłączone' }))
    expect(screen.queryByText('anna', { selector: 'td' })).not.toBeInTheDocument()
    expect(screen.getByText('olek', { selector: 'td' })).toBeInTheDocument()
  })

  it('reissues the activation link from the access tab at once', async () => {
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
    // The new link changes nothing until it is used, so it is issued without a question.
    await waitFor(() => expect(reissue).toHaveBeenCalledWith('u1'))
    expect(screen.queryByRole('dialog', { name: 'Wygenerować nowy link aktywacyjny?' })).not.toBeInTheDocument()
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
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/Konto ma już hasło/)
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

describe('PeoplePanel new account in the rotation', () => {
  const ewa = user({ id: 'u2', username: 'ewa', first_name: 'Ewa', last_name: 'Nowak', display_name: 'Ewa Nowak', phone: '+48600100200' })
  const link = { user: ewa, activation_url: 'http://localhost:8080/activate?token=secret' }

  it('creates the account, its rotation and its qualifications from one panel and opens the rotation', async () => {
    vi.spyOn(api, 'adminUsers').mockResolvedValueOnce([]).mockResolvedValue([ewa])
    const joined = member({ id: 'm2', user_id: 'u2', display_name: 'Ewa Nowak', active_from: '2026-09-14', eligibility: [
      { id: 'e5', role: 'primary', starts_on: '2026-09-14', ends_on: null },
      { id: 'e6', role: 'secondary', starts_on: '2026-09-14', ends_on: null },
    ] })
    vi.spyOn(api, 'team').mockResolvedValueOnce([]).mockResolvedValue([joined])
    vi.spyOn(api, 'publicConfig').mockRejectedValue(new Error('offline'))
    const create = vi.spyOn(api, 'createAdminUser').mockResolvedValue(link)
    const join = vi.spyOn(api, 'createTeamMember').mockResolvedValue({ ...joined, eligibility: [] })
    const qualify = vi.spyOn(api, 'createEligibility').mockResolvedValue(joined.eligibility[0])
    renderScreen(<PeoplePanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Nowe konto' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nowe konto lokalne' })
    fireEvent.change(within(dialog).getByLabelText(/^Login/), { target: { value: 'ewa' } })

    fireEvent.click(within(dialog).getByRole('checkbox', { name: /W rotacji dyżurów/ }))
    expect(within(dialog).getByText(/Ta osoba wejdzie do rotacji 10-09-2026 bez kwalifikacji/)).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText(/^Imię/), { target: { value: 'Ewa' } })
    const submit = within(dialog).getByRole('button', { name: 'Utwórz konto' })
    // The rotation needs the phone the strip "Teraz" shows.
    expect(submit).toBeDisabled()
    expect(within(dialog).getByLabelText(/^Telefon/)).toBeRequired()
    fireEvent.change(within(dialog).getByLabelText(/^Telefon/), { target: { value: '600 100 200' } })
    expect(submit).toBeEnabled()
    // ...and the entry date the rotation starts on.
    fireEvent.change(within(dialog).getByLabelText('Wejście od'), { target: { value: '' } })
    expect(submit).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText('Wejście od'), { target: { value: '2026-09-14' } })
    const roles = within(dialog).getByRole('group', { name: 'Kwalifikacje dyżurowe' })
    fireEvent.click(within(roles).getByRole('button', { name: 'SECONDARY' }))
    fireEvent.click(within(roles).getByRole('button', { name: '11–19' }))
    fireEvent.click(within(roles).getByRole('button', { name: '11–19' }))
    fireEvent.click(within(roles).getByRole('button', { name: 'PRIMARY' }))
    expect(within(roles).getByRole('button', { name: 'PRIMARY' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(roles).getByRole('button', { name: '11–19' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(dialog).getByText(/Ewa dostanie dyżury od 14-09-2026 w rolach PRIMARY i SECONDARY\./)).toBeInTheDocument()
    fireEvent.click(within(roles).getByRole('button', { name: 'SECONDARY' }))
    expect(within(dialog).getByText(/Ewa dostanie dyżury od 14-09-2026 w roli PRIMARY\./)).toBeInTheDocument()
    fireEvent.click(within(roles).getByRole('button', { name: 'SECONDARY' }))
    fireEvent.click(submit)

    const done = await within(dialog).findByRole('status')
    expect(done).toHaveTextContent('Konto utworzone · w rotacji od 14-09-2026 · PRIMARY, SECONDARY')
    expect(done).toHaveTextContent('activate?token=secret')
    expect(done).toHaveTextContent('Link aktywacyjny ważny 24 godziny. Przekaż go bezpiecznym kanałem.')
    expect(screen.getByRole('dialog', { name: /Ewa Nowak/ })).toBe(dialog)
    expect(within(dialog).getByText('w rotacji od 14-09-2026', { selector: '.st' })).toBeInTheDocument()
    expect(create.mock.calls[0][0]).toMatchObject({ username: 'ewa', first_name: 'Ewa', phone: '600 100 200' })
    expect(join).toHaveBeenCalledWith({ user_id: 'u2', active_from: '2026-09-14' })
    expect(qualify.mock.calls.map(([call]) => call)).toEqual([
      { memberId: 'm2', input: { role: 'primary', starts_on: '2026-09-14', ends_on: null } },
      { memberId: 'm2', input: { role: 'secondary', starts_on: '2026-09-14', ends_on: null } },
    ])

    fireEvent.click(within(dialog).getByRole('button', { name: 'Otwórz rotację' }))
    const details = await screen.findByRole('dialog', { name: /Ewa Nowak/ })
    await waitFor(() => expect(within(details).getByRole('tab', { name: /Rotacja/ })).toHaveAttribute('aria-selected', 'true'))
    expect(within(qualification(details, 'SECONDARY')).getByText('od 14-09-2026 · bez daty końca')).toBeInTheDocument()
    expect(within(details).queryByText(/Niezapisane/)).not.toBeInTheDocument()
  })

  it('keeps the link and says so when the server refuses the rotation', async () => {
    mockData([])
    vi.spyOn(api, 'adminUsers').mockResolvedValueOnce([]).mockResolvedValue([ewa])
    vi.spyOn(api, 'createAdminUser').mockResolvedValue(link)
    vi.spyOn(api, 'createTeamMember').mockRejectedValue(new Error('Osoba jest już w rotacji'))
    renderScreen(<PeoplePanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Nowe konto' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nowe konto lokalne' })
    fireEvent.change(within(dialog).getByLabelText(/^Imię/), { target: { value: 'Ewa' } })
    fireEvent.change(within(dialog).getByLabelText(/^Login/), { target: { value: 'ewa' } })
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /W rotacji dyżurów/ }))
    expect(within(dialog).getByText(/Ewa wejdzie do rotacji 10-09-2026 bez kwalifikacji: generator nie przydzieli żadnej roli/)).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText(/^Telefon/), { target: { value: '600100200' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Utwórz konto' }))

    expect(await within(dialog).findByRole('status')).toHaveTextContent(/^Konto utworzonehttp/)
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Konto jest gotowe, ale rotacji nie zapisanoOsoba jest już w rotacji')
    expect(within(dialog).queryByText('w rotacji od 10-09-2026')).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dodaj do rotacji' }))
    const details = await screen.findByRole('dialog', { name: /Ewa Nowak/ })
    expect(await within(details).findByText('Poza rotacją')).toBeInTheDocument()
    expect(within(details).getByRole('tab', { name: /Rotacja/ })).toHaveAttribute('aria-selected', 'true')
  })

  it.each([
    { saved: 0, status: 'bez kwalifikacji', missing: 'kwalifikacje PRIMARY, SECONDARY i 11–19 nie zostały zapisane' },
    { saved: 1, status: 'PRIMARY', missing: 'kwalifikacje SECONDARY i 11–19 nie zostały zapisane' },
    { saved: 2, status: 'PRIMARY, SECONDARY', missing: 'kwalifikacja 11–19 nie została zapisana' },
  ])('says which qualifications are missing when the rotation is saved with $saved of them', async ({ saved, status, missing }) => {
    mockData([])
    vi.spyOn(api, 'createAdminUser').mockResolvedValue(link)
    vi.spyOn(api, 'createTeamMember').mockResolvedValue(member({ id: 'm2', user_id: 'u2', active_from: '2026-09-10', eligibility: [] }))
    const qualify = vi.spyOn(api, 'createEligibility')
    for (let index = 0; index < saved; index++) qualify.mockResolvedValueOnce({ id: `e${index}`, role: 'primary', starts_on: '2026-09-10', ends_on: null })
    qualify.mockRejectedValueOnce(new Error('Okresy nakładają się'))
    renderScreen(<PeoplePanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Nowe konto' }))
    const dialog = await screen.findByRole('dialog', { name: 'Nowe konto lokalne' })
    fireEvent.change(within(dialog).getByLabelText(/^Imię/), { target: { value: 'Ewa' } })
    fireEvent.change(within(dialog).getByLabelText(/^Login/), { target: { value: 'ewa' } })
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /W rotacji dyżurów/ }))
    fireEvent.change(within(dialog).getByLabelText(/^Telefon/), { target: { value: '600100200' } })
    const roles = within(dialog).getByRole('group', { name: 'Kwalifikacje dyżurowe' })
    for (const role of ['11–19', 'SECONDARY', 'PRIMARY']) fireEvent.click(within(roles).getByRole('button', { name: role }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Utwórz konto' }))

    expect(await within(dialog).findByRole('status')).toHaveTextContent(`Konto utworzone · w rotacji od 10-09-2026 · ${status}`)
    // The rotation is saved, so the alert names only what is missing from it.
    expect(within(dialog).getByRole('alert')).toHaveTextContent(`Konto i rotację zapisano, ale ${missing}Okresy nakładają się`)
    expect(within(dialog).getByRole('button', { name: 'Otwórz rotację' })).toBeInTheDocument()
  })
})

const ldapConfig = () => vi.spyOn(api, 'publicConfig').mockResolvedValue({
  ldap_enabled: true, app_name: 'On-call', app_subtitle: '', version: '1.4.0', audit_retention_days: 365, login_audit_retention_days: 90, undo_window_seconds: 10, sso_enabled: false,
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

    fireEvent.click(screen.getByRole('radio', { name: 'Poza rotacją' }))
    expect(screen.queryByText('anna', { selector: 'td' })).not.toBeInTheDocument()
    expect(screen.getByText('ewa', { selector: 'td' })).toBeInTheDocument()
    expect(screen.getByText('olek', { selector: 'td' })).toBeInTheDocument()
  })

  it('flags a stored number that is not a Polish one in the table and on the account tab', async () => {
    mockData([user({ id: 'u1', phone: '+49 170 1234567' })], [member({ id: 'm1' })])
    renderScreen(<PeoplePanel />)

    const anna = await rowOf('anna')
    expect(within(anna).getByText('popraw numer')).toBeInTheDocument()
    const dialog = await openRow('anna')
    // The field judges the number once it is left, not as the panel opens.
    expect(within(dialog).queryByText('Popraw numer: +48 i dziewięć cyfr.')).not.toBeInTheDocument()
    fireEvent.blur(within(dialog).getByLabelText(/^Telefon/))
    expect(within(dialog).getByText('Popraw numer: +48 i dziewięć cyfr.')).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText(/^Telefon/), { target: { value: '600 100 200' } })
    expect(within(dialog).queryByText('Popraw numer: +48 i dziewięć cyfr.')).not.toBeInTheDocument()
    expect(within(dialog).getByText(/^Format: \+48 i dziewięć cyfr/)).toBeInTheDocument()
    // Typing again is not judged until the field is left once more.
    fireEvent.blur(within(dialog).getByLabelText(/^Telefon/))
    fireEvent.change(within(dialog).getByLabelText(/^Telefon/), { target: { value: '6' } })
    expect(within(dialog).queryByText('Popraw numer: +48 i dziewięć cyfr.')).not.toBeInTheDocument()
    fireEvent.blur(within(dialog).getByLabelText(/^Telefon/))
    expect(within(dialog).getByText('Popraw numer: +48 i dziewięć cyfr.')).toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: 'Eksportuj CSV' })).toBeDisabled()
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

    fireEvent.click(screen.getByRole('button', { name: 'Eksportuj CSV' }))

    expect(click).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:people'))
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
    expect(within(dialog).getByText('Same cyfry, np. 001234. Klucz dowiązania z AD: zgodny z employeeNumber.')).toBeInTheDocument()
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
    // A wrong format is said under the field, in Polish, and holds the account back.
    fireEvent.change(within(dialog).getByLabelText(/^Numer pracownika/), { target: { value: 'T-001' } })
    const personnel = within(dialog).getByLabelText(/^Numer pracownika/)
    expect(personnel).toHaveAttribute('aria-invalid', 'true')
    expect(personnel).toHaveAccessibleDescription('Numer pracownika to same cyfry, np. 001234.')
    expect(within(dialog).getByRole('button', { name: 'Utwórz konto' })).toBeDisabled()
    fireEvent.change(personnel, { target: { value: '0042' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Utwórz konto' }))

    expect(await within(dialog).findByText(/activate\?token=secret/)).toBeInTheDocument()
    expect(create.mock.calls[0][0]).toEqual({
      username: 'ewa', personnel_number: '0042', first_name: 'Ewa', last_name: 'Nowak', email: null, phone: null, role: 'member',
    })
    expect(within(dialog).queryByRole('button', { name: 'Utwórz konto' })).not.toBeInTheDocument()
    expect(screen.getByText('Utworzono konto Ewa Nowak')).toBeInTheDocument()
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

    const refusal = await within(dialog).findByRole('alert')
    expect(refusal).toHaveTextContent('Login jest już zajęty')
    expect(refusal).toHaveFocus()
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
    expect(within(dialog).queryByText('Wymagany dla osób w rotacji.')).not.toBeInTheDocument()
    fireEvent.submit(dialog.querySelector('#person-form')!)
    // A save attempt judges the number too, even with nothing else to save.
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

    const refusal = await within(dialog).findByRole('alert')
    expect(refusal).toHaveTextContent('E-mail jest już używany')
    expect(refusal).toHaveFocus()
    expect(within(dialog).getByLabelText('E-mail')).toHaveValue('ewa@example.com')
  })

  it('stays open with the changes when closing is not confirmed', async () => {
    mockData()
    renderScreen(<PeoplePanel />)
    const dialog = await openRow('anna')
    fireEvent.change(within(dialog).getByLabelText('Nazwisko'), { target: { value: 'Nowak' } })

    fireEvent.keyDown(dialog, { key: 'Escape' })
    const warning = await screen.findByRole('dialog', { name: 'Odrzucić niezapisane zmiany?' })
    expect(within(warning).getByText(/Niezapisane: nazwisko/)).toBeInTheDocument()
    fireEvent.click(within(warning).getByRole('button', { name: 'Anuluj' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Odrzucić niezapisane zmiany?' })).not.toBeInTheDocument())
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

  it('disables an account at once and switches it back on with Undo', async () => {
    mockData()
    const save = vi.spyOn(api, 'updateAdminUser').mockResolvedValue(user({ id: 'u1', is_active: false }))
    renderScreen(<PeoplePanel />)
    const dialog = await openAccess()

    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Konto włączone/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz (1)' }))

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save.mock.calls[0][0].input.is_active).toBe(false)
    expect(await screen.findByText('Wyłączono konto: Anna Kowalska')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cofnij' }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(save.mock.calls[1][0]).toEqual({ id: 'u1', input: { role: 'member', is_active: true } })
  })

  it('shows a refused access change in the panel', async () => {
    mockData()
    vi.spyOn(api, 'updateAdminUser').mockRejectedValue(new Error('Nie można wyłączyć ostatniego administratora'))
    renderScreen(<PeoplePanel />)
    const dialog = await openAccess()

    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Konto włączone/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz (1)' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Nie można wyłączyć ostatniego administratora')
    expect(screen.queryByText(/Wyłączono konto/)).not.toBeInTheDocument()
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
    expect(await screen.findByText('Włączono konto: Anna Kowalska')).toBeInTheDocument()
  })

  it('issues a password reset link at once and says when sessions end', async () => {
    mockData()
    const reset = vi.spyOn(api, 'issuePasswordReset').mockResolvedValue({
      url: 'http://localhost:8080/reset?token=once', expires_at: '2026-09-10T08:00:00Z',
    })
    renderScreen(<PeoplePanel />)
    const dialog = await openAccess()
    expect(within(dialog).getByText(/Po ustawieniu nowego hasła sesje tej osoby wygasną\./)).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Wygeneruj reset hasła' }))

    expect(await within(dialog).findByText('http://localhost:8080/reset?token=once')).toBeInTheDocument()
    expect(within(dialog).getByText('Link resetu hasła (ważny godzinę)')).toBeInTheDocument()
    expect(reset).toHaveBeenCalledWith('u1')
    expect(screen.queryByRole('dialog', { name: 'Wygenerować reset hasła?' })).not.toBeInTheDocument()
  })

  it('shows a refused password reset in the panel', async () => {
    mockData()
    vi.spyOn(api, 'issuePasswordReset').mockRejectedValue(new Error('Konto jest wyłączone'))
    renderScreen(<PeoplePanel />)
    const dialog = await openAccess()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Wygeneruj reset hasła' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Konto jest wyłączone')
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

/** No published duty after the exit date in any of the five pages read. */
const noDutiesAfterExit = () => vi.spyOn(api, 'calendar').mockImplementation(async (startsOn, endsOn) => ({
  starts_on: startsOn, ends_on: endsOn, days: [], members: [], team_has_members: true, assignments: [], availability: [],
}))

/**
 * The server's rotation for one member: a membership change or a period
 * change that would leave a period outside the membership, or ending before
 * it starts, is refused, as in `change_membership` and `change_eligibility`.
 */
function rotationServer(initial: TeamMember) {
  let state = initial
  const inside = (rotation: Pick<TeamMember, 'active_from' | 'active_until'>, period: Pick<TeamMember['eligibility'][number], 'starts_on' | 'ends_on'>) =>
    period.starts_on >= rotation.active_from
    && (period.ends_on === null || period.ends_on >= period.starts_on)
    && (rotation.active_until === null || (period.ends_on !== null && period.ends_on <= rotation.active_until))
  vi.spyOn(api, 'team').mockImplementation(async () => [state])
  const membership = vi.spyOn(api, 'updateTeamMember').mockImplementation(async ({ input }) => {
    const next = { ...state, ...input }
    if (!state.eligibility.every((period) => inside(next, period))) throw new Error('Okresy kwalifikacji muszą mieścić się w okresie członkostwa w rotacji')
    state = next
    return state
  })
  const periods = vi.spyOn(api, 'updateEligibility').mockImplementation(async ({ id, input }) => {
    const next = { ...state.eligibility.find((period) => period.id === id)!, ...input }
    if (!inside(state, next)) throw new Error('Okres kwalifikacji musi mieścić się w okresie członkostwa w rotacji')
    state = { ...state, eligibility: state.eligibility.map((period) => (period.id === id ? next : period)) }
    return next
  })
  const created = vi.spyOn(api, 'createEligibility').mockImplementation(async ({ input }) => {
    const next = { id: `e${state.eligibility.length + 10}`, ...input, ends_on: input.ends_on ?? null }
    if (!inside(state, next)) throw new Error('Okres kwalifikacji musi mieścić się w okresie członkostwa w rotacji')
    state = { ...state, eligibility: [...state.eligibility, next] }
    return next
  })
  vi.spyOn(api, 'deleteEligibility').mockImplementation(async (id) => {
    state = { ...state, eligibility: state.eligibility.filter((period) => period.id !== id) }
  })
  return { membership, periods, created }
}

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
    expect(screen.getByText('Dodano do rotacji: Anna Kowalska · od 01-10-2026')).toBeInTheDocument()
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
    const calendar = noDutiesAfterExit()
    renderScreen(<PeoplePanel />)
    const dialog = await openRotation()

    expect(within(dialog).getByText('w rotacji od 12-10-2026', { selector: '.st' })).toBeInTheDocument()
    expect(within(qualification(dialog, 'PRIMARY')).getByText('od 12-10-2026 do 31-12-2026')).toBeInTheDocument()
    // A period that has not started yet is deleted rather than ended.
    expect(within(qualification(dialog, 'PRIMARY')).getByRole('button', { name: 'Usuń: PRIMARY' })).toBeInTheDocument()
    expect(await within(dialog).findByText('Puste: bez daty końca.')).toBeInTheDocument()
    // The saved exit date needs no check of the duties after it.
    expect(calendar).not.toHaveBeenCalled()
    // Ending a rotation that has not started would have no exit date to pick.
    expect(within(dialog).queryByRole('button', { name: 'Zakończ rotację…' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Zapisz' })).toBeDisabled()
  })

  it('describes an ended rotation with its past periods as history', async () => {
    mockData([user({ id: 'u1' })], [member({ id: 'm1', active_until: '2026-06-30', eligibility: [
      { id: 'e0', role: 'secondary', starts_on: '2025-09-02', ends_on: '2025-12-31' },
      { id: 'e1', role: 'primary', starts_on: '2026-01-01', ends_on: '2026-06-30' },
    ] })])
    noDutiesAfterExit()
    renderScreen(<PeoplePanel />)
    const dialog = await openRotation()

    expect(within(dialog).getByText('rotacja zakończona 30-06-2026', { selector: '.st' })).toBeInTheDocument()
    const period = qualification(dialog, 'PRIMARY')
    expect(within(period).getByText('od 01-01-2026 do 30-06-2026')).toBeInTheDocument()
    // History runs newest first, after the roles.
    expect(within(dialog).getAllByText(/^od .* do /, { selector: '.list-main small' }).map((item) => item.textContent))
      .toEqual(['od 01-01-2026 do 30-06-2026', 'od 02-09-2025 do 31-12-2025'])
    expect(within(period).getByText('historia')).toBeInTheDocument()
    expect(within(period).queryByRole('button')).not.toBeInTheDocument()
    expect(within(dialog).getByText('PRIMARY: brak kwalifikacji')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Zakończ rotację…' })).not.toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Usuń konto…' }))
    const sheet = await screen.findByRole('dialog', { name: /Usuwam konto/ })
    expect(within(sheet).getByText(/Osoba usunięta/)).toBeInTheDocument()
    expect(within(sheet).queryByText(/pozostaną bez obsady/)).not.toBeInTheDocument()
  })

  it('says a member without any period gets no duties', async () => {
    mockData([user({ id: 'u1' })], [member({ id: 'm1', eligibility: [] })])
    renderScreen(<PeoplePanel />)
    const dialog = await openRotation()

    expect(within(dialog).getByText('Brak okresów; generator nie przydzieli tej osobie żadnej roli.')).toBeInTheDocument()
    expect(within(dialog).getByText('PRIMARY: brak kwalifikacji')).toBeInTheDocument()
    expect(within(dialog).getByText('SECONDARY: brak kwalifikacji')).toBeInTheDocument()
    expect(within(dialog).getByText('11–19: brak kwalifikacji')).toBeInTheDocument()
  })

  it('saves new rotation dates at once when no qualification and no duty reaches past the exit', async () => {
    mockData([user({ id: 'u1', phone: '+48 1' })], [member({ id: 'm1', eligibility: [
      { id: 'e1', role: 'primary', starts_on: '2025-10-01', ends_on: '2026-12-31' },
    ] })])
    noDutiesAfterExit()
    const save = vi.spyOn(api, 'updateTeamMember').mockResolvedValue(member({ id: 'm1' }))
    renderScreen(<PeoplePanel />)
    const dialog = await openRotation()

    fireEvent.change(within(dialog).getByLabelText('Wejście od'), { target: { value: '2025-08-01' } })
    fireEvent.change(within(dialog).getByLabelText(/^Wyjście do/), { target: { value: '2026-12-31' } })

    expect(within(dialog).getByText('Niezapisane: wejście do rotacji: 01-08-2025 · wyjście z rotacji: 31-12-2026')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Zapisz (2)' })).toBeDisabled()
    expect(await within(dialog).findByText('Puste: bez daty końca.')).toBeInTheDocument()
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Zapisz (2)' })).toBeEnabled())
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz (2)' }))

    await waitFor(() => expect(save).toHaveBeenCalledWith({ id: 'm1', input: { active_from: '2025-08-01', active_until: '2026-12-31' } }))
    expect(screen.queryByRole('dialog', { name: /Zakończenie rotacji/ })).not.toBeInTheDocument()
  })

  it('closes the qualifications an exit date with no duties after it would cut through the dialog', async () => {
    const before = member({ id: 'm1', eligibility: [
      { id: 'e1', role: 'primary', starts_on: '2025-09-02', ends_on: '2027-03-31' },
      { id: 'e2', role: 'late_shift', starts_on: '2027-04-01', ends_on: null },
    ] })
    const after = member({ id: 'm1', active_until: '2026-12-31', eligibility: [
      { id: 'e1', role: 'primary', starts_on: '2025-09-02', ends_on: '2026-12-31' },
    ] })
    mockData([user({ id: 'u1', phone: '+48 1' })])
    const finish = vi.spyOn(api, 'updateTeamMember').mockResolvedValue(after)
    vi.spyOn(api, 'team').mockImplementation(async () => [finish.mock.calls.length > 0 ? after : before])
    noDutiesAfterExit()
    const close = vi.spyOn(api, 'updateEligibility').mockResolvedValue(after.eligibility[0])
    const remove = vi.spyOn(api, 'deleteEligibility').mockResolvedValue(undefined)
    renderScreen(<PeoplePanel />)
    const dialog = await openRotation()

    fireEvent.change(within(dialog).getByLabelText(/^Wyjście do/), { target: { value: '2026-12-31' } })
    expect(await within(dialog).findByText('Kwalifikacje trwają dłużej; zapis zamknie je z tym dniem.')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz (1)' }))

    // The server refuses an exit date a period outlives, so nothing is sent before the dialog.
    const sheet = await screen.findByRole('dialog', { name: 'Zakończenie rotacji: Anna Kowalska' })
    expect(finish).not.toHaveBeenCalled()
    expect(await within(sheet).findByText(/Brak dyżurów po dacie wyjścia/)).toBeInTheDocument()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Zakończ rotację' }))

    await waitFor(() => expect(finish).toHaveBeenCalledWith({ id: 'm1', input: { active_until: '2026-12-31' } }))
    expect(close).toHaveBeenCalledWith({ id: 'e1', input: { ends_on: '2026-12-31' } })
    expect(remove).toHaveBeenCalledWith('e2')
    expect(finish.mock.invocationCallOrder[0]).toBeGreaterThan(Math.max(close.mock.invocationCallOrder[0], remove.mock.invocationCallOrder[0]))
    await waitFor(() => expect(within(dialog).queryByText(/Niezapisane/)).not.toBeInTheDocument())
  })

  it('saves a later entry date on its own and names what keeps it back', async () => {
    mockData([user({ id: 'u1', phone: '+48 1' })])
    const { membership, periods, created } = rotationServer(member({ id: 'm1' }))
    renderScreen(<PeoplePanel />)
    const dialog = await openRotation()
    const entry = within(dialog).getByLabelText('Wejście od')

    // Both saved periods start before the new date, so the server would refuse it.
    fireEvent.change(entry, { target: { value: '2025-10-01' } })
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Kwalifikacje PRIMARY i 11–19 zaczynają się przed tą datą. Okresy, które kończą się przed nią, usuń w tym samym zapisie; okresy trwające dłużej najpierw przesuń albo usuń w osobnym zapisie.')
    expect(entry).toHaveAttribute('aria-invalid', 'true')
    expect(within(dialog).getByRole('button', { name: 'Zapisz (1)' })).toBeDisabled()

    // Other rotation changes in the same save are named and wait for a save of their own.
    fireEvent.click(within(qualification(dialog, 'PRIMARY')).getByRole('button', { name: 'Edytuj: PRIMARY' }))
    fireEvent.change(within(dialog).getByLabelText('Od'), { target: { value: '2025-10-01' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Gotowe' }))
    fireEvent.click(within(qualification(dialog, '11–19')).getByRole('button', { name: 'Zakończ dziś: 11–19' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dodaj okres', pressed: false }))
    fireEvent.click(within(within(dialog).getByRole('radiogroup', { name: 'Rola dyżurowa' })).getByRole('radio', { name: 'SECONDARY' }))
    fireEvent.change(within(dialog).getByLabelText('Od'), { target: { value: '2025-10-01' } })
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Dodaj okres' }).find((button) => !button.hasAttribute('aria-pressed'))!)
    expect(within(dialog).getByText('Późniejszą datę wejścia zapisz osobno, bez innych zmian rotacji: okres PRIMARY, okres 11–19, nowy okres SECONDARY.')).toBeInTheDocument()
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Kwalifikacje PRIMARY i 11–19 zaczynają się przed tą datą')
    expect(within(dialog).getByRole('button', { name: 'Zapisz (4)' })).toBeDisabled()

    // Without the entry date the rest saves as usual.
    fireEvent.change(entry, { target: { value: '2025-09-02' } })
    expect(within(dialog).queryByText(/Późniejszą datę wejścia/)).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz (3)' }))
    await waitFor(() => expect(created).toHaveBeenCalledWith({ memberId: 'm1', input: { role: 'secondary', starts_on: '2025-10-01', ends_on: null } }))
    expect(periods.mock.calls.map(([call]) => call)).toEqual([
      { id: 'e2', input: { starts_on: '2025-09-02', ends_on: '2026-09-09' } },
      { id: 'e1', input: { starts_on: '2025-10-01', ends_on: null } },
    ])
    expect(membership).not.toHaveBeenCalled()
    await waitFor(() => expect(within(dialog).queryByText(/Niezapisane/)).not.toBeInTheDocument())

    // An ended period keeps its start, so it still keeps the later date back.
    fireEvent.change(entry, { target: { value: '2025-10-01' } })
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Kwalifikacja 11–19 zaczyna się przed tą datą. Okres, który kończy się przed nią, usuń w tym samym zapisie; okres trwający dłużej najpierw przesuń albo usuń w osobnym zapisie.')
    expect(within(dialog).getByRole('button', { name: 'Zapisz (1)' })).toBeDisabled()
    expect(membership).not.toHaveBeenCalled()
  })

  it('saves an earlier entry date before the periods that start on it', async () => {
    mockData([user({ id: 'u1', phone: '+48 1' })], [member({ id: 'm1' })])
    const save = vi.spyOn(api, 'updateTeamMember').mockResolvedValue(member({ id: 'm1', active_from: '2025-08-01' }))
    const add = vi.spyOn(api, 'createEligibility').mockResolvedValue({ id: 'e3', role: 'secondary', starts_on: '2025-08-01', ends_on: null })
    renderScreen(<PeoplePanel />)
    const dialog = await openRotation()

    fireEvent.change(within(dialog).getByLabelText('Wejście od'), { target: { value: '2025-08-01' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dodaj okres', pressed: false }))
    fireEvent.click(within(within(dialog).getByRole('radiogroup', { name: 'Rola dyżurowa' })).getByRole('radio', { name: 'SECONDARY' }))
    fireEvent.change(within(dialog).getByLabelText('Od'), { target: { value: '2025-08-01' } })
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Dodaj okres' }).find((button) => !button.hasAttribute('aria-pressed'))!)
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz (2)' }))

    await waitFor(() => expect(add).toHaveBeenCalledWith({ memberId: 'm1', input: { role: 'secondary', starts_on: '2025-08-01', ends_on: null } }))
    expect(save).toHaveBeenCalledWith({ id: 'm1', input: { active_from: '2025-08-01' } })
    expect(add.mock.invocationCallOrder[0]).toBeGreaterThan(save.mock.invocationCallOrder[0])
  })

  it('saves a later exit date before a period edited to reach it', async () => {
    mockData([user({ id: 'u1', phone: '+48 1' })])
    const { membership, periods } = rotationServer(member({ id: 'm1', active_until: '2026-12-31', eligibility: [
      { id: 'e1', role: 'primary', starts_on: '2025-09-02', ends_on: '2026-12-31' },
    ] }))
    noDutiesAfterExit()
    renderScreen(<PeoplePanel />)
    const dialog = await openRotation()

    fireEvent.change(within(dialog).getByLabelText(/^Wyjście do/), { target: { value: '2027-06-30' } })
    fireEvent.click(within(qualification(dialog, 'PRIMARY')).getByRole('button', { name: 'Edytuj: PRIMARY' }))
    fireEvent.change(within(dialog).getByLabelText('Do (opcjonalnie)'), { target: { value: '2027-06-30' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Gotowe' }))
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Zapisz (2)' })).toBeEnabled())
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz (2)' }))

    await waitFor(() => expect(periods).toHaveBeenCalledWith({ id: 'e1', input: { starts_on: '2025-09-02', ends_on: '2027-06-30' } }))
    expect(membership.mock.calls.map(([call]) => call)).toEqual([{ id: 'm1', input: { active_until: '2027-06-30' } }])
    expect(periods.mock.invocationCallOrder[0]).toBeGreaterThan(membership.mock.invocationCallOrder[0])
    await waitFor(() => expect(within(dialog).queryByText(/Niezapisane/)).not.toBeInTheDocument())
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('brings a saved exit date forward when every period already ends by then', async () => {
    mockData([user({ id: 'u1', phone: '+48 1' })])
    const { membership } = rotationServer(member({ id: 'm1', active_until: '2026-12-31', eligibility: [
      { id: 'e1', role: 'primary', starts_on: '2025-09-02', ends_on: '2026-10-31' },
    ] }))
    noDutiesAfterExit()
    renderScreen(<PeoplePanel />)
    const dialog = await openRotation()

    fireEvent.change(within(dialog).getByLabelText(/^Wyjście do/), { target: { value: '2026-11-30' } })
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Zapisz (1)' })).toBeEnabled())
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz (1)' }))

    await waitFor(() => expect(membership.mock.calls.map(([call]) => call)).toEqual([{ id: 'm1', input: { active_until: '2026-11-30' } }]))
    await waitFor(() => expect(within(dialog).queryByText(/Niezapisane/)).not.toBeInTheDocument())
  })

  it('saves a later entry date with the deletion of a period before it, and Undo puts the date back first', async () => {
    mockData([user({ id: 'u1', phone: '+48 1' })])
    const { membership, created } = rotationServer(member({ id: 'm1', active_from: '2026-12-01', eligibility: [
      { id: 'e1', role: 'primary', starts_on: '2026-12-01', ends_on: '2026-12-10' },
      { id: 'e2', role: 'secondary', starts_on: '2026-12-15', ends_on: null },
    ] }))
    renderScreen(<PeoplePanel />)
    const dialog = await openRotation()

    fireEvent.change(within(dialog).getByLabelText('Wejście od'), { target: { value: '2026-12-15' } })
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Kwalifikacja PRIMARY zaczyna się przed tą datą')
    fireEvent.click(within(qualification(dialog, 'PRIMARY')).getByRole('button', { name: 'Usuń: PRIMARY' }))
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(dialog).queryByText(/Późniejszą datę wejścia/)).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz (2)' }))

    await waitFor(() => expect(membership).toHaveBeenCalledWith({ id: 'm1', input: { active_from: '2026-12-15' } }))
    const remove = vi.mocked(api.deleteEligibility)
    expect(remove.mock.calls).toEqual([['e1']])
    expect(membership.mock.invocationCallOrder[0]).toBeGreaterThan(remove.mock.invocationCallOrder[0])
    expect(await screen.findByText('Zapisano: wejście do rotacji: 15-12-2026')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cofnij' }))

    await waitFor(() => expect(created).toHaveBeenCalledWith({ memberId: 'm1', input: { role: 'primary', starts_on: '2026-12-01', ends_on: '2026-12-10' } }))
    expect(membership).toHaveBeenLastCalledWith({ id: 'm1', input: { active_from: '2026-12-01' } })
    expect(created.mock.invocationCallOrder[0]).toBeGreaterThan(membership.mock.invocationCallOrder[1])
    await waitFor(() => expect(within(dialog).getByLabelText('Wejście od')).toHaveValue('2026-12-01'))
    expect(screen.queryByText('Nie udało się cofnąć')).not.toBeInTheDocument()
    expect(within(dialog).queryByText(/Niezapisane/)).not.toBeInTheDocument()
  })

  it('reports an account refusal only once the rotation is saved, so the list shows what is left', async () => {
    mockData([user({ id: 'u1', phone: '+48 601 220 118' })])
    let release = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const { membership } = rotationServer(member({ id: 'm1' }))
    const server = membership.getMockImplementation()!
    membership.mockImplementation(async (call) => {
      await gate
      return server(call)
    })
    vi.spyOn(api, 'updateAdminUser').mockRejectedValue(new Error('Adres e-mail jest już zajęty'))
    renderScreen(<PeoplePanel />)
    const dialog = await openRotation()

    fireEvent.change(within(dialog).getByLabelText('Wejście od'), { target: { value: '2025-08-01' } })
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Konto' }))
    fireEvent.change(within(dialog).getByLabelText('E-mail'), { target: { value: 'taken@example.com' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz (2)' }))
    await waitFor(() => expect(membership).toHaveBeenCalledWith({ id: 'm1', input: { active_from: '2025-08-01' } }))
    expect(within(dialog).queryByText('Adres e-mail jest już zajęty')).not.toBeInTheDocument()
    release()

    expect(await within(dialog).findByText('Adres e-mail jest już zajęty')).toBeInTheDocument()
    await waitFor(() => expect(within(dialog).getByText('Niezapisane: e-mail')).toBeInTheDocument())
  })

  it('keeps a later entry date back from a deletion of a period running into it and from the exit date', async () => {
    mockData([user({ id: 'u1', phone: '+48 1' })])
    const { membership, periods } = rotationServer(member({ id: 'm1', active_from: '2026-12-01', eligibility: [
      { id: 'e1', role: 'primary', starts_on: '2026-12-01', ends_on: null },
      { id: 'e2', role: 'secondary', starts_on: '2026-12-01', ends_on: null },
    ] }))
    noDutiesAfterExit()
    renderScreen(<PeoplePanel />)
    const dialog = await openRotation()

    fireEvent.change(within(dialog).getByLabelText('Wejście od'), { target: { value: '2026-12-15' } })
    fireEvent.change(within(dialog).getByLabelText(/^Wyjście do/), { target: { value: '2027-06-30' } })
    fireEvent.click(within(qualification(dialog, 'SECONDARY')).getByRole('button', { name: 'Usuń: SECONDARY' }))

    // The deleted period is not told to move its start; the note names its deletion instead.
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Kwalifikacja PRIMARY zaczyna się przed tą datą. Okres, który kończy się przed nią, usuń w tym samym zapisie; okres trwający dłużej najpierw przesuń albo usuń w osobnym zapisie.')
    expect(within(dialog).getByText('Późniejszą datę wejścia zapisz osobno, bez innych zmian rotacji: wyjście z rotacji: 30-06-2027, usunięcie okresu SECONDARY.')).toBeInTheDocument()
    await waitFor(() => expect(within(dialog).queryByText(/Sprawdzam/)).not.toBeInTheDocument())
    expect(within(dialog).getByRole('button', { name: 'Zapisz (3)' })).toBeDisabled()
    expect(membership).not.toHaveBeenCalled()
    expect(periods).not.toHaveBeenCalled()
    expect(api.deleteEligibility).not.toHaveBeenCalled()
    expect(within(dialog).getByText('Niezapisane: wejście do rotacji: 15-12-2026 · wyjście z rotacji: 30-06-2027 · usunięcie okresu SECONDARY')).toBeInTheDocument()
  })

  it('ends what an Undo puts back at an exit date saved since', async () => {
    mockData([user({ id: 'u1', phone: '+48 1' })])
    const { membership, created } = rotationServer(member({ id: 'm1', active_from: '2026-12-01', eligibility: [
      { id: 'e1', role: 'primary', starts_on: '2026-12-01', ends_on: null },
      { id: 'e2', role: 'secondary', starts_on: '2026-12-01', ends_on: '2027-12-31' },
    ] }))
    noDutiesAfterExit()
    renderScreen(<PeoplePanel />)
    const dialog = await openRotation()

    fireEvent.click(within(qualification(dialog, 'PRIMARY')).getByRole('button', { name: 'Usuń: PRIMARY' }))
    fireEvent.click(within(qualification(dialog, 'SECONDARY')).getByRole('button', { name: 'Usuń: SECONDARY' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz (2)' }))
    await waitFor(() => expect(within(dialog).queryByText(/Niezapisane/)).not.toBeInTheDocument())
    fireEvent.change(within(dialog).getByLabelText(/^Wyjście do/), { target: { value: '2027-06-30' } })
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Zapisz (1)' })).toBeEnabled())
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz (1)' }))
    await waitFor(() => expect(membership).toHaveBeenCalledWith({ id: 'm1', input: { active_until: '2027-06-30' } }))
    await waitFor(() => expect(within(dialog).queryByText(/Niezapisane/)).not.toBeInTheDocument())

    // The rotation now ends on 30-06-2027, so the server takes nothing past it.
    fireEvent.click(screen.getByRole('button', { name: 'Cofnij' }))
    await waitFor(() => expect(created).toHaveBeenCalledTimes(2))
    expect(created.mock.calls.map(([call]) => call)).toEqual([
      { memberId: 'm1', input: { role: 'primary', starts_on: '2026-12-01', ends_on: '2027-06-30' } },
      { memberId: 'm1', input: { role: 'secondary', starts_on: '2026-12-01', ends_on: '2027-06-30' } },
    ])
    expect(screen.queryByText('Nie udało się cofnąć')).not.toBeInTheDocument()
  })

  it('removes an exit date', async () => {
    mockData([user({ id: 'u1', phone: '+48 1' })], [member({ id: 'm1', active_until: '2026-12-31', eligibility: [
      { id: 'e1', role: 'primary', starts_on: '2025-09-02', ends_on: '2026-12-31' },
    ] })])
    noDutiesAfterExit()
    const save = vi.spyOn(api, 'updateTeamMember').mockResolvedValue(member({ id: 'm1' }))
    renderScreen(<PeoplePanel />)
    const dialog = await openRotation()

    fireEvent.change(within(dialog).getByLabelText(/^Wyjście do/), { target: { value: '' } })
    expect(within(dialog).getByText('Niezapisane: usunięcie daty wyjścia z rotacji')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz (1)' }))

    await waitFor(() => expect(save).toHaveBeenCalledWith({ id: 'm1', input: { active_until: null } }))
  })

  it('saves an exit date with published duties after it through the replacements dialog', async () => {
    mockData([user({ id: 'u1', phone: '+48 1' })])
    const rotation = vi.spyOn(api, 'updateTeamMember').mockResolvedValue(member({ id: 'm1' }))
    // The team follows what was saved: the entry date first, the exit date once the dialog is done.
    vi.spyOn(api, 'team').mockImplementation(async () => [member({
      id: 'm1',
      active_from: rotation.mock.calls.length > 0 ? '2025-08-01' : '2025-09-02',
      active_until: rotation.mock.calls.length > 1 ? '2026-09-30' : null,
    })])
    vi.spyOn(api, 'calendar').mockImplementation(async (startsOn) => ({
      starts_on: startsOn, ends_on: startsOn, days: [], team_has_members: true, availability: [],
      members: [
        { id: 'm1', display_name: 'Anna Kowalska', eligibility: [{ role: 'primary', starts_on: '2025-01-01', ends_on: null }] },
        { id: 'm2', display_name: 'Marek Nowak', eligibility: [{ role: 'primary', starts_on: '2025-01-01', ends_on: null }] },
      ],
      assignments: startsOn === '2026-10-01' ? [{
        service_date: '2026-10-02', role: 'primary', assignee_name: 'Anna Kowalska', is_override: false,
        schedule_id: 's1', schedule_version: 2, member_id: 'm1', change_kind: null,
      }] : [],
    }))
    vi.spyOn(api, 'batchOverrideCheck').mockResolvedValue({ violations: [], ends_handover: null })
    const rewrite = vi.spyOn(api, 'batchOverride').mockResolvedValue([])
    vi.spyOn(api, 'updateEligibility').mockResolvedValue({ id: 'e1', role: 'primary', starts_on: '2025-09-02', ends_on: '2026-09-30' })
    renderScreen(<PeoplePanel />)
    const dialog = await openRotation()

    fireEvent.change(within(dialog).getByLabelText('Wejście od'), { target: { value: '2025-08-01' } })
    fireEvent.change(within(dialog).getByLabelText(/^Wyjście do/), { target: { value: '2026-09-30' } })
    fireEvent.click(within(qualification(dialog, '11–19')).getByRole('button', { name: 'Zakończ dziś: 11–19' }))
    expect(await within(dialog).findByText('Po tej dacie jest 1 opublikowany dyżur; zapis poprowadzi przez wybór zastępców.')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz (3)' }))

    // The entry date saves at once; the exit date waits for the replacements,
    // the qualification for the duties that still need it to be rewritten.
    let sheet = await screen.findByRole('dialog', { name: 'Zakończenie rotacji: Anna Kowalska' })
    expect(rotation).toHaveBeenCalledTimes(1)
    expect(rotation).toHaveBeenCalledWith({ id: 'm1', input: { active_from: '2025-08-01' } })
    expect(api.updateEligibility).not.toHaveBeenCalled()
    expect(within(sheet).getByText(/1 dyżur po 30-09-2026 dostanie zastępcę/)).toBeInTheDocument()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Anuluj' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Zakończenie rotacji/ })).not.toBeInTheDocument())
    expect(within(dialog).getByText('Niezapisane: wyjście z rotacji: 30-09-2026 · okres 11–19')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz (2)' }))
    sheet = await screen.findByRole('dialog', { name: 'Zakończenie rotacji: Anna Kowalska' })
    expect(rotation).toHaveBeenCalledTimes(1)
    fireEvent.change(within(sheet).getByLabelText(/pt 2 paź · PRIMARY/), { target: { value: 'm2' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Przepisz 1 dyżur i zakończ rotację' }))

    await waitFor(() => expect(rotation).toHaveBeenLastCalledWith({ id: 'm1', input: { active_until: '2026-09-30' } }))
    expect(rewrite).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Zakończenie rotacji/ })).not.toBeInTheDocument())
    // The panel stays open on the person, with what the dialog left to save.
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText('Zakończono rotację: Anna Kowalska · przepisano 1 dyżur')).toBeInTheDocument()
    expect(within(dialog).getByText('Niezapisane: okres 11–19')).toBeInTheDocument()
  })

  it('ends what is still pending at the exit date the dialog closed and drops what would start after it', async () => {
    mockData([user({ id: 'u1', phone: '+48 1' })])
    const rotation = vi.spyOn(api, 'updateTeamMember').mockResolvedValue(member({ id: 'm1', active_until: '2026-09-30' }))
    vi.spyOn(api, 'team').mockImplementation(async () => [rotation.mock.calls.length === 0
      ? member({ id: 'm1', eligibility: [
        ...member({ id: 'm1' }).eligibility,
        { id: 'e3', role: 'secondary', starts_on: '2026-09-20', ends_on: '2026-10-31' },
        { id: 'e4', role: 'secondary', starts_on: '2026-11-01', ends_on: null },
      ] })
      : member({ id: 'm1', active_until: '2026-09-30', eligibility: [
        { id: 'e1', role: 'primary', starts_on: '2025-09-02', ends_on: '2026-09-30' },
        { id: 'e2', role: 'late_shift', starts_on: '2025-09-02', ends_on: '2026-09-30' },
        { id: 'e3', role: 'secondary', starts_on: '2026-09-20', ends_on: '2026-09-30' },
      ] })])
    vi.spyOn(api, 'calendar').mockImplementation(async (startsOn) => ({
      starts_on: startsOn, ends_on: startsOn, days: [], team_has_members: true, availability: [],
      members: [
        { id: 'm1', display_name: 'Anna Kowalska', eligibility: [{ role: 'primary', starts_on: '2025-01-01', ends_on: null }] },
        { id: 'm2', display_name: 'Marek Nowak', eligibility: [{ role: 'primary', starts_on: '2025-01-01', ends_on: null }] },
      ],
      assignments: startsOn === '2026-10-01' ? [{
        service_date: '2026-10-02', role: 'primary', assignee_name: 'Anna Kowalska', is_override: false,
        schedule_id: 's1', schedule_version: 2, member_id: 'm1', change_kind: null,
      }] : [],
    }))
    vi.spyOn(api, 'batchOverrideCheck').mockResolvedValue({ violations: [], ends_handover: null })
    vi.spyOn(api, 'batchOverride').mockResolvedValue([])
    const remove = vi.spyOn(api, 'deleteEligibility').mockResolvedValue(undefined)
    const update = vi.spyOn(api, 'updateEligibility').mockResolvedValue({ id: 'e1', role: 'primary', starts_on: '2025-09-02', ends_on: '2026-09-30' })
    const add = vi.spyOn(api, 'createEligibility').mockResolvedValue({ id: 'e5', role: 'late_shift', starts_on: '2026-09-21', ends_on: '2026-09-30' })
    renderScreen(<PeoplePanel />)
    const dialog = await openRotation()
    const editPeriod = (role: string, index: number, label: string, value: string) => {
      fireEvent.click(within(qualification(dialog, role, index)).getByRole('button', { name: `Edytuj: ${role}` }))
      fireEvent.change(within(dialog).getByLabelText(label), { target: { value } })
      fireEvent.click(within(dialog).getByRole('button', { name: 'Gotowe' }))
    }
    const addPeriod = (role: string, from: string) => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Dodaj okres', pressed: false }))
      fireEvent.click(within(within(dialog).getByRole('radiogroup', { name: 'Rola dyżurowa' })).getByRole('radio', { name: role }))
      fireEvent.change(within(dialog).getByLabelText('Od'), { target: { value: from } })
      fireEvent.click(within(dialog).getAllByRole('button', { name: 'Dodaj okres' }).find((button) => !button.hasAttribute('aria-pressed'))!)
    }

    // An open period that only moves its start, one ending before the exit,
    // one to delete, one starting after the exit, and two new ones on either side of it.
    editPeriod('PRIMARY', 0, 'Od', '2025-10-01')
    editPeriod('11–19', 0, 'Do (opcjonalnie)', '2026-09-20')
    fireEvent.click(within(qualification(dialog, 'SECONDARY', 0)).getByRole('button', { name: 'Usuń: SECONDARY' }))
    editPeriod('SECONDARY', 1, 'Do (opcjonalnie)', '2027-01-31')
    addPeriod('11–19', '2026-09-21')
    addPeriod('PRIMARY', '2026-10-10')
    fireEvent.change(within(dialog).getByLabelText(/^Wyjście do/), { target: { value: '2026-09-30' } })
    expect(await within(dialog).findByText('Po tej dacie jest 1 opublikowany dyżur; zapis poprowadzi przez wybór zastępców.')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz (7)' }))
    const sheet = await screen.findByRole('dialog', { name: 'Zakończenie rotacji: Anna Kowalska' })
    fireEvent.change(within(sheet).getByLabelText(/pt 2 paź · PRIMARY/), { target: { value: 'm2' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Przepisz 1 dyżur i zakończ rotację' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Zakończenie rotacji/ })).not.toBeInTheDocument())
    expect(await within(dialog).findByText('Niezapisane: okres PRIMARY · okres 11–19 · usunięcie okresu SECONDARY · nowy okres 11–19')).toBeInTheDocument()
    update.mockClear()
    remove.mockClear()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz (4)' }))
    await waitFor(() => expect(add).toHaveBeenCalledWith({ memberId: 'm1', input: { role: 'late_shift', starts_on: '2026-09-21', ends_on: '2026-09-30' } }))
    expect(add).toHaveBeenCalledTimes(1)
    expect(remove.mock.calls).toEqual([['e3']])
    expect(update.mock.calls.map(([call]) => call)).toEqual([
      { id: 'e1', input: { starts_on: '2025-10-01', ends_on: '2026-09-30' } },
      { id: 'e2', input: { starts_on: '2025-09-02', ends_on: '2026-09-20' } },
    ])
  })

  it('ends the rotation from its own button, as of today without an exit date', async () => {
    mockData([user({ id: 'u1', phone: '+48 1' })])
    vi.spyOn(api, 'team').mockResolvedValueOnce([member({ id: 'm1' })]).mockResolvedValue([member({ id: 'm1', active_until: '2026-09-10' })])
    noDutiesAfterExit()
    const endPeriod = vi.spyOn(api, 'updateEligibility').mockResolvedValue({ id: 'e1', role: 'primary', starts_on: '2025-09-02', ends_on: '2026-09-10' })
    const finish = vi.spyOn(api, 'updateTeamMember').mockResolvedValue(member({ id: 'm1', active_until: '2026-09-10' }))
    renderScreen(<PeoplePanel />)
    const dialog = await openRotation()

    expect(within(dialog).getByText('przepisuje przyszłe dyżury i zamyka uprawnienia')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zakończ rotację…' }))
    const sheet = await screen.findByRole('dialog', { name: 'Zakończenie rotacji: Anna Kowalska' })
    expect(await within(sheet).findByText(/Brak dyżurów po dacie wyjścia/)).toBeInTheDocument()
    expect(within(sheet).getByText('Kwalifikacje tej osoby skończą się z dniem 10-09-2026.')).toBeInTheDocument()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Zakończ rotację' }))

    await waitFor(() => expect(finish).toHaveBeenCalledWith({ id: 'm1', input: { active_until: '2026-09-10' } }))
    expect(await screen.findByText('Zakończono rotację: Anna Kowalska')).toBeInTheDocument()
    expect(endPeriod).toHaveBeenCalledWith({ id: 'e1', input: { ends_on: '2026-09-10' } })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Zakończenie rotacji/ })).not.toBeInTheDocument())
    expect(within(dialog).getByLabelText(/^Wyjście do/)).toHaveValue('2026-09-10')
    expect(within(dialog).queryByText(/Niezapisane/)).not.toBeInTheDocument()
  })

  it('leaves the exit date to the dialog when the duties after it cannot be read', async () => {
    mockData([user({ id: 'u1', phone: '+48 1' })], [member({ id: 'm1', eligibility: [
      { id: 'e1', role: 'primary', starts_on: '2025-09-02', ends_on: '2026-06-30' },
    ] })])
    vi.spyOn(api, 'calendar').mockRejectedValue(new Error('Brak połączenia'))
    const save = vi.spyOn(api, 'updateTeamMember')
    renderScreen(<PeoplePanel />)
    const dialog = await openRotation()

    fireEvent.change(within(dialog).getByLabelText(/^Wyjście do/), { target: { value: '2026-09-30' } })
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Zapisz (1)' })).toBeEnabled())
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz (1)' }))

    const sheet = await screen.findByRole('dialog', { name: 'Zakończenie rotacji: Anna Kowalska' })
    expect(await within(sheet).findByRole('alert')).toHaveTextContent('Brak połączenia')
    expect(save).not.toHaveBeenCalled()
  })
})

describe('PeoplePanel qualification periods', () => {
  afterEach(() => focusManager.setFocused(undefined))

  it('adds a period for the chosen role and dates and creates it only on save', async () => {
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
    const submitPeriod = () => within(dialog).getAllByRole('button', { name: 'Dodaj okres' }).find((button) => !button.hasAttribute('aria-pressed'))!
    fireEvent.change(within(dialog).getByLabelText('Od'), { target: { value: '' } })
    expect(submitPeriod()).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText('Od'), { target: { value: '2026-10-01' } })
    fireEvent.change(within(dialog).getByLabelText('Do (opcjonalnie)'), { target: { value: '2026-12-31' } })
    fireEvent.click(submitPeriod())

    expect(within(dialog).queryByRole('radiogroup', { name: 'Rola dyżurowa' })).not.toBeInTheDocument()
    const added = qualification(dialog, 'SECONDARY')
    expect(within(added).getByText(/od 01-10-2026 do 31-12-2026/)).toBeInTheDocument()
    expect(within(added).getByText('nowy, niezapisany')).toBeInTheDocument()
    expect(within(dialog).getByText('Niezapisane: nowy okres SECONDARY')).toBeInTheDocument()
    fireEvent.click(within(added).getByRole('button', { name: 'Usuń: SECONDARY' }))
    expect(within(dialog).queryByText(/Niezapisane/)).not.toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Dodaj SECONDARY' }))
    expect(within(qualification(dialog, 'SECONDARY')).getByText(/od 10-09-2026 · bez daty końca/)).toBeInTheDocument()
    expect(add).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz (1)' }))
    await waitFor(() => expect(add).toHaveBeenCalledWith({ memberId: 'm1', input: { role: 'secondary', starts_on: '2026-09-10', ends_on: null } }))
    await waitFor(() => expect(within(dialog).queryByText(/Niezapisane/)).not.toBeInTheDocument())
  })

  it('shows why a period could not be added and does not create the saved one twice', async () => {
    mockData([user({ id: 'u1', phone: '+48 1' })], [member({ id: 'm1', eligibility: [{ id: 'e1', role: 'primary', starts_on: '2025-09-02', ends_on: null }] })])
    const add = vi.spyOn(api, 'createEligibility')
      .mockResolvedValueOnce({ id: 'e3', role: 'secondary', starts_on: '2026-09-10', ends_on: null })
      .mockRejectedValueOnce(new Error('Okresy nakładają się'))
      .mockResolvedValue({ id: 'e4', role: 'late_shift', starts_on: '2026-09-10', ends_on: null })
    renderScreen(<PeoplePanel />)
    const dialog = await openRotation()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Dodaj SECONDARY' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dodaj 11–19' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz (2)' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Okresy nakładają się')
    expect(within(dialog).getByText('Niezapisane: nowy okres 11–19')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz (1)' }))
    await waitFor(() => expect(add).toHaveBeenCalledTimes(3))
    expect(add).toHaveBeenLastCalledWith({ memberId: 'm1', input: { role: 'late_shift', starts_on: '2026-09-10', ends_on: null } })
  })

  it('marks an edited period as unsaved until it is edited back or restored', async () => {
    mockData([user({ id: 'u1', phone: '+48 1' })], [member({ id: 'm1', eligibility: [
      { id: 'e1', role: 'primary', starts_on: '2025-09-02', ends_on: null },
      { id: 'e2', role: 'late_shift', starts_on: '2025-09-02', ends_on: '2026-12-31' },
    ] })])
    renderScreen(<PeoplePanel />)
    const dialog = await openRotation()

    fireEvent.click(within(qualification(dialog, '11–19')).getByRole('button', { name: 'Edytuj: 11–19' }))
    fireEvent.change(within(dialog).getByLabelText('Do (opcjonalnie)'), { target: { value: '' } })
    expect(within(dialog).getByText('Niezapisane: okres 11–19')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Gotowe' }))
    const edited = qualification(dialog, '11–19')
    expect(within(edited).getByText(/od 02-09-2025 · bez daty końca/)).toBeInTheDocument()
    expect(within(edited).getByText('zmieniony, niezapisany')).toBeInTheDocument()

    fireEvent.click(within(edited).getByRole('button', { name: 'Edytuj: 11–19' }))
    fireEvent.change(within(dialog).getByLabelText('Do (opcjonalnie)'), { target: { value: '2026-12-31' } })
    expect(within(dialog).queryByText(/Niezapisane/)).not.toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText('Do (opcjonalnie)'), { target: { value: '2027-01-31' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Gotowe' }))
    fireEvent.click(within(qualification(dialog, '11–19')).getByRole('button', { name: 'Przywróć: 11–19' }))
    expect(within(dialog).queryByText(/Niezapisane/)).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Zapisz' })).toBeDisabled()
  })

  it('saves a new start alone and refuses a period left without a start', async () => {
    mockData([user({ id: 'u1', phone: '+48 1' })], [member({ id: 'm1' })])
    const save = vi.spyOn(api, 'updateEligibility').mockResolvedValue({ id: 'e1', role: 'primary', starts_on: '2025-10-01', ends_on: null })
    renderScreen(<PeoplePanel />)
    const dialog = await openRotation()

    fireEvent.click(within(qualification(dialog, 'PRIMARY')).getByRole('button', { name: 'Edytuj: PRIMARY' }))
    fireEvent.change(within(dialog).getByLabelText('Od'), { target: { value: '' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz (1)' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Każdy okres kwalifikacji musi mieć datę początku')
    expect(save).not.toHaveBeenCalled()

    fireEvent.change(within(dialog).getByLabelText('Od'), { target: { value: '2025-10-01' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz (1)' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ id: 'e1', input: { starts_on: '2025-10-01', ends_on: null } }))
    expect(await screen.findByText('Zapisano: okres PRIMARY')).toBeInTheDocument()
  })

  it('ends a qualification today on save and puts its end date back with Undo', async () => {
    mockData([user({ id: 'u1', phone: '+48 1' })], [member({ id: 'm1' })])
    const save = vi.spyOn(api, 'updateEligibility').mockResolvedValue({ id: 'e2', role: 'late_shift', starts_on: '2025-09-02', ends_on: '2026-09-09' })
    renderScreen(<PeoplePanel />)
    const dialog = await openRotation()

    fireEvent.click(within(qualification(dialog, '11–19')).getByRole('button', { name: 'Zakończ dziś: 11–19' }))
    expect(within(qualification(dialog, '11–19')).getByText(/od 02-09-2025 do 09-09-2026/)).toBeInTheDocument()
    expect(within(dialog).getByText('Niezapisane: okres 11–19')).toBeInTheDocument()
    expect(save).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz (1)' }))

    // The period ends yesterday: the published schedule keeps its duties, the next generation skips the role.
    await waitFor(() => expect(save).toHaveBeenCalledWith({ id: 'e2', input: { starts_on: '2025-09-02', ends_on: '2026-09-09' } }))
    expect(await screen.findByText('Zakończono kwalifikację 11–19 od dziś')).toBeInTheDocument()
    // The removal's own toast says what was saved; no second one repeats it.
    expect(screen.queryByText(/^Zapisano/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cofnij' }))
    await waitFor(() => expect(save).toHaveBeenLastCalledWith({ id: 'e2', input: { starts_on: '2025-09-02', ends_on: null } }))
    await waitFor(() => expect(screen.queryByText('Zakończono kwalifikację 11–19 od dziś')).not.toBeInTheDocument())
    expect(api.team).toHaveBeenCalledTimes(3)
  })

  it('deletes a period that has not started on save and creates it again with Undo', async () => {
    mockData([user({ id: 'u1', phone: '+48 1' })], [member({ id: 'm1', eligibility: [
      { id: 'e1', role: 'secondary', starts_on: '2025-01-01', ends_on: '2025-12-31' },
      { id: 'e3', role: 'secondary', starts_on: '2026-10-01', ends_on: null },
    ] })])
    const remove = vi.spyOn(api, 'deleteEligibility').mockResolvedValue(undefined)
    const end = vi.spyOn(api, 'updateEligibility')
    const restore = vi.spyOn(api, 'createEligibility').mockResolvedValue({ id: 'e4', role: 'secondary', starts_on: '2026-10-01', ends_on: null })
    renderScreen(<PeoplePanel />)
    const dialog = await openRotation()
    expect(within(qualification(dialog, 'SECONDARY', 1)).getByText('historia')).toBeInTheDocument()

    fireEvent.click(within(qualification(dialog, 'SECONDARY')).getByRole('button', { name: 'Usuń: SECONDARY' }))
    expect(within(qualification(dialog, 'SECONDARY')).getByText('usunięty, niezapisany')).toBeInTheDocument()
    expect(within(qualification(dialog, 'SECONDARY')).queryByRole('button', { name: 'Edytuj: SECONDARY' })).not.toBeInTheDocument()
    expect(within(dialog).getByText('Niezapisane: usunięcie okresu SECONDARY')).toBeInTheDocument()
    fireEvent.click(within(qualification(dialog, 'SECONDARY')).getByRole('button', { name: 'Przywróć: SECONDARY' }))
    expect(within(dialog).queryByText(/Niezapisane/)).not.toBeInTheDocument()
    fireEvent.click(within(qualification(dialog, 'SECONDARY')).getByRole('button', { name: 'Usuń: SECONDARY' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz (1)' }))

    await waitFor(() => expect(remove).toHaveBeenCalledWith('e3'))
    expect(remove).toHaveBeenCalledTimes(1)
    expect(end).not.toHaveBeenCalled()
    expect(await screen.findByText('Usunięto okres SECONDARY')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cofnij' }))
    await waitFor(() => expect(restore).toHaveBeenCalledWith({ memberId: 'm1', input: { role: 'secondary', starts_on: '2026-10-01', ends_on: null } }))
  })

  it('ends a qualification on a chosen past day and reports an Undo that failed', async () => {
    mockData([user({ id: 'u1', phone: '+48 1' })], [member({ id: 'm1' })])
    const save = vi.spyOn(api, 'updateEligibility')
      .mockResolvedValueOnce({ id: 'e2', role: 'late_shift', starts_on: '2025-09-02', ends_on: '2026-08-31' })
      .mockRejectedValue(new Error('Okres nakłada się na inny'))
    renderScreen(<PeoplePanel />)
    const dialog = await openRotation()

    fireEvent.click(within(qualification(dialog, '11–19')).getByRole('button', { name: 'Edytuj: 11–19' }))
    fireEvent.change(within(dialog).getByLabelText('Do (opcjonalnie)'), { target: { value: '2026-08-31' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz (1)' }))

    expect(await screen.findByText('Zakończono kwalifikację 11–19 z dniem 31-08-2026')).toBeInTheDocument()
    expect(save).toHaveBeenCalledWith({ id: 'e2', input: { starts_on: '2025-09-02', ends_on: '2026-08-31' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cofnij' }))
    expect(await screen.findByText('Nie udało się cofnąć')).toBeInTheDocument()
    expect(screen.getByText('Okres nakłada się na inny')).toBeInTheDocument()
  })

  it('shows why a qualification could not be ended and keeps only it pending', async () => {
    mockData([user({ id: 'u1', phone: '+48 1' })])
    vi.spyOn(api, 'team').mockResolvedValueOnce([member({ id: 'm1' })]).mockResolvedValue([member({ id: 'm1', active_from: '2025-09-01' })])
    const entry = vi.spyOn(api, 'updateTeamMember').mockResolvedValue(member({ id: 'm1', active_from: '2025-09-01' }))
    vi.spyOn(api, 'updateEligibility').mockRejectedValue(new Error('Konflikt wersji'))
    renderScreen(<PeoplePanel />)
    const dialog = await openRotation()

    fireEvent.change(within(dialog).getByLabelText(/^Wejście od/), { target: { value: '2025-09-01' } })
    fireEvent.click(within(qualification(dialog, 'PRIMARY')).getByRole('button', { name: 'Zakończ dziś: PRIMARY' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz (2)' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Konflikt wersji')
    expect(entry).toHaveBeenCalledWith({ id: 'm1', input: { active_from: '2025-09-01' } })
    expect(screen.queryByRole('button', { name: 'Cofnij' })).not.toBeInTheDocument()
    // The entry date was saved before the refusal, so only the period stays listed.
    expect(await within(dialog).findByText('Niezapisane: okres PRIMARY')).toBeInTheDocument()
  })

  it('does not resend a period edit the server already holds', async () => {
    // Returning to the window reloads the team while a period edit is still
    // pending; the reloaded period already starts where the edit moved it.
    vi.spyOn(api, 'adminUsers').mockResolvedValue([user({ id: 'u1', phone: '+48 1' })])
    vi.spyOn(api, 'publicConfig').mockRejectedValue(new Error('offline'))
    vi.spyOn(api, 'team')
      .mockResolvedValueOnce([member({ id: 'm1' })])
      .mockResolvedValue([member({ id: 'm1', eligibility: [
        { id: 'e1', role: 'primary', starts_on: '2025-10-01', ends_on: null },
        { id: 'e2', role: 'late_shift', starts_on: '2025-09-02', ends_on: null },
      ] })])
    const period = vi.spyOn(api, 'updateEligibility')
    const account = vi.spyOn(api, 'updateAdminUser').mockResolvedValue(user({ id: 'u1' }))
    renderScreen(<PeoplePanel />)
    const dialog = await openRotation()
    fireEvent.click(within(qualification(dialog, 'PRIMARY')).getByRole('button', { name: 'Edytuj: PRIMARY' }))
    fireEvent.change(within(dialog).getByLabelText('Od'), { target: { value: '2025-10-01' } })
    expect(within(dialog).getByText('Niezapisane: okres PRIMARY')).toBeInTheDocument()

    act(() => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
    })
    await waitFor(() => expect(within(dialog).queryByText('Niezapisane: okres PRIMARY')).not.toBeInTheDocument())
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Konto' }))
    fireEvent.change(within(dialog).getByLabelText('E-mail'), { target: { value: 'nowy@example.com' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz (1)' }))

    await waitFor(() => expect(account).toHaveBeenCalledTimes(1))
    expect(period).not.toHaveBeenCalled()
  })
})

