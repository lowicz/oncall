import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderScreen } from '../test/render'
import { SwapImpactPreview } from './SwapImpactPreview'
import { FairnessCategory, FairnessMember, SwapImpact, api } from '../api'

const category = (actual: number, deviation: number): FairnessCategory => ({ actual, expected: actual - deviation, deviation })

const member = (primary: FairnessCategory): FairnessMember => ({
  member_id: 'm1',
  display_name: 'Marek Nowak',
  active_from: '2025-01-01',
  eligible_days: {},
  primary,
  secondary: category(0, 0),
  late_shift: category(0, 0),
  weekends: category(0, 0),
  holidays: category(0, 0),
  total_points: primary.actual,
})

const impact: SwapImpact = {
  service_date: '2026-09-24',
  role: 'primary',
  points: 1,
  window_start: '2025-09-24',
  window_end: '2026-09-24',
  requester: { member_id: 'm1', display_name: 'Marek Nowak', before: member(category(14.5, 1.25)), after: member(category(13.5, 0.25)) },
  replacement: { member_id: 'm2', display_name: 'Tomek Lis', before: member(category(10, -2.75)), after: member(category(11, -1.75)) },
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SwapImpactPreview', () => {
  it('writes the window, points and deviations the way every other screen does', async () => {
    vi.spyOn(api, 'swapImpact').mockResolvedValue(impact)
    renderScreen(<SwapImpactPreview serviceDate="2026-09-24" role="primary" replacementId="m2" mode="override" />)

    expect(await screen.findByText(/Okno 24-09-2025 – 24-09-2026\./)).toHaveTextContent('czw 24-09-2026 to 1 punkt.')
    expect(screen.getByText(/punkty 14,5 → 13,5 \(-1\)/)).toBeInTheDocument()
    expect(screen.getByText(/punkty 10 → 11 \(\+1\)/)).toBeInTheDocument()
    expect(screen.getByText('+1,25 → +0,25')).toBeInTheDocument()
    expect(screen.getByText('-2,75 → -1,75')).toBeInTheDocument()
    expect(screen.getByText('Marek Nowak · traci dyżur')).toBeInTheDocument()
  })
})
