import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderScreen } from '../test/render'
import { OffboardingDialog } from './OffboardingDialog'
import { ApiError, api } from '../api'
import type { CalendarData, TeamMember } from '../api'

const leaving: TeamMember = {
  id: 'm1',
  user_id: null,
  display_name: 'Anna Kowalska',
  active_from: '2025-01-01',
  active_until: null,
  eligibility: [],
}

const everyRole = [
  { role: 'primary' as const, starts_on: '2025-01-01', ends_on: null },
]

const duty = (service_date: string, schedule_id: string, schedule_version: number, member_id: string) => ({
  service_date,
  role: 'primary' as const,
  assignee_name: member_id === 'm1' ? 'Anna Kowalska' : 'Marek Nowak',
  is_override: false,
  schedule_id,
  schedule_version,
  member_id,
  change_kind: null,
})

const calendarWith = (assignments: CalendarData['assignments']): CalendarData => ({
  starts_on: '2026-09-21',
  ends_on: '2026-12-19',
  days: [],
  members: [
    { id: 'm1', display_name: 'Anna Kowalska', eligibility: everyRole },
    { id: 'm2', display_name: 'Marek Nowak', eligibility: everyRole },
  ],
  team_has_members: true,
  assignments,
  availability: [],
})

const threeInSeven = {
  rule: 'three_in_seven',
  message: 'Więcej niż 3 dyżury on-call w okresie 7 dni.',
  member_name: 'Marek Nowak',
  days: ['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'],
}

afterEach(() => vi.restoreAllMocks())

describe('OffboardingDialog', () => {
  it('lists the rules a rewrite would break and resends only the refused schedule once acknowledged', async () => {
    // Before the first attempt Anna holds a duty in each of two publications;
    // the first one is rewritten before the second is refused.
    let assignments = [duty('2026-09-22', 's1', 1, 'm1'), duty('2026-10-05', 's2', 3, 'm1')]
    vi.spyOn(api, 'calendar').mockImplementation(async (startsOn) => (
      calendarWith(startsOn === '2026-09-21' ? assignments : [])
    ))
    const batch = vi.spyOn(api, 'batchOverride')
      .mockImplementationOnce(async () => {
        assignments = [duty('2026-09-22', 's1', 2, 'm2'), duty('2026-10-05', 's2', 3, 'm1')]
        return []
      })
      .mockRejectedValueOnce(new ApiError(
        'Korekta złamie reguły twarde grafiku; potwierdź świadome naruszenie', 409, [threeInSeven],
      ))
      .mockResolvedValue([])
    const finished = vi.spyOn(api, 'updateTeamMember').mockResolvedValue({} as never)
    const onDone = vi.fn()
    renderScreen(
      <OffboardingDialog open member={leaving} activeUntil="2026-09-20" onClose={() => {}} onDone={onDone} />,
    )

    const pickers = await screen.findAllByRole('combobox')
    expect(pickers).toHaveLength(2)
    for (const picker of pickers) fireEvent.change(picker, { target: { value: 'm2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Przepisz dyżury i zakończ rotację' }))
    fireEvent.click(screen.getByRole('button', { name: 'Potwierdź zakończenie rotacji' }))

    expect(await screen.findByText('Przepisanie złamie reguły twarde')).toBeInTheDocument()
    expect(screen.getByText(/Więcej niż 3 dyżury on-call w okresie 7 dni/)).toBeInTheDocument()
    expect(batch.mock.calls.map(([input]) => [input.schedule_id, input.acknowledge_rule_violations]))
      .toEqual([['s1', false], ['s2', false]])
    expect(finished).not.toHaveBeenCalled()

    const confirm = screen.getByRole('button', { name: 'Potwierdź zakończenie rotacji' })
    const acknowledgement = screen.getByRole('checkbox', { name: 'Rozumiem i świadomie łamię te reguły' })
    // The rewritten schedule drops out once the calendar is read again.
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(1))
    expect(confirm).toBeDisabled()

    fireEvent.click(acknowledgement)
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(batch).toHaveBeenCalledTimes(3)
    expect(batch.mock.calls[2][0]).toMatchObject({
      schedule_id: 's2',
      expected_version: 3,
      acknowledge_rule_violations: true,
    })
  })

  it('drops the acknowledgement when a different replacement is picked', async () => {
    vi.spyOn(api, 'calendar').mockImplementation(async (startsOn) => calendarWith(
      startsOn === '2026-09-21' ? [duty('2026-10-05', 's2', 3, 'm1')] : [],
    ))
    vi.spyOn(api, 'batchOverride').mockRejectedValue(new ApiError(
      'Korekta złamie reguły twarde grafiku; potwierdź świadome naruszenie', 409, [threeInSeven],
    ))
    renderScreen(
      <OffboardingDialog open member={leaving} activeUntil="2026-09-20" onClose={() => {}} onDone={() => {}} />,
    )

    const picker = await screen.findByRole('combobox')
    fireEvent.change(picker, { target: { value: 'm2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Przepisz dyżury i zakończ rotację' }))
    fireEvent.click(screen.getByRole('button', { name: 'Potwierdź zakończenie rotacji' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Rozumiem i świadomie łamię te reguły' }))

    fireEvent.change(picker, { target: { value: '' } })
    fireEvent.change(picker, { target: { value: 'm2' } })

    expect(screen.queryByText('Przepisanie złamie reguły twarde')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /świadomie łamię/ })).not.toBeInTheDocument()
  })
})
