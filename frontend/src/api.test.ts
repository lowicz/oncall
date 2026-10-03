import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from './api'
import { messages } from './i18n'

const common = () => messages().common

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

interface Sent {
  url: string
  method: string
  headers: Record<string, string>
  credentials: RequestCredentials | undefined
  body: unknown
}

/** A server that hands out one CSRF token and answers every other call with
 *  `reply`, recording what each call sent (the token fetch aside). */
function server(reply: (url: string) => Response = () => new Response(JSON.stringify({ ok: true }), { status: 200 })) {
  const sent: Sent[] = []
  const csrf: string[] = []
  const fetch = vi.fn((url: string, init: RequestInit = {}) => {
    if (url === '/api/v1/auth/csrf') {
      csrf.push(url)
      return Promise.resolve(new Response(JSON.stringify({ csrf_token: 'tok' }), { status: 200 }))
    }
    const body = init.body
    sent.push({
      url,
      method: init.method ?? 'GET',
      headers: { ...(init.headers as Record<string, string>) },
      credentials: init.credentials,
      body: typeof body === 'string' ? JSON.parse(body) as unknown : body,
    })
    return Promise.resolve(reply(url))
  })
  vi.stubGlobal('fetch', fetch)
  return { sent, csrf }
}

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Accept-Language': 'pl' }
const CSRF_JSON_HEADERS = { ...JSON_HEADERS, 'X-CSRF-Token': 'tok' }
const CSRF_RAW_HEADERS = { 'X-CSRF-Token': 'tok', 'Accept-Language': 'pl' }

interface Case {
  name: string
  call: () => Promise<unknown>
  method: string
  url: string
  headers: Record<string, string>
  body?: unknown
}

const get = (name: string, call: () => Promise<unknown>, url: string): Case =>
  ({ name, call, method: 'GET', url, headers: JSON_HEADERS })
const send = (name: string, call: () => Promise<unknown>, method: string, url: string, body?: unknown): Case =>
  ({ name, call, method, url, headers: CSRF_JSON_HEADERS, body })
const rawDelete = (name: string, call: () => Promise<unknown>, url: string): Case =>
  ({ name, call, method: 'DELETE', url, headers: CSRF_RAW_HEADERS })

const eventInput = { title: 'Szkolenie', starts_on: '2026-09-14', ends_on: '2026-09-15', color: 'blue' as const }
const availabilityInput = { kind: 'prefer_not' as const, starts_on: '2026-09-14', ends_on: '2026-09-14', note: 'wizyta' }
const userInput = {
  username: 'jkowal', personnel_number: null, first_name: 'Jan', last_name: 'Kowal',
  email: null, phone: null, role: 'member' as const,
}

const CASES: Case[] = [
  get('me', () => api.me(), '/api/v1/auth/me'),
  get('publicConfig', () => api.publicConfig(), '/api/v1/config'),
  { name: 'login', call: () => api.login('jan', 'sekret'), method: 'POST', url: '/api/v1/auth/login',
    headers: JSON_HEADERS, body: { username: 'jan', password: 'sekret' } },
  { name: 'logout', call: () => api.logout(), method: 'POST', url: '/api/v1/auth/logout', headers: CSRF_RAW_HEADERS },
  get('publishedSchedule', () => api.publishedSchedule(), '/api/v1/schedules/published'),
  get('calendar', () => api.calendar('2026-09-01', '2026-09-30'),
    '/api/v1/calendar?starts_on=2026-09-01&ends_on=2026-09-30'),
  send('batchOverride', () => api.batchOverride({
    schedule_id: 's1', expected_version: 2, reason: 'choroba',
    assignments: [{ service_date: '2026-09-14', role: 'primary', replacement_member_id: 'm2' }],
  }), 'POST', '/api/v1/calendar/override/batch', {
    schedule_id: 's1', expected_version: 2, reason: 'choroba',
    assignments: [{ service_date: '2026-09-14', role: 'primary', replacement_member_id: 'm2' }],
  }),
  get('calendarEvents', () => api.calendarEvents('2026-09-01', '2026-09-30'),
    '/api/v1/calendar/events?starts_on=2026-09-01&ends_on=2026-09-30'),
  send('createCalendarEvent', () => api.createCalendarEvent(eventInput), 'POST', '/api/v1/calendar/events', eventInput),
  send('updateCalendarEvent', () => api.updateCalendarEvent({ id: 'e1', title: 'Nowy' }),
    'PATCH', '/api/v1/calendar/events/e1', { title: 'Nowy' }),
  send('deleteCalendarEvent', () => api.deleteCalendarEvent('e1'), 'DELETE', '/api/v1/calendar/events/e1'),
  send('directOverride', () => api.directOverride({
    expected_version: 3, service_date: '2026-09-14', role: 'secondary', replacement_member_id: 'm3',
  }), 'POST', '/api/v1/calendar/override', {
    expected_version: 3, service_date: '2026-09-14', role: 'secondary', replacement_member_id: 'm3',
  }),
  send('directOverrideCheck', () => api.directOverrideCheck({
    service_date: '2026-09-14', role: 'late_shift', replacement_member_id: 'm3',
  }), 'POST', '/api/v1/calendar/override/check', {
    service_date: '2026-09-14', role: 'late_shift', replacement_member_id: 'm3',
  }),
  get('availability', () => api.availability(), '/api/v1/availability/me'),
  send('createAvailability', () => api.createAvailability(availabilityInput),
    'POST', '/api/v1/availability/me', availabilityInput),
  send('deleteAvailability', () => api.deleteAvailability('a1'), 'DELETE', '/api/v1/availability/me/a1'),
  get('memberAvailability', () => api.memberAvailability('m1'), '/api/v1/availability/members/m1'),
  send('createMemberAvailability', () => api.createMemberAvailability('m1', availabilityInput),
    'POST', '/api/v1/availability/members/m1', availabilityInput),
  send('deleteMemberAvailability', () => api.deleteMemberAvailability('m1', 'a1'),
    'DELETE', '/api/v1/availability/members/m1/a1'),
  send('commitHistory', () => api.commitHistory({
    filename: 'h.csv', valid: true, errors: [],
    rows: [{ service_date: '2026-01-05', role: 'primary', assignee_name: 'Jan' }],
  }), 'POST', '/api/v1/history/commit', {
    filename: 'h.csv', rows: [{ service_date: '2026-01-05', role: 'primary', assignee_name: 'Jan' }],
  }),
  get('historyImports', () => api.historyImports(), '/api/v1/history/imports'),
  get('schedulingPolicy', () => api.schedulingPolicy(), '/api/v1/scheduling/policy'),
  get('suggestedScheduleRange', () => api.suggestedScheduleRange(), '/api/v1/scheduling/suggested-range'),
  send('updateSchedulingPolicy', () => api.updateSchedulingPolicy({ rotation_mode: 'weekly', solve_seconds: 30 }),
    'PUT', '/api/v1/scheduling/policy', { rotation_mode: 'weekly', solve_seconds: 30 }),
  get('activeRuns', () => api.activeRuns(), '/api/v1/scheduling/runs'),
  get('draftSchedules', () => api.draftSchedules(), '/api/v1/scheduling/drafts'),
  get('compareSchedules', () => api.compareSchedules('a b', 'c'),
    '/api/v1/scheduling/compare?left_id=a%20b&right_id=c'),
  get('schedule', () => api.schedule('s1'), '/api/v1/scheduling/s1'),
  rawDelete('deleteSchedule', () => api.deleteSchedule('s1'), '/api/v1/scheduling/s1'),
  send('overrideDraft', () => api.overrideDraft({
    id: 's1', expected_version: 4, service_date: '2026-09-14', role: 'primary', replacement_member_id: 'm2',
  }), 'POST', '/api/v1/scheduling/s1/override', {
    expected_version: 4, service_date: '2026-09-14', role: 'primary', replacement_member_id: 'm2',
  }),
  get('draftFairnessImpact', () => api.draftFairnessImpact('s1', 5), '/api/v1/scheduling/s1/fairness-impact?version=5'),
  send('proposeSchedule', () => api.proposeSchedule({ id: 's1', expectedVersion: 2 }),
    'POST', '/api/v1/scheduling/s1/propose', { expected_version: 2 }),
  send('withdrawSchedule', () => api.withdrawSchedule({ id: 's1', expectedVersion: 3 }),
    'POST', '/api/v1/scheduling/s1/withdraw', { expected_version: 3 }),
  get('publishPreview', () => api.publishPreview('s1'), '/api/v1/scheduling/s1/publish-preview'),
  send('publishSchedule with defaults', () => api.publishSchedule({ id: 's1', expectedVersion: 6 }),
    'POST', '/api/v1/scheduling/s1/publish', {
      expected_version: 6, acknowledge_lost_changes: false, acknowledge_gap: false,
      acknowledge_rest_violations: false, change_resolutions: {},
    }),
  send('publishSchedule with every acknowledgement', () => api.publishSchedule({
    id: 's1', expectedVersion: 6, acknowledgeLostChanges: true, acknowledgeGap: true,
    acknowledgeRestViolations: true, changeResolutions: { '2026-09-14:primary': 'change' },
  }), 'POST', '/api/v1/scheduling/s1/publish', {
    expected_version: 6, acknowledge_lost_changes: true, acknowledge_gap: true,
    acknowledge_rest_violations: true, change_resolutions: { '2026-09-14:primary': 'change' },
  }),
  get('swaps with no filter', () => api.swaps(), '/api/v1/swaps'),
  get('swaps filtered', () => api.swaps({ status: ['approved', 'rejected'], limit: 20 }),
    '/api/v1/swaps?status=approved&status=rejected&limit=20'),
  get('swapPolicy', () => api.swapPolicy(), '/api/v1/swaps/policy'),
  get('swapImpact', () => api.swapImpact('2026-09-14', 'primary', 'm 2'),
    '/api/v1/swaps/impact?service_date=2026-09-14&role=primary&replacement_member_id=m%202'),
  get('swapOptions', () => api.swapOptions('2026-09-14', 'secondary'),
    '/api/v1/swaps/options?service_date=2026-09-14&role=secondary'),
  send('createSwap', () => api.createSwap({
    schedule_id: 's1', service_date: '2026-09-14', role: 'primary', replacement_member_id: 'm2', note: 'urlop',
  }), 'POST', '/api/v1/swaps', {
    schedule_id: 's1', service_date: '2026-09-14', role: 'primary', replacement_member_id: 'm2', note: 'urlop',
  }),
  send('acceptSwap', () => api.acceptSwap('w1'), 'POST', '/api/v1/swaps/w1/accept'),
  send('approveSwap', () => api.approveSwap('w1'), 'POST', '/api/v1/swaps/w1/approve'),
  send('rejectSwap', () => api.rejectSwap({ id: 'w1', reason: 'brak' }), 'POST', '/api/v1/swaps/w1/reject', { reason: 'brak' }),
  send('cancelSwap', () => api.cancelSwap({ id: 'w1', reason: 'zmiana' }), 'POST', '/api/v1/swaps/w1/cancel', { reason: 'zmiana' }),
  send('createShareLink', () => api.createShareLink({
    label: 'Zarząd', starts_on: '2026-09-01', ends_on: '2026-09-30', expires_days: 7,
  }), 'POST', '/api/v1/admin/share-links', {
    label: 'Zarząd', starts_on: '2026-09-01', ends_on: '2026-09-30', expires_days: 7,
  }),
  get('shareLinks', () => api.shareLinks(), '/api/v1/admin/share-links'),
  send('revokeShareLink', () => api.revokeShareLink('l1'), 'DELETE', '/api/v1/admin/share-links/l1'),
  send('createShareLinkFeed', () => api.createShareLinkFeed('l1'), 'POST', '/api/v1/admin/share-links/l1/feed'),
  { name: 'exchangeShare', call: () => api.exchangeShare('abc'), method: 'POST', url: '/api/v1/share/exchange',
    headers: JSON_HEADERS, body: { token: 'abc' } },
  send('createFeed', () => api.createFeed('Telefon'), 'POST', '/api/v1/calendar/feeds', { label: 'Telefon' }),
  get('feeds', () => api.feeds(), '/api/v1/calendar/feeds'),
  send('revokeFeed', () => api.revokeFeed('f1'), 'DELETE', '/api/v1/calendar/feeds/f1'),
  get('fairness today', () => api.fairness(), '/api/v1/fairness'),
  get('fairness as of a date', () => api.fairness('2026-06-30'), '/api/v1/fairness?as_of=2026-06-30'),
  get('fairnessDuties today', () => api.fairnessDuties('m 1'), '/api/v1/fairness/duties?member_id=m%201'),
  get('fairnessDuties as of a date', () => api.fairnessDuties('m1', '2026-06-30'),
    '/api/v1/fairness/duties?member_id=m1&as_of=2026-06-30'),
  get('monthlyReportPreview', () => api.monthlyReportPreview('2026-09'), '/api/v1/reports/monthly?month=2026-09'),
  get('adminUsers', () => api.adminUsers(), '/api/v1/admin/users'),
  get('team', () => api.team(), '/api/v1/team'),
  send('createAdminUser', () => api.createAdminUser(userInput), 'POST', '/api/v1/admin/users', userInput),
  send('updateAdminUser', () => api.updateAdminUser({ id: 'u1', input: { is_active: false } }),
    'PATCH', '/api/v1/admin/users/u1', { is_active: false }),
  send('deleteAdminUser', () => api.deleteAdminUser('u1'), 'DELETE', '/api/v1/admin/users/u1'),
  send('updateUserEmail', () => api.updateUserEmail({ id: 'u1', email: 'jan@example.org' }),
    'PATCH', '/api/v1/admin/users/u1', { email: 'jan@example.org' }),
  send('issuePasswordReset', () => api.issuePasswordReset('u1'), 'POST', '/api/v1/admin/users/u1/reset'),
  send('reissueActivation', () => api.reissueActivation('u1'), 'POST', '/api/v1/admin/users/u1/activation'),
  send('createTeamMember', () => api.createTeamMember({ user_id: 'u1', active_from: '2026-09-01' }),
    'POST', '/api/v1/admin/team-members', { user_id: 'u1', active_from: '2026-09-01' }),
  send('updateTeamMember', () => api.updateTeamMember({ id: 'm1', input: { active_until: '2026-12-31' } }),
    'PATCH', '/api/v1/admin/team-members/m1', { active_until: '2026-12-31' }),
  send('createEligibility', () => api.createEligibility({
    memberId: 'm1', input: { role: 'primary', starts_on: '2026-09-01', ends_on: null },
  }), 'POST', '/api/v1/admin/team-members/m1/eligibility', { role: 'primary', starts_on: '2026-09-01', ends_on: null }),
  send('updateEligibility', () => api.updateEligibility({ id: 'e1', input: { ends_on: '2026-10-01' } }),
    'PATCH', '/api/v1/admin/eligibility/e1', { ends_on: '2026-10-01' }),
  send('deleteEligibility', () => api.deleteEligibility('e1'), 'DELETE', '/api/v1/admin/eligibility/e1'),
  { name: 'activateAccount', call: () => api.activateAccount('t1', 'haslo'), method: 'POST',
    url: '/api/v1/auth/activate', headers: JSON_HEADERS, body: { token: 't1', password: 'haslo' } },
  { name: 'resetPassword', call: () => api.resetPassword('t2', 'haslo'), method: 'POST',
    url: '/api/v1/auth/reset', headers: JSON_HEADERS, body: { token: 't2', password: 'haslo' } },
  get('passwordTokenInfo', () => api.passwordTokenInfo('a/b', 'password_reset'),
    '/api/v1/auth/password-token?token=a%2Fb&kind=password_reset'),
  get('auditEvents with defaults', () => api.auditEvents({}), '/api/v1/admin/audit?limit=100&offset=0'),
  get('auditEvents with every filter', () => api.auditEvents({
    action: 'user.create', actor: 'admin', q: 'Jan', starts_on: '2026-09-01', ends_on: '2026-09-30',
    include_logins: true, limit: 50, offset: 100,
  }), '/api/v1/admin/audit?action=user.create&actor=admin&q=Jan&starts_on=2026-09-01'
    + '&ends_on=2026-09-30&include_logins=true&limit=50&offset=100'),
]

describe('API requests', () => {
  it.each(CASES)('$name sends $method $url', async ({ call, method, url, headers, body }) => {
    const { sent, csrf } = server()
    await call()
    expect(sent).toEqual([{ url, method, headers, credentials: 'include', body }])
    expect(csrf).toHaveLength('X-CSRF-Token' in headers ? 1 : 0)
  })

  it('asks the server in the language the interface shows', async () => {
    window.localStorage.setItem('oncall-language', 'en')
    const { sent } = server()
    await api.me()
    expect(sent[0].headers['Accept-Language']).toBe('en')
  })

  it('returns the parsed answer, and nothing for 204 No Content', async () => {
    server((url) => (url.endsWith('/me')
      ? new Response(JSON.stringify({ username: 'jan' }), { status: 200 })
      : new Response(null, { status: 204 })))
    await expect(api.me()).resolves.toEqual({ username: 'jan' })
    await expect(api.deleteAdminUser('u1')).resolves.toBeUndefined()
  })

  it('uploads the history file as a form with the CSRF token and returns the preview', async () => {
    const preview = { filename: 'historia.csv', valid: true, rows: [], errors: [] }
    const { sent } = server(() => new Response(JSON.stringify(preview), { status: 200 }))
    const file = new File(['data;rola'], 'historia.csv')
    await expect(api.previewHistory(file)).resolves.toEqual(preview)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ url: '/api/v1/history/preview', method: 'POST', headers: CSRF_RAW_HEADERS })
    expect((sent[0].body as FormData).get('file')).toBeInstanceOf(File)
  })

  it('downloads the monthly report as a file', async () => {
    const { sent } = server(() => new Response('a;b\n1;2', { status: 200 }))
    const blob = await api.monthlyReport('2026-09')
    expect(await blob.text()).toBe('a;b\n1;2')
    expect(sent).toEqual([{
      url: '/api/v1/reports/monthly.csv?month=2026-09', method: 'GET',
      headers: { 'Accept-Language': 'pl' }, credentials: 'include', body: undefined,
    }])
  })
})

describe('API refusals', () => {
  const failing = (status: number, body: unknown = { detail: 'Odmowa serwera' }) =>
    server(() => new Response(body === null ? 'not json' : JSON.stringify(body), { status }))

  it('logout reports its own failure with the status', async () => {
    failing(500)
    await expect(api.logout()).rejects.toThrow(common().logoutFailed(500))
  })

  it.each([
    ['deleteSchedule', () => api.deleteSchedule('s1')],
    ['deleteAvailability', () => api.deleteAvailability('a1')],
    ['deleteMemberAvailability', () => api.deleteMemberAvailability('m1', 'a1')],
    ['revokeShareLink', () => api.revokeShareLink('l1')],
    ['revokeFeed', () => api.revokeFeed('f1')],
    ['monthlyReport', () => api.monthlyReport('2026-09')],
    ['previewHistory', () => api.previewHistory(new File(['x'], 'h.csv'))],
    ['ownAvatar', () => api.ownAvatar('/api/v1/auth/me/avatar')],
    ['a shared request', () => api.me()],
  ])('%s shows the server message', async (_name, call) => {
    failing(409)
    const error = await refusal(call)
    expect(error.message).toBe('Odmowa serwera')
    expect(error.status).toBe(409)
    expect(error.violations).toEqual([])
    expect(error.nextStep).toBeNull()
  })

  it.each([
    ['deleteSchedule', () => api.deleteSchedule('s1')],
    ['deleteAvailability', () => api.deleteAvailability('a1')],
    ['deleteMemberAvailability', () => api.deleteMemberAvailability('m1', 'a1')],
    ['revokeShareLink', () => api.revokeShareLink('l1')],
    ['revokeFeed', () => api.revokeFeed('f1')],
    ['monthlyReport', () => api.monthlyReport('2026-09')],
    ['previewHistory', () => api.previewHistory(new File(['x'], 'h.csv'))],
    ['ownAvatar', () => api.ownAvatar('/api/v1/auth/me/avatar')],
    ['a shared request', () => api.me()],
  ])('%s falls back to the status when the answer is not JSON', async (_name, call) => {
    failing(502, null)
    const error = await refusal(call)
    expect(error.message).toBe(common().httpError(502))
    expect(error.status).toBe(502)
  })

  it('falls back to the status when the answer names no detail', async () => {
    failing(500, { error: 'x' })
    expect((await refusal(() => api.me())).message).toBe(common().httpError(500))
  })

  it('keeps the rule violations and the next step of a hard-rule refusal', async () => {
    const violation = { rule: 'rest', message: 'Za krótki odpoczynek', member_name: 'Jan', days: ['2026-09-14'] }
    failing(409, { detail: { message: 'Zmiana łamie reguły', violations: [violation], next_step: 'Wybierz inną osobę' } })
    const error = await refusal(() => api.directOverride({
      expected_version: 1, service_date: '2026-09-14', role: 'primary', replacement_member_id: 'm2',
    }))
    expect(error.message).toBe('Zmiana łamie reguły')
    expect(error.violations).toEqual([violation])
    expect(error.nextStep).toBe('Wybierz inną osobę')
  })

  it('falls back to the status for a structured refusal with no message', async () => {
    failing(409, { detail: { violations: 'none', next_step: 3 } })
    const error = await refusal(() => api.me())
    expect(error.message).toBe(common().httpError(409))
    expect(error.violations).toEqual([])
    expect(error.nextStep).toBeNull()
  })

  it('treats a null detail like a missing one', async () => {
    failing(400, { detail: null })
    expect((await refusal(() => api.me())).message).toBe(common().httpError(400))
  })

  it('joins field messages that already end a sentence without doubling the full stop', async () => {
    failing(422, { detail: [
      { loc: ['body', 'a'], msg: 'Pierwsze?' },
      { loc: ['body', 'b'], msg: 'Drugie!' },
      { msg: '  Bez pola  ' },
      { loc: ['body', 'c'], msg: '   ' },
      null,
    ] })
    expect((await refusal(() => api.me())).message).toBe('Pierwsze? Drugie! Bez pola.')
  })
})

describe('the own avatar', () => {
  // A Response built by Node hands back Node's Blob, which jsdom's FileReader
  // cannot read; the photo answer carries the page's own Blob instead.
  const photo = () => ({
    ok: true, status: 200, blob: () => Promise.resolve(new Blob(['png'], { type: 'image/png' })),
  }) as unknown as Response

  it('is null when the directory holds no photo', async () => {
    const { sent } = server(() => new Response(null, { status: 404 }))
    await expect(api.ownAvatar('/api/v1/auth/me/avatar')).resolves.toBeNull()
    expect(sent[0]).toMatchObject({ url: '/api/v1/auth/me/avatar', headers: { 'Accept-Language': 'pl' }, credentials: 'include' })
  })

  it('is the photo as a data URL', async () => {
    server(() => photo())
    await expect(api.ownAvatar('/avatar')).resolves.toBe(`data:image/png;base64,${btoa('png')}`)
  })

  it('fails with the reader error when the photo cannot be read', async () => {
    server(() => photo())
    const failure = new DOMException('broken', 'NotReadableError')
    vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader) {
      Object.defineProperty(this, 'error', { value: failure })
      this.onerror?.(new ProgressEvent('error') as ProgressEvent<FileReader>)
    })
    await expect(api.ownAvatar('/avatar')).rejects.toBe(failure)
  })

  it('fails with a readable message when the reader names no error', async () => {
    server(() => photo())
    vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader) {
      this.onerror?.(new ProgressEvent('error') as ProgressEvent<FileReader>)
    })
    await expect(api.ownAvatar('/avatar')).rejects.toThrow(common().imageReadFailed)
  })
})

describe('schedule generation', () => {
  const run = (overrides: Record<string, unknown>) => ({
    id: 'r1', status: 'queued', progress: 0, schedule_id: null, error: null, conflicts: null,
    created_at: '2026-09-10T07:00:00Z', solve_seconds: 30, queue_position: 0, estimated_start_seconds: null,
    ...overrides,
  })

  function generator(steps: Record<string, unknown>[]) {
    const polls = [...steps]
    return server((url) => {
      if (url === '/api/v1/scheduling/runs') return new Response(JSON.stringify(run({})), { status: 200 })
      if (url === '/api/v1/scheduling/runs/r1') return new Response(JSON.stringify(run(polls.shift() ?? {})), { status: 200 })
      return new Response(JSON.stringify({ id: 'd1', name: 'Wrzesień' }), { status: 200 })
    })
  }

  it('starts a run, reports every poll and returns the finished draft', async () => {
    const { sent } = generator([
      { status: 'running', progress: 40 },
      { status: 'completed', progress: 100 },
      { status: 'completed', progress: 100, schedule_id: 'd1' },
    ])
    const progress: unknown[] = []
    const pending = api.generateSchedule(
      { starts_on: '2026-10-01', ends_on: '2026-10-31' },
      (current) => progress.push([current.status, current.progress]),
    )
    // One second between polls.
    await vi.advanceTimersByTimeAsync(2000)
    const draft = await pending
    expect(draft).toEqual({ id: 'd1', name: 'Wrzesień' })
    expect(progress).toEqual([['queued', 0], ['running', 40], ['completed', 100], ['completed', 100]])
    expect(sent[0]).toEqual({
      url: '/api/v1/scheduling/runs', method: 'POST', headers: CSRF_JSON_HEADERS, credentials: 'include',
      body: { starts_on: '2026-10-01', ends_on: '2026-10-31' },
    })
    expect(sent.map((call) => call.url).slice(1)).toEqual([
      '/api/v1/scheduling/runs/r1', '/api/v1/scheduling/runs/r1', '/api/v1/scheduling/runs/r1',
      '/api/v1/scheduling/d1',
    ])
  })

  it('works without a progress listener', async () => {
    generator([{ status: 'completed', schedule_id: 'd1' }])
    await expect(api.generateSchedule({ starts_on: '2026-10-01', ends_on: '2026-10-31' }))
      .resolves.toEqual({ id: 'd1', name: 'Wrzesień' })
  })

  it('fails with the error the run records', async () => {
    generator([{ status: 'failed', error: 'Brak osób' }])
    await expect(api.followRun('r1')).rejects.toThrow('Brak osób')
  })

  it('fails with a readable message when the failed run records none', async () => {
    generator([{ status: 'failed' }])
    await expect(api.followRun('r1')).rejects.toThrow(common().generatorFailed)
  })
})
