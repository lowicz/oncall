import { useCallback, useSyncExternalStore } from 'react'

/**
 * The interface language: Polish by default, English on request.
 *
 * The choice is a browser preference like the theme (`src/theme.ts`): it is
 * kept in `localStorage`, read once at start-up and written to `<html lang>`,
 * and nothing else decides it. A visitor who has never chosen sees Polish
 * whatever their browser or operating system prefers, because the product's
 * own vocabulary is Polish and the documentation is written in it first.
 *
 * Components read the current language through `useLanguage()`, which
 * re-renders them when it changes; modules outside React read it through
 * `readLanguage()` at call time.
 */
export type Language = 'pl' | 'en'

export const LANGUAGES: readonly Language[] = ['pl', 'en']
export const DEFAULT_LANGUAGE: Language = 'pl'
export const LANGUAGE_STORAGE_KEY = 'oncall-language'

/** Each language named in itself, the one label that is never translated. */
export const languageNames: Record<Language, string> = {
  pl: 'Polski',
  en: 'English',
}

export const isLanguage = (value: unknown): value is Language =>
  typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value)

const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

export function readLanguage(): Language {
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
    return isLanguage(stored) ? stored : DEFAULT_LANGUAGE
  } catch {
    return DEFAULT_LANGUAGE
  }
}

/** Writes the language to <html>, for hyphenation, spell-checking and assistive technology. */
export function applyLanguage(language: Language = readLanguage()) {
  document.documentElement.setAttribute('lang', language)
}

export function setLanguage(language: Language) {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
  } catch {
    // Private mode or a blocked store: the choice lives for this page only.
  }
  applyLanguage(language)
  notify()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useLanguage(): [Language, (language: Language) => void] {
  const language = useSyncExternalStore(subscribe, readLanguage, () => DEFAULT_LANGUAGE)
  const set = useCallback((next: Language) => setLanguage(next), [])
  return [language, set]
}
