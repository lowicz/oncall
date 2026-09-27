import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen } from '@testing-library/react'
import { renderScreen } from '../test/render'
import { CopyButton } from './CopyButton'

afterEach(() => {
  vi.restoreAllMocks()
})

function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  return writeText
}

describe('CopyButton', () => {
  it('copies the value, says so, and goes back to its label after two seconds', async () => {
    const writeText = stubClipboard()
    renderScreen(<CopyButton value="https://example.test/feed.ics" label="Kopiuj adres" />)

    fireEvent.click(screen.getByRole('button', { name: 'Kopiuj adres' }))
    expect(await screen.findByRole('button', { name: 'Skopiowano' })).toBeInTheDocument()
    expect(writeText).toHaveBeenCalledWith('https://example.test/feed.ics')

    act(() => { vi.advanceTimersByTime(2000) })
    expect(screen.getByRole('button', { name: 'Kopiuj adres' })).toBeInTheDocument()
  })

  it('falls back to the generic label', () => {
    stubClipboard()
    renderScreen(<CopyButton value="x" />)
    expect(screen.getByRole('button', { name: 'Kopiuj' })).toBeInTheDocument()
  })
})
