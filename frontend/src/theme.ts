import { useCallback, useSyncExternalStore } from 'react'

/**
 * Colour scheme preference: dark is the default, light is the alternative and
 * "system" follows the operating system. The resolved scheme is written to
 * `data-theme` on <html>, which is what tokens.css keys the palette on. The
 * same attribute is set before first paint by the inline script in
 * index.html, so this module only has to keep it in sync afterwards.
 */
export type ThemeMode = 'dark' | 'light' | 'system'
export type Scheme = 'dark' | 'light'

export const THEME_STORAGE_KEY = 'oncall-theme'
export const DENSITY_STORAGE_KEY = 'oncall-density'
export type Density = 'default' | 'compact'

const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Private mode or a blocked store: the choice lives for this page only.
  }
}

export function readThemeMode(): ThemeMode {
  const stored = readStored(THEME_STORAGE_KEY)
  return stored === 'light' || stored === 'system' ? stored : 'dark'
}

export function readDensity(): Density {
  return readStored(DENSITY_STORAGE_KEY) === 'compact' ? 'compact' : 'default'
}

export function systemScheme(): Scheme {
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark'
}

export function resolveScheme(mode: ThemeMode): Scheme {
  return mode === 'system' ? systemScheme() : mode
}

/** Writes the resolved scheme and density to <html> for the stylesheet. */
export function applyPreferences(mode: ThemeMode = readThemeMode(), density: Density = readDensity()) {
  const root = document.documentElement
  root.setAttribute('data-theme', resolveScheme(mode))
  if (density === 'compact') root.setAttribute('data-density', 'compact')
  else root.removeAttribute('data-density')
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', resolveScheme(mode) === 'light' ? '#eef1f5' : '#0b0e13')
}

export function setThemeMode(mode: ThemeMode) {
  writeStored(THEME_STORAGE_KEY, mode)
  applyPreferences(mode, readDensity())
  notify()
}

export function setDensity(density: Density) {
  writeStored(DENSITY_STORAGE_KEY, density)
  applyPreferences(readThemeMode(), density)
  notify()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const media = window.matchMedia?.('(prefers-color-scheme: light)')
  const onSystemChange = () => {
    if (readThemeMode() === 'system') applyPreferences()
    listener()
  }
  media?.addEventListener?.('change', onSystemChange)
  return () => {
    listeners.delete(listener)
    media?.removeEventListener?.('change', onSystemChange)
  }
}

export function useThemeMode(): [ThemeMode, (mode: ThemeMode) => void] {
  const mode = useSyncExternalStore(subscribe, readThemeMode, () => 'dark' as ThemeMode)
  const set = useCallback((next: ThemeMode) => setThemeMode(next), [])
  return [mode, set]
}

export function useDensity(): [Density, (density: Density) => void] {
  const density = useSyncExternalStore(subscribe, readDensity, () => 'default' as Density)
  const set = useCallback((next: Density) => setDensity(next), [])
  return [density, set]
}

export const themeModeLabels: Record<ThemeMode, string> = {
  dark: 'Ciemny',
  light: 'Jasny',
  system: 'Systemowy',
}
