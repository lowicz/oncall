import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { NARROW_QUERY, useMediaQuery, useNarrow } from './useMediaQuery'

function Probe({ query }: { query?: string }) {
  const wide = useMediaQuery(query ?? '(min-width: 1200px)')
  const narrow = useNarrow()
  return <output>{`${wide ? 'wide' : 'not-wide'} ${narrow ? 'narrow' : 'not-narrow'}`}</output>
}

afterEach(() => vi.restoreAllMocks())

describe('useMediaQuery', () => {
  it('follows the viewport as it changes and stops listening once unmounted', () => {
    let narrow = true
    const listeners = new Set<() => void>()
    const queries: string[] = []
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
      queries.push(query)
      return {
        get matches() { return query === NARROW_QUERY ? narrow : false },
        addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
      } as unknown as MediaQueryList
    })
    const view = render(<Probe />)
    expect(screen.getByRole('status')).toHaveTextContent('not-wide narrow')
    expect(queries).toContain(NARROW_QUERY)

    narrow = false
    act(() => listeners.forEach((listener) => listener()))
    expect(screen.getByRole('status')).toHaveTextContent('not-wide not-narrow')

    view.unmount()
    expect(listeners.size).toBe(0)
  })

  it('is false where matchMedia is unavailable', () => {
    const original = window.matchMedia
    Object.defineProperty(window, 'matchMedia', { value: undefined, configurable: true, writable: true })
    try {
      render(<Probe />)
      expect(screen.getByRole('status')).toHaveTextContent('not-wide not-narrow')
    } finally {
      Object.defineProperty(window, 'matchMedia', { value: original, configurable: true, writable: true })
    }
  })

  it('reads an old media query list that cannot be listened to', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as unknown as MediaQueryList)
    render(<Probe />)
    expect(screen.getByRole('status')).toHaveTextContent('wide narrow')
  })

  it('treats an engine returning no list as not matching', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue(undefined as unknown as MediaQueryList)
    render(<Probe />)
    expect(screen.getByRole('status')).toHaveTextContent('not-wide not-narrow')
  })

  it('renders the desktop layout on a server', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as unknown as MediaQueryList)
    expect(renderToString(<Probe />)).toContain('not-wide not-narrow')
  })
})
