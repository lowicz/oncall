import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MutationObserver, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { App } from './App'
import { ApiError, CurrentUser } from './api'
import { SignedIn, createQueryClient, meKey } from './session'
import { ToastProvider, TooltipProvider } from './ui'

const ADMIN: CurrentUser = {
  username: 'admin',
  display_name: 'Administrator',
  role: 'admin',
  has_team_member: false,
  email: null,
  share: null,
  avatar_url: null,
}

function json(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }))
}

/** A server whose session ends after the first `me`: every later request is
 *  refused with 401 until the person signs in again. */
function serverWhoseSessionEnds() {
  let signedIn = true
  let checked = false
  vi.stubGlobal('fetch', vi.fn((path: string) => {
    if (path === '/api/v1/config') {
      return json(200, { app_name: 'On-call', app_subtitle: '', ldap_enabled: false, version: '1.0.0' })
    }
    if (path === '/api/v1/auth/login') {
      signedIn = true
      return json(200, ADMIN)
    }
    if (path === '/api/v1/auth/me' && !checked) {
      checked = true
      signedIn = false
      return json(200, ADMIN)
    }
    if (!signedIn) return json(401, { detail: 'Brak aktywnej sesji' })
    return json(503, { detail: 'Niedostępne w teście' })
  }))
}

function Where() {
  return <output aria-label="Adres">{useLocation().pathname}</output>
}

function renderApp(route: string) {
  const queryClient = createQueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ToastProvider>
          <MemoryRouter initialEntries={[route]}>
            <App />
            <Where />
          </MemoryRouter>
        </ToastProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  )
  return queryClient
}

afterEach(() => vi.unstubAllGlobals())

describe('an ended session', () => {
  it('replaces the shell with the login screen at the same address', async () => {
    serverWhoseSessionEnds()
    const queryClient = renderApp('/wiecej')

    expect(await screen.findByText('Sesja wygasła')).toBeInTheDocument()
    expect(screen.getByRole('form', { name: 'Logowanie' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Adres')).toHaveTextContent('/wiecej')
    // Nothing the ended session fetched stays cached for the next person:
    // only who is signed in and the public branding the login screen reads.
    const cached = queryClient.getQueryCache().getAll()
      .filter((query) => query.state.data !== undefined)
      .map((query) => query.queryKey[0])
    expect(cached.sort()).toEqual(['me', 'public-config'])
  })

  it('returns to the open screen after signing in again', async () => {
    serverWhoseSessionEnds()
    renderApp('/wiecej')
    await screen.findByText('Sesja wygasła')

    fireEvent.change(screen.getByLabelText('Login'), { target: { value: 'admin' } })
    fireEvent.change(screen.getByLabelText('Hasło'), { target: { value: 'local-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Zaloguj' }))

    await waitFor(() => expect(screen.queryByRole('form', { name: 'Logowanie' })).not.toBeInTheDocument())
    expect(screen.getByLabelText('Adres')).toHaveTextContent('/wiecej')
    expect(screen.queryByText('Sesja wygasła')).not.toBeInTheDocument()
  })
})

describe('createQueryClient', () => {
  function signedIn(queryClient: QueryClient) {
    queryClient.setQueryData<SignedIn>(meKey, ADMIN)
    queryClient.setQueryData(['swaps'], [])
  }

  it('ends the session when a mutation is refused with 401', async () => {
    const queryClient = createQueryClient()
    signedIn(queryClient)
    const save = new MutationObserver(queryClient, {
      mutationFn: () => Promise.reject(new ApiError('Sesja wygasła', 401)),
    })
    await save.mutate().catch(() => undefined)
    expect(queryClient.getQueryData(meKey)).toBeNull()
    expect(queryClient.getQueryData(['swaps'])).toBeUndefined()
  })

  it('leaves a signed-in session alone on any other refusal', async () => {
    const queryClient = createQueryClient()
    signedIn(queryClient)
    const save = new MutationObserver(queryClient, {
      mutationFn: () => Promise.reject(new ApiError('Brak uprawnień', 403)),
    })
    await save.mutate().catch(() => undefined)
    expect(queryClient.getQueryData(meKey)).toEqual(ADMIN)
  })

  it('does not call a refused sign-in an ended session', async () => {
    const queryClient = createQueryClient()
    const login = new MutationObserver(queryClient, {
      mutationFn: () => Promise.reject(new ApiError('Nieprawidłowy login lub hasło', 401)),
    })
    await login.mutate().catch(() => undefined)
    expect(queryClient.getQueryData(meKey)).toBeUndefined()
  })
})
