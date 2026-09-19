import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderScreen } from '../test/render'
import { DraftFairnessPanel } from './DraftFairnessPanel'
import { api } from '../api'
import type { DraftFairnessImpact, DraftSchedule } from '../api'

const result = { id: 'd1', version: 2 } as DraftSchedule

const impact = (over: Partial<DraftFairnessImpact> = {}): DraftFairnessImpact => ({
  schedule_id: 'd1',
  schedule_version: 2,
  baseline_as_of: '2026-10-04',
  projected_as_of: '2026-10-04',
  baseline_members: [],
  projected_members: [],
  late_shift_balanced: false,
  criterion_points: 3,
  criterion_met: true,
  spreads: [
    { lens: 'primary', before: 6.0, after: 2.0, meets_criterion: true },
    { lens: 'secondary', before: 10.0, after: 3.0, meets_criterion: true },
    { lens: 'weekends', before: 2.0, after: 2.0, meets_criterion: true },
    { lens: 'holidays', before: 2.0, after: 2.0, meets_criterion: true },
  ],
  acceptance_floor: null,
  ...over,
})

afterEach(() => vi.restoreAllMocks())

describe('DraftFairnessPanel criterion summary', () => {
  it('shows per-lens spread before -> after with the criterion state in words', async () => {
    vi.spyOn(api, 'draftFairnessImpact').mockResolvedValue(impact())
    renderScreen(<DraftFairnessPanel result={result} />)
    expect(
      await screen.findByText('Kryterium odbioru: rozpiętość ≤ 3 pkt na soczewce'),
    ).toBeInTheDocument()
    expect(screen.getByText(/SECONDARY: 10 → 3 · spełnia/)).toBeInTheDocument()
    expect(screen.getByText(/PRIMARY: 6 → 2 · spełnia/)).toBeInTheDocument()
    expect(screen.queryByText(/nieosiągalne przy zastanym/)).not.toBeInTheDocument()
  })

  it('names the lowest achievable spread when the criterion is unattainable', async () => {
    vi.spyOn(api, 'draftFairnessImpact').mockResolvedValue(
      impact({
        criterion_met: false,
        acceptance_floor: 6,
        spreads: [
          { lens: 'primary', before: 7.0, after: 5.0, meets_criterion: false },
          { lens: 'secondary', before: 10.0, after: 6.0, meets_criterion: false },
          { lens: 'weekends', before: 2.0, after: 2.0, meets_criterion: true },
          { lens: 'holidays', before: 2.0, after: 2.0, meets_criterion: true },
        ],
      }),
    )
    renderScreen(<DraftFairnessPanel result={result} />)
    expect(await screen.findByText(/Najniższa osiągalna rozpiętość to 6/)).toBeInTheDocument()
    expect(screen.getByText(/przyczyną jest zastana nierówność/)).toBeInTheDocument()
    expect(screen.getAllByText(/nie spełnia/).length).toBeGreaterThanOrEqual(2)
  })

  it('puts departed people outside the criterion table section', async () => {
    const former = {
      member_id: 'former', display_name: 'Robert Baran', active_from: '2024-01-01',
      eligible_days: { primary: 1, secondary: 1, late_shift: 1 },
      primary: { actual: 1, expected: 1, deviation: 0 },
      secondary: { actual: 1, expected: 1, deviation: 0 },
      late_shift: { actual: 1, expected: 1, deviation: 0 },
      weekends: { actual: 0, expected: 0, deviation: 0 },
      holidays: { actual: 0, expected: 0, deviation: 0 },
      total_points: 3, in_criterion: false,
    }
    vi.spyOn(api, 'draftFairnessImpact').mockResolvedValue(impact({
      baseline_members: [former], projected_members: [former],
    }))
    renderScreen(<DraftFairnessPanel result={result} />)
    expect(await screen.findByText('Poza rotacją')).toBeInTheDocument()
    expect(screen.getByText('Robert Baran')).toBeInTheDocument()
  })
})
