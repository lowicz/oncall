import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderScreen } from '../../test/render'
import { ForwardingPanel } from './Forwarding'
import { AdminUser, ForwardingSettings, ForwardingState, RevealedPasswords, TeamMember, api } from '../../api'

afterEach(() => vi.restoreAllMocks())

const SETTINGS: ForwardingSettings = {
  mode: 'dry_run', base_url: 'https://wco.orange.pl', vpbx_number: '221234567', username: 'oncall-bot', wco_user_id: '4711',
  password_set: true, password_changed_at: '2026-09-01T07:00:00Z', rotation_pending_since: null, credentials_invalid_since: null,
  updated_at: '2026-09-01T07:05:00Z',
}
const EMPTY_SETTINGS: ForwardingSettings = {
  mode: 'off', base_url: 'https://wco.orange.pl', vpbx_number: null, username: null, wco_user_id: null,
  password_set: false, password_changed_at: null, rotation_pending_since: null, credentials_invalid_since: null,
  updated_at: '2026-09-01T07:05:00Z',
}
const STATE: ForwardingState = {
  applied_number: '+48600600600', applied_member_name: 'Anna Kowalska', applied_at: '2026-09-09T07:00:00Z',
  desired_number: '+48500500500', desired_member_name: 'Marek Nowak', desired_for_day: '2026-09-10',
  last_attempt_at: '2026-09-10T07:00:30Z', last_outcome: 'failed', last_error: 'POST /admin_api/perform_login answered HTTP 401 or 403',
  failing_since: '2026-09-10T07:00:00Z', attempts: 3, next_attempt_at: '2026-09-10T08:00:00Z',
}
const EMPTY_STATE: ForwardingState = {
  applied_number: null, applied_member_name: null, applied_at: null, desired_number: null, desired_member_name: null,
  desired_for_day: null, last_attempt_at: null, last_outcome: null, last_error: null, failing_since: null, attempts: 0, next_attempt_at: null,
}
const member = (id: string, user_id: string | null, display_name: string, active_until: string | null = null): TeamMember =>
  ({ id, user_id, display_name, active_from: '2025-01-01', active_until, eligibility: [] })
const TEAM: TeamMember[] = [
  member('m1', 'u1', 'Anna Kowalska'),
  member('m2', 'u2', 'Marek Nowak'),
  member('m3', 'u3', 'Zofia Lis'),
  member('m4', null, 'Importowany Gość'),
  member('m5', 'u5', 'Ola Wiśniewska', '2026-08-31'),
]
const user = (id: string, display_name: string, phone: string | null): AdminUser => ({
  id, username: id, personnel_number: null, first_name: '', last_name: '', display_name, auth_source: 'local', role: 'member',
  email: null, phone, is_active: true, created_at: '2025-09-02T10:00:00Z', pending_activation: null,
})
const USERS: AdminUser[] = [
  user('u1', 'Anna Kowalska', '+48600600600'),
  user('u2', 'Marek Nowak', null),
  user('u3', 'Zofia Lis', '123'),
  user('u5', 'Ola Wiśniewska', '+48500500500'),
]
const REVEALED: RevealedPasswords = {
  current: 'Dummy-Haslo-WCO!1', pending: null, pending_since: null, credentials_invalid_since: null, password_changed_at: '2026-09-01T07:00:00Z',
}

function stub(settings = SETTINGS, state = STATE) {
  vi.spyOn(api, 'forwardingSettings').mockResolvedValue(settings)
  vi.spyOn(api, 'forwardingState').mockResolvedValue(state)
  vi.spyOn(api, 'team').mockResolvedValue(TEAM)
  vi.spyOn(api, 'adminUsers').mockResolvedValue(USERS)
}

const settingsForm = () => screen.findByRole('form', { name: 'Konto WCO' })
const row = (key: string) => (screen.getByText(key).closest('.kv-row') as HTMLElement)

describe('ForwardingPanel', () => {
  it('shows the saved account, the state and the numbers of the rotation', async () => {
    stub()
    renderScreen(<ForwardingPanel />)

    const form = await settingsForm()
    expect(within(form).getByLabelText('Tryb')).toHaveValue('dry_run')
    expect(within(form).getByText(/Proces loguje się do WCO i odczytuje numer/)).toBeInTheDocument()
    expect(within(form).getByLabelText(/Adres WCO/)).toHaveValue('https://wco.orange.pl')
    expect(within(form).getByLabelText('Numer centrali')).toHaveValue('221234567')
    expect(within(form).getByLabelText('Login')).toHaveValue('oncall-bot')
    expect(within(form).getByLabelText('Identyfikator użytkownika WCO')).toHaveValue('4711')
    expect(within(form).getByText('Hasło zapisane, zmienione 01-09-2026, 09:00.')).toBeInTheDocument()
    expect(within(form).getByText('zapisano 01-09-2026, 09:05')).toBeInTheDocument()
    expect(within(form).getByRole('button', { name: 'Sprawdź połączenie' })).toBeEnabled()

    expect(row('Cel')).toHaveTextContent('Marek Nowak · +48500500500 · dyżur 10-09-2026')
    expect(row('WCO przekierowuje na')).toHaveTextContent('+48600600600 · Anna Kowalska')
    expect(row('Potwierdzono')).toHaveTextContent('09-09-2026, 09:00')
    expect(row('Ostatnia próba')).toHaveTextContent('10-09-2026, 09:00')
    expect(row('Wynik')).toHaveTextContent('niepowodzenie')
    expect(row('Błąd')).toHaveTextContent('POST /admin_api/perform_login answered HTTP 401 or 403')
    expect(row('Niepowodzenia od')).toHaveTextContent('10-09-2026, 09:00')
    expect(row('Nieudane próby')).toHaveTextContent('3')
    expect(row('Następna próba')).toHaveTextContent('10-09-2026, 10:00')
    expect(row('Hasło WCO zmieniono')).toHaveTextContent('01-09-2026, 09:00')
    expect(screen.queryByText('Zmiana hasła w toku od')).not.toBeInTheDocument()

    const heading = screen.getByRole('heading', { name: 'Numery osób w rotacji' })
    expect(heading.nextElementSibling).toHaveTextContent('4 w rotacji · 3 do uzupełnienia')
    const names = Array.from(document.querySelectorAll('.list-row b')).map((node) => node.textContent)
    expect(names).toEqual(['Importowany Gość', 'Marek Nowak', 'Zofia Lis', 'Anna Kowalska'])
    expect(screen.queryByText('Ola Wiśniewska')).not.toBeInTheDocument()
    const zofia = screen.getByText('Zofia Lis').closest('.list-row') as HTMLElement
    expect(within(zofia).getByText('popraw numer')).toBeInTheDocument()
    expect(within(zofia).getByText('123')).toBeInTheDocument()
    const guest = screen.getByText('Importowany Gość').closest('.list-row') as HTMLElement
    expect(within(guest).getAllByText('brak numeru')).toHaveLength(2)
    expect(screen.getByRole('link', { name: 'Osoby' })).toHaveAttribute('href', '/osoby')
  })

  it('starts empty: the password is required and the connection cannot be checked yet', async () => {
    stub(EMPTY_SETTINGS, EMPTY_STATE)
    renderScreen(<ForwardingPanel />)

    const form = await settingsForm()
    expect(within(form).getByLabelText(/Hasło WCO/)).toBeRequired()
    expect(within(form).queryByRole('button', { name: 'Zostaw zapisane' })).not.toBeInTheDocument()
    expect(within(form).getByRole('button', { name: 'Sprawdź połączenie' })).toBeDisabled()
    expect(within(form).getByText('Najpierw zapisz numer centrali, login, identyfikator użytkownika i hasło.')).toBeInTheDocument()
    expect(row('Cel')).toHaveTextContent('-')
    expect(row('WCO przekierowuje na')).toHaveTextContent('-')
    expect(row('Wynik')).toHaveTextContent('-')
    expect(row('Hasło WCO zmieniono')).toHaveTextContent('-')
    expect(screen.queryByText('Błąd')).not.toBeInTheDocument()
    expect(screen.queryByText('Niepowodzenia od')).not.toBeInTheDocument()
  })

  it('names a day with nobody on PRIMARY, a target without a number and a number WCO holds for nobody', async () => {
    stub(
      { ...SETTINGS, password_changed_at: null, rotation_pending_since: '2026-09-10T06:00:00Z', credentials_invalid_since: '2026-09-10T06:30:00Z' },
      { ...STATE, desired_member_name: null, desired_number: null, applied_member_name: null, last_outcome: 'skipped_no_primary', last_error: null, failing_since: null },
    )
    renderScreen(<ForwardingPanel />)

    const form = await settingsForm()
    expect(within(form).getByText('Hasło zapisane.')).toBeInTheDocument()
    expect(within(form).getByRole('alert')).toHaveTextContent('WCO odrzuciło zapisane hasła 10-09-2026, 08:30. Proces nie loguje się, dopóki nie wpiszesz nowego hasła.')
    expect(within(form).getByText(/Trwa automatyczna zmiana hasła WCO \(od 10-09-2026, 08:00\)/)).toBeInTheDocument()
    expect(row('Cel')).toHaveTextContent('nikt na PRIMARY · dyżur 10-09-2026')
    expect(row('WCO przekierowuje na')).toHaveTextContent('+48600600600')
    expect(row('Wynik')).toHaveTextContent('pominięto: nikogo na PRIMARY')
    expect(row('Zmiana hasła w toku od')).toHaveTextContent('10-09-2026, 08:00')
    expect(row('Hasła odrzucone')).toHaveTextContent('10-09-2026, 08:30')
    expect(screen.queryByText('Nieudane próby')).not.toBeInTheDocument()
  })

  it('says when the target has no number', async () => {
    stub(SETTINGS, { ...STATE, desired_number: null, last_outcome: 'skipped_no_phone' })
    renderScreen(<ForwardingPanel />)

    await settingsForm()
    expect(row('Cel')).toHaveTextContent('Marek Nowak · brak numeru · dyżur 10-09-2026')
    expect(row('Wynik')).toHaveTextContent('pominięto: brak numeru')
  })

  it('saves the form with a new password and then keeps the stored one', async () => {
    stub(EMPTY_SETTINGS, EMPTY_STATE)
    const update = vi.spyOn(api, 'updateForwardingSettings').mockResolvedValue({
      ...SETTINGS, mode: 'live', password_changed_at: '2026-09-10T07:00:00Z',
    })
    renderScreen(<ForwardingPanel />)

    const form = await settingsForm()
    fireEvent.change(within(form).getByLabelText('Tryb'), { target: { value: 'live' } })
    expect(within(form).getByText(/Proces przełącza numer na telefon osoby/)).toBeInTheDocument()
    fireEvent.change(within(form).getByLabelText(/Adres WCO/), { target: { value: 'https://wco.example.test ' } })
    fireEvent.change(within(form).getByLabelText('Numer centrali'), { target: { value: ' 221234567 ' } })
    fireEvent.change(within(form).getByLabelText('Login'), { target: { value: 'oncall-bot' } })
    fireEvent.change(within(form).getByLabelText('Identyfikator użytkownika WCO'), { target: { value: '4711' } })
    fireEvent.change(within(form).getByLabelText(/Hasło WCO/), { target: { value: 'Dummy-Haslo-WCO!1' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Zapisz' }))

    await waitFor(() => expect(update).toHaveBeenCalledWith({
      mode: 'live', base_url: 'https://wco.example.test', vpbx_number: '221234567', username: 'oncall-bot', wco_user_id: '4711', password: 'Dummy-Haslo-WCO!1',
    }))
    expect(await screen.findByText('Zapisano ustawienia przełączania')).toBeInTheDocument()
    expect(within(form).getByText('Hasło zapisane, zmienione 10-09-2026, 09:00.')).toBeInTheDocument()
    expect(within(form).getByRole('button', { name: 'Sprawdź połączenie' })).toBeEnabled()

    fireEvent.click(within(form).getByRole('button', { name: 'Zmień hasło' }))
    expect(within(form).getByLabelText(/Hasło WCO/)).not.toBeRequired()
    fireEvent.click(within(form).getByRole('button', { name: 'Zostaw zapisane' }))
    expect(within(form).queryByLabelText(/Hasło WCO/)).not.toBeInTheDocument()
    fireEvent.click(within(form).getByRole('button', { name: 'Zapisz' }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(2))
    expect(update.mock.calls[1][0]).toMatchObject({ password: null, vpbx_number: '221234567' })
  })

  it('keeps asking for a password after a save that stored none', async () => {
    stub(EMPTY_SETTINGS, EMPTY_STATE)
    vi.spyOn(api, 'updateForwardingSettings').mockResolvedValue({ ...EMPTY_SETTINGS, vpbx_number: '221234567' })
    renderScreen(<ForwardingPanel />)

    const form = await settingsForm()
    fireEvent.submit(form)

    expect(await screen.findByText('Zapisano ustawienia przełączania')).toBeInTheDocument()
    expect(within(form).getByLabelText(/Hasło WCO/)).toBeRequired()
    expect(within(form).getByRole('button', { name: 'Sprawdź połączenie' })).toBeDisabled()
  })

  it('sends null for fields left blank and shows why a save was refused', async () => {
    stub(EMPTY_SETTINGS, EMPTY_STATE)
    const update = vi.spyOn(api, 'updateForwardingSettings').mockRejectedValue(new Error('Hasło WCO jest przechowywane zaszyfrowane, a serwer nie ma klucza'))
    renderScreen(<ForwardingPanel />)

    const form = await settingsForm()
    fireEvent.submit(form)

    expect(await within(form).findByRole('alert')).toHaveTextContent('serwer nie ma klucza')
    expect(update).toHaveBeenCalledWith({
      mode: 'off', base_url: 'https://wco.orange.pl', vpbx_number: null, username: null, wco_user_id: null, password: null,
    })
  })

  it.each([
    [{ outcome: 'ok', number: '+48600600600', detail: null }, 'Połączenie działa. WCO przekierowuje teraz na +48600600600.', 'box-ok'],
    [{ outcome: 'ok', number: null, detail: null }, 'Połączenie działa, ale WCO nie podało numeru.', 'box-ok'],
    [{ outcome: 'password_expired', number: null, detail: null }, 'Logowanie działa, ale hasło WCO wygasło.', 'box-warn'],
    [{ outcome: 'connection', number: null, detail: 'GET /admin_api/login failed: ConnectError' }, 'Nie udało się połączyć z WCO.', 'box-bad'],
  ] as const)('reports a connection check: %o', async (result, text, tone) => {
    stub()
    const test = vi.spyOn(api, 'testForwardingConnection').mockResolvedValue({ ...result })
    renderScreen(<ForwardingPanel />)

    fireEvent.click(await screen.findByRole('button', { name: 'Sprawdź połączenie' }))

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(text)
    expect(status).toHaveClass(tone)
    if (result.detail) expect(within(status).getByText(result.detail)).toHaveClass('mono')
    expect(test).toHaveBeenCalledTimes(1)
  })

  it('drops a connection check result once the settings are saved', async () => {
    stub()
    vi.spyOn(api, 'testForwardingConnection').mockResolvedValue({ outcome: 'login_refused', number: null, detail: null })
    vi.spyOn(api, 'updateForwardingSettings').mockResolvedValue(SETTINGS)
    renderScreen(<ForwardingPanel />)

    fireEvent.click(await screen.findByRole('button', { name: 'Sprawdź połączenie' }))
    expect(await screen.findByText(/WCO odrzuciło zapisane dane logowania/)).toBeInTheDocument()
    fireEvent.submit(await settingsForm())

    await waitFor(() => expect(screen.queryByText(/WCO odrzuciło zapisane dane logowania/)).not.toBeInTheDocument())
  })

  it('shows why a connection check could not run', async () => {
    stub()
    vi.spyOn(api, 'testForwardingConnection').mockRejectedValue(new Error('Żaden klucz z ONCALL_SECRETS_KEY nie odszyfrowuje zapisanego hasła WCO'))
    renderScreen(<ForwardingPanel />)

    fireEvent.click(await screen.findByRole('button', { name: 'Sprawdź połączenie' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Żaden klucz')
  })

  it('offers a retry when the settings, the state or the people fail to load', async () => {
    vi.spyOn(api, 'forwardingSettings').mockRejectedValueOnce(new Error('Serwer niedostępny')).mockResolvedValue(SETTINGS)
    vi.spyOn(api, 'forwardingState').mockRejectedValueOnce(new Error('Stan niedostępny')).mockResolvedValue(STATE)
    vi.spyOn(api, 'team').mockRejectedValueOnce(new Error('Zespół niedostępny')).mockResolvedValue(TEAM)
    vi.spyOn(api, 'adminUsers').mockResolvedValue(USERS)
    renderScreen(<ForwardingPanel />)

    expect(await screen.findByText('Serwer niedostępny')).toBeInTheDocument()
    expect(await screen.findByText('Stan niedostępny')).toBeInTheDocument()
    expect(await screen.findByText('Zespół niedostępny')).toBeInTheDocument()
    for (const retry of screen.getAllByRole('button', { name: 'Spróbuj ponownie' })) fireEvent.click(retry)

    await settingsForm()
    await waitFor(() => expect(row('Wynik')).toHaveTextContent('niepowodzenie'))
    expect(await screen.findByText('Zofia Lis')).toBeInTheDocument()
  })

  it('says when nobody is in the rotation', async () => {
    stub()
    vi.spyOn(api, 'team').mockResolvedValue([])
    renderScreen(<ForwardingPanel />)

    expect(await screen.findByText('Nikogo nie ma w rotacji.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Numery osób w rotacji' }).nextElementSibling).toHaveTextContent('0 w rotacji · 0 do uzupełnienia')
  })
})

const openReveal = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Pokaż hasło' }))
  return screen.findByRole('dialog', { name: 'Pokaż hasło WCO' })
}

describe('ForwardingPanel reveal dialog', () => {
  it('asks for the administrator\'s own password and shows the value masked, copied as it is, for 60 seconds', async () => {
    stub()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const reveal = vi.spyOn(api, 'revealForwardingPassword').mockResolvedValue(REVEALED)
    const update = vi.spyOn(api, 'updateForwardingSettings')
    const { queryClient } = renderScreen(<ForwardingPanel />)

    const dialog = await openReveal()
    expect(within(dialog).getByText('Odsłonięcie zostanie zapisane w dzienniku zdarzeń.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Pokaż' })).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText('Twoje hasło do aplikacji'), { target: { value: 'moje-haslo' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pokaż' }))

    await within(dialog).findByText('Hasło WCO')
    expect(reveal.mock.calls[0][0]).toBe('moje-haslo')
    expect(update).not.toHaveBeenCalled()
    expect(within(dialog).getByText('••••••••••••')).toBeInTheDocument()
    expect(within(dialog).queryByText('Dummy-Haslo-WCO!1')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('status')).toHaveTextContent('Hasło zniknie z ekranu za 60 s.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pokaż hasło' }))
    expect(within(dialog).getByText('Dummy-Haslo-WCO!1')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ukryj hasło' }))
    expect(within(dialog).getByText('••••••••••••')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Kopiuj' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Dummy-Haslo-WCO!1'))

    act(() => { vi.advanceTimersByTime(1000) })
    expect(within(dialog).getByRole('status')).toHaveTextContent('Hasło zniknie z ekranu za 59 s.')
    act(() => { vi.advanceTimersByTime(59_000) })
    expect(within(dialog).queryByText('••••••••••••')).not.toBeInTheDocument()
    await waitFor(() => expect(queryClient.getMutationCache().getAll()).toEqual([]))
    expect(within(dialog).getByLabelText('Twoje hasło do aplikacji')).toHaveValue('')
  })

  it('shows both passwords during a rotation, the pending one first, and a warning once WCO refused them', async () => {
    stub()
    vi.spyOn(api, 'revealForwardingPassword').mockResolvedValue({
      ...REVEALED, pending: 'Dummy-Pending-WCO!2', pending_since: '2026-09-10T06:00:00Z', credentials_invalid_since: '2026-09-10T06:30:00Z',
    })
    const { queryClient } = renderScreen(<ForwardingPanel />)

    const dialog = await openReveal()
    fireEvent.change(within(dialog).getByLabelText('Twoje hasło do aplikacji'), { target: { value: 'moje-haslo' } })
    fireEvent.submit(within(dialog).getByLabelText('Twoje hasło do aplikacji').closest('form') as HTMLFormElement)

    expect(await within(dialog).findByText('Trwa zmiana hasła (od 10-09-2026, 08:00). Najpierw spróbuj:')).toBeInTheDocument()
    expect(within(dialog).getByText('Jeśli WCO go nie przyjmie:')).toBeInTheDocument()
    expect(within(dialog).getByRole('alert')).toHaveTextContent('WCO odrzuciło zapisane hasła 10-09-2026, 08:30; prawdopodobnie zmieniono je poza aplikacją.')
    const eyes = within(dialog).getAllByRole('button', { name: 'Pokaż hasło' })
    expect(eyes).toHaveLength(2)
    fireEvent.click(eyes[0])
    expect(within(dialog).getByText('Dummy-Pending-WCO!2')).toBeInTheDocument()
    expect(within(dialog).queryByText('Dummy-Haslo-WCO!1')).not.toBeInTheDocument()

    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Zamknij' }).at(-1)!)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(queryClient.getMutationCache().getAll()).toEqual([]))
    fireEvent.click(screen.getByRole('button', { name: 'Pokaż hasło' }))
    const reopened = await screen.findByRole('dialog', { name: 'Pokaż hasło WCO' })
    expect(within(reopened).queryByText('••••••••••••')).not.toBeInTheDocument()
    expect(within(reopened).getByLabelText('Twoje hasło do aplikacji')).toHaveValue('')
  })

  it('leaves a wrong confirmation inside the dialog', async () => {
    stub()
    vi.spyOn(api, 'revealForwardingPassword').mockRejectedValue(new Error('Nieprawidłowy login lub hasło'))
    renderScreen(<ForwardingPanel />)

    const dialog = await openReveal()
    fireEvent.change(within(dialog).getByLabelText('Twoje hasło do aplikacji'), { target: { value: 'zle-haslo' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pokaż' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Nieprawidłowy login lub hasło')
    expect(within(dialog).queryByText('••••••••••••')).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Anuluj' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
