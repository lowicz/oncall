import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderScreen } from '../test/render'
import { GeneratorPanel } from './Generator'
import { api } from '../api'
import type { DraftSchedule, ScheduleRun, ScheduleSummary, SchedulingPolicy } from '../api'

const policy: SchedulingPolicy = {
  rotation_mode: 'hybrid',
  fairness_weight: 3,
  continuity_weight: 1,
  preference_weight: 2,
  late_shift_anchor: 'secondary',
  solve_seconds: 15,
  time_budget_seconds: 60,
  updated_at: '2026-09-01T10:00:00Z',
}

const summary = (over: Partial<ScheduleSummary> & { id: string }): ScheduleSummary => ({
  name: 'Szkic 2026-09-17',
  starts_on: '2026-09-17',
  ends_on: '2026-10-01',
  status: 'draft',
  version: 1,
  rotation_mode: 'hybrid',
  solver_status: 'OPTIMAL',
  assignment_count: 41,
  created_at: '2026-09-02T10:00:00Z',
  ...over,
})

const draft = (over: Partial<DraftSchedule> & { id: string }): DraftSchedule => ({
  name: 'Szkic 2026-09-17',
  starts_on: '2026-09-17',
  ends_on: '2026-09-18',
  status: 'draft',
  version: 1,
  rotation_mode: 'hybrid',
  solver_status: 'OPTIMAL',
  acceptance_floor: null,
  assignments: [],
  ...over,
})

const run = (over: Partial<ScheduleRun> & { id: string }): ScheduleRun => ({
  status: 'running',
  progress: 30,
  schedule_id: null,
  error: null,
  conflicts: null,
  created_at: new Date(Date.now() - 12_000).toISOString(),
  solve_seconds: 15,
  queue_position: 0,
  estimated_start_seconds: null,
  ...over,
})

function stub(drafts: ScheduleSummary[], runs: ScheduleRun[] = []) {
  vi.spyOn(api, 'activeRuns').mockResolvedValue(runs)
  vi.spyOn(api, 'schedulingPolicy').mockResolvedValue(policy)
  vi.spyOn(api, 'draftSchedules').mockResolvedValue(drafts)
  vi.spyOn(api, 'suggestedScheduleRange').mockResolvedValue({
    first_uncovered: '2026-09-21',
    starts_on: '2026-09-21',
    ends_on: '2026-10-18',
  })
  vi.spyOn(api, 'calendar').mockResolvedValue({
    starts_on: '2026-09-17',
    ends_on: '2026-09-18',
    days: [],
    members: [],
    assignments: [],
    availability: [],
  })
  vi.spyOn(api, 'draftFairnessImpact').mockResolvedValue({
    schedule_id: 'd1',
    schedule_version: 1,
    baseline_as_of: '2026-09-16',
    projected_as_of: '2026-09-18',
    baseline_members: [],
    projected_members: [],
    late_shift_balanced: false,
    criterion_points: 3,
    criterion_met: true,
    spreads: [],
    acceptance_floor: null,
  })
}

afterEach(() => vi.restoreAllMocks())

describe('GeneratorPanel draft persistence', () => {
  it('uses the server range when there is no calendar deep link', async () => {
    stub([])
    renderScreen(<GeneratorPanel />)

    await waitFor(() => {
      expect(document.querySelector('#generator-from')).toHaveValue('2026-09-21')
      expect(document.querySelector('#generator-to')).toHaveValue('2026-10-18')
    })
  })

  it('keeps an explicit calendar range instead of requesting a suggestion', async () => {
    stub([])
    renderScreen(<GeneratorPanel />, { route: '/generator?od=2026-09-08&do=2026-10-11' })

    await waitFor(() => {
      expect(document.querySelector('#generator-from')).toHaveValue('2026-09-08')
      expect(document.querySelector('#generator-to')).toHaveValue('2026-10-11')
    })
    expect(api.suggestedScheduleRange).not.toHaveBeenCalled()
  })

  it('generates for the range the coordinator edits, not the suggested one', async () => {
    stub([])
    const generate = vi
      .spyOn(api, 'generateSchedule')
      .mockResolvedValue(draft({ id: 'd1', starts_on: '2026-09-22', ends_on: '2026-10-18' }))
    renderScreen(<GeneratorPanel />)

    await waitFor(() => expect(document.querySelector('#generator-from')).toHaveValue('2026-09-21'))
    fireEvent.change(screen.getByLabelText(/^Od/), { target: { value: '2026-09-22' } })
    await waitFor(() => expect(document.querySelector('#generator-from')).toHaveValue('2026-09-22'))

    fireEvent.click(screen.getByRole('button', { name: 'Utwórz szkic' }))
    await waitFor(() =>
      expect(generate).toHaveBeenCalledWith(
        { starts_on: '2026-09-22', ends_on: '2026-10-18' },
        expect.anything(),
      ),
    )
  })

  it('lists drafts that already exist instead of opening on an empty form', async () => {
    stub([summary({ id: 'd1' }), summary({ id: 'd2', status: 'proposed' })])
    renderScreen(<GeneratorPanel />)
    expect(await screen.findByText('Szkice', { selector: 'h2' })).toBeInTheDocument()
    // The heading renders before the listing query settles.
    expect(await screen.findAllByRole('button', { name: 'Otwórz' })).toHaveLength(2)
    expect(screen.getByText('Do akceptacji')).toBeInTheDocument()
  })

  it('reopens a draft by id, which is what survives a page reload', async () => {
    stub([summary({ id: 'd1' })])
    const fetchOne = vi.spyOn(api, 'schedule').mockResolvedValue(draft({ id: 'd1' }))
    renderScreen(<GeneratorPanel />)

    fireEvent.click(await screen.findByRole('button', { name: 'Otwórz' }))
    await waitFor(() => expect(fetchOne).toHaveBeenCalledWith('d1'))
    expect(await screen.findByText('CP-SAT: OPTIMAL')).toBeInTheDocument()
  })

  it('shows the lifecycle and who acts at each stage', async () => {
    stub([summary({ id: 'd1' })])
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({ id: 'd1', status: 'proposed' }))
    renderScreen(<GeneratorPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Otwórz' }))

    expect(await screen.findByText('koordynator poprawia')).toBeInTheDocument()
    expect(screen.getByText('koordynator akceptuje')).toBeInTheDocument()
    expect(screen.getByText('widoczny dla zespołu')).toBeInTheDocument()
    // A proposal offers publication, not another hand-off.
    expect(await screen.findByRole('button', { name: /^Publikuj…/ })).toBeInTheDocument()
  })

  it('explains a solver status that is not a full solution', async () => {
    stub([summary({ id: 'd1', solver_status: 'INFEASIBLE' })])
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({ id: 'd1', solver_status: 'INFEASIBLE' }))
    renderScreen(<GeneratorPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Otwórz' }))
    expect(await screen.findByText(/Solver nie znalazł pełnego rozwiązania/)).toBeInTheDocument()
  })

  it('keeps the settings in a drawer, out of the way', async () => {
    stub([])
    renderScreen(<GeneratorPanel />)
    expect(await screen.findByRole('button', { name: /Ustawienia generatora/ })).toBeInTheDocument()
    // Collapsed, so the weight inputs are not in the accessibility tree.
    expect(screen.queryByRole('spinbutton', { name: /Równy udział/ })).not.toBeInTheDocument()
  })

  it('names the saved settings the next generation will use', async () => {
    stub([])
    renderScreen(<GeneratorPanel />)
    expect(await screen.findByText(/Zapisane ustawienia: Hybrydowy/)).toBeInTheDocument()
  })

  it('offers a hint rather than an empty panel when there are no drafts', async () => {
    stub([])
    renderScreen(<GeneratorPanel />)
    expect(await screen.findByText(/Brak szkiców/)).toBeInTheDocument()
  })
})

describe('GeneratorPanel transitions', () => {
  it('links the open draft in the URL so it can be shared and reloaded', async () => {
    stub([summary({ id: 'd1' })])
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({ id: 'd1' }))
    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })
    // Opened straight from the URL, with no click.
    expect(await screen.findByText('CP-SAT: OPTIMAL')).toBeInTheDocument()
    expect(api.schedule).toHaveBeenCalledWith('d1')
  })

  it('does not serve a stale status after handing a draft over', async () => {
    stub([summary({ id: 'd1' })])
    const fetchOne = vi.spyOn(api, 'schedule')
      .mockResolvedValueOnce(draft({ id: 'd1', status: 'draft' }))
      .mockResolvedValue(draft({ id: 'd1', status: 'proposed', version: 2 }))
    vi.spyOn(api, 'proposeSchedule')
      .mockResolvedValue(draft({ id: 'd1', status: 'proposed', version: 2 }))

    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })
    fireEvent.click(await screen.findByRole('button', { name: 'Przekaż do akceptacji' }))

    // The stepper must follow the server, not the pre-transition cache entry.
    expect(await screen.findByRole('button', { name: /^Publikuj…/ })).toBeInTheDocument()
    await waitFor(() => expect(fetchOne).toHaveBeenCalledTimes(2))
  })

  it('shows lost changes and acknowledges them when publishing', async () => {
    stub([summary({ id: 'd1', status: 'proposed', version: 2 })])
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({ id: 'd1', status: 'proposed', version: 2 }))
    vi.spyOn(api, 'publishPreview').mockResolvedValue({
      lost_changes: [{
        service_date: '2026-09-17',
        role: 'primary',
        previous_assignee_name: 'Anna Kowalska',
        new_assignee_name: 'Marek Nowak',
        source: 'override',
        original_assignee_name: 'Ola Wiśniewska',
        reason: 'Nowy szkic ma w tym slocie innego pierwotnego wykonawcę',
      }],
      carried_changes: [],
      pending_swaps: [{
        id: 's1',
        service_date: '2026-09-18',
        role: 'secondary',
        requester_name: 'Ola Wiśniewska',
        replacement_name: 'Anna Kowalska',
        status: 'pending_coordinator',
      }],
      uncovered_before: ['2026-09-16'],
      stale_changes_count: 2,
      rest_violations: [{
        rule: 'three_in_seven',
        message: 'Więcej niż 3 dyżury on-call w okresie 7 dni.',
        member_name: 'Anna Kowalska',
        days: ['2026-09-14', '2026-09-15', '2026-09-17', '2026-09-18'],
      }],
    })
    const publish = vi.spyOn(api, 'publishSchedule').mockResolvedValue(
      draft({ id: 'd1', status: 'published', version: 3 }),
    )

    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })
    fireEvent.click(await screen.findByRole('button', { name: /^Publikuj…/ }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('Rozstrzygnij konflikty ze zmianami')).toBeInTheDocument()
    expect(within(dialog).getByText(/zmiana Anna Kowalska, szkic Marek Nowak/)).toBeInTheDocument()
    expect(within(dialog).getByText('Te oczekujące zamiany zostaną anulowane')).toBeInTheDocument()
    expect(within(dialog).getByText('Przed grafikiem pozostanie luka')).toBeInTheDocument()
    expect(within(dialog).getByText(/Szkic nieaktualny: od wygenerowania zmieniło się 2 wpisów/))
      .toBeInTheDocument()
    expect(within(dialog).getByText('Publikacja naruszy reguły odpoczynku')).toBeInTheDocument()

    fireEvent.change(within(dialog).getByLabelText('Decyzja'), { target: { value: 'draft' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publikuj v2' }))
    await waitFor(() => expect(publish.mock.calls[0][0]).toEqual({
      id: 'd1',
      expectedVersion: 2,
      acknowledgeLostChanges: true,
      acknowledgeGap: true,
      acknowledgeRestViolations: true,
      changeResolutions: { '2026-09-17:primary': 'draft' },
    }))
  })
})

describe('GeneratorPanel draft deletion', () => {
  it('asks before discarding and then removes the draft', async () => {
    stub([summary({ id: 'd1' })])
    const remove = vi.spyOn(api, 'deleteSchedule').mockResolvedValue(undefined)
    renderScreen(<GeneratorPanel />)

    fireEvent.click(await screen.findByRole('button', { name: /Usuń szkic/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/nie da się cofnąć/)).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Usuń' }))
    await waitFor(() => expect(remove).toHaveBeenCalled())
    expect(remove.mock.calls[0][0]).toBe('d1')
  })

  it('does not delete anything when the confirmation is dismissed', async () => {
    stub([summary({ id: 'd1' })])
    const remove = vi.spyOn(api, 'deleteSchedule').mockResolvedValue(undefined)
    renderScreen(<GeneratorPanel />)

    fireEvent.click(await screen.findByRole('button', { name: /Usuń szkic/ }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Anuluj' }))
    expect(remove).not.toHaveBeenCalled()
  })

  it('closes the open draft and drops it from the URL once deleted', async () => {
    stub([summary({ id: 'd1' })])
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({ id: 'd1' }))
    vi.spyOn(api, 'deleteSchedule').mockResolvedValue(undefined)
    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })

    expect(await screen.findByText('CP-SAT: OPTIMAL')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: /Usuń szkic/ }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Usuń' }))

    await waitFor(() => expect(screen.queryByText('CP-SAT: OPTIMAL')).not.toBeInTheDocument())
  })
})

describe('GeneratorPanel hard unavailability conflicts', () => {
  const conflicted = draft({
    id: 'd1',
    solver_status: 'FEASIBLE',
    unavailability_conflicts: [
      { service_date: '2026-11-03', role: 'primary', assignee_name: 'Anna Kowalska' },
      { service_date: '2026-11-04', role: 'secondary', assignee_name: 'Anna Kowalska' },
    ],
  })

  it('banners the conflict instead of claiming every hard rule is satisfied', async () => {
    stub([summary({ id: 'd1' })])
    vi.spyOn(api, 'schedule').mockResolvedValue(conflicted)
    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })

    expect(
      await screen.findByText(/1 osoba ma dyżur w dniu zgłoszonej niedostępności/),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Grafik spełnia wszystkie reguły twarde/)).not.toBeInTheDocument()
    // The problems table lists both conflicts by person, with a way to the cell.
    expect(screen.getAllByText('Dyżur w dniu „nie mogę”')).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Popraw' })).toHaveLength(2)
  })

  it('blocks the hand-off with a stated reason instead of letting the API answer 409', async () => {
    stub([summary({ id: 'd1' })])
    vi.spyOn(api, 'schedule').mockResolvedValue(conflicted)
    const propose = vi.spyOn(api, 'proposeSchedule')
    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })

    const button = await screen.findByRole('button', { name: 'Przekaż do akceptacji' })
    expect(button).toBeDisabled()
    expect(
      screen.getByText('Najpierw usuń dyżury w dniach zgłoszonej niedostępności'),
    ).toBeInTheDocument()
    expect(propose).not.toHaveBeenCalled()
  })

  it('leaves the hand-off available when nothing conflicts', async () => {
    stub([summary({ id: 'd1' })])
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({ id: 'd1', solver_status: 'FEASIBLE' }))
    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })

    expect(await screen.findByRole('button', { name: 'Przekaż do akceptacji' })).toBeEnabled()
    expect(screen.getByText(/Sprawiedliwość: najlepsza znaleziona/)).toBeInTheDocument()
  })
})

describe('GeneratorPanel warnings', () => {
  it('keeps the solver own warning apart from a broken hard rule', async () => {
    stub([summary({ id: 'd1' })])
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({
      id: 'd1',
      warnings: [
        {
          source: 'solver',
          message: 'Reguły rozrzedzania musiały zostać zawieszone, bo przy tej '
            + 'obsadzie i nieobecnościach nie da się ich spełnić.',
        },
        {
          source: 'rules',
          message: 'Anna Kowalska: Więcej niż 3 kolejne dni dyżuru on-call. '
            + 'Dni: 07-09-2026, 08-09-2026, 09-09-2026, 10-09-2026.',
        },
      ],
    }))
    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })

    expect(await screen.findByText('Ostrzeżenie solvera')).toBeInTheDocument()
    expect(screen.getByText('Złamana reguła twarda')).toBeInTheDocument()
    expect(screen.getByText(/Reguły rozrzedzania musiały zostać zawieszone/)).toBeInTheDocument()
    // Names and dates, not a bare rule sentence, and no word about corrections.
    expect(screen.getByText(/Anna Kowalska: .*Dni: 07-09-2026/)).toBeInTheDocument()
    expect(screen.queryByText(/Korekta/)).not.toBeInTheDocument()
  })
})

describe('GeneratorPanel resuming a generation', () => {
  it('rejoins a run that was already going when the page loaded', async () => {
    stub([], [run({ id: 'r1' })])
    const follow = vi.spyOn(api, 'followRun').mockImplementation(
      (_id, onProgress) => {
        onProgress?.(run({ id: 'r1' }))
        return new Promise(() => {})
      },
    )
    renderScreen(<GeneratorPanel />)

    expect(await screen.findByText(/nie uruchamiaj go drugi raz/)).toBeInTheDocument()
    expect(follow.mock.calls[0][0]).toBe('r1')
    // The button that would start a second, indistinguishable draft is off.
    expect(screen.getByRole('button', { name: 'Generuję…' })).toBeDisabled()
  })

  it('counts the seconds and names the per-pass budget', async () => {
    stub([], [run({ id: 'r1' })])
    vi.spyOn(api, 'followRun').mockImplementation((_id, onProgress) => {
      onProgress?.(run({ id: 'r1' }))
      return new Promise(() => {})
    })
    renderScreen(<GeneratorPanel />)

    // Not „budżet do 15 s": a hard model is solved several times over, so the
    // counter legitimately passes the number next to it.
    expect(await screen.findByText(/budżet 15 s na jeden przebieg/)).toBeInTheDocument()
  })

  it('leaves the form alone when nothing is running', async () => {
    stub([])
    const follow = vi.spyOn(api, 'followRun')
    renderScreen(<GeneratorPanel />)

    expect(await screen.findByRole('button', { name: 'Utwórz szkic' })).toBeEnabled()
    expect(follow).not.toHaveBeenCalled()
  })

  it('tells a waiting coordinator the queue position and the start estimate', async () => {
    const queued = run({
      id: 'r1',
      status: 'queued',
      progress: 0,
      queue_position: 1,
      estimated_start_seconds: 40,
    })
    stub([], [queued])
    vi.spyOn(api, 'followRun').mockImplementation((_id, onProgress) => {
      onProgress?.(queued)
      return new Promise(() => {})
    })
    renderScreen(<GeneratorPanel />)

    expect(
      await screen.findByText(/W kolejce: 1 zadanie przed Tobą, szacowany start za około 40 s/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'W kolejce…' })).toBeDisabled()
  })
})

describe('GeneratorPanel solver time budget', () => {
  it('offers the control the UNKNOWN message sends the coordinator to', async () => {
    stub([])
    const save = vi.spyOn(api, 'updateSchedulingPolicy')
      .mockResolvedValue({ ...policy, solve_seconds: 45 })
    renderScreen(<GeneratorPanel />)

    fireEvent.click(await screen.findByRole('button', { name: /Ustawienia generatora/ }))
    const field = await screen.findByRole('spinbutton', { name: /Budżet czasu na przebieg/ })
    expect(field).toHaveValue(15)

    fireEvent.change(field, { target: { value: '45' } })
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz ustawienia generowania' }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0][0]).toMatchObject({ solve_seconds: 45 })
  })

  it('keeps the save button off while the budget matches what is stored', async () => {
    stub([])
    renderScreen(<GeneratorPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /Ustawienia generatora/ }))
    await screen.findByRole('spinbutton', { name: /Budżet czasu na przebieg/ })
    expect(
      screen.getByRole('button', { name: 'Zapisz ustawienia generowania' }),
    ).toBeDisabled()
  })

  it('names the whole-run ceiling next to the per-pass budget', async () => {
    stub([])
    renderScreen(<GeneratorPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /Ustawienia generatora/ }))
    const field = await screen.findByRole('spinbutton', { name: /Budżet czasu na przebieg/ })

    expect(screen.getByText(/górny limit całego generowania to około 60 s/)).toBeInTheDocument()
    fireEvent.change(field, { target: { value: '30' } })
    expect(screen.getByText(/górny limit całego generowania to około 120 s/)).toBeInTheDocument()
  })
})
