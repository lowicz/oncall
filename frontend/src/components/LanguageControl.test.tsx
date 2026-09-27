import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LanguageSegmented } from './LanguageControl'
import { LANGUAGE_STORAGE_KEY } from '../i18n'

afterEach(() => {
  vi.restoreAllMocks()
  document.documentElement.setAttribute('lang', 'pl')
})

function renderWithClient() {
  const queryClient = new QueryClient()
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  render(<QueryClientProvider client={queryClient}><LanguageSegmented /></QueryClientProvider>)
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

  it('does nothing when the current language is chosen again', () => {
    const invalidate = renderWithClient()
    fireEvent.click(screen.getByRole('radio', { name: 'Polski' }))

    expect(screen.getByRole('radiogroup', { name: 'Język' })).toBeInTheDocument()
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull()
    expect(invalidate).not.toHaveBeenCalled()
  })
})
