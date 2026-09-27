import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
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

  it('offers eligible, available people, least loaded first, and ends the rights on the exit date', async () => {
    const primaryFrom = (starts_on: string, ends_on: string | null = null) => [{ role: 'primary' as const, starts_on, ends_on }]
    vi.spyOn(api, 'calendar').mockImplementation(async (startsOn) => ({
      ...calendarWith(startsOn === '2026-09-21' ? [
        duty('2026-09-19', 's1', 1, 'm1'),
        duty('2026-10-05', 's1', 1, 'm1'),
        duty('2026-10-06', 's1', 1, 'm2'),
        duty('2026-10-07', 's1', 1, 'm2'),
        { ...duty('2026-10-08', 's1', 1, 'm3'), role: 'secondary' as const },
        { ...duty('2026-10-09', 's1', 1, 'm2'), member_id: null },
      ] : []),
      members: [
        { id: 'm1', display_name: 'Anna Kowalska', eligibility: everyRole },
        { id: 'm2', display_name: 'Marek Nowak', eligibility: everyRole },
        { id: 'm3', display_name: 'Beata Lis', eligibility: everyRole },
        { id: 'm4', display_name: 'Adam Wolski', eligibility: everyRole },
        { id: 'm5', display_name: 'Ewa Secondary', eligibility: [{ role: 'secondary', starts_on: '2025-01-01', ends_on: null }] },
        { id: 'm6', display_name: 'Filip Później', eligibility: primaryFrom('2026-12-01') },
        { id: 'm7', display_name: 'Gosia Wcześniej', eligibility: primaryFrom('2025-01-01', '2026-09-25') },
        { id: 'm8', display_name: 'Hania Bez Uprawnień' },
        { id: 'm9', display_name: 'Iza Niedostępna', eligibility: everyRole },
      ],
      availability: startsOn === '2026-09-21' ? [
        { member_id: 'm9', kind: 'unavailable' as const, starts_on: '2026-10-01', ends_on: '2026-10-10', note: null },
        { member_id: 'm4', kind: 'prefer_not' as const, starts_on: '2026-10-05', ends_on: '2026-10-05', note: null },
        { member_id: 'm3', kind: 'unavailable' as const, starts_on: '2026-11-01', ends_on: '2026-11-02', note: null },
      ] : [],
    }))
    const batch = vi.spyOn(api, 'batchOverride').mockResolvedValue([])
    const remove = vi.spyOn(api, 'deleteEligibility').mockResolvedValue(undefined)
    const update = vi.spyOn(api, 'updateEligibility').mockResolvedValue({} as never)
    const finished = vi.spyOn(api, 'updateTeamMember').mockResolvedValue({} as never)
    const onDone = vi.fn()
    const member: TeamMember = {
      ...leaving,
      eligibility: [
        { id: 'e-open', role: 'primary', starts_on: '2025-01-01', ends_on: null },
        { id: 'e-future', role: 'secondary', starts_on: '2026-10-01', ends_on: null },
        { id: 'e-later', role: 'late_shift', starts_on: '2025-01-01', ends_on: '2026-12-31' },
        { id: 'e-past', role: 'secondary', starts_on: '2025-01-01', ends_on: '2026-06-30' },
      ],
    }
    renderScreen(<OffboardingDialog open member={member} activeUntil="2026-09-20" onClose={() => {}} onDone={onDone} />)

    expect(screen.getByRole('status', { name: 'Szukam przyszłych dyżurów' })).toBeInTheDocument()
    const picker = await screen.findByRole('combobox', { name: /05-10-2026 · PRIMARY/ })
    expect(screen.getAllByRole('combobox')).toHaveLength(1)
    expect(within(picker).getAllByRole('option').map((option) => option.textContent))
      .toEqual(['Wybierz zastępcę', 'Adam Wolski', 'Beata Lis', 'Marek Nowak'])

    const start = screen.getByRole('button', { name: 'Przepisz dyżury i zakończ rotację' })
    expect(start).toBeDisabled()
    fireEvent.change(picker, { target: { value: 'm4' } })
    fireEvent.click(start)
    expect(screen.getByText('Potwierdź przepisanie 1 dyżurów i zakończenie wszystkich uprawnień tej osoby z dniem 20-09-2026.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Potwierdź zakończenie rotacji' }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(batch).toHaveBeenCalledWith({
      schedule_id: 's1',
      expected_version: 1,
      assignments: [{ service_date: '2026-10-05', role: 'primary', replacement_member_id: 'm4' }],
      reason: 'Zakończenie rotacji Anna Kowalska',
      acknowledge_rule_violations: false,
    })
    expect(remove.mock.calls).toEqual([['e-future']])
    expect(update.mock.calls.map(([input]) => input)).toEqual([
      { id: 'e-open', input: { ends_on: '2026-09-20' } },
      { id: 'e-later', input: { ends_on: '2026-09-20' } },
    ])
    expect(finished).toHaveBeenCalledWith({ id: 'm1', input: { active_until: '2026-09-20' } })
  })

  it('ends a rotation without duties and shows why the save failed', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(calendarWith([]))
    vi.spyOn(api, 'updateTeamMember').mockRejectedValue(new ApiError('Brak uprawnień', 403))
    const onClose = vi.fn()
    renderScreen(<OffboardingDialog open member={leaving} activeUntil="2026-09-20" onClose={onClose} onDone={vi.fn()} />)

    expect(await screen.findByText('Brak dyżurów po dacie wyjścia; zakończenie rotacji nie wymaga przepisania.')).toBeInTheDocument()
    expect(screen.getByText(/Dyżury po 20-09-2026: 0\./)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Przepisz dyżury i zakończ rotację' }))
    fireEvent.click(screen.getByRole('button', { name: 'Potwierdź zakończenie rotacji' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Brak uprawnień')

    fireEvent.click(screen.getByRole('button', { name: 'Zamknij' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows a refused rewrite that names no rule as a plain failure', async () => {
    vi.spyOn(api, 'calendar').mockImplementation(async (startsOn) => calendarWith(
      startsOn === '2026-09-21' ? [duty('2026-10-05', 's2', 3, 'm1')] : [],
    ))
    const batch = vi.spyOn(api, 'batchOverride').mockRejectedValue(new ApiError('Grafik zmienił wersję', 409))
    renderScreen(<OffboardingDialog open member={leaving} activeUntil="2026-09-20" onClose={() => {}} onDone={vi.fn()} />)

    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'm2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Przepisz dyżury i zakończ rotację' }))
    fireEvent.click(screen.getByRole('button', { name: 'Potwierdź zakończenie rotacji' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Grafik zmienił wersję')
    expect(screen.queryByText('Przepisanie złamie reguły twarde')).not.toBeInTheDocument()
    expect(batch).toHaveBeenCalledTimes(1)
  })

  it('takes an acknowledgement back', async () => {
    vi.spyOn(api, 'calendar').mockImplementation(async (startsOn) => calendarWith(
      startsOn === '2026-09-21' ? [duty('2026-10-05', 's2', 3, 'm1')] : [],
    ))
    vi.spyOn(api, 'batchOverride').mockRejectedValue(new ApiError('Korekta złamie reguły', 409, [threeInSeven]))
    renderScreen(<OffboardingDialog open member={leaving} activeUntil="2026-09-20" onClose={() => {}} onDone={vi.fn()} />)

    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'm2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Przepisz dyżury i zakończ rotację' }))
    fireEvent.click(screen.getByRole('button', { name: 'Potwierdź zakończenie rotacji' }))
    const acknowledgement = await screen.findByRole('checkbox', { name: 'Rozumiem i świadomie łamię te reguły' })
    const confirm = screen.getByRole('button', { name: 'Potwierdź zakończenie rotacji' })
    await waitFor(() => expect(acknowledgement).toBeEnabled())

    fireEvent.click(acknowledgement)
    expect(confirm).toBeEnabled()
    fireEvent.click(acknowledgement)
    expect(acknowledgement).not.toBeChecked()
    expect(confirm).toBeDisabled()
  })

  it('reports a calendar that cannot be read', async () => {
    vi.spyOn(api, 'calendar').mockRejectedValue(new Error('Serwer niedostępny'))
    renderScreen(<OffboardingDialog open member={leaving} activeUntil="2026-09-20" onClose={() => {}} onDone={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Serwer niedostępny')
  })

  it('looks up no calendar for an exit date it cannot read', async () => {
    const calendar = vi.spyOn(api, 'calendar')
    renderScreen(<OffboardingDialog open member={leaving} activeUntil="wkrótce" onClose={() => {}} onDone={vi.fn()} />)
    expect(await screen.findByText('Brak dyżurów po dacie wyjścia; zakończenie rotacji nie wymaga przepisania.')).toBeInTheDocument()
    expect(calendar).not.toHaveBeenCalled()
  })
})
