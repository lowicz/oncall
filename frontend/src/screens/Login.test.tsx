import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from '../api'
import { renderScreen } from '../test/render'
import { meKey } from '../session'
import { Login } from './Login'

afterEach(() => vi.restoreAllMocks())

async function signInRefusedWith(error: Error) {
  vi.spyOn(api, 'publicConfig').mockResolvedValue({
    app_name: 'On-call', app_subtitle: '', ldap_enabled: true, version: '1.4.0', audit_retention_days: 365, login_audit_retention_days: 90,
  })
  vi.spyOn(api, 'login').mockRejectedValue(error)
  renderScreen(<Login />)
  fireEvent.change(screen.getByLabelText('Login'), { target: { value: 'anna' } })
  fireEvent.change(screen.getByLabelText('Hasło'), { target: { value: 'domain-password' } })
  fireEvent.click(screen.getByRole('button', { name: 'Zaloguj' }))
  return screen.findByRole('alert')
}

const CONFIG = {
  app_name: 'On-call', app_subtitle: '', ldap_enabled: false, version: '1.4.0', audit_retention_days: 365, login_audit_retention_days: 90,
}

/** Shows who the shell would treat as signed in, the way `App` reads it. */
function SignedInProbe() {
  const me = useQuery<{ display_name: string } | null>({ queryKey: meKey, queryFn: () => null, enabled: false })
  return <output aria-label="signed-in">{me.data?.display_name ?? ''}</output>
}

describe('Login', () => {
  it('hands the signed-in person to the shell after a successful sign-in', async () => {
    vi.spyOn(api, 'publicConfig').mockResolvedValue(CONFIG)
    const login = vi.spyOn(api, 'login').mockResolvedValue({
      username: 'anna', display_name: 'Anna Kowalska', role: 'member', has_team_member: true, email: null, share: null, avatar_url: null,
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
      app_name: 'On-call', app_subtitle: 'Zespół infrastruktury (UAT)', ldap_enabled: true, version: '1.4.0', audit_retention_days: 365, login_audit_retention_days: 90,
    })
    renderScreen(<Login />)
    expect(await screen.findByText(/Zespół infrastruktury \(UAT\)/)).toHaveTextContent('On-call · Zespół infrastruktury (UAT)')
  })

  it('suppresses the browser-native password reveal so its own toggle is the only one shown', async () => {
    vi.spyOn(api, 'publicConfig').mockResolvedValue({
      app_name: 'On-call', app_subtitle: '', ldap_enabled: true, version: '1.4.0', audit_retention_days: 365, login_audit_retention_days: 90,
    })
    renderScreen(<Login />)
    const passwordInput = await screen.findByLabelText('Hasło')
    expect(passwordInput).toHaveClass('in-pw-toggled')
    expect(screen.getAllByRole('button', { name: 'Pokaż hasło' })).toHaveLength(1)
  })
})
