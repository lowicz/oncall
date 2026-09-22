import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { api, ApiError } from '../api'
import { renderScreen } from '../test/render'
import { Login } from './Login'

afterEach(() => vi.restoreAllMocks())

async function signInRefusedWith(error: ApiError) {
  vi.spyOn(api, 'publicConfig').mockResolvedValue({
    app_name: 'On-call', app_subtitle: '', ldap_enabled: true, version: '1.4.0',
  })
  vi.spyOn(api, 'login').mockRejectedValue(error)
  renderScreen(<Login />)
  fireEvent.change(screen.getByLabelText('Login'), { target: { value: 'anna' } })
  fireEvent.change(screen.getByLabelText('Hasło'), { target: { value: 'domain-password' } })
  fireEvent.click(screen.getByRole('button', { name: 'Zaloguj' }))
  return screen.findByRole('alert')
}

describe('Login', () => {
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
})
