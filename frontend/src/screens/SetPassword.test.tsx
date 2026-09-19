import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { api } from '../api'
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
    expect(reset).not.toHaveBeenCalled()
  })
})
