import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY, applyLanguage, readLanguage, setLanguage } from './language'
import { locale, messages } from './messages'

afterEach(() => {
  window.localStorage.clear()
  applyLanguage(DEFAULT_LANGUAGE)
})

describe('the interface language', () => {
  it('is Polish for a visitor who has never chosen, whatever the browser prefers', () => {
    window.localStorage.clear()
    expect(readLanguage()).toBe('pl')
    applyLanguage()
    expect(document.documentElement.lang).toBe('pl')
    expect(messages().nav.screens.schedule).toBe('Grafik')
    expect(locale()).toBe('pl-PL')
  })

  it('keeps an explicit choice for the next visit and tells the document', () => {
    setLanguage('en')
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en')
    expect(readLanguage()).toBe('en')
    expect(document.documentElement.lang).toBe('en')
    expect(messages().nav.screens.schedule).toBe('Schedule')
    expect(locale()).toBe('en-GB')
  })

  it('falls back to Polish when the stored value names no language', () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'fr')
    expect(readLanguage()).toBe('pl')
  })
})
