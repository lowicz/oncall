import { beforeEach, describe, expect, it } from 'vitest'
import { THEME_STORAGE_KEY, DENSITY_STORAGE_KEY, applyPreferences, readThemeMode, resolveScheme, setDensity, setThemeMode } from './theme'

beforeEach(() => {
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-density')
  document.head.innerHTML = '<meta name="theme-color" content="#0b0e13" />'
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
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', '#eef1f5')
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
    expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', '#0b0e13')
  })
})
