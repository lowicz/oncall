import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReactElement } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LanguageMenuRadio, LanguageSegmented } from './LanguageControl'
import { LANGUAGE_STORAGE_KEY } from '../i18n'
import { Menu } from '../ui'

afterEach(() => {
  vi.restoreAllMocks()
  document.documentElement.setAttribute('lang', 'pl')
})

function renderWithClient(control: ReactElement = <LanguageSegmented />) {
  const queryClient = new QueryClient()
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  render(<QueryClientProvider client={queryClient}>{control}</QueryClientProvider>)
  return invalidate
}

describe('LanguageSegmented', () => {
  it('switches the language and asks the API for everything again', () => {
    const invalidate = renderWithClient()
    fireEvent.click(screen.getByRole('radio', { name: 'English' }))

    expect(screen.getByRole('radiogroup', { name: 'Language' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'English' })).toHaveAttribute('aria-checked', 'true')
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en')
    expect(document.documentElement).toHaveAttribute('lang', 'en')
    expect(invalidate).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the current language is chosen again', async () => {
    // The account menu's radio reports a click on the checked choice too.
    const invalidate = renderWithClient(<Menu trigger={<button type="button">Konto</button>}><LanguageMenuRadio /></Menu>)
    fireEvent.click(screen.getByRole('button', { name: 'Konto' }))
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Polski' }))

    expect(screen.getByRole('menuitemradio', { name: 'Polski' })).toHaveAttribute('aria-checked', 'true')
    expect(document.documentElement).toHaveAttribute('lang', 'pl')
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull()
    expect(invalidate).not.toHaveBeenCalled()
  })
})
