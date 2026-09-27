import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import {
  THEME_STORAGE_KEY, DENSITY_STORAGE_KEY, applyPreferences, readDensity, readThemeMode, resolveScheme, setDensity,
  setThemeMode, useDensity, useThemeMode,
} from './theme'

beforeEach(() => {
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-density')
  document.head.innerHTML = '<meta name="theme-color" content="#061228" />'
})

describe('theme preference', () => {
  it('defaults to dark and treats an unknown stored value as dark', () => {
    expect(readThemeMode()).toBe('dark')
    window.localStorage.setItem(THEME_STORAGE_KEY, 'sepia')
    expect(readThemeMode()).toBe('dark')
  })

  it('resolves "system" through the OS preference and everything else as itself', () => {
    // The test stub says the OS does not prefer light, so system means dark.
    expect(resolveScheme('system')).toBe('dark')
    expect(resolveScheme('light')).toBe('light')
    expect(resolveScheme('dark')).toBe('dark')
  })

  it('writes the resolved scheme, the density and the browser chrome colour to the document', () => {
    setThemeMode('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', '#F4F6FA')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')

    setDensity('compact')
    expect(document.documentElement.getAttribute('data-density')).toBe('compact')
    expect(window.localStorage.getItem(DENSITY_STORAGE_KEY)).toBe('compact')
    // The theme choice survives the density change.
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')

    setDensity('default')
    expect(document.documentElement.hasAttribute('data-density')).toBe(false)
  })

  it('applies the stored preference on start-up, as the pre-paint script does', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'system')
    applyPreferences()
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', '#061228')
  })
})

describe('the matrix density token', () => {
  it('shrinks the day cell in compact mode so the toggle visibly changes the matrix', () => {
    const style = document.createElement('style')
    style.textContent = readFileSync(resolve(process.cwd(), 'src/tokens.css'), 'utf8')
    document.head.appendChild(style)
    try {
      const cell = () => getComputedStyle(document.documentElement).getPropertyValue('--cell').trim()
      const fromDefault = cell()
      setDensity('compact')
      const fromCompact = cell()
      expect(fromDefault).toBe('35px')
      expect(fromCompact).toBe('29px')
      expect(fromCompact).not.toBe(fromDefault)
    } finally {
      style.remove()
    }
  })
})

describe('a blocked preference store', () => {
  afterEach(() => vi.restoreAllMocks())

  it('reads as the defaults and keeps a choice for this page only', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(readThemeMode()).toBe('dark')
    expect(readDensity()).toBe('default')
    setThemeMode('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })
})

/** An operating-system colour preference the test can flip. */
function systemPreference(light: boolean) {
  const listeners = new Set<() => void>()
  const media = {
    get matches() { return light },
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  }
  vi.spyOn(window, 'matchMedia').mockReturnValue(media as unknown as MediaQueryList)
  return {
    listeners,
    change(next: boolean) {
      light = next
      act(() => listeners.forEach((listener) => listener()))
    },
  }
}

describe('the theme hooks', () => {
  afterEach(() => vi.restoreAllMocks())

  function ThemeProbe() {
    const [mode, setMode] = useThemeMode()
    const [density, setDensityChoice] = useDensity()
    return (
      <div>
        <output aria-label="mode">{mode}</output>
        <output aria-label="density">{density}</output>
        <button onClick={() => setMode('system')}>system</button>
        <button onClick={() => setDensityChoice('compact')}>compact</button>
      </div>
    )
  }

  it('re-render on a choice and follow the operating system while set to "system"', () => {
    const os = systemPreference(true)
    const view = render(<ThemeProbe />)
    expect(screen.getByLabelText('mode')).toHaveTextContent('dark')
    expect(screen.getByLabelText('density')).toHaveTextContent('default')

    fireEvent.click(screen.getByRole('button', { name: 'system' }))
    expect(screen.getByLabelText('mode')).toHaveTextContent('system')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')

    fireEvent.click(screen.getByRole('button', { name: 'compact' }))
    expect(screen.getByLabelText('density')).toHaveTextContent('compact')
    expect(document.documentElement.getAttribute('data-density')).toBe('compact')

    os.change(false)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')

    view.unmount()
    expect(os.listeners.size).toBe(0)
  })

  it('render the defaults where there is no stored choice to read, as on a server', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light')
    window.localStorage.setItem(DENSITY_STORAGE_KEY, 'compact')
    const html = renderToString(<ThemeProbe />)
    expect(html).toContain('>dark<')
    expect(html).toContain('>default<')
  })

  it('leave an explicit scheme alone when the operating system changes', () => {
    const os = systemPreference(false)
    setThemeMode('light')
    render(<ThemeProbe />)
    os.change(false)
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('work in an engine with no media queries', () => {
    const original = window.matchMedia
    Object.defineProperty(window, 'matchMedia', { value: undefined, configurable: true, writable: true })
    try {
      render(<ThemeProbe />)
      expect(screen.getByLabelText('mode')).toHaveTextContent('dark')
      expect(resolveScheme('system')).toBe('dark')
    } finally {
      Object.defineProperty(window, 'matchMedia', { value: original, configurable: true, writable: true })
    }
  })

  it('work with an old media query list that cannot be listened to', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as unknown as MediaQueryList)
    const view = render(<ThemeProbe />)
    expect(screen.getByLabelText('mode')).toHaveTextContent('dark')
    view.unmount()
  })
})

describe('the scheme outside a browser', () => {
  it('is dark', () => {
    vi.stubGlobal('window', undefined)
    try {
      expect(resolveScheme('system')).toBe('dark')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('a page without a theme-colour tag', () => {
  it('still writes the scheme', () => {
    document.head.innerHTML = ''
    applyPreferences('light', 'default')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })
})
