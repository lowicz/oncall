import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { renderScreen } from '../test/render'
import { DraftScheduleMatrix } from './DraftScheduleMatrix'
import { CalendarData, DraftFairnessImpact, DraftSchedule, FairnessCategory, FairnessMember, api } from '../api'

const category = (deviation: number): FairnessCategory => ({ actual: 20 + deviation, expected: 20, deviation })

const balance = (id: string, name: string, primary: number): FairnessMember => ({
  member_id: id,
  display_name: name,
  active_from: '2025-01-01',
  eligible_days: {},
  primary: category(primary),
  secondary: category(0),
  late_shift: category(0),
  weekends: category(0),
  holidays: category(0),
  total_points: 20 + primary,
})

const draft: DraftSchedule = {
  id: 'd1',
  name: 'Szkic',
  starts_on: '2026-09-21',
  ends_on: '2026-09-21',
  status: 'draft',
  version: 1,
  rotation_mode: 'daily',
  solver_status: 'OPTIMAL',
  acceptance_floor: null,
  assignments: [{ service_date: '2026-09-21', role: 'primary', assignee_name: 'Anna Kowalska', is_override: false }],
}

const calendar: CalendarData = {
  starts_on: '2026-09-21',
  ends_on: '2026-09-21',
  days: [{ service_date: '2026-09-21', weekday: 'pon', is_day_off: false, holiday_name: null, published: false, events: [] }],
  members: [
    { id: 'm1', display_name: 'Anna Kowalska' },
    { id: 'm2', display_name: 'Marek Nowak' },
  ],
  team_has_members: true,
  assignments: [],
  availability: [],
}

const impact: DraftFairnessImpact = {
  schedule_id: 'd1',
  schedule_version: 1,
  baseline_as_of: '2026-09-20',
  projected_as_of: '2026-09-21',
  baseline_members: [],
  projected_members: [balance('m1', 'Anna Kowalska', -0.5), balance('m2', 'Marek Nowak', 14.01)],
  late_shift_balanced: false,
  criterion_points: 3,
  criterion_met: true,
  spreads: [],
  acceptance_floor: null,
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('DraftScheduleMatrix correction', () => {
  it('writes the balance change with a decimal comma and names the day as every screen does', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(calendar)
    vi.spyOn(api, 'draftFairnessImpact').mockResolvedValue(impact)
    renderScreen(<DraftScheduleMatrix result={draft} onChange={() => {}} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Marek Nowak, pon 21-09-2026, brak dyżuru' }))

    const box = await screen.findByText('Bilans PRIMARY: Marek Nowak')
    expect(box.closest('.box')).toHaveTextContent('+14,01 → +15,01 (+1 punkt)')
  })
})
