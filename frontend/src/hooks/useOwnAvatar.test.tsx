import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useOwnAvatar } from './useOwnAvatar'

const AVATAR_URL = '/api/v1/auth/me/avatar'
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

function answer(status: number, body: BodyInit | null = null, contentType = 'application/json') {
  const response = new Response(body, { status, headers: { 'Content-Type': contentType } })
  // In a browser `response.blob()` and `new FileReader()` share one realm; in
  // jsdom the global `fetch`/`Response` come from Node (undici), whose Blob the
  // jsdom `FileReader` rejects as "not of type Blob". Hand back a same-realm
  // Blob so the test exercises the real data-URL path instead of that mismatch.
  if (body instanceof Uint8Array) {
    const blob = new Blob([body], { type: contentType })
    response.blob = () => Promise.resolve(blob)
  }
  return vi.fn(() => Promise.resolve(response))
}

function renderAvatar(user: Parameters<typeof useOwnAvatar>[0]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return renderHook(() => useOwnAvatar(user), { wrapper })
}

afterEach(() => vi.unstubAllGlobals())

describe('useOwnAvatar', () => {
  it('shows the photo the directory holds, as a data URL', async () => {
    const fetch = answer(200, PNG, 'image/png')
    vi.stubGlobal('fetch', fetch)
    const { result } = renderAvatar({ username: 'anna', avatar_url: AVATAR_URL })
    await waitFor(() => expect(result.current).toMatch(/^data:image\/png;base64,/))
    // The person's own photo only, with the session cookie and nothing else.
    expect(fetch).toHaveBeenCalledWith(AVATAR_URL, { credentials: 'include' })
  })

  it('keeps the initials when the directory holds no photo', async () => {
    const fetch = answer(404, JSON.stringify({ detail: 'Brak zdjęcia w katalogu' }))
    vi.stubGlobal('fetch', fetch)
    const { result } = renderAvatar({ username: 'anna', avatar_url: AVATAR_URL })
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    await waitFor(() => expect(result.current).toBeNull())
  })

  it('keeps the initials when the directory cannot answer, and does not keep asking', async () => {
    const fetch = answer(503, JSON.stringify({ detail: 'Katalog jest chwilowo niedostępny' }))
    vi.stubGlobal('fetch', fetch)
    const { result } = renderAvatar({ username: 'anna', avatar_url: AVATAR_URL })
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    expect(result.current).toBeNull()
  })

  it('asks for nothing when the account may have no photo', async () => {
    const fetch = answer(200, PNG, 'image/png')
    vi.stubGlobal('fetch', fetch)
    const { result } = renderAvatar({ username: 'local', avatar_url: null })
    expect(result.current).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })
})
