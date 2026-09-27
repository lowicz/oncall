import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import { useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { useToast } from './ui'

vi.mock('./App', () => ({
  // Reads every provider main.tsx is responsible for, so a missing one fails here.
  App: function App() {
    const queryClient = useQueryClient()
    const toast = useToast()
    const location = useLocation()
    return <h1>{`App at ${location.pathname}, ${queryClient ? 'queries' : ''}, ${toast ? 'toasts' : ''}`}</h1>
  },
}))

afterEach(() => {
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.setAttribute('lang', 'pl')
})

describe('the entry point', () => {
  it('applies the stored preferences before rendering the application with its providers', async () => {
    window.localStorage.setItem('oncall-theme', 'light')
    window.localStorage.setItem('oncall-language', 'en')
    document.body.innerHTML = '<div id="root"></div>'

    await act(async () => { await import('./main') })

    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(document.documentElement.getAttribute('lang')).toBe('en')
    expect(await screen.findByRole('heading', { name: 'App at /, queries, toasts' })).toBeInTheDocument()
    expect(document.getElementById('root')).toContainElement(screen.getByRole('heading'))
  })
})
