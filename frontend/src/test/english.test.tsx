/**
 * The interface in English: the second language, chosen explicitly, and the
 * switch back. The Polish wording itself is locked by `polish-baseline`; this
 * checks that choosing English changes the words, the document's language
 * and nothing that was not asked for.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { renderScreen } from './render'
import { Login } from '../screens/Login'
import { DEFAULT_LANGUAGE, applyLanguage, messages, setLanguage } from '../i18n'

const en = messages('en')
const pl = messages('pl')

afterEach(() => {
  window.localStorage.clear()
  applyLanguage(DEFAULT_LANGUAGE)
})

describe('the English interface', () => {
  it('shows the sign-in screen in English once English is chosen', () => {
    setLanguage('en')
    renderScreen(<Login />)

    expect(document.documentElement.lang).toBe('en')
    expect(screen.getByRole('heading', { name: en.auth.headline })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.auth.signIn })).toBeInTheDocument()
    expect(screen.getByLabelText(en.auth.username)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: pl.auth.signIn })).not.toBeInTheDocument()
    // The catalogs really differ where it matters.
    expect(en.auth.signIn).not.toBe(pl.auth.signIn)
  })

  it('switches back to Polish from the language control, live', () => {
    setLanguage('en')
    renderScreen(<Login expired />)
    expect(screen.getByText(en.auth.sessionExpired)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: 'Polski' }))

    expect(document.documentElement.lang).toBe('pl')
    expect(window.localStorage.getItem('oncall-language')).toBe('pl')
    expect(screen.getByText(pl.auth.sessionExpired)).toBeInTheDocument()
    expect(screen.queryByText(en.auth.sessionExpired)).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Polski' })).toHaveAttribute('aria-checked', 'true')
  })
})
