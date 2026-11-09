import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { useLocation } from 'react-router-dom'
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

function Location() {
  const location = useLocation()
  return <output aria-label="location">{location.pathname}{location.search}</output>
}

afterEach(() => vi.restoreAllMocks())

describe('OffboardingDialog', () => {
  it('checks every schedule and shows hard rules before the first rewrite', async () => {
    const assignments = [duty('2026-09-22', 's1', 1, 'm1'), duty('2026-10-05', 's2', 3, 'm1')]
    vi.spyOn(api, 'calendar').mockImplementation(async (startsOn) => (
      calendarWith(startsOn === '2026-09-21' ? assignments : [])
    ))
    const check = vi.spyOn(api, 'batchOverrideCheck').mockResolvedValue({ violations: [threeInSeven], ends_handover: null })
    const batch = vi.spyOn(api, 'batchOverride').mockResolvedValue([])
    const finished = vi.spyOn(api, 'updateTeamMember').mockResolvedValue({} as never)
    const onDone = vi.fn()
    renderScreen(
      <>
        <OffboardingDialog open member={leaving} activeUntil="2026-09-20" onClose={() => {}} onDone={onDone} onChanged={() => {}} />
        <Location />
      </>,
    )

    fireEvent.change(await screen.findByRole('combobox', { name: 'Ten sam zastępca dla wszystkich' }), { target: { value: 'm2' } })
    expect(screen.getByText('2 dyżury po 20-09-2026 dostaną zastępcę wybranego niżej, a kwalifikacje tej osoby skończą się z dniem 20-09-2026.')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /wt 22 wrz · PRIMARY/ })).toHaveValue('m2')
    expect(screen.getByRole('combobox', { name: /pon 5 paź · PRIMARY/ })).toHaveValue('m2')
    expect(screen.getByText('Zastępcy dostaną e-mail; operacja trafi do audytu jako „Zakończenie rotacji Anna Kowalska”.')).toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'Przepisz 2 dyżury i zakończ rotację' })
    expect(button).toHaveClass('btn-danger')
    fireEvent.click(button)

    expect(await screen.findByText('Przepisanie złamie reguły twarde')).toBeInTheDocument()
    expect(screen.getByText(/Więcej niż 3 dyżury on-call w okresie 7 dni/)).toBeInTheDocument()
    // One check for both schedules, so a rule spanning them is seen too.
    expect(check.mock.calls.map(([input]) => input.batches.map((item) => item.schedule_id)))
      .toEqual([['s1', 's2']])
    expect(batch).not.toHaveBeenCalled()
    expect(finished).not.toHaveBeenCalled()

    const acknowledgement = screen.getByRole('checkbox', { name: 'Rozumiem i świadomie łamię te reguły' })
    expect(button).toBeDisabled()
    fireEvent.click(acknowledgement)
    expect(button).toBeEnabled()
    fireEvent.click(button)

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    // The same button saved: the check is not repeated for the acknowledged picks.
    expect(check).toHaveBeenCalledTimes(1)
    expect(batch.mock.calls.map(([input]) => [input.schedule_id, input.acknowledge_rule_violations]))
      .toEqual([['s1', true], ['s2', true]])
    expect(await screen.findByText('Zakończono rotację: Anna Kowalska · przepisano 2 dyżury')).toBeInTheDocument()
    expect(screen.getByText('Marek Nowak ×2 · e-maile o zmianie wychodzą')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Otwórz grafik' }))
    expect(screen.getByLabelText('location')).toHaveTextContent('/grafik?od=2026-09-21')
  })

  it('says what was rewritten before a failure and checks only the rest on a retry', async () => {
    let assignments = [duty('2026-09-22', 's1', 1, 'm1'), duty('2026-10-05', 's2', 3, 'm1')]
    vi.spyOn(api, 'calendar').mockImplementation(async (startsOn) => (
      calendarWith(startsOn === '2026-09-21' ? assignments : [])
    ))
    const check = vi.spyOn(api, 'batchOverrideCheck').mockResolvedValue({ violations: [], ends_handover: null })
    const batch = vi.spyOn(api, 'batchOverride').mockImplementation(async (input) => {
      if (input.schedule_id === 's2' && input.expected_version === 3) {
        assignments = [duty('2026-09-22', 's1', 2, 'm2'), duty('2026-10-05', 's2', 4, 'm1')]
        throw new ApiError('Grafik zmienił się w międzyczasie', 409)
      }
      return []
    })
    vi.spyOn(api, 'updateTeamMember').mockResolvedValue({} as never)
    const onDone = vi.fn()
    renderScreen(
      <OffboardingDialog open member={leaving} activeUntil="2026-09-20" onClose={() => {}} onDone={onDone} onChanged={() => {}} />,
    )

    for (const picker of await screen.findAllByRole('combobox')) fireEvent.change(picker, { target: { value: 'm2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Przepisz 2 dyżury i zakończ rotację' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Grafik zmienił się w międzyczasie')
    expect(await screen.findByText('1 dyżur już przepisano. Kliknij ponownie, aby przepisać pozostałe i zakończyć rotację.'))
      .toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(1))

    fireEvent.click(screen.getByRole('button', { name: 'Przepisz 1 dyżur i zakończ rotację' }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    // The toast counts the duties of both attempts.
    expect(await screen.findByText('Zakończono rotację: Anna Kowalska · przepisano 2 dyżury')).toBeInTheDocument()
    expect(check.mock.calls.map(([input]) => input.batches.map((item) => item.schedule_id)))
      .toEqual([['s1', 's2'], ['s2']])
    expect(batch.mock.calls.map(([input]) => [input.schedule_id, input.expected_version]))
      .toEqual([['s1', 1], ['s2', 3], ['s2', 4]])
  })

  it('reloads the person after an eligibility call fails, so a retry ends only the periods left', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(calendarWith([]))
    const first = { id: 'e1', role: 'primary' as const, starts_on: '2026-10-01', ends_on: null }
    const second = { id: 'e2', role: 'secondary' as const, starts_on: '2026-10-01', ends_on: null }
    const remove = vi.spyOn(api, 'deleteEligibility')
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ApiError('Serwer niedostępny', 503))
      .mockResolvedValue(undefined)
    vi.spyOn(api, 'updateTeamMember').mockResolvedValue({} as never)
    const onDone = vi.fn()
    function Host() {
      const [member, setMember] = useState<TeamMember>({ ...leaving, eligibility: [first, second] })
      return (
        <OffboardingDialog
          open
          member={member}
          activeUntil="2026-09-20"
          onClose={() => {}}
          onDone={onDone}
          onChanged={() => setMember({ ...leaving, eligibility: [second] })}
        />
      )
    }
    renderScreen(<Host />)

    fireEvent.click(await screen.findByRole('button', { name: 'Zakończ rotację' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Serwer niedostępny')

    fireEvent.click(await screen.findByRole('button', { name: 'Zakończ rotację' }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(remove.mock.calls).toEqual([['e1'], ['e2'], ['e2']])
    // Nothing was rewritten, so the toast names no replacements.
    expect(await screen.findByText('Zakończono rotację: Anna Kowalska')).toBeInTheDocument()
    expect(screen.queryByText(/e-maile o zmianie/)).not.toBeInTheDocument()
  })

  it('drops the checked rules and acknowledgement when a different replacement is picked', async () => {
    vi.spyOn(api, 'calendar').mockImplementation(async (startsOn) => calendarWith(
      startsOn === '2026-09-21' ? [duty('2026-10-05', 's2', 3, 'm1')] : [],
    ))
    vi.spyOn(api, 'batchOverrideCheck').mockResolvedValue({ violations: [threeInSeven], ends_handover: null })
    renderScreen(
      <OffboardingDialog open member={leaving} activeUntil="2026-09-20" onClose={() => {}} onDone={() => {}} onChanged={() => {}} />,
    )

    const picker = await screen.findByRole('combobox')
    fireEvent.change(picker, { target: { value: 'm2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Przepisz 1 dyżur i zakończ rotację' }))
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
    const check = vi.spyOn(api, 'batchOverrideCheck').mockResolvedValue({ violations: [], ends_handover: null })
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
    renderScreen(<OffboardingDialog open member={member} activeUntil="2026-09-20" onClose={() => {}} onDone={onDone} onChanged={() => {}} />)

    expect(screen.getByRole('status', { name: 'Szukam przyszłych dyżurów…' })).toBeInTheDocument()
    const picker = await screen.findByRole('combobox', { name: /pon 5 paź · PRIMARY/ })
    // One duty needs no "the same replacement for all".
    expect(screen.getAllByRole('combobox')).toHaveLength(1)
    expect(within(picker).getAllByRole('option').map((option) => option.textContent))
      .toEqual(['Wybierz zastępcę', 'Adam Wolski (0 dyżurów)', 'Beata Lis (0 dyżurów)', 'Marek Nowak (0 dyżurów)'])

    const start = screen.getByRole('button', { name: 'Przepisz 1 dyżur i zakończ rotację' })
    expect(start).toBeDisabled()
    fireEvent.change(picker, { target: { value: 'm4' } })
    fireEvent.click(start)

    // No rule breaks, so the one click checks and saves.
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(check).toHaveBeenCalledWith({
      batches: [{
        schedule_id: 's1',
        assignments: [{ service_date: '2026-10-05', role: 'primary', replacement_member_id: 'm4' }],
      }],
    })
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

  it('gives everyone one replacement where they can take the duty, the least loaded first', async () => {
    vi.spyOn(api, 'calendar').mockImplementation(async (startsOn) => ({
      ...calendarWith(startsOn === '2026-09-21' ? [
        duty('2026-10-05', 's1', 1, 'm1'),
        duty('2026-10-06', 's1', 1, 'm2'),
        duty('2026-10-07', 's1', 1, 'm3'),
        duty('2026-10-08', 's1', 1, 'm2'),
        duty('2026-10-09', 's1', 1, 'm1'),
        // Outside the days rewritten here, so it does not count.
        duty('2026-11-20', 's1', 1, 'm4'),
      ] : []),
      members: [
        { id: 'm1', display_name: 'Anna Kowalska', eligibility: everyRole },
        { id: 'm2', display_name: 'Marek Nowak', eligibility: everyRole },
        { id: 'm3', display_name: 'Beata Lis', eligibility: everyRole },
        { id: 'm4', display_name: 'Adam Wolski', eligibility: everyRole },
      ],
      availability: startsOn === '2026-09-21'
        ? [{ member_id: 'm4', kind: 'unavailable' as const, starts_on: '2026-10-01', ends_on: '2026-10-06', note: null }]
        : [],
    }))
    renderScreen(<OffboardingDialog open member={leaving} activeUntil="2026-09-20" onClose={() => {}} onDone={vi.fn()} onChanged={() => {}} />)

    const all = await screen.findByRole('combobox', { name: 'Ten sam zastępca dla wszystkich' })
    expect(screen.getByText(/W nawiasie: ile dyżurów ma już każda osoba w dniach 5 – 9 paź; najmniej obciążeni są na górze\./)).toBeInTheDocument()
    expect(within(all).getAllByRole('option').map((option) => option.textContent))
      .toEqual(['Wybierz zastępcę', 'Adam Wolski (0 dyżurów)', 'Beata Lis (1 dyżur)', 'Marek Nowak (2 dyżury)'])
    const first = screen.getByRole('combobox', { name: /pon 5 paź · PRIMARY/ })
    const second = screen.getByRole('combobox', { name: /pt 9 paź · PRIMARY/ })
    expect(within(first).getAllByRole('option').map((option) => option.textContent))
      .toEqual(['Wybierz zastępcę', 'Beata Lis (1 dyżur)', 'Marek Nowak (2 dyżury)'])

    // Adam is away on the 5th: that duty keeps its own pick.
    fireEvent.change(all, { target: { value: 'm4' } })
    expect(first).toHaveValue('')
    expect(second).toHaveValue('m4')
    expect(all).toHaveValue('')
    fireEvent.change(all, { target: { value: 'm3' } })
    expect(first).toHaveValue('m3')
    expect(second).toHaveValue('m3')
    expect(all).toHaveValue('m3')
    fireEvent.change(second, { target: { value: 'm2' } })
    expect(all).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Przepisz 2 dyżury i zakończ rotację' })).toBeEnabled()
  })

  it('ends a rotation without duties and shows why the save failed', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(calendarWith([]))
    vi.spyOn(api, 'updateTeamMember').mockRejectedValue(new ApiError('Brak uprawnień', 403))
    const onClose = vi.fn()
    renderScreen(<OffboardingDialog open member={leaving} activeUntil="2026-09-20" onClose={onClose} onDone={vi.fn()} onChanged={() => {}} />)

    expect(await screen.findByText('Brak dyżurów po dacie wyjścia; zakończenie rotacji nie wymaga przepisania.')).toBeInTheDocument()
    expect(screen.getByText('Kwalifikacje tej osoby skończą się z dniem 20-09-2026.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Zakończ rotację' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Brak uprawnień')

    fireEvent.click(screen.getByRole('button', { name: 'Zamknij' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('stops before every write when the rule check fails', async () => {
    vi.spyOn(api, 'calendar').mockImplementation(async (startsOn) => calendarWith(
      startsOn === '2026-09-21' ? [duty('2026-10-05', 's2', 3, 'm1')] : [],
    ))
    vi.spyOn(api, 'batchOverrideCheck').mockRejectedValue(new ApiError('Nie sprawdzono reguł', 503))
    const batch = vi.spyOn(api, 'batchOverride')
    renderScreen(<OffboardingDialog open member={leaving} activeUntil="2026-09-20" onClose={() => {}} onDone={vi.fn()} onChanged={() => {}} />)

    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'm2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Przepisz 1 dyżur i zakończ rotację' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Nie sprawdzono reguł')
    expect(screen.queryByText('Przepisanie złamie reguły twarde')).not.toBeInTheDocument()
    expect(batch).not.toHaveBeenCalled()
  })

  it('takes an acknowledgement back', async () => {
    vi.spyOn(api, 'calendar').mockImplementation(async (startsOn) => calendarWith(
      startsOn === '2026-09-21' ? [duty('2026-10-05', 's2', 3, 'm1')] : [],
    ))
    vi.spyOn(api, 'batchOverrideCheck').mockResolvedValue({ violations: [threeInSeven], ends_handover: null })
    renderScreen(<OffboardingDialog open member={leaving} activeUntil="2026-09-20" onClose={() => {}} onDone={vi.fn()} onChanged={() => {}} />)

    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'm2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Przepisz 1 dyżur i zakończ rotację' }))
    const acknowledgement = await screen.findByRole('checkbox', { name: 'Rozumiem i świadomie łamię te reguły' })
    const confirm = screen.getByRole('button', { name: 'Przepisz 1 dyżur i zakończ rotację' })
    await waitFor(() => expect(acknowledgement).toBeEnabled())

    fireEvent.click(acknowledgement)
    expect(confirm).toBeEnabled()
    fireEvent.click(acknowledgement)
    expect(acknowledgement).not.toBeChecked()
    expect(confirm).toBeDisabled()
  })

  it('writes nothing for an exit date before the entry', async () => {
    const entering: TeamMember = {
      ...leaving,
      active_from: '2026-11-16',
      eligibility: [{ id: 'e1', role: 'primary', starts_on: '2026-11-16', ends_on: null }],
    }
    const calendar = vi.spyOn(api, 'calendar')
    const removed = vi.spyOn(api, 'deleteEligibility')
    const finished = vi.spyOn(api, 'updateTeamMember')
    renderScreen(<OffboardingDialog open member={entering} activeUntil="2026-11-08" onClose={() => {}} onDone={vi.fn()} onChanged={() => {}} />)

    expect(screen.getByRole('alert')).toHaveTextContent('Data wyjścia 08-11-2026 jest przed wejściem do rotacji 16-11-2026. Zmień datę w polu „Wyjście do”.')
    expect(screen.queryByText(/Kwalifikacje tej osoby skończą się/)).not.toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'Zakończ rotację' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(calendar).not.toHaveBeenCalled()
    expect(removed).not.toHaveBeenCalled()
    expect(finished).not.toHaveBeenCalled()
  })

  it('reports a calendar that cannot be read', async () => {
    vi.spyOn(api, 'calendar').mockRejectedValue(new Error('Serwer niedostępny'))
    renderScreen(<OffboardingDialog open member={leaving} activeUntil="2026-09-20" onClose={() => {}} onDone={vi.fn()} onChanged={() => {}} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Serwer niedostępny')
  })

  it('looks up no calendar for an exit date it cannot read', async () => {
    const calendar = vi.spyOn(api, 'calendar')
    renderScreen(<OffboardingDialog open member={leaving} activeUntil="wkrótce" onClose={() => {}} onDone={vi.fn()} onChanged={() => {}} />)
    expect(await screen.findByText('Brak dyżurów po dacie wyjścia; zakończenie rotacji nie wymaga przepisania.')).toBeInTheDocument()
    expect(calendar).not.toHaveBeenCalled()
  })
})
