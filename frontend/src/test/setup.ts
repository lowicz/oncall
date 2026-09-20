import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, vi } from 'vitest'

/**
 * One fixed "now" for the whole suite.
 *
 * Screens hide actions for dates that have already passed (`warsawDate()`), so
 * fixtures written as concrete dates quietly stop meaning what they meant: the
 * swap inbox tests asserted on buttons that a September 2026 run no longer
 * rendered, because their 14-09-2026 fixture had become the past. Pinning the
 * clock keeps every such fixture stable whenever the suite is run.
 *
 * `shouldAdvanceTime` leaves timers ticking against the real clock, so React
 * Testing Library's `waitFor`/`findBy*` and MUI's transitions behave as they do
 * under real timers.
 */
export const TEST_NOW = new Date('2026-09-10T09:00:00+02:00')

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, now: TEST_NOW })
})

afterEach(() => {
  vi.useRealTimers()
})

// jsdom does not implement matchMedia; components that switch layouts on it
// get a desktop default in tests.
if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
}

// The jsdom build vitest 3 loads here exposes no `localStorage` on the test
// window; the theme and density preferences are stored there, so give tests an
// in-memory store with the same surface and clear it between tests.
if (!window.localStorage) {
  const store = new Map<string, string>()
  const memoryStorage: Storage = {
    get length() { return store.size },
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => Array.from(store.keys())[index] ?? null,
    removeItem: (key) => { store.delete(key) },
    setItem: (key, value) => { store.set(key, String(value)) },
  }
  Object.defineProperty(window, 'localStorage', { value: memoryStorage, configurable: true })
}

afterEach(() => {
  window.localStorage.clear()
})
