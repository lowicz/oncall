import { describe, expect, it, vi } from 'vitest'
import { correctionTiming, coverageEnded } from './coverage'

const WEDNESDAY = { service_date: '2026-09-09', is_day_off: false }
const SATURDAY = { service_date: '2026-09-12', is_day_off: true }
const at = (moment: string) => new Date(`${moment}+02:00`)

describe('coverageEnded', () => {
  it('ends a working day night on-call at 09:00 the next morning', () => {
    expect(coverageEnded(WEDNESDAY, 'primary', at('2026-09-10T08:59:00'))).toBe(false)
    expect(coverageEnded(WEDNESDAY, 'secondary', at('2026-09-10T09:00:00'))).toBe(true)
  })

  it('ends 11–19 at 19:00 the same day', () => {
    expect(coverageEnded(WEDNESDAY, 'late_shift', at('2026-09-09T18:59:00'))).toBe(false)
    expect(coverageEnded(WEDNESDAY, 'late_shift', at('2026-09-09T19:00:00'))).toBe(true)
  })

  it('ends a day off at midnight', () => {
    expect(coverageEnded(SATURDAY, 'primary', at('2026-09-12T23:59:00'))).toBe(false)
    expect(coverageEnded(SATURDAY, 'primary', at('2026-09-13T00:00:00'))).toBe(true)
  })
})

describe('correctionTiming', () => {
  it('asks a reason once any role has ended and stays silent only once all have', () => {
    // The pinned clock: Thursday 10-09-2026, 09:00 in Warsaw.
    const thursday = { service_date: '2026-09-10', is_day_off: false }
    expect(correctionTiming(thursday, ['primary', 'late_shift'])).toEqual({ historical: false, silent: false })
    expect(correctionTiming(WEDNESDAY, ['primary', 'late_shift'])).toEqual({ historical: true, silent: true })
    expect(correctionTiming(undefined, ['primary'])).toEqual({ historical: false, silent: false })
  })

  it('mails the duties still in force when only some have ended', () => {
    vi.setSystemTime(at('2026-09-10T20:00:00'))
    const thursday = { service_date: '2026-09-10', is_day_off: false }
    expect(correctionTiming(thursday, ['primary', 'late_shift'])).toEqual({ historical: true, silent: false })
  })
})
