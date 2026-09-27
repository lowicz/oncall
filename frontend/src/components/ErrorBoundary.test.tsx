import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ErrorBoundary } from './ErrorBoundary'

let broken = true

function Screen() {
  if (broken) throw new TypeError('rows is undefined')
  return <p>Ekran działa</p>
}

afterEach(() => {
  vi.restoreAllMocks()
  broken = true
})

describe('ErrorBoundary', () => {
  it('names a crashed screen and renders it again on retry', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<ErrorBoundary><Screen /></ErrorBoundary>)

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Ten ekran przestał działać')
    expect(alert).toHaveTextContent('TypeError: rows is undefined')

    broken = false
    fireEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }))
    expect(screen.getByText('Ekran działa')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('names a crashed application and reloads the page on request', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const reload = vi.fn()
    const original = window.location
    Object.defineProperty(window, 'location', { value: { ...original, reload }, configurable: true })
    try {
      render(<ErrorBoundary scope="app"><Screen /></ErrorBoundary>)
      expect(screen.getByRole('alert')).toHaveTextContent('Aplikacja przestała działać')
      fireEvent.click(screen.getByRole('button', { name: 'Odśwież stronę' }))
      expect(reload).toHaveBeenCalledTimes(1)
    } finally {
      Object.defineProperty(window, 'location', { value: original, configurable: true })
    }
  })
})
