import { describe, expect, it } from 'vitest'
import { auditActionLabels, humanizeAuditSummary } from './labels'

describe('audit trail readability (QA7-L16)', () => {
  it('maps a known action code to a Polish label', () => {
    expect(auditActionLabels['schedule.override']).toBe('Korekta grafiku')
  })

  it('falls back to the raw code for an action outside the map', () => {
    expect(auditActionLabels['some.future_action']).toBeUndefined()
  })

  it('cleans the English word and raw role codes out of a stored summary', () => {
    expect(humanizeAuditSummary('Override 2026-09-14 · late_shift: Anna → Marek')).toBe(
      'Korekta 2026-09-14 · 11–19: Anna → Marek',
    )
    expect(humanizeAuditSummary('Override 2026-09-14 · primary: Anna → Marek')).toBe(
      'Korekta 2026-09-14 · PRIMARY: Anna → Marek',
    )
  })
})
