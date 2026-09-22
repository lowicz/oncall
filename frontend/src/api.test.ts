import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from './api'

function answer(status: number, body: unknown) {
  return vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })))
}

async function refusal(call: () => Promise<unknown>): Promise<ApiError> {
  const error = await call().catch((caught: unknown) => caught)
  expect(error).toBeInstanceOf(ApiError)
  return error as ApiError
}

afterEach(() => vi.unstubAllGlobals())

describe('API errors', () => {
  it('shows the message the server gives for a rejected field', async () => {
    vi.stubGlobal('fetch', answer(422, {
      detail: [{ loc: ['body', 'username'], msg: 'Login nie może zawierać spacji', type: 'value_error' }],
    }))
    const error = await refusal(() => api.publicConfig())
    expect(error.message).toBe('Login nie może zawierać spacji')
    expect(error.status).toBe(422)
  })

  it('shows one message per field, each message once', async () => {
    vi.stubGlobal('fetch', answer(422, {
      detail: [
        { loc: ['body', 'title'], msg: 'Wartość jest za długa (maksimum 160 znaków).', type: 'string_too_long' },
        { loc: ['body', 'title'], msg: 'Druga uwaga do tego samego pola', type: 'value_error' },
        { loc: ['body', 'username'], msg: 'Login nie może zawierać spacji', type: 'value_error' },
        { loc: ['body', 'starts_on'], msg: 'To pole jest wymagane.', type: 'missing' },
        { loc: ['body', 'ends_on'], msg: 'To pole jest wymagane.', type: 'missing' },
      ],
    }))
    const error = await refusal(() => api.publicConfig())
    expect(error.message).toBe(
      'Wartość jest za długa (maksimum 160 znaków). Login nie może zawierać spacji. To pole jest wymagane.',
    )
  })

  it('falls back to the status when the list carries no message', async () => {
    vi.stubGlobal('fetch', answer(422, { detail: [{ loc: ['body'] }, 'x'] }))
    const error = await refusal(() => api.publicConfig())
    expect(error.message).toBe('Błąd HTTP 422')
  })

  it('reads a field error on the history file upload, which bypasses the shared request', async () => {
    vi.stubGlobal('fetch', vi.fn((path: string) => Promise.resolve(path === '/api/v1/auth/csrf'
      ? new Response(JSON.stringify({ csrf_token: 't' }), { status: 200 })
      : new Response(JSON.stringify({
        detail: [{ loc: ['body', 'file'], msg: 'To pole jest wymagane.', type: 'missing' }],
      }), { status: 422 }))))
    const error = await refusal(() => api.previewHistory(new File(['x'], 'historia.csv')))
    expect(error.message).toBe('To pole jest wymagane.')
    expect(error.message).not.toContain('[object Object]')
  })
})
