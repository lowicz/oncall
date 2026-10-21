import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { api, ApiError } from '../api'
import { renderScreen } from '../test/render'
import { meKey } from '../session'
import { Login } from './Login'

afterEach(() => vi.restoreAllMocks())

async function signInRefusedWith(error: Error) {
  vi.spyOn(api, 'publicConfig').mockResolvedValue({
    app_name: 'On-call', app_subtitle: '', ldap_enabled: true, version: '1.4.0', audit_retention_days: 365, login_audit_retention_days: 90, sso_enabled: false,
  })
  vi.spyOn(api, 'login').mockRejectedValue(error)
  renderScreen(<Login />)
  fireEvent.change(screen.getByLabelText('Login'), { target: { value: 'anna' } })
  fireEvent.change(screen.getByLabelText('Hasło'), { target: { value: 'domain-password' } })
  fireEvent.click(screen.getByRole('button', { name: 'Zaloguj' }))
  return screen.findByRole('alert')
}

const CONFIG = {
  app_name: 'On-call', app_subtitle: '', ldap_enabled: false, version: '1.4.0', audit_retention_days: 365, login_audit_retention_days: 90, sso_enabled: false,
}

/** The address bar as the router sees it, so a test can say what a reload would repeat. */
function LocationProbe() {
  const location = useLocation()
  return <span data-testid="location">{location.pathname + location.search}</span>
}

const SSO_CONFIG = { ...CONFIG, sso_enabled: true }

/** Shows who the shell would treat as signed in, the way `App` reads it. */
function SignedInProbe() {
  const me = useQuery<{ display_name: string } | null>({ queryKey: meKey, queryFn: () => null, enabled: false })
  return <output aria-label="signed-in">{me.data?.display_name ?? ''}</output>
}

describe('Login', () => {
  it('hands the signed-in person to the shell after a successful sign-in', async () => {
    vi.spyOn(api, 'publicConfig').mockResolvedValue(CONFIG)
    const login = vi.spyOn(api, 'login').mockResolvedValue({
      username: 'anna', display_name: 'Anna Kowalska', role: 'member', has_team_member: true, email: null, phone: null, share: null, avatar_url: null,
    })
    renderScreen(<><Login /><SignedInProbe /></>)
    fireEvent.change(screen.getByLabelText('Login'), { target: { value: 'anna' } })
    fireEvent.change(screen.getByLabelText('Hasło'), { target: { value: 'secret-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Zaloguj' }))
    await waitFor(() => expect(screen.getByLabelText('signed-in')).toHaveTextContent('Anna Kowalska'))
    expect(login).toHaveBeenCalledWith('anna', 'secret-password')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says it is signing in while the request is in flight', async () => {
    vi.spyOn(api, 'publicConfig').mockResolvedValue(CONFIG)
    vi.spyOn(api, 'login').mockReturnValue(new Promise(() => {}))
    renderScreen(<Login />)
    fireEvent.change(screen.getByLabelText('Login'), { target: { value: 'anna' } })
    fireEvent.change(screen.getByLabelText('Hasło'), { target: { value: 'secret-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Zaloguj' }))
    expect(await screen.findByRole('button', { name: /Logowanie…/ })).toBeInTheDocument()
  })

  it('explains that an ended session is why the sign-in screen is shown', async () => {
    vi.spyOn(api, 'publicConfig').mockResolvedValue(CONFIG)
    renderScreen(<Login expired />)
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Sesja wygasła')
    expect(status).toHaveTextContent('Zaloguj się ponownie, aby wrócić do otwartego ekranu.')
  })

  it('offers the directory hint only when the directory is enabled', async () => {
    vi.spyOn(api, 'publicConfig').mockResolvedValue(CONFIG)
    renderScreen(<Login />)
    expect(await screen.findByText(/Nie pamiętasz hasła\?/)).not.toHaveTextContent('Masz konto firmowe?')
  })

  it('shows and hides the typed password with its toggle', async () => {
    vi.spyOn(api, 'publicConfig').mockResolvedValue(CONFIG)
    renderScreen(<Login />)
    const input = screen.getByLabelText('Hasło')
    expect(input).toHaveAttribute('type', 'password')
    fireEvent.click(screen.getByRole('button', { name: 'Pokaż hasło' }))
    expect(input).toHaveAttribute('type', 'text')
    fireEvent.click(screen.getByRole('button', { name: 'Ukryj hasło' }))
    expect(input).toHaveAttribute('type', 'password')
  })

  it('asks the person to wait when sign-ins are throttled', async () => {
    const alert = await signInRefusedWith(new ApiError('Zbyt wiele prób logowania', 429))
    expect(alert).toHaveTextContent('Odczekaj chwilę i spróbuj ponownie.')
    expect(alert).not.toHaveTextContent('wyłączone')
  })

  it('falls back to the generic hint when the request failed without an answer', async () => {
    const alert = await signInRefusedWith(new TypeError('Failed to fetch'))
    expect(alert).toHaveTextContent('Spróbuj ponownie za chwilę.')
  })

  it('suggests a disabled account only when the login or password was rejected', async () => {
    const alert = await signInRefusedWith(new ApiError('Nieprawidłowy login lub hasło', 401))
    expect(alert).toHaveTextContent('Nieprawidłowy login lub hasło')
    expect(alert).toHaveTextContent('Jeśli konto zostało wyłączone')
    expect(screen.getByLabelText('Hasło')).toHaveValue('')
  })

  it('tells the person to retry when the directory is unavailable', async () => {
    const alert = await signInRefusedWith(
      new ApiError('Logowanie katalogowe jest chwilowo niedostępne', 503),
    )
    expect(alert).toHaveTextContent('Logowanie katalogowe jest chwilowo niedostępne')
    expect(alert).toHaveTextContent('Spróbuj ponownie za chwilę')
    expect(alert).not.toHaveTextContent('wyłączone')
  })

  it('sends a directory identity conflict to the administrator', async () => {
    const alert = await signInRefusedWith(
      new ApiError('Login lub numer pracownika jest już przypisany do innego konta', 409),
    )
    expect(alert).toHaveTextContent('skontaktuj się z nim')
    expect(alert).not.toHaveTextContent('wyłączone')
  })

  it('shows the configured subtitle with its own casing', async () => {
    vi.spyOn(api, 'publicConfig').mockResolvedValue({
      app_name: 'On-call', app_subtitle: 'Zespół infrastruktury (UAT)', ldap_enabled: true, version: '1.4.0', audit_retention_days: 365, login_audit_retention_days: 90, sso_enabled: false,
    })
    renderScreen(<Login />)
    expect(await screen.findByText(/Zespół infrastruktury \(UAT\)/)).toHaveTextContent('On-call · Zespół infrastruktury (UAT)')
  })

  it('suppresses the browser-native password reveal so its own toggle is the only one shown', async () => {
    vi.spyOn(api, 'publicConfig').mockResolvedValue({
      app_name: 'On-call', app_subtitle: '', ldap_enabled: true, version: '1.4.0', audit_retention_days: 365, login_audit_retention_days: 90, sso_enabled: false,
    })
    renderScreen(<Login />)
    const passwordInput = await screen.findByLabelText('Hasło')
    expect(passwordInput).toHaveClass('in-pw-toggled')
    expect(screen.getAllByRole('button', { name: 'Pokaż hasło' })).toHaveLength(1)
  })
  it('offers single sign-on only when the deployment has it', async () => {
    vi.spyOn(api, 'publicConfig').mockResolvedValue(CONFIG)
    renderScreen(<Login />)
    await screen.findByText(/Nie pamiętasz hasła\?/)
    expect(screen.queryByRole('link', { name: 'Zaloguj przez SSO' })).not.toBeInTheDocument()
    expect(screen.queryByText('albo')).not.toBeInTheDocument()
  })

  it('sends the person to the API with the screen they were on, after an "albo" divider', async () => {
    vi.spyOn(api, 'publicConfig').mockResolvedValue(SSO_CONFIG)
    renderScreen(<Login />, { route: '/zamiany?tab=open' })
    const link = await screen.findByRole('link', { name: 'Zaloguj przez SSO' })
    expect(link).toHaveAttribute('href', '/api/v1/auth/sso/start?next=%2Fzamiany%3Ftab%3Dopen')
    expect(link).toHaveClass('btn', 'btn-block')
    expect(link).not.toHaveClass('btn-pri')
    expect(screen.getByText('albo')).toHaveClass('login-or')
    // After the password form's button, so the primary way in stays first.
    expect(screen.getByRole('button', { name: 'Zaloguj' }).compareDocumentPosition(link)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it.each([
    ['unavailable', 'Logowanie SSO jest chwilowo niedostępne', 'Zaloguj się loginem i hasłem. Jeśli problem się powtarza, powiadom administratora.'],
    ['rejected', 'Logowanie SSO nie powiodło się', 'Spróbuj ponownie. Jeśli problem się powtarza, powiadom administratora.'],
    ['no_account', 'Brak konta dla Twojego numeru pracownika', 'Poproś administratora o konto z Twoim numerem pracownika.'],
    ['inactive', 'Konto jest nieaktywne', 'Skontaktuj się z administratorem.'],
  ])('explains why single sign-on refused (%s) and takes the code out of the address', async (code, title, hint) => {
    vi.spyOn(api, 'publicConfig').mockResolvedValue(SSO_CONFIG)
    renderScreen(<><Login expired /><LocationProbe /></>, { route: `/?sso=${code}` })
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(title)
    expect(alert).toHaveTextContent(hint)
    // The refusal takes the slot the ended-session notice would have used.
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/)
    expect(screen.getByRole('link', { name: 'Zaloguj przez SSO' })).toHaveAttribute('href', '/api/v1/auth/sso/start?next=%2F')
  })

  it('ignores a code it does not know and keeps the rest of the address', async () => {
    vi.spyOn(api, 'publicConfig').mockResolvedValue(SSO_CONFIG)
    renderScreen(<><Login expired /><LocationProbe /></>, { route: '/grafik?month=2026-10&sso=whatever' })
    expect(await screen.findByRole('status')).toHaveTextContent('Sesja wygasła')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/grafik?month=2026-10')
    expect(screen.getByRole('link', { name: 'Zaloguj przez SSO' })).toHaveAttribute('href', '/api/v1/auth/sso/start?next=%2Fgrafik%3Fmonth%3D2026-10')
  })

  it('keeps the password form usable under a refusal, whose message gives way to the next attempt', async () => {
    vi.spyOn(api, 'publicConfig').mockResolvedValue(SSO_CONFIG)
    vi.spyOn(api, 'login').mockRejectedValue(new ApiError('Nieprawidłowy login lub hasło', 401))
    renderScreen(<Login />, { route: '/?sso=no_account' })
    expect(await screen.findByRole('alert')).toHaveTextContent('Brak konta dla Twojego numeru pracownika')
    fireEvent.change(screen.getByLabelText('Login'), { target: { value: 'anna' } })
    fireEvent.change(screen.getByLabelText('Hasło'), { target: { value: 'secret-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Zaloguj' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Nieprawidłowy login lub hasło'))
    expect(screen.getByRole('alert')).not.toHaveTextContent('Brak konta')
  })
})
