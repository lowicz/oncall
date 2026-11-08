import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderScreen } from '../test/render'
import { loadRealStylesheet } from '../test/stylesheet'
import { NowStrip, coverageEnd, formatUntil } from './NowStrip'
import { api } from '../api'
import type { CurrentDuty, PublishedSchedule } from '../api'

/** The last rule whose selector list names `selector`, as the cascade would apply it. */
function dotRule(selector: string): CSSStyleRule | undefined {
  let found: CSSStyleRule | undefined
  for (const sheet of Array.from(document.styleSheets)) {
    for (const rule of Array.from(sheet.cssRules)) {
      if (rule instanceof CSSStyleRule && rule.selectorText.split(',').map((item) => item.trim()).includes(selector)) found = rule
    }
  }
  return found
}

const duty = (over: Partial<CurrentDuty>): CurrentDuty => ({
  role: 'primary', service_date: '2026-09-09', assignee_name: 'Anna Kowalska', member_id: 'm1',
  contact_email: null, contact_phone: null,
  coverage_starts_at: '19:00', coverage_ends_at: '09:00', is_day_off: false, is_override: false,
  next_assignee_name: null, next_service_date: null,
  ...over,
})

const schedule = (current: CurrentDuty[]): PublishedSchedule => ({
  generated_at: '2026-09-01T10:00:00Z',
  is_published: true,
  id: 's1',
  version: 1,
  starts_on: '2026-09-01',
  ends_on: '2026-10-03',
  assignments: [],
  current,
  today_is_day_off: false,
  today_holiday_name: null,
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('NowStrip', () => {
  it('keeps the whole phone number and the full name of a long-named duty', async () => {
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(schedule([
      duty({ assignee_name: 'Katarzyna Dąbrowska-Wróblewska', contact_phone: '+48 600 100 005' }),
    ]))
    renderScreen(<NowStrip />)

    const strip = screen.getByRole('region', { name: 'Dyżur teraz' })
    // The name may be cut with an ellipsis on a narrow bar; its title still carries it whole.
    expect(await within(strip).findByTitle('Katarzyna Dąbrowska-Wróblewska')).toHaveTextContent('Katarzyna Dąbrowska-Wróblewska')
    expect(within(strip).getByRole('link', { name: '+48 600 100 005' })).toHaveAttribute('href', 'tel:+48600100005')
  })

  it('sets the role chips white on the header band and leaves them filled everywhere else', async () => {
    // The real stylesheet, so the header rule has to win the cascade over the
    // shared chip fill; use the longhand because jsdom expands shorthand custom
    // properties to transparent instead of preserving the unresolved token.
    loadRealStylesheet()
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(schedule([
      duty({}),
      duty({ role: 'secondary', assignee_name: 'Marek Nowak' }),
      duty({ role: 'late_shift', service_date: '2026-09-10', coverage_starts_at: '11:00', coverage_ends_at: '19:00', assignee_name: 'Ola Wiśniewska' }),
    ]))
    renderScreen(<><NowStrip /><span className="lbl lbl-p">P</span></>)

    const strip = screen.getByRole('region', { name: 'Dyżur teraz' })
    await within(strip).findByTitle('Ola Wiśniewska')
    const paint = (element: HTMLElement) => {
      const style = getComputedStyle(element)
      return [style.getPropertyValue('background-color'), style.getPropertyValue('color')]
    }
    const chip = (label: string) => paint(within(strip).getByText(label, { selector: '.lbl' }))
    expect(chip('PRIMARY')).toEqual(['var(--band-chip)', 'var(--band-p)'])
    expect(chip('SECONDARY')).toEqual(['var(--band-chip)', 'var(--band-sec)'])
    expect(chip('11–19')).toEqual(['var(--band-chip)', 'var(--band-late)'])
    expect(paint(screen.getByText('P'))).toEqual(['var(--p-fill)', 'var(--role-ink)'])
  })

  it('names the end of the duty with the weekday abbreviation every screen uses', () => {
    // Wednesday 19:00 to Thursday 09:00.
    const end = coverageEnd(duty({}))
    expect(formatUntil(end, new Date('2026-09-09T21:00:00'))).toBe('do czw 09:00 · 12 h 0 min')
    expect(formatUntil(coverageEnd(duty({ service_date: '2026-09-12', is_day_off: true })), new Date('2026-09-14T09:00:00'))).toBe('do niedz 00:00')
  })

  it('counts down the minutes left in a short window every minute', async () => {
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(schedule([
      duty({ role: 'late_shift', service_date: '2026-09-10', coverage_starts_at: '08:00', coverage_ends_at: '09:30' }),
    ]))
    renderScreen(<NowStrip><button type="button">Motyw</button></NowStrip>)

    const strip = screen.getByRole('region', { name: 'Dyżur teraz' })
    expect(await within(strip).findByText('do czw 09:30 · 30 min')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(within(strip).getByText('do czw 09:30 · 29 min')).toBeInTheDocument()
    expect(within(strip).getByRole('button', { name: 'Motyw' })).toBeInTheDocument()
    // Nobody holds the other roles on a working day.
    expect(within(strip).getAllByText('brak obsady')).toHaveLength(2)
  })

  it('weighs a gap like a name and marks it with the alarm dot', async () => {
    loadRealStylesheet()
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(schedule([duty({ service_date: '2026-09-10' })]))
    renderScreen(<NowStrip />)
    const [gap] = await screen.findAllByText('brak obsady')
    expect(gap).toHaveClass('now-who', 'now-gap')
    expect(gap).not.toHaveClass('now-who-none')
    expect(getComputedStyle(gap).fontWeight).toBe('700')
    expect(dotRule('.now-gap::before')?.style.background).toBe('var(--bad-dot)')
    expect(dotRule('.now-stale::before')?.style.background).toBe('var(--warn-dot)')
  })

  it('marks the day shift as not applicable on a holiday and on a day off', async () => {
    vi.spyOn(api, 'publishedSchedule').mockResolvedValueOnce({
      ...schedule([duty({ service_date: '2026-09-10', coverage_starts_at: '19:00' })]),
      today_is_day_off: true,
      today_holiday_name: 'Wniebowzięcie',
    })
    renderScreen(<NowStrip />)
    expect(await screen.findByText('święto · Wniebowzięcie')).toBeInTheDocument()
    expect(screen.getByText('nie dotyczy')).toBeInTheDocument()
    expect(screen.getByText('do pt 09:00 · 24 h 0 min')).toBeInTheDocument()
  })

  it('names a plain day off', async () => {
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue({ ...schedule([]), today_is_day_off: true })
    renderScreen(<NowStrip />)
    expect(await screen.findByText('dzień wolny · 2X')).toBeInTheDocument()
  })

  it('distinguishes a failed first load from unstaffed roles', async () => {
    vi.spyOn(api, 'publishedSchedule').mockRejectedValue(new Error('offline'))
    renderScreen(<NowStrip />)
    expect(await screen.findAllByText('brak danych')).toHaveLength(3)
    expect(screen.getAllByText('brak danych')[0]).toHaveClass('now-stale')
    expect(screen.getAllByText('brak połączenia')).toHaveLength(3)
    expect(screen.queryByText('brak obsady')).not.toBeInTheDocument()
  })

  it('keeps the last known staffing and its time when a refresh fails', async () => {
    const published = vi.spyOn(api, 'publishedSchedule').mockResolvedValue(schedule([duty({ service_date: '2026-09-10' })]))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={queryClient}><NowStrip /></QueryClientProvider>)
    expect(await screen.findByText('do pt 09:00 · 24 h 0 min')).toBeInTheDocument()

    published.mockRejectedValue(new Error('offline'))
    await act(async () => { await queryClient.refetchQueries({ queryKey: ['published-schedule'] }) })

    await waitFor(() => expect(screen.getByText('stan z 09:00')).toHaveClass('now-stale'))
    expect(screen.getByText('stan z 09:00')).toHaveAttribute('title', 'Stan z 09:00')
    expect(screen.getByText('Anna Kowalska')).toBeInTheDocument()
  })

  it('keeps saying the connection is gone on an empty slot when a refresh fails', async () => {
    const published = vi.spyOn(api, 'publishedSchedule').mockResolvedValue(schedule([duty({ service_date: '2026-09-10' })]))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={queryClient}><NowStrip /></QueryClientProvider>)
    expect(await screen.findAllByText('brak obsady')).toHaveLength(2)
    expect(screen.queryByText('brak połączenia')).not.toBeInTheDocument()

    published.mockRejectedValue(new Error('offline'))
    await act(async () => { await queryClient.refetchQueries({ queryKey: ['published-schedule'] }) })

    await waitFor(() => expect(screen.getAllByText('brak połączenia')).toHaveLength(2))
    expect(screen.getAllByText('brak obsady')).toHaveLength(2)
  })

  it('draws a ringed warn dot before a stale timestamp so it reads on the header band', async () => {
    // The real stylesheet, so the dot the now-stale class draws is the actual
    // cascade; jsdom applies no pseudo-element, so the rule is read from the CSSOM.
    loadRealStylesheet()
    const published = vi.spyOn(api, 'publishedSchedule').mockResolvedValue(schedule([duty({ service_date: '2026-09-10' })]))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={queryClient}><NowStrip /></QueryClientProvider>)
    expect(await screen.findByText('do pt 09:00 · 24 h 0 min')).toBeInTheDocument()

    published.mockRejectedValue(new Error('offline'))
    await act(async () => { await queryClient.refetchQueries({ queryKey: ['published-schedule'] }) })
    await waitFor(() => expect(screen.getByText('stan z 09:00')).toHaveClass('now-stale'))

    const dot = dotRule('.now-stale::before')
    expect(dot?.style.background).toBe('var(--warn-dot)')
    expect(dot?.style.boxShadow).toContain('var(--band-ink)')
    expect(dot?.style.width).toBe('8px')
  })

  it('puts the number pill beside whoever the number rings at, and keeps the PRIMARY phone', async () => {
    loadRealStylesheet()
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(schedule([
      duty({ contact_phone: '+48 601 220 118' }),
      duty({ role: 'secondary', assignee_name: 'Marek Nowak', member_id: 'm2', contact_phone: '+48 602 345 678' }),
    ]))
    vi.spyOn(api, 'forwardingNow').mockResolvedValue({
      mode: 'live', day: '2026-09-10', day_ends_at: '2026-09-11T09:00:00+02:00',
      holder_member_id: 'm2', holder_name: 'Marek Nowak', holder_role: 'secondary',
      handover: {
        id: 'h1', day: '2026-09-10', from_member_id: 'm1', from_name: 'Anna Kowalska', to_member_id: 'm2', to_name: 'Marek Nowak',
        starts_at: '2026-09-10T07:00:00Z', until: '2026-09-10T11:40:00Z', started_by_name: 'Anna Kowalska',
      },
      status: 'switching', confirmed_at: null,
    })
    renderScreen(<NowStrip />)

    const strip = screen.getByRole('region', { name: 'Dyżur teraz' })
    const pill = await within(strip).findByRole('button', { name: 'numer on-call · przełączam · do 13:40' })
    expect(pill.closest('.now-slot')).toHaveAttribute('data-role', 'secondary')
    expect(within(strip).getAllByRole('button', { name: /numer on-call/ })).toHaveLength(1)
    expect(within(strip).getByRole('link', { name: '+48 601 220 118' })).toBeInTheDocument()
    // The name beside the pill stays whole and the slot may wrap the pill to a second row.
    expect(getComputedStyle(pill.closest('.now-slot')!).flexWrap).toBe('wrap')
    expect(getComputedStyle(within(strip).getByText('Marek Nowak')).flexShrink).toBe('0')
  })

  it('shows no pill while forwarding is off', async () => {
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(schedule([duty({})]))
    const now = vi.spyOn(api, 'forwardingNow').mockResolvedValue({
      mode: 'off', day: null, day_ends_at: null, holder_member_id: null, holder_name: null, holder_role: null,
      handover: null, status: null, confirmed_at: null,
    })
    renderScreen(<NowStrip />)
    await screen.findByText('Anna Kowalska')
    await waitFor(() => expect(now).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /numer on-call/ })).not.toBeInTheDocument()
  })

  it('leaves the end out when the window cannot be read', () => {
    const end = coverageEnd(duty({ coverage_starts_at: '', coverage_ends_at: 'x' }))
    expect(end).toBeNull()
    expect(formatUntil(end, new Date())).toBe('')
  })
})
