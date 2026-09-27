import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { api, ApiError } from '../api'
import { renderScreen } from '../test/render'
import { SetPassword } from './SetPassword'

afterEach(() => vi.restoreAllMocks())

describe('SetPassword', () => {
  it('activates an account using the token from the URL', async () => {
    vi.spyOn(api, 'passwordTokenInfo').mockResolvedValue({
      username: 'marek', display_name: 'Marek Nowak',
    })
    const activate = vi.spyOn(api, 'activateAccount').mockResolvedValue(undefined)
    renderScreen(<SetPassword mode="activate" />, { route: '/activate?token=one-time-token-value' })
    expect(await screen.findByText(/Ustawiasz hasło dla: Marek Nowak/)).toHaveTextContent('(marek)')
    fireEvent.change(screen.getByLabelText(/^Nowe hasło/), {
      target: { value: 'new-password-123' },
    })
    fireEvent.change(screen.getByLabelText(/^Powtórz hasło/), {
      target: { value: 'new-password-123' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Aktywuj konto' }))
    await waitFor(() => expect(activate).toHaveBeenCalledWith(
      'one-time-token-value', 'new-password-123',
    ))
    expect(await screen.findByText('Hasło zostało ustawione.')).toBeInTheDocument()
  })

  it('does not submit mismatching passwords', async () => {
    vi.spyOn(api, 'passwordTokenInfo').mockResolvedValue({
      username: 'anna', display_name: 'Anna Kowalska',
    })
    const reset = vi.spyOn(api, 'resetPassword').mockResolvedValue(undefined)
    renderScreen(<SetPassword mode="reset" />, { route: '/reset?token=one-time-token-value' })
    await screen.findByText(/Ustawiasz hasło dla: Anna Kowalska/)
    fireEvent.change(screen.getByLabelText(/^Nowe hasło/), {
      target: { value: 'new-password-123' },
    })
    fireEvent.change(screen.getByLabelText(/^Powtórz hasło/), {
      target: { value: 'different-password' },
    })
    expect(screen.getByRole('button', { name: 'Ustaw nowe hasło' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Hasła nie są identyczne')
    expect(reset).not.toHaveBeenCalled()
  })

  it.each(['activate', 'reset'] as const)('shows the configured subtitle with its own casing on %s', async (mode) => {
    vi.spyOn(api, 'publicConfig').mockResolvedValue({
      app_name: 'On-call', app_subtitle: 'Zespół infrastruktury (UAT)', ldap_enabled: false, version: '1.4.0', audit_retention_days: 365, login_audit_retention_days: 90,
    })
    vi.spyOn(api, 'passwordTokenInfo').mockResolvedValue({
      username: 'anna', display_name: 'Anna Kowalska',
    })
    renderScreen(<SetPassword mode={mode} />, { route: `/${mode}?token=one-time-token-value` })
    expect(await screen.findByText(/Zespół infrastruktury \(UAT\)/)).toHaveTextContent('On-call · Zespół infrastruktury (UAT)')
  })

  it('explains a link that carries no token and offers nothing to submit', async () => {
    const info = vi.spyOn(api, 'passwordTokenInfo')
    renderScreen(<SetPassword mode="activate" />, { route: '/activate' })
    expect(screen.getByRole('alert')).toHaveTextContent('W linku brakuje tokenu.')
    expect(screen.getByRole('button', { name: 'Aktywuj konto' })).toBeDisabled()
    expect(info).not.toHaveBeenCalled()
  })

  it('sends the person back to sign-in when the link no longer works', async () => {
    const info = vi.spyOn(api, 'passwordTokenInfo').mockRejectedValue(new ApiError('Link wygasł lub został już użyty', 410))
    renderScreen(<SetPassword mode="reset" />, { route: '/reset?token=one-time-token-value' })
    expect(await screen.findByRole('heading', { name: 'Ten link już nie działa' })).toBeInTheDocument()
    expect(info).toHaveBeenCalledWith('one-time-token-value', 'password_reset')
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Link wygasł lub został już użyty')
    expect(alert).toHaveTextContent('Poproś administratora o nowy link.')
    expect(screen.getByRole('link', { name: 'Wróć do logowania' })).toHaveAttribute('href', '/')
    expect(screen.queryByLabelText(/^Nowe hasło/)).not.toBeInTheDocument()
  })

  it('resets the password, saying it is saving until the answer comes', async () => {
    vi.spyOn(api, 'passwordTokenInfo').mockResolvedValue({ username: 'anna', display_name: 'Anna Kowalska' })
    let finish: () => void = () => {}
    const reset = vi.spyOn(api, 'resetPassword').mockReturnValue(new Promise<void>((resolve) => { finish = resolve }))
    renderScreen(<SetPassword mode="reset" />, { route: '/reset?token=one-time-token-value' })
    await screen.findByText(/Ustawiasz hasło dla: Anna Kowalska/)
    fireEvent.change(screen.getByLabelText(/^Nowe hasło/), { target: { value: 'new-password-123' } })
    fireEvent.change(screen.getByLabelText(/^Powtórz hasło/), { target: { value: 'new-password-123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ustaw nowe hasło' }))
    expect(await screen.findByRole('button', { name: /Zapisuję…/ })).toBeInTheDocument()
    expect(reset).toHaveBeenCalledWith('one-time-token-value', 'new-password-123')
    finish()
    expect(await screen.findByRole('status')).toHaveTextContent('Hasło zostało ustawione.')
    expect(screen.getByRole('link', { name: 'Przejdź do logowania' })).toHaveAttribute('href', '/')
  })

  it('shows why the server refused the new password and keeps the form', async () => {
    vi.spyOn(api, 'passwordTokenInfo').mockResolvedValue({ username: 'anna', display_name: 'Anna Kowalska' })
    vi.spyOn(api, 'resetPassword').mockRejectedValue(new ApiError('Hasło jest zbyt słabe', 422))
    renderScreen(<SetPassword mode="reset" />, { route: '/reset?token=one-time-token-value' })
    await screen.findByText(/Ustawiasz hasło dla: Anna Kowalska/)
    fireEvent.change(screen.getByLabelText(/^Nowe hasło/), { target: { value: 'new-password-123' } })
    fireEvent.change(screen.getByLabelText(/^Powtórz hasło/), { target: { value: 'new-password-123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ustaw nowe hasło' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Hasło jest zbyt słabe')
    expect(screen.getByRole('button', { name: 'Ustaw nowe hasło' })).toBeEnabled()
  })

  it('does not send mismatching passwords even when the form is submitted directly', async () => {
    vi.spyOn(api, 'passwordTokenInfo').mockResolvedValue({ username: 'anna', display_name: 'Anna Kowalska' })
    const reset = vi.spyOn(api, 'resetPassword').mockResolvedValue(undefined)
    renderScreen(<SetPassword mode="reset" />, { route: '/reset?token=one-time-token-value' })
    await screen.findByText(/Ustawiasz hasło dla: Anna Kowalska/)
    fireEvent.change(screen.getByLabelText(/^Nowe hasło/), { target: { value: 'new-password-123' } })
    fireEvent.change(screen.getByLabelText(/^Powtórz hasło/), { target: { value: 'new-password-456' } })
    fireEvent.submit(screen.getByRole('form', { name: 'Ustaw nowe hasło' }))
    expect(reset).not.toHaveBeenCalled()
    expect(screen.queryByText('Hasło zostało ustawione.')).not.toBeInTheDocument()
  })
})
