import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderScreen } from '../test/render'
import { GeneratorPanel } from './Generator'
import { api, ApiError } from '../api'
import type { DraftSchedule, ScheduleRun, ScheduleSummary, SchedulingPolicy } from '../api'

const policy: SchedulingPolicy = {
  rotation_mode: 'hybrid',
  fairness_weight: 3,
  continuity_weight: 1,
  preference_weight: 2,
  late_shift_anchor: 'secondary',
  solve_seconds: 15,
  time_budget_seconds: 60,
  coordinator_swap_approval_required: true,
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
    team_has_members: false,
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

  it('uses the server range when the linked dates do not exist', async () => {
    stub([])
    renderScreen(<GeneratorPanel />, { route: '/generator?od=2026-13-45&do=2026-02-30' })

    await waitFor(() => {
      expect(document.querySelector('#generator-from')).toHaveValue('2026-09-21')
      expect(document.querySelector('#generator-to')).toHaveValue('2026-10-18')
    })
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

  it('points the empty draft list at the new-draft form above it', async () => {
    stub([])
    renderScreen(<GeneratorPanel />)
    const hint = await screen.findByText('Utwórz nowy, wybierając zakres dat powyżej.')
    const form = screen.getByRole('form', { name: 'Nowy szkic' })
    expect(form.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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
    expect(within(dialog).getByText('Szkic nieaktualny: od wygenerowania zmieniły się 2 wpisy.'))
      .toBeInTheDocument()
    expect(within(dialog).getByText(/w tym zakresie zostanie anulowana\.$/)).toBeInTheDocument()
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

describe('GeneratorPanel swap approval switch', () => {
  it('saves the coordinator approval of swaps as a policy field, off or on', async () => {
    stub([])
    const save = vi.spyOn(api, 'updateSchedulingPolicy')
      .mockResolvedValue({ ...policy, coordinator_swap_approval_required: false })
    renderScreen(<GeneratorPanel />)

    fireEvent.click(await screen.findByRole('button', { name: /Ustawienia generatora/ }))
    const toggle = await screen.findByRole('checkbox', { name: /Zamiana dyżuru wymaga zatwierdzenia koordynatora/ })
    expect(toggle).toBeChecked()
    expect(screen.getByRole('button', { name: 'Zapisz ustawienia generowania' })).toBeDisabled()

    fireEvent.click(toggle)
    expect(toggle).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz ustawienia generowania' }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0][0]).toMatchObject({ coordinator_swap_approval_required: false })
    // The stored value comes back off, so the form is clean again.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Zapisz ustawienia generowania' })).toBeDisabled())
    expect(screen.getByRole('checkbox', { name: /Zamiana dyżuru wymaga zatwierdzenia koordynatora/ })).not.toBeChecked()
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

describe('GeneratorPanel queue and progress', () => {
  it.each([
    ['waits for a free worker when the run has no place in the queue yet', 0, 'Zadanie oczekuje na wolny proces generatora.'],
    ['names the place in the queue without an estimate when none is known', 2, 'W kolejce: 2 zadania przed Tobą.'],
  ])('%s', async (_, position, sentence) => {
    const queued = run({ id: 'r1', status: 'queued', progress: 0, queue_position: position, estimated_start_seconds: null })
    stub([], [queued])
    vi.spyOn(api, 'followRun').mockImplementation((_id, onProgress) => {
      onProgress?.(queued)
      return new Promise(() => {})
    })
    renderScreen(<GeneratorPanel />)

    expect(await screen.findByText(sentence)).toBeInTheDocument()
    expect(screen.getByText('Zadanie w kolejce workera.')).toBeInTheDocument()
  })

  it('starts with an empty bar before the worker reports anything', async () => {
    stub([])
    const generate = vi.spyOn(api, 'generateSchedule').mockReturnValue(new Promise(() => {}))
    renderScreen(<GeneratorPanel />)
    await waitFor(() => expect(document.querySelector('#generator-from')).toHaveValue('2026-09-21'))

    fireEvent.click(screen.getByRole('button', { name: 'Utwórz szkic' }))
    expect(await screen.findByRole('progressbar', { name: 'Postęp generowania' })).toHaveAttribute('aria-valuenow', '0')
    expect(screen.getByRole('heading', { level: 1, name: 'Generuję 21 wrz – 18 paź' })).toBeInTheDocument()
    expect(screen.getByText('Solver pracuje poza procesem API.')).toBeInTheDocument()
    expect(screen.queryByText(/na jeden przebieg solvera/)).not.toBeInTheDocument()
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('moves to the fairness step once the solver is done and names the gap before the draft', async () => {
    stub([])
    vi.spyOn(api, 'generateSchedule').mockImplementation((_input, onProgress) => {
      onProgress?.(run({ id: 'r1', status: 'completed', progress: 90, uncovered_before: ['2026-09-19', '2026-09-20'] }))
      return new Promise(() => {})
    })
    renderScreen(<GeneratorPanel />)
    await waitFor(() => expect(document.querySelector('#generator-from')).toHaveValue('2026-09-21'))

    fireEvent.click(screen.getByRole('button', { name: 'Utwórz szkic' }))
    expect(await screen.findByText('Przed początkiem szkicu pozostaje 2 nieobsadzonych dni: 19-09-2026, 20-09-2026.')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Postęp generowania' })).toHaveAttribute('aria-valuenow', '90')
    const steps = screen.getByRole('list', { name: 'Etap generowania' })
    expect(within(steps).getByText('sprawiedliwość')).toHaveAttribute('aria-current', 'step')
    expect(within(steps).getByText('solver')).toHaveClass('step-done')
  })

  it('lists the reasons a generation failed', async () => {
    stub([])
    vi.spyOn(api, 'generateSchedule').mockImplementation(async (_input, onProgress) => {
      onProgress?.(run({ id: 'r1', status: 'failed', conflicts: ['Anna Kowalska: brak kwalifikacji PRIMARY'] }))
      throw new ApiError('Nie da się wygenerować grafiku', 409)
    })
    renderScreen(<GeneratorPanel />)
    await waitFor(() => expect(document.querySelector('#generator-from')).toHaveValue('2026-09-21'))

    fireEvent.click(screen.getByRole('button', { name: 'Utwórz szkic' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Nie da się wygenerować grafiku')
    expect(within(alert).getByRole('listitem')).toHaveTextContent('Anna Kowalska: brak kwalifikacji PRIMARY')
    expect(screen.getByRole('button', { name: 'Utwórz szkic' })).toBeEnabled()
  })

  it('lists the reasons a resumed generation failed', async () => {
    stub([], [run({ id: 'r1' })])
    vi.spyOn(api, 'followRun').mockImplementation(async (_id, onProgress) => {
      onProgress?.(run({ id: 'r1', status: 'failed', conflicts: ['Brak osób z kwalifikacją SECONDARY'] }))
      throw new ApiError('Generowanie nie powiodło się', 409)
    })
    renderScreen(<GeneratorPanel />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Generowanie nie powiodło się')
    expect(within(alert).getByRole('listitem')).toHaveTextContent('Brak osób z kwalifikacją SECONDARY')
    expect(screen.getByRole('button', { name: 'Utwórz szkic' })).toBeEnabled()
  })

  it('names a failure without a list when the run reported no conflicts', async () => {
    stub([])
    vi.spyOn(api, 'generateSchedule').mockRejectedValue(new ApiError('Worker niedostępny', 503))
    renderScreen(<GeneratorPanel />)
    await waitFor(() => expect(document.querySelector('#generator-from')).toHaveValue('2026-09-21'))

    fireEvent.click(screen.getByRole('button', { name: 'Utwórz szkic' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Worker niedostępny')
    expect(within(alert).queryByRole('list')).not.toBeInTheDocument()
  })
})

describe('GeneratorPanel range form', () => {
  it('warns when the range covers a single day', async () => {
    stub([])
    renderScreen(<GeneratorPanel />)
    await waitFor(() => expect(document.querySelector('#generator-to')).toHaveValue('2026-10-18'))
    expect(screen.queryByText('Zakres obejmuje jeden dzień.')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/^Do/), { target: { value: '2026-09-21' } })
    expect(await screen.findByText('Zakres obejmuje jeden dzień.')).toBeInTheDocument()
    expect(screen.getByText(/solver tylko obsadzi ten dzień/)).toBeInTheDocument()
  })

  it('offers to compare a daily and a weekly variant', async () => {
    stub([summary({ id: 'd1', rotation_mode: 'daily' }), summary({ id: 'd2', rotation_mode: 'weekly' })])
    renderScreen(<GeneratorPanel />)
    expect(await screen.findByRole('button', { name: /Porównaj wariant dzienny i tygodniowy/ })).toBeInTheDocument()
  })

  it('does not offer the comparison without both variants', async () => {
    stub([summary({ id: 'd1', rotation_mode: 'daily' }), summary({ id: 'd2', rotation_mode: 'hybrid' })])
    renderScreen(<GeneratorPanel />)
    expect(await screen.findAllByRole('button', { name: 'Otwórz' })).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /Porównaj wariant/ })).not.toBeInTheDocument()
  })
})

describe('GeneratorPanel open draft details', () => {
  const staffed = draft({
    id: 'd1',
    solver_status: 'FEASIBLE',
    fairness_proven: true,
    continuity_gap: 0.025,
    assignments: [
      { service_date: '2026-09-17', role: 'primary', assignee_name: 'Anna Kowalska', is_override: false },
      { service_date: '2026-09-17', role: 'secondary', assignee_name: 'Marek Nowak', is_override: false },
      { service_date: '2026-09-18', role: 'primary', assignee_name: 'Marek Nowak', is_override: false },
    ],
  })

  it('counts the staffed days and states a proven fairness with the solution gap', async () => {
    stub([summary({ id: 'd1' })])
    vi.spyOn(api, 'schedule').mockResolvedValue(staffed)
    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })

    expect(await screen.findByText('Obsada: 2 dni, 3 przydziały')).toBeInTheDocument()
    expect(screen.getByText(/wersja 1 · 3 przydziały w 2 dniach · Hybrydowy/)).toBeInTheDocument()
    expect(screen.getByText('Sprawiedliwość: optymalna (udowodniona). Jakość całego rozwiązania: luka 2,5%. Stan kryterium pokazuje panel obok.')).toBeInTheDocument()
  })

  it('says a conflict on a proposal can only be fixed by generating again', async () => {
    stub([summary({ id: 'd1', status: 'proposed' })])
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({
      id: 'd1',
      status: 'proposed',
      unavailability_conflicts: [{ service_date: '2026-09-17', role: 'primary', assignee_name: 'Anna Kowalska' }],
    }))
    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })
    expect(await screen.findByText('Szkic nie jest już edytowalny; wygeneruj go ponownie.')).toBeInTheDocument()
  })

  it('filters the problems from the risk chips and the hard-only switch', async () => {
    stub([summary({ id: 'd1' })])
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({
      id: 'd1',
      warnings: [
        { source: 'solver', message: 'Reguły rozrzedzania zawieszone.' },
        { source: 'rules', message: 'Anna Kowalska: więcej niż 3 dni z rzędu.' },
      ],
    }))
    // jsdom has no scrollIntoView; the chips scroll the problems table into view.
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    try {
      renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })
      expect(await screen.findByText('Reguły rozrzedzania zawieszone.')).toBeInTheDocument()
      const hardOnly = screen.getByRole('button', { name: 'Tylko twarde' })
      expect(hardOnly).toHaveAttribute('aria-pressed', 'false')

      fireEvent.click(screen.getByRole('button', { name: 'Reguły twarde: 1 naruszenie' }))
      expect(hardOnly).toHaveAttribute('aria-pressed', 'true')
      expect(hardOnly).toHaveClass('on')
      expect(screen.queryByText('Reguły rozrzedzania zawieszone.')).not.toBeInTheDocument()
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' })

      fireEvent.click(screen.getByRole('button', { name: '1 ostrzeżenie miękkie' }))
      expect(hardOnly).toHaveAttribute('aria-pressed', 'false')
      expect(screen.getByText('Reguły rozrzedzania zawieszone.')).toBeInTheDocument()

      fireEvent.click(hardOnly)
      expect(hardOnly).toHaveAttribute('aria-pressed', 'true')
      expect(screen.queryByText('Reguły rozrzedzania zawieszone.')).not.toBeInTheDocument()
    } finally {
      delete (Element.prototype as Partial<Element>).scrollIntoView
    }
  })

  it('shows unknown settings while the policy has not loaded', async () => {
    stub([summary({ id: 'd1' })])
    vi.spyOn(api, 'schedulingPolicy').mockReturnValue(new Promise(() => {}))
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({ id: 'd1' }))
    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })

    const budget = await screen.findByText('Budżet solvera')
    const settings = budget.closest('dl') as HTMLElement
    expect(within(settings).getAllByText('–')).toHaveLength(4)
    expect(within(settings).getByText('Ta sama osoba co SECONDARY')).toBeInTheDocument()
  })

  it('names the stored settings next to the proposal once the policy is known', async () => {
    stub([summary({ id: 'd1' })])
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({ id: 'd1' }))
    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })

    expect(await screen.findByText('15 s / przebieg')).toBeInTheDocument()
    const settings = screen.getByText('Budżet solvera').closest('dl') as HTMLElement
    expect(within(settings).queryByText('–')).not.toBeInTheDocument()
  })

  it('reports a draft that cannot be opened and opens it on retry', async () => {
    stub([summary({ id: 'd1' })])
    const fetchOne = vi.spyOn(api, 'schedule')
      .mockRejectedValueOnce(new ApiError('Szkic nie istnieje', 404))
      .mockResolvedValue(draft({ id: 'd1' }))
    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })

    expect(screen.getByText('Otwieranie szkicu…')).toBeInTheDocument()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Szkic nie istnieje')
    fireEvent.click(within(alert).getByRole('button', { name: 'Spróbuj ponownie' }))
    expect(await screen.findByText('CP-SAT: OPTIMAL')).toBeInTheDocument()
    expect(fetchOne).toHaveBeenCalledTimes(2)
  })
})

describe('GeneratorPanel lifecycle actions', () => {
  it('takes a proposal back to a draft', async () => {
    stub([summary({ id: 'd1', status: 'proposed', version: 2 })])
    vi.spyOn(api, 'schedule')
      .mockResolvedValueOnce(draft({ id: 'd1', status: 'proposed', version: 2 }))
      .mockResolvedValue(draft({ id: 'd1', status: 'draft', version: 3 }))
    const withdraw = vi.spyOn(api, 'withdrawSchedule').mockResolvedValue(draft({ id: 'd1', status: 'draft', version: 3 }))
    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })

    fireEvent.click(await screen.findByRole('button', { name: 'Wróć do szkicu' }))
    await waitFor(() => expect(withdraw).toHaveBeenCalledWith({ id: 'd1', expectedVersion: 2 }))
    expect(await screen.findByRole('button', { name: 'Przekaż do akceptacji' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Publikuj…/ })).not.toBeInTheDocument()
  })

  it('generates the open draft again over its own range', async () => {
    stub([summary({ id: 'd1' })])
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({ id: 'd1' }))
    const generate = vi.spyOn(api, 'generateSchedule').mockReturnValue(new Promise(() => {}))
    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })

    fireEvent.click(await screen.findByRole('button', { name: 'Generuj ponownie' }))
    await waitFor(() => expect(generate).toHaveBeenCalledWith({ starts_on: '2026-09-17', ends_on: '2026-09-18' }, expect.anything()))
    expect(await screen.findByRole('heading', { level: 1, name: 'Generuję 17 – 18 wrz' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generuj ponownie' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Przekaż do akceptacji' })).toBeDisabled()
  })

  it('titles a resumed generation with the open draft range', async () => {
    stub([summary({ id: 'd1' })], [run({ id: 'r1' })])
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({ id: 'd1' }))
    vi.spyOn(api, 'followRun').mockImplementation((_id, onProgress) => {
      onProgress?.(run({ id: 'r1' }))
      return new Promise(() => {})
    })
    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })

    expect(await screen.findByRole('heading', { level: 1, name: 'Generuję 17 – 18 wrz' })).toBeInTheDocument()
    expect(screen.getByText(/nie uruchamiaj go drugi raz/)).toBeInTheDocument()
  })
})

describe('GeneratorPanel settings drawer', () => {
  it('closes with its close button', async () => {
    stub([])
    renderScreen(<GeneratorPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /Ustawienia generatora/ }))
    expect(await screen.findByRole('dialog', { name: 'Ustawienia generatora' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Zamknij panel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('opens from the proposal settings with the draft range locked', async () => {
    stub([summary({ id: 'd1' })])
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({ id: 'd1' }))
    const generate = vi.spyOn(api, 'generateSchedule').mockReturnValue(new Promise(() => {}))
    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })

    fireEvent.click(await screen.findByRole('button', { name: 'Zmień i generuj ponownie' }))
    const from = await screen.findByLabelText(/^Od/, { selector: '#settings-from' })
    expect(from).toHaveValue('2026-09-17')
    expect(from).toBeDisabled()
    expect(screen.getByText('Zakres otwartego szkicu; nowy zakres zaczniesz z listy szkiców.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Generuj' }))
    await waitFor(() => expect(generate).toHaveBeenCalledWith({ starts_on: '2026-09-17', ends_on: '2026-09-18' }, expect.anything()))
  })

  it('edits the range from the drawer and generates it', async () => {
    stub([])
    const generate = vi.spyOn(api, 'generateSchedule').mockReturnValue(new Promise(() => {}))
    renderScreen(<GeneratorPanel />)
    await waitFor(() => expect(document.querySelector('#generator-from')).toHaveValue('2026-09-21'))

    fireEvent.click(screen.getByRole('button', { name: /Ustawienia generatora/ }))
    const from = await screen.findByLabelText(/^Od/, { selector: '#settings-from' })
    expect(screen.getByText('Maks. 35 dni na jedno generowanie.')).toBeInTheDocument()
    fireEvent.change(from, { target: { value: '2026-09-28' } })
    fireEvent.change(screen.getByLabelText(/^Do/, { selector: '#settings-to' }), { target: { value: '2026-10-25' } })
    expect(document.querySelector('#generator-from')).toHaveValue('2026-09-28')
    expect(document.querySelector('#generator-to')).toHaveValue('2026-10-25')

    fireEvent.click(screen.getByRole('button', { name: 'Generuj' }))
    await waitFor(() => expect(generate).toHaveBeenCalledWith({ starts_on: '2026-09-28', ends_on: '2026-10-25' }, expect.anything()))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Generuj' })).not.toBeInTheDocument())
  })

  it('warns about the weekly mode, marks unsaved changes and restores the stored ones', async () => {
    stub([])
    renderScreen(<GeneratorPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /Ustawienia generatora/ }))
    const mode = await screen.findByRole('combobox', { name: /Tryb rotacji/ })
    await waitFor(() => expect(mode).toBeEnabled())
    expect(screen.getByRole('button', { name: 'Przywróć zapisane' })).toBeDisabled()

    fireEvent.change(mode, { target: { value: 'weekly' } })
    fireEvent.change(screen.getByRole('combobox', { name: /Powiązanie 11–19/ }), { target: { value: 'independent' } })
    expect(screen.getByText(/Tryb tygodniowy wyłącza limit 3 dyżurów/)).toBeInTheDocument()
    expect(screen.getByText('niezapisane')).toBeInTheDocument()
    expect(screen.getByText(/masz niezapisane zmiany w ustawieniach/)).toBeInTheDocument()
    // Generating would ignore the unsaved values, so it waits for a save.
    expect(screen.getByRole('button', { name: 'Generuj' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Przywróć zapisane' }))
    expect(mode).toHaveValue('hybrid')
    expect(screen.getByRole('combobox', { name: /Powiązanie 11–19/ })).toHaveValue('secondary')
    expect(screen.queryByText(/Tryb tygodniowy wyłącza limit/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generuj' })).toBeEnabled()
  })

  it('says it is saving while the policy is written and confirms it afterwards', async () => {
    stub([])
    let finish: (value: SchedulingPolicy) => void = () => {}
    const save = vi.spyOn(api, 'updateSchedulingPolicy').mockReturnValue(new Promise((resolve) => { finish = resolve }))
    renderScreen(<GeneratorPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /Ustawienia generatora/ }))
    const weight = await screen.findByRole('spinbutton', { name: /Równy udział/ })

    fireEvent.change(weight, { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz ustawienia generowania' }))
    expect(await screen.findByRole('button', { name: /Zapisuję…/ })).toBeDisabled()
    expect(save.mock.calls[0][0]).toMatchObject({ fairness_weight: 5 })

    finish({ ...policy, fairness_weight: 5 })
    expect(await screen.findByText('Zapisano.')).toBeInTheDocument()
  })

  it('reads an emptied budget as zero in the whole-run estimate', async () => {
    stub([])
    renderScreen(<GeneratorPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /Ustawienia generatora/ }))
    const field = await screen.findByRole('spinbutton', { name: /Budżet czasu na przebieg/ })
    await waitFor(() => expect(field).toHaveValue(15))

    fireEvent.change(field, { target: { value: '' } })
    expect(screen.getByText(/górny limit całego generowania to około 0 s/)).toBeInTheDocument()
  })
})

describe('GeneratorPanel publication sheet', () => {
  const started = draft({ id: 'd1', status: 'proposed', version: 2, starts_on: '2026-09-08', ends_on: '2026-09-18' })
  const preview = {
    lost_changes: [],
    carried_changes: [],
    pending_swaps: [],
    uncovered_before: [],
    stale_changes_count: 0,
    rest_violations: [],
  }

  it('asks to acknowledge a range that has already begun and carries earlier changes over', async () => {
    stub([summary({ id: 'd1', status: 'proposed', version: 2 })])
    vi.spyOn(api, 'schedule').mockResolvedValue(started)
    vi.spyOn(api, 'publishPreview').mockResolvedValue({
      ...preview,
      carried_changes: [{
        service_date: '2026-09-17',
        role: 'secondary',
        previous_assignee_name: 'Ola Wiśniewska',
        new_assignee_name: 'Ola Wiśniewska',
        source: 'approved_swap',
        original_assignee_name: 'Marek Nowak',
        reason: null,
      }],
    })
    let finish: (value: DraftSchedule) => void = () => {}
    const publish = vi.spyOn(api, 'publishSchedule').mockReturnValue(new Promise((resolve) => { finish = resolve }))
    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })

    fireEvent.click(await screen.findByRole('button', { name: /^Publikuj…/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Ten zakres obejmuje dzisiejszy albo wcześniejszy dzień.')).toBeInTheDocument()
    expect(await within(dialog).findByText('Zmiany zostaną przeniesione')).toBeInTheDocument()
    expect(within(dialog).getByText('czw 17 wrz · SECONDARY: Ola Wiśniewska')).toBeInTheDocument()
    const confirm = within(dialog).getByRole('button', { name: 'Publikuj v2' })
    expect(confirm).toBeDisabled()

    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Rozumiem, że zmieniam dzień/ }))
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)
    expect(await within(dialog).findByRole('button', { name: /Publikuję…/ })).toBeInTheDocument()
    expect(publish.mock.calls[0][0]).toMatchObject({ id: 'd1', expectedVersion: 2, acknowledgeLostChanges: false, acknowledgeGap: false })

    finish(draft({ ...started, status: 'published', version: 3 }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByText('grafik opublikowany')).toBeInTheDocument()
  })

  it('names a lost change without a reason and closes on the way back', async () => {
    stub([summary({ id: 'd1', status: 'proposed', version: 2 })])
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({ id: 'd1', status: 'proposed', version: 2 }))
    vi.spyOn(api, 'publishPreview').mockResolvedValue({
      ...preview,
      lost_changes: [{
        service_date: '2026-09-17',
        role: 'primary',
        previous_assignee_name: 'Anna Kowalska',
        new_assignee_name: 'Marek Nowak',
        source: 'override',
        original_assignee_name: 'Ola Wiśniewska',
        reason: null,
      }],
    })
    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })

    fireEvent.click(await screen.findByRole('button', { name: /^Publikuj…/ }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText(/PRIMARY: zmiana Anna Kowalska, szkic Marek Nowak\.$/)).toBeInTheDocument()
    expect(within(dialog).queryByText(/Ten zakres obejmuje dzisiejszy/)).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Publikuj v2' })).toBeDisabled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Wróć do propozycji' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('closes the publication check with its close button, publishing nothing', async () => {
    stub([summary({ id: 'd1', status: 'proposed', version: 2 })])
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({ id: 'd1', status: 'proposed', version: 2 }))
    vi.spyOn(api, 'publishPreview').mockResolvedValue({ lost_changes: [], carried_changes: [], pending_swaps: [], uncovered_before: [], stale_changes_count: 0, rest_violations: [] })
    const publish = vi.spyOn(api, 'publishSchedule')
    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })

    fireEvent.click(await screen.findByRole('button', { name: /^Publikuj…/ }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zamknij' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(publish).not.toHaveBeenCalled()
  })

  it('refuses to publish when the consequences cannot be checked', async () => {
    stub([summary({ id: 'd1', status: 'proposed', version: 2 })])
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({ id: 'd1', status: 'proposed', version: 2 }))
    vi.spyOn(api, 'publishPreview').mockRejectedValue(new ApiError('Błąd serwera', 500))
    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })

    fireEvent.click(await screen.findByRole('button', { name: /^Publikuj…/ }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Nie udało się sprawdzić skutków publikacji.')
    expect(within(dialog).getByRole('button', { name: 'Publikuj v2' })).toBeDisabled()
  })
})
