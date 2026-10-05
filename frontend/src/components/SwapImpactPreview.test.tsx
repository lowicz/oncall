import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderScreen } from '../test/render'
import { SwapImpactPreview } from './SwapImpactPreview'
import { ApiError, FairnessCategory, FairnessMember, SwapImpact, api } from '../api'

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

  it('says which side moves away from balance and which stays, and leaves the rules to the screen around it', async () => {
    vi.spyOn(api, 'swapImpact').mockResolvedValue({
      ...impact,
      points: 2,
      // The requester moves from +1 to -1: as far from balance as before.
      requester: { member_id: 'm1', display_name: 'Marek Nowak', before: member(category(14, 1)), after: member(category(12, -1)) },
      replacement: { member_id: 'm2', display_name: 'Tomek Lis', before: member(category(12, 0.5)), after: member(category(14, 2.5)) },
      warnings: [{ rule: 'rest', message: 'Brak odpoczynku po dyżurze', member_name: 'Tomek Lis', days: [] }],
    })
    renderScreen(<SwapImpactPreview serviceDate="2026-09-26" role="primary" replacementId="m2" />)

    expect(await screen.findByText(/to 2 punkty \(2X\)\./)).toBeInTheDocument()
    expect(screen.getByText('Marek Nowak · oddaje dyżur')).toBeInTheDocument()
    expect(screen.getByText('Tomek Lis · przejmuje dyżur')).toBeInTheDocument()
    expect(screen.getByText('bez zmiany')).toBeInTheDocument()
    expect(screen.getByText('dalej od równowagi').parentElement).toHaveClass('impact-d-warn')
    // The form, the sheet and the correction dialog list what the move breaks
    // and take the acknowledgement; the preview repeating it showed it twice.
    expect(screen.queryByText(/Brak odpoczynku po dyżurze/)).not.toBeInTheDocument()
  })

  it('says so when a side keeps its balance', async () => {
    vi.spyOn(api, 'swapImpact').mockResolvedValue({ ...impact, replacement: { ...impact.replacement, after: impact.replacement.before }, warnings: [] })
    renderScreen(<SwapImpactPreview serviceDate="2026-09-24" role="primary" replacementId="m2" />)

    expect(await screen.findByText('Saldo tej osoby się nie zmienia.')).toBeInTheDocument()
  })

  it('shows progress, then the refusal of the projection', async () => {
    vi.spyOn(api, 'swapImpact').mockRejectedValue(new ApiError('Nie można zastąpić samego siebie', 422))
    renderScreen(<SwapImpactPreview serviceDate="2026-09-24" role="primary" replacementId="m1" />)

    expect(screen.getByRole('status', { name: 'Przeliczanie wpływu zamiany' })).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('Nie można zastąpić samego siebie')
  })

  it('shows nothing until a replacement is chosen', () => {
    const swapImpact = vi.spyOn(api, 'swapImpact')
    const { container } = renderScreen(<SwapImpactPreview serviceDate="2026-09-24" role="primary" replacementId="" />)
    expect(container).toBeEmptyDOMElement()
    expect(swapImpact).not.toHaveBeenCalled()
  })
})
