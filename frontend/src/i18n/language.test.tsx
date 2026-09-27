import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import {
  DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY, applyLanguage, readLanguage, setLanguage, useLanguage,
} from './language'
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

describe('a blocked language store', () => {
  afterEach(() => vi.restoreAllMocks())

  it('reads as Polish and keeps a choice for this page only', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(readLanguage()).toBe('pl')
    setLanguage('en')
    expect(document.documentElement.lang).toBe('en')
  })
})

describe('useLanguage', () => {
  function LanguageProbe() {
    const [language, choose] = useLanguage()
    return <button onClick={() => choose(language === 'pl' ? 'en' : 'pl')}>{language}</button>
  }

  it('re-renders on a choice and stops listening once unmounted', () => {
    const view = render(<LanguageProbe />)
    fireEvent.click(screen.getByRole('button', { name: 'pl' }))
    expect(screen.getByRole('button', { name: 'en' })).toBeInTheDocument()
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en')
    view.unmount()
    // A later choice reaches no unmounted listener.
    expect(() => setLanguage('pl')).not.toThrow()
  })

  it('renders Polish where there is no stored choice to read, as on a server', () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en')
    expect(renderToString(<LanguageProbe />)).toContain('>pl<')
  })
})
