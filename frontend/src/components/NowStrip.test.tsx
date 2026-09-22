import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { renderScreen } from '../test/render'
import { NowStrip } from './NowStrip'
import { api } from '../api'
import type { CurrentDuty, PublishedSchedule } from '../api'

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
})
