import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { useLocation, useNavigate } from 'react-router-dom'
import { renderScreen } from '../test/render'
import { chooseFromMenu } from '../test/menu'
import { GeneratorPanel } from './Generator'
import { api, ApiError } from '../api'
import type { DraftSchedule, PublishPreview, ScheduleRun, ScheduleSummary, SchedulingPolicy } from '../api'

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
  override_count: 0,
  created_at: '2026-09-02T10:00:00Z',
  ...over,
})

function Go({ to }: Readonly<{ to: string }>) {
  const navigate = useNavigate()
  return <button type="button" onClick={() => navigate(to)}>{`go ${to}`}</button>
}

function Location() {
  const location = useLocation()
  return <output aria-label="location">{location.pathname}{location.search}</output>
}

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
  vi.spyOn(api, 'publishPreview').mockResolvedValue(emptyPreview)
}

const emptyPreview = { lost_changes: [], carried_changes: [], pending_swaps: [], uncovered_before: [], stale_changes_count: 0, rest_violations: [] }

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
    expect(await screen.findByText('Szkic · v1')).toBeInTheDocument()
  })

  it('offers a proposal publication as its one action, not another hand-off', async () => {
    stub([summary({ id: 'd1' })])
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({ id: 'd1', status: 'proposed' }))
    renderScreen(<GeneratorPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Otwórz' }))

    const decision = await screen.findByRole('region', { name: 'Decyzja o szkicu' })
    expect(within(decision).getByText('Propozycja czeka na publikację.')).toBeInTheDocument()
    expect(await within(decision).findByRole('button', { name: 'Publikuj v1…' })).toBeInTheDocument()
    expect(within(decision).getByRole('button', { name: 'Wróć do szkicu' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Przekaż do akceptacji' })).not.toBeInTheDocument()
  })

  it.each([
    ['OPTIMAL', 'rozwiązanie optymalne'],
    ['FEASIBLE', 'najlepsze znalezione w limicie czasu'],
    ['INFEASIBLE', 'bez pełnego rozwiązania'],
  ])('says the %s solver status in words and keeps the engine code in the details', async (status, words) => {
    stub([summary({ id: 'd1', solver_status: status })])
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({ id: 'd1', solver_status: status }))
    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })

    fireEvent.click(await screen.findByRole('tab', { name: 'Ustawienia' }))
    expect(await screen.findByText(words)).toBeInTheDocument()
    expect(screen.queryByText(/CP-SAT/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Szczegóły solvera' }))
    const details = await screen.findByRole('dialog', { name: 'Szczegóły solvera' })
    expect(within(details).getByText(`CP-SAT: ${status}`)).toBeInTheDocument()
    // No gap was reported, so none is invented.
    expect(within(details).queryByText(/Luka/)).not.toBeInTheDocument()
  })

  it('puts the gap to the best possible solution in the solver details', async () => {
    stub([summary({ id: 'd1' })])
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({ id: 'd1', solver_status: 'FEASIBLE', continuity_gap: 0.025 }))
    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })

    fireEvent.click(await screen.findByRole('tab', { name: 'Ustawienia' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Szczegóły solvera' }))
    const details = await screen.findByRole('dialog', { name: 'Szczegóły solvera' })
    // A no-break space before the sign, so a narrow popover never leaves "%" alone on a line.
    expect(within(details).getByText('Luka do najlepszego możliwego rozwiązania: 2,5\u00a0%', { normalizer: (text) => text })).toBeInTheDocument()
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
    expect(await screen.findByText('Szkic · v1')).toBeInTheDocument()
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
    fireEvent.click(await screen.findByRole('button', { name: 'Inne akcje' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Przekaż do akceptacji' }))

    // The decision must follow the server, not the pre-transition cache entry.
    expect(await screen.findByRole('button', { name: 'Publikuj v2…' })).toBeInTheDocument()
    await waitFor(() => expect(fetchOne).toHaveBeenCalledTimes(2))
    expect(screen.getByText('Przekazano do akceptacji: 17 – 18 wrz')).toBeInTheDocument()
  })

  it('states the publication effects on the page and settles conflicts and consents in the sheet', async () => {
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
    // Information without a decision is on the page before the sheet opens.
    const decision = await screen.findByRole('region', { name: 'Decyzja o szkicu' })
    expect(await within(decision).findByText('Co zmieni publikacja')).toBeInTheDocument()
    expect(within(decision).getByText('1 zamiana anulowana')).toBeInTheDocument()
    expect(within(decision).getByText('2 wpisy zmienione od wygenerowania')).toBeInTheDocument()
    fireEvent.click(within(decision).getByRole('button', { name: 'Przeniesione zmiany i anulowane zamiany' }))
    expect(within(decision).getByText('anulowana · pt 18 wrz · SECONDARY: Ola Wiśniewska → Anna Kowalska')).toBeInTheDocument()

    fireEvent.click(within(decision).getByRole('button', { name: 'Publikuj v2…' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Zespół dostanie e-mail, kanały ICS zaktualizują się od razu\./)).toBeInTheDocument()
    // The same effects stand in the sheet, above the decisions.
    expect(within(dialog).getByText('Co zmieni publikacja')).toBeInTheDocument()
    expect(within(dialog).getByText('1 zamiana anulowana')).toBeInTheDocument()
    expect(within(dialog).getByText('Do rozstrzygnięcia: 1 konflikt ze zmianami')).toBeInTheDocument()
    expect(within(dialog).getByText(/korekta: Anna Kowalska, szkic: Marek Nowak/)).toBeInTheDocument()
    expect(within(dialog).getByText('Nowy szkic ma w tym slocie innego pierwotnego wykonawcę')).toHaveClass('box-next')
    expect(within(dialog).getByRole('option', { name: 'Zachowaj korektę: Anna Kowalska' })).toBeInTheDocument()
    expect(within(dialog).getByText('Publikacja naruszy reguły odpoczynku')).toBeInTheDocument()
    expect(await within(dialog).findByText('Do rozstrzygnięcia: 1 konflikt, 2 zgody.')).toBeInTheDocument()

    fireEvent.change(within(dialog).getByLabelText('Decyzja'), { target: { value: 'draft' } })
    expect(within(dialog).getByText('Do rozstrzygnięcia: 2 zgody.')).toBeInTheDocument()
    // Each kind of violation is consented to in its own frame before publishing.
    const publishButton = within(dialog).getByRole('button', { name: 'Publikuj v2' })
    const rest = within(dialog).getByRole('checkbox', { name: 'Rozumiem i świadomie łamię te reguły' })
    const gap = within(dialog).getByRole('checkbox', { name: 'Rozumiem, że te dni zostają bez obsady' })
    expect(rest.closest('.box')).toHaveTextContent('Publikacja naruszy reguły odpoczynku')
    expect(gap.closest('.box')).toHaveTextContent('Przed grafikiem zostanie luka: 16-09-2026')
    expect(publishButton).toBeDisabled()
    fireEvent.click(rest)
    expect(publishButton).toBeDisabled()
    fireEvent.click(gap)
    fireEvent.click(rest)
    expect(publishButton).toBeDisabled()
    fireEvent.click(rest)
    expect(publishButton).toBeEnabled()
    expect(within(dialog).getByText('Gotowe do publikacji.')).toBeInTheDocument()
    fireEvent.click(publishButton)
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

  it('keeps a deletion failure inside the confirmation dialog', async () => {
    stub([summary({ id: 'd1' })])
    vi.spyOn(api, 'deleteSchedule').mockRejectedValue(new Error('Szkic zmienił się w międzyczasie'))
    renderScreen(<GeneratorPanel />)

    fireEvent.click(await screen.findByRole('button', { name: /Usuń szkic/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Usunąć szkic?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Usuń' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Szkic zmienił się w międzyczasie')
    expect(screen.getByRole('dialog', { name: 'Usunąć szkic?' })).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Anuluj' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Usuń szkic/ }))
    const reopened = await screen.findByRole('dialog', { name: 'Usunąć szkic?' })
    expect(within(reopened).queryByRole('alert')).not.toBeInTheDocument()
  })

  it.each([
    [0, /^Szkic v2 \(.*\)\. Tej operacji nie da się cofnąć\.$/],
    [1, /Szkic v2 ma 1 ręczną korektę; przepadnie\./],
    [3, /Szkic v2 ma 3 ręczne korekty; przepadną\./],
    [5, /Szkic v2 ma 5 ręcznych korekt; przepadnie\./],
  ])('names the %i manual corrections that go with the draft', async (count, expected) => {
    stub([summary({ id: 'd1', name: 'Szkic v2', version: 2, override_count: count })])
    renderScreen(<GeneratorPanel />)

    fireEvent.click(await screen.findByRole('button', { name: /Usuń szkic/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(expected)).toBeInTheDocument()
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

    expect(await screen.findByText('Szkic · v1')).toBeInTheDocument()
    // With a draft open, the other drafts are a tab under the matrix.
    fireEvent.click(screen.getByRole('tab', { name: /Szkice/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Usuń szkic/ }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Usuń' }))

    await waitFor(() => expect(screen.queryByText('Szkic · v1')).not.toBeInTheDocument())
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

  it('states the conflict in the decision panel instead of claiming every hard rule is satisfied', async () => {
    stub([summary({ id: 'd1' })])
    vi.spyOn(api, 'schedule').mockResolvedValue(conflicted)
    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })

    const decision = await screen.findByRole('region', { name: 'Decyzja o szkicu' })
    expect(within(decision).getByText('2 naruszenia reguł twardych')).toBeInTheDocument()
    expect(decision).toHaveTextContent('Blokują publikację: Anna Kowalska · PRIMARY wt 3 lis, Anna Kowalska · SECONDARY śr 4 lis.')
    expect(screen.queryByText('Reguły twarde spełnione')).not.toBeInTheDocument()
    // The problems table lists both conflicts by person, with a way to the cell.
    expect(screen.getAllByText('Dyżur w dniu „nie mogę”')).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Popraw' })).toHaveLength(2)
  })

  it('makes fixing the conflicts the one action instead of a hand-off the API would refuse', async () => {
    stub([summary({ id: 'd1' })])
    vi.spyOn(api, 'calendar').mockResolvedValue({
      starts_on: '2026-09-17',
      ends_on: '2026-09-18',
      days: [{ service_date: '2026-11-03', weekday: 'wt', is_day_off: false, holiday_name: null, published: false, events: [] }],
      members: [{ id: 'm1', display_name: 'Anna Kowalska' }],
      team_has_members: true,
      assignments: [],
      availability: [],
    })
    vi.spyOn(api, 'schedule').mockResolvedValue(conflicted)
    const propose = vi.spyOn(api, 'proposeSchedule')
    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })

    const decision = await screen.findByRole('region', { name: 'Decyzja o szkicu' })
    expect(within(decision).queryByRole('button', { name: 'Opublikuj…' })).not.toBeInTheDocument()
    expect(within(decision).getByText('potem: Opublikuj…')).toBeInTheDocument()
    fireEvent.click(within(decision).getByRole('button', { name: 'Popraw 2 problemy' }))
    // The first conflict opens in the inspector, ready to correct.
    expect(await screen.findByRole('dialog', { name: 'Wstaw: Anna Kowalska · 03-11-2026' })).toBeInTheDocument()
    expect(propose).not.toHaveBeenCalled()
  })

  it('offers the hand-off in the menu when nothing conflicts', async () => {
    stub([summary({ id: 'd1' })])
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({ id: 'd1', solver_status: 'FEASIBLE' }))
    const propose = vi.spyOn(api, 'proposeSchedule').mockReturnValue(new Promise(() => {}))
    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })

    const decision = await screen.findByRole('region', { name: 'Decyzja o szkicu' })
    fireEvent.click(within(decision).getByRole('button', { name: 'Inne akcje' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Przekaż do akceptacji' }))
    await waitFor(() => expect(propose).toHaveBeenCalledWith({ id: 'd1', expectedVersion: 1 }))
    expect(await within(decision).findByRole('button', { name: 'Opublikuj…' })).toBeDisabled()
  })

  it('publishes a clean draft straight away, handing it over in the background', async () => {
    stub([summary({ id: 'd1' })])
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({ id: 'd1' }))
    const proposal = draft({ id: 'd1', status: 'proposed', version: 2 })
    const propose = vi.spyOn(api, 'proposeSchedule').mockResolvedValue(proposal)
    let answer: (value: PublishPreview) => void = () => {}
    const check = vi.spyOn(api, 'publishPreview').mockReturnValue(new Promise((resolve) => { answer = resolve }))
    const publish = vi.spyOn(api, 'publishSchedule').mockResolvedValue(draft({ id: 'd1', status: 'published', version: 3 }))
    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })

    fireEvent.click(await screen.findByRole('button', { name: 'Opublikuj…' }))
    // The sheet waits for the effects of the proposal made in the background.
    await waitFor(() => expect(check).toHaveBeenCalledWith('d1'))
    expect(propose).toHaveBeenCalledWith({ id: 'd1', expectedVersion: 1 })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    act(() => answer({ ...emptyPreview, pending_swaps: [{ id: 's1', service_date: '2026-09-18', role: 'secondary', requester_name: 'Marek Nowak', replacement_name: 'Ola Wiśniewska', status: 'pending_replacement' }] }))
    const dialog = await screen.findByRole('dialog', { name: 'Publikuję szkic v2 · 17 – 18 wrz' })
    expect(within(dialog).getByText('1 zamiana anulowana')).toBeInTheDocument()
    expect(screen.queryByText('Przekazano do akceptacji: 17 – 18 wrz')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Wróć do szkicu' })).toBeInTheDocument()
    const confirm = within(dialog).getByRole('button', { name: 'Publikuj v2' })
    await waitFor(() => expect(confirm).toBeEnabled())
    fireEvent.click(confirm)
    await waitFor(() => expect(publish.mock.calls[0][0]).toMatchObject({ id: 'd1', expectedVersion: 2 }))
    expect(await screen.findByText('Opublikowano v2 · 17 – 18 wrz')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Otwórz grafik' })).toBeInTheDocument()
  })

  it('takes a draft back quietly when its publication sheet is closed', async () => {
    stub([summary({ id: 'd1' })])
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({ id: 'd1' }))
    vi.spyOn(api, 'proposeSchedule').mockResolvedValue(draft({ id: 'd1', status: 'proposed', version: 2 }))
    const withdraw = vi.spyOn(api, 'withdrawSchedule').mockResolvedValue(draft({ id: 'd1', version: 3 }))
    const publish = vi.spyOn(api, 'publishSchedule')
    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })

    fireEvent.click(await screen.findByRole('button', { name: 'Opublikuj…' }))
    const dialog = await screen.findByRole('dialog', { name: /^Publikuję szkic/ })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Wróć do szkicu' }))
    await waitFor(() => expect(withdraw).toHaveBeenCalledWith({ id: 'd1', expectedVersion: 2, quiet: true }))
    expect(await screen.findByRole('button', { name: 'Opublikuj…' })).toBeEnabled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText(/^Cofnięto do szkicu/)).not.toBeInTheDocument()
    expect(publish).not.toHaveBeenCalled()
  })

  it('takes the draft back when its effects cannot be read, saying so inline', async () => {
    stub([summary({ id: 'd1' })])
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({ id: 'd1' }))
    vi.spyOn(api, 'proposeSchedule').mockResolvedValue(draft({ id: 'd1', status: 'proposed', version: 2 }))
    vi.spyOn(api, 'publishPreview').mockRejectedValue(new ApiError('Błąd serwera', 500))
    const withdraw = vi.spyOn(api, 'withdrawSchedule').mockResolvedValue(draft({ id: 'd1', version: 3 }))
    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })

    const decision = await screen.findByRole('region', { name: 'Decyzja o szkicu' })
    fireEvent.click(within(decision).getByRole('button', { name: 'Opublikuj…' }))
    expect(await within(decision).findByRole('alert')).toHaveTextContent('Błąd serwera')
    expect(withdraw).toHaveBeenCalledWith({ id: 'd1', expectedVersion: 2 })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('takes the draft back when the page leaves its sheet, and opens no sheet for the next schedule', async () => {
    stub([summary({ id: 'd1' }), summary({ id: 'd2', status: 'proposed', version: 4 })])
    vi.spyOn(api, 'schedule').mockImplementation(async (id) => id === 'd1' ? draft({ id: 'd1' }) : draft({ id: 'd2', status: 'proposed', version: 4 }))
    vi.spyOn(api, 'proposeSchedule').mockResolvedValue(draft({ id: 'd1', status: 'proposed', version: 2 }))
    const withdraw = vi.spyOn(api, 'withdrawSchedule').mockResolvedValue(draft({ id: 'd1', version: 3 }))
    renderScreen(<><GeneratorPanel /><Go to="/generator" /><Go to="/generator?szkic=d2" /><Location /></>, { route: '/generator?szkic=d1' })

    fireEvent.click(await screen.findByRole('button', { name: 'Opublikuj…' }))
    expect(await screen.findByRole('dialog', { name: /^Publikuję szkic/ })).toBeInTheDocument()
    fireEvent.click(screen.getByText('go /generator'))
    await waitFor(() => expect(withdraw).toHaveBeenCalledWith({ id: 'd1', expectedVersion: 2, quiet: true }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // The take-back does not reopen the draft the coordinator left.
    expect(screen.getByLabelText('location')).toHaveTextContent(/^\/generator$/)
    expect(await screen.findByRole('form', { name: 'Nowy szkic' })).toBeInTheDocument()

    fireEvent.click(screen.getByText('go /generator?szkic=d2'))
    expect(await screen.findByRole('button', { name: 'Publikuj v4…' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(withdraw).toHaveBeenCalledTimes(1)
  })

  it('takes the draft back when the coordinator moved on before its effects were known', async () => {
    stub([summary({ id: 'd1' }), summary({ id: 'd2', status: 'proposed', version: 4 })])
    vi.spyOn(api, 'schedule').mockImplementation(async (id) => id === 'd1' ? draft({ id: 'd1' }) : draft({ id: 'd2', status: 'proposed', version: 4 }))
    vi.spyOn(api, 'proposeSchedule').mockResolvedValue(draft({ id: 'd1', status: 'proposed', version: 2 }))
    let answer: (value: PublishPreview) => void = () => {}
    vi.spyOn(api, 'publishPreview').mockImplementation((id) => id === 'd1' ? new Promise((resolve) => { answer = resolve }) : Promise.resolve(emptyPreview))
    const withdraw = vi.spyOn(api, 'withdrawSchedule').mockResolvedValue(draft({ id: 'd1', version: 3 }))
    renderScreen(<><GeneratorPanel /><Go to="/generator?szkic=d2" /></>, { route: '/generator?szkic=d1' })

    fireEvent.click(await screen.findByRole('button', { name: 'Opublikuj…' }))
    await waitFor(() => expect(api.publishPreview).toHaveBeenCalledWith('d1'))
    fireEvent.click(screen.getByText('go /generator?szkic=d2'))
    expect(await screen.findByRole('button', { name: 'Publikuj v4…' })).toBeInTheDocument()
    act(() => answer(emptyPreview))
    await waitFor(() => expect(withdraw).toHaveBeenCalledWith({ id: 'd1', expectedVersion: 2, quiet: true }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('17 – 18 wrz Do akceptacji · v4')
  })

  it('takes the draft back when the generator is left with its sheet open', async () => {
    stub([summary({ id: 'd1' })])
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({ id: 'd1' }))
    vi.spyOn(api, 'proposeSchedule').mockResolvedValue(draft({ id: 'd1', status: 'proposed', version: 2 }))
    const withdraw = vi.spyOn(api, 'withdrawSchedule').mockResolvedValue(draft({ id: 'd1', version: 3 }))
    const { unmount } = renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })

    fireEvent.click(await screen.findByRole('button', { name: 'Opublikuj…' }))
    expect(await screen.findByRole('dialog', { name: /^Publikuję szkic/ })).toBeInTheDocument()
    unmount()
    await waitFor(() => expect(withdraw).toHaveBeenCalledWith({ id: 'd1', expectedVersion: 2, quiet: true }))
  })

  it('keeps a failed publication of one draft out of the next one', async () => {
    stub([summary({ id: 'd1' }), summary({ id: 'd2' })])
    vi.spyOn(api, 'schedule').mockImplementation(async (id) => draft({ id, name: id }))
    vi.spyOn(api, 'proposeSchedule').mockRejectedValue(new ApiError('Szkic zmienił się od otwarcia', 409))
    renderScreen(<><GeneratorPanel /><Go to="/generator?szkic=d2" /></>, { route: '/generator?szkic=d1' })

    const decision = await screen.findByRole('region', { name: 'Decyzja o szkicu' })
    fireEvent.click(within(decision).getByRole('button', { name: 'Opublikuj…' }))
    expect(await within(decision).findByRole('alert')).toHaveTextContent('Szkic zmienił się od otwarcia')
    fireEvent.click(screen.getByText('go /generator?szkic=d2'))
    expect(await screen.findByRole('heading', { level: 2, name: 'd2' })).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Decyzja o szkicu' })).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says inline in the decision panel when the draft cannot be readied for publication', async () => {
    stub([summary({ id: 'd1' })])
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({ id: 'd1' }))
    vi.spyOn(api, 'proposeSchedule').mockRejectedValue(new ApiError('Szkic zmienił się od otwarcia', 409))
    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })

    const decision = await screen.findByRole('region', { name: 'Decyzja o szkicu' })
    fireEvent.click(within(decision).getByRole('button', { name: 'Opublikuj…' }))
    expect(await within(decision).findByRole('alert')).toHaveTextContent('Szkic zmienił się od otwarcia')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
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
    expect(await screen.findByText(/jedna próba trwa do 15 s/)).toBeInTheDocument()
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
    // The swap policy has its own heading: it does not shape the generation.
    expect(screen.getByRole('heading', { name: 'Polityka zamian' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Zapisz' })).toBeDisabled()

    fireEvent.click(toggle)
    expect(toggle).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0][0]).toMatchObject({ coordinator_swap_approval_required: false })
    // The stored value comes back off, so the form is clean again.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Zapisz' })).toBeDisabled())
    expect(screen.getByRole('checkbox', { name: /Zamiana dyżuru wymaga zatwierdzenia koordynatora/ })).not.toBeChecked()
    expect(screen.getByText('Zapisano ustawienia generowania')).toBeInTheDocument()
    expect(screen.getByText('Zapisano.')).toHaveAttribute('role', 'status')
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
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0][0]).toMatchObject({ solve_seconds: 45 })
  })

  it('keeps the save button off while the budget matches what is stored', async () => {
    stub([])
    renderScreen(<GeneratorPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /Ustawienia generatora/ }))
    await screen.findByRole('spinbutton', { name: /Budżet czasu na przebieg/ })
    expect(
      screen.getByRole('button', { name: 'Zapisz' }),
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
    expect(screen.getByRole('region', { name: 'Postęp generowania' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Utwórz szkic' }))
    const progress = await screen.findByRole('progressbar', { name: 'Postęp generowania' })
    expect(progress).toHaveAttribute('aria-valuenow', '0')
    expect(progress.querySelector('i')).toHaveStyle({ transform: 'scaleX(0)' })
    expect(screen.getByRole('heading', { level: 1, name: 'Generuję 21 wrz – 18 paź' })).toBeInTheDocument()
    expect(screen.getByText('Solver pracuje poza procesem API.')).toBeInTheDocument()
    expect(screen.queryByText(/na jeden przebieg solvera/)).not.toBeInTheDocument()
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('announces stage changes only, not the solver progress within a stage', async () => {
    stub([])
    let report: ((progress: ScheduleRun) => void) | undefined
    vi.spyOn(api, 'generateSchedule').mockImplementation((_input, onProgress) => {
      report = onProgress
      return new Promise(() => {})
    })
    renderScreen(<GeneratorPanel />)
    await waitFor(() => expect(document.querySelector('#generator-from')).toHaveValue('2026-09-21'))

    fireEvent.click(screen.getByRole('button', { name: 'Utwórz szkic' }))
    const live = screen.getByRole('region', { name: 'Postęp generowania' })
    await waitFor(() => expect(live).toHaveTextContent('Generowanie rozpoczęte.'))
    act(() => report?.(run({ id: 'r1', progress: 41 })))
    expect(live).toHaveTextContent(/^Generowanie: solver\.$/)
    act(() => report?.(run({ id: 'r1', progress: 43 })))
    expect(screen.getByRole('progressbar', { name: 'Postęp generowania' })).toHaveAttribute('aria-valuenow', '43')
    expect(live).toHaveTextContent(/^Generowanie: solver\.$/)
    act(() => report?.(run({ id: 'r1', status: 'completed', progress: 90 })))
    expect(live).toHaveTextContent(/^Generowanie: sprawiedliwość\.$/)
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
    const progress = screen.getByRole('progressbar', { name: 'Postęp generowania' })
    expect(progress).toHaveAttribute('aria-valuenow', '90')
    expect(progress.querySelector('i')).toHaveStyle({ transform: 'scaleX(0.9)' })
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

    expect(await screen.findByText('2 dni · 3 przydziały')).toBeInTheDocument()
    // The range is the title, with one state pill.
    const title = screen.getByRole('heading', { level: 1, name: '17 – 18 wrz Szkic · v1' })
    expect(within(title).getByText('Szkic · v1')).toHaveClass('st', 'st-draft', 'ph-pill')
    expect(screen.getByText('3 przydziały w 2 dniach · Hybrydowy')).toBeInTheDocument()
    // The solver's own figures live in the draft's settings tab, not above the matrix.
    expect(screen.queryByText('optymalna (udowodniona)')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Ustawienia' }))
    const settings = await screen.findByRole('tabpanel')
    const solver = within(settings).getByText('Solver').closest('.kv-row') as HTMLElement
    expect(within(solver).getByText(/^najlepsze znalezione w limicie czasu/)).toBeInTheDocument()
    expect(within(settings).queryByText(/CP-SAT/)).not.toBeInTheDocument()
    expect(within(settings).getByText('optymalna (udowodniona)')).toBeInTheDocument()
  })

  it('says a conflict on a proposal blocks the publication and leads back to the draft', async () => {
    stub([summary({ id: 'd1', status: 'proposed' })])
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({
      id: 'd1',
      status: 'proposed',
      unavailability_conflicts: [{ service_date: '2026-09-17', role: 'primary', assignee_name: 'Anna Kowalska' }],
    }))
    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })
    const decision = await screen.findByRole('region', { name: 'Decyzja o szkicu' })
    expect(decision).toHaveTextContent('Blokują publikację: Anna Kowalska · PRIMARY czw 17 wrz.')
    expect(within(decision).getByRole('button', { name: 'Wróć do szkicu' })).toHaveClass('btn-pri')
    expect(within(decision).queryByRole('button', { name: /^Publikuj/ })).not.toBeInTheDocument()
  })

  it('filters the problems from the soft-warning chip and the hard-only switch', async () => {
    stub([summary({ id: 'd1' })])
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({
      id: 'd1',
      warnings: [
        { source: 'solver', message: 'Reguły rozrzedzania zawieszone.' },
        { source: 'rules', message: 'Anna Kowalska: więcej niż 3 dni z rzędu.' },
      ],
    }))
    // jsdom has no scrollIntoView; the chip scrolls the tabs into view.
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    try {
      renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })
      expect(await screen.findByText('Reguły rozrzedzania zawieszone.')).toBeInTheDocument()
      expect(screen.getByRole('region', { name: 'Decyzja o szkicu' })).toHaveTextContent('Złamane reguły opisuje zakładka Problemy pod macierzą.')
      const hardOnly = screen.getByRole('button', { name: 'Tylko twarde' })
      expect(hardOnly).toHaveAttribute('aria-pressed', 'false')

      fireEvent.click(hardOnly)
      expect(hardOnly).toHaveAttribute('aria-pressed', 'true')
      expect(hardOnly).toHaveClass('on')
      expect(screen.queryByText('Reguły rozrzedzania zawieszone.')).not.toBeInTheDocument()

      // From another tab, the chip brings back the problems with the soft ones shown.
      fireEvent.click(screen.getByRole('tab', { name: 'Sprawiedliwość' }))
      expect(screen.queryByRole('button', { name: 'Tylko twarde' })).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: '1 ostrzeżenie miękkie' }))
      expect(screen.getByRole('button', { name: 'Tylko twarde' })).toHaveAttribute('aria-pressed', 'false')
      expect(screen.getByText('Reguły rozrzedzania zawieszone.')).toBeInTheDocument()
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' })
    } finally {
      delete (Element.prototype as Partial<Element>).scrollIntoView
    }
  })

  it('sums up the lenses in two chips, meeting the criterion and not', async () => {
    stub([summary({ id: 'd1' })])
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({ id: 'd1' }))
    vi.spyOn(api, 'draftFairnessImpact').mockResolvedValue({
      schedule_id: 'd1',
      schedule_version: 1,
      baseline_as_of: '2026-09-16',
      projected_as_of: '2026-09-18',
      baseline_members: [],
      projected_members: [],
      late_shift_balanced: false,
      criterion_points: 1,
      criterion_met: false,
      spreads: [
        { lens: 'primary', before: 1, after: 1.5, meets_criterion: false },
        { lens: 'weekends', before: 2, after: 1.5, meets_criterion: false },
        { lens: 'secondary', before: 0.5, after: 0.5, meets_criterion: true },
        { lens: 'future_lens', before: 0, after: 0, meets_criterion: true },
      ],
      acceptance_floor: null,
    })
    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })

    expect(await screen.findByText('SECONDARY, future_lens: spełnia')).toBeInTheDocument()
    expect(screen.getByText('PRIMARY, Weekendy: nie spełnia')).toBeInTheDocument()
  })

  it('keeps the team weights out of the draft settings and opens the one settings drawer', async () => {
    stub([summary({ id: 'd1', solver_status: 'INFEASIBLE' })])
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({ id: 'd1', solver_status: 'INFEASIBLE' }))
    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })

    fireEvent.click(await screen.findByRole('tab', { name: 'Ustawienia' }))
    const settings = await screen.findByRole('tabpanel')
    expect(within(settings).getByText('17-09-2026 – 18-09-2026')).toBeInTheDocument()
    expect(within(settings).getByText('bez pełnego rozwiązania')).toBeInTheDocument()
    // No solution, so no fairness figure to report.
    expect(within(settings).queryByText('Sprawiedliwość')).not.toBeInTheDocument()
    expect(within(settings).queryByText(/Waga/)).not.toBeInTheDocument()
    expect(within(settings).getByText(/zmieniane w jednym miejscu/)).toBeInTheDocument()
    fireEvent.click(within(settings).getByRole('button', { name: 'Zmień ustawienia i generuj…' }))
    expect(await screen.findByRole('dialog', { name: 'Ustawienia generatora' })).toBeInTheDocument()
  })

  it('states a fairness the solver did not prove and invents no solution gap', async () => {
    stub([summary({ id: 'd1' })])
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({ id: 'd1', continuity_gap: null }))
    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })

    fireEvent.click(await screen.findByRole('tab', { name: 'Ustawienia' }))
    expect(await screen.findByText('najlepsza znaleziona')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Szczegóły solvera' }))
    expect(within(await screen.findByRole('dialog', { name: 'Szczegóły solvera' })).queryByText(/Luka/)).not.toBeInTheDocument()
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
    expect(await screen.findByText('Szkic · v1')).toBeInTheDocument()
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
    expect(await screen.findByRole('button', { name: 'Opublikuj…' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Publikuj v/ })).not.toBeInTheDocument()
    expect(screen.getByText('Cofnięto do szkicu: 17 – 18 wrz')).toBeInTheDocument()
  })

  it('generates the open draft again over its own range', async () => {
    stub([summary({ id: 'd1' })])
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({ id: 'd1' }))
    const generate = vi.spyOn(api, 'generateSchedule').mockReturnValue(new Promise(() => {}))
    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })

    const again = await screen.findByRole('button', { name: 'Generuj nowy szkic' })
    fireEvent.click(again)
    await waitFor(() => expect(generate).toHaveBeenCalledWith({ starts_on: '2026-09-17', ends_on: '2026-09-18' }, expect.anything()))
    expect(await screen.findByRole('heading', { level: 1, name: 'Generuję 17 – 18 wrz' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generuj nowy szkic' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Opublikuj…' })).toBeDisabled()
  })

  it('says where the open draft went once a new one is generated over its range', async () => {
    stub([summary({ id: 'd1' })])
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({ id: 'd1' }))
    vi.spyOn(api, 'generateSchedule').mockResolvedValue(draft({ id: 'd2' }))
    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })

    fireEvent.click(await screen.findByRole('button', { name: 'Generuj nowy szkic' }))
    expect(await screen.findByText('Utworzono nowy szkic · otwarty grafik zostaje bez zmian')).toBeInTheDocument()
  })

  it('keeps the settings in the "more" menu of an open draft and gives the focus back to it', async () => {
    stub([summary({ id: 'd1' })])
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({ id: 'd1' }))
    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })

    await chooseFromMenu('Więcej', 'Ustawienia generatora')
    const panel = await screen.findByRole('dialog', { name: 'Ustawienia generatora' })
    fireEvent.click(within(panel).getByRole('button', { name: 'Zamknij panel' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Więcej' })).toHaveFocus())
  })

  it('gives the focus back to the proposal settings button that opened the panel', async () => {
    stub([summary({ id: 'd1' })])
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({ id: 'd1' }))
    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })

    fireEvent.click(await screen.findByRole('tab', { name: 'Ustawienia' }))
    const inline = await screen.findByRole('button', { name: 'Zmień ustawienia i generuj…' })
    inline.focus()
    fireEvent.click(inline)
    const panel = await screen.findByRole('dialog', { name: 'Ustawienia generatora' })
    fireEvent.click(within(panel).getByRole('button', { name: 'Zamknij panel' }))
    await waitFor(() => expect(inline).toHaveFocus())
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

describe('GeneratorPanel draft correction', () => {
  const corrected = draft({
    id: 'd1',
    ends_on: '2026-09-17',
    // SECONDARY is held by someone outside the matrix, so the day has no gap
    // and Marek's empty cell opens on the PRIMARY Anna holds.
    assignments: [
      { service_date: '2026-09-17', role: 'primary', assignee_name: 'Anna Kowalska', is_override: false },
      { service_date: '2026-09-17', role: 'secondary', assignee_name: 'Ola Wiśniewska', is_override: false },
    ],
  })

  function stubCorrection() {
    stub([summary({ id: 'd1' }), summary({ id: 'd2', version: 7 })])
    vi.spyOn(api, 'calendar').mockResolvedValue({
      starts_on: '2026-09-17',
      ends_on: '2026-09-17',
      days: [{ service_date: '2026-09-17', weekday: 'czw', is_day_off: false, holiday_name: null, published: false, events: [] }],
      members: [{ id: 'm1', display_name: 'Anna Kowalska' }, { id: 'm2', display_name: 'Marek Nowak' }],
      team_has_members: true,
      assignments: [],
      availability: [],
    })
    const schedule = vi.spyOn(api, 'schedule').mockImplementation(async (id) => id === 'd1' ? corrected : draft({ ...corrected, id: 'd2', version: 7 }))
    const save = vi.spyOn(api, 'overrideDraft')
      .mockResolvedValueOnce({ ...corrected, version: 2, assignments: [{ ...corrected.assignments[0], assignee_name: 'Marek Nowak', is_override: true }] })
      .mockResolvedValueOnce({ ...corrected, version: 3 })
    return { schedule, save }
  }

  async function correctD1() {
    fireEvent.click(await screen.findByRole('button', { name: /^Marek Nowak, czw 17-09-2026/ }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Wstaw: Marek Nowak · 17-09-2026' })).getByRole('button', { name: 'Przypisz w szkicu' }))
    expect(await screen.findByText('Szkic · v2')).toBeInTheDocument()
  }

  it('drops a failed publication alert once the draft is corrected', async () => {
    stubCorrection()
    vi.spyOn(api, 'proposeSchedule').mockRejectedValue(new ApiError('Szkic zmienił się od otwarcia', 409))
    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })

    const decision = await screen.findByRole('region', { name: 'Decyzja o szkicu' })
    fireEvent.click(within(decision).getByRole('button', { name: 'Opublikuj…' }))
    expect(await within(decision).findByRole('alert')).toHaveTextContent('Szkic zmienił się od otwarcia')
    await correctD1()
    expect(within(screen.getByRole('region', { name: 'Decyzja o szkicu' })).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps the draft opened since when the earlier correction is undone', async () => {
    const { schedule, save } = stubCorrection()
    const { router } = renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })
    await correctD1()

    fireEvent.click(screen.getByRole('tab', { name: /Szkice/ }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Otwórz' })[0])
    expect(await screen.findByText('Szkic · v7')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cofnij' }))

    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(save.mock.calls[1][0]).toMatchObject({ id: 'd1', expected_version: 2, assignments: [{ role: 'primary', replacement_member_id: 'm1' }] })
    await waitFor(() => expect(schedule.mock.calls.filter(([id]) => id === 'd2').length).toBeGreaterThan(1))
    expect(screen.getByText('Szkic · v7')).toBeInTheDocument()
    expect(router.state.location.search).toBe('?szkic=d2')
  })

  it('leaves a closed draft closed when its correction is undone', async () => {
    const { save } = stubCorrection()
    const { router } = renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })
    await correctD1()

    act(() => { void router.navigate('/generator') })
    await waitFor(() => expect(screen.queryByText('Szkic · v2')).not.toBeInTheDocument())
    // The list mounts again outside the tabs and reads the drafts once more.
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Otwórz' }).length).toBeGreaterThan(0))
    const listed = vi.mocked(api.draftSchedules).mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Cofnij' }))

    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(api.draftSchedules).toHaveBeenCalledTimes(listed + 1))
    expect(screen.queryByText(/wersja \d+ ·/)).not.toBeInTheDocument()
    expect(router.state.location.search).toBe('')
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

  it('says in one sentence who the settings are for and keeps how the weights work in a popover', async () => {
    stub([])
    renderScreen(<GeneratorPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /Ustawienia generatora/ }))
    const drawer = await screen.findByRole('dialog', { name: 'Ustawienia generatora' })
    expect(within(drawer).getByText('Ustawienia dotyczą całego zespołu i działają od następnego generowania.', { exact: false })).toBeInTheDocument()
    expect(within(drawer).queryByText(/człon celu/)).not.toBeInTheDocument()

    fireEvent.click(within(drawer).getByRole('button', { name: 'Jak działają wagi' }))
    const help = await screen.findByRole('dialog', { name: 'Jak działają wagi' })
    expect(within(help).getByText(/Liczy się tylko stosunek wag: 6 \/ 4 \/ 2 działa tak samo jak 3 \/ 2 \/ 1\./)).toBeInTheDocument()
  })

  it('opens from the proposal settings with the draft range locked', async () => {
    stub([summary({ id: 'd1' })])
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({ id: 'd1' }))
    const generate = vi.spyOn(api, 'generateSchedule').mockReturnValue(new Promise(() => {}))
    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })

    fireEvent.click(await screen.findByRole('tab', { name: 'Ustawienia' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Zmień ustawienia i generuj…' }))
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

  it('keeps unsaved settings when closing the panel is cancelled', async () => {
    stub([])
    renderScreen(<GeneratorPanel />)

    fireEvent.click(await screen.findByRole('button', { name: /Ustawienia generatora/ }))
    const mode = await screen.findByRole('combobox', { name: /Tryb rotacji/ })
    await waitFor(() => expect(mode).toBeEnabled())
    fireEvent.change(mode, { target: { value: 'weekly' } })
    fireEvent.click(screen.getByRole('button', { name: 'Zamknij panel' }))

    const warning = await screen.findByRole('dialog', { name: 'Odrzucić niezapisane zmiany?' })
    fireEvent.click(within(warning).getByRole('button', { name: 'Anuluj' }))
    expect(mode).toHaveValue('weekly')

    fireEvent.click(screen.getByRole('button', { name: 'Zamknij panel' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Odrzucić niezapisane zmiany?' })).getByRole('button', { name: 'Odrzuć zmiany' }))
    await waitFor(() => expect(screen.queryByRole('combobox', { name: /Tryb rotacji/ })).not.toBeInTheDocument())
  })

  it('blocks opening another draft until unsaved settings are discarded', async () => {
    stub([summary({ id: 'd1' })])
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({ id: 'd1' }))
    renderScreen(<GeneratorPanel />)

    fireEvent.click(await screen.findByRole('button', { name: /Ustawienia generatora/ }))
    const mode = await screen.findByRole('combobox', { name: /Tryb rotacji/ })
    await waitFor(() => expect(mode).toBeEnabled())
    fireEvent.change(mode, { target: { value: 'weekly' } })
    fireEvent.click(screen.getByRole('button', { name: 'Otwórz' }))

    const warning = await screen.findByRole('dialog', { name: 'Odrzucić niezapisane zmiany?' })
    expect(api.schedule).not.toHaveBeenCalled()
    fireEvent.click(within(warning).getByRole('button', { name: 'Anuluj' }))
    expect(mode).toHaveValue('weekly')

    fireEvent.click(screen.getByRole('button', { name: 'Otwórz' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Odrzucić niezapisane zmiany?' })).getByRole('button', { name: 'Odrzuć zmiany' }))
    await waitFor(() => expect(api.schedule).toHaveBeenCalledWith('d1'))
    expect(screen.getByRole('combobox', { name: /Tryb rotacji/ })).toHaveValue('hybrid')
    expect(screen.queryByText('niezapisane')).not.toBeInTheDocument()
  })

  it('opens a finished generation without asking about the unsaved settings', async () => {
    stub([])
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({ id: 'd1' }))
    let finish: (value: DraftSchedule) => void = () => {}
    vi.spyOn(api, 'generateSchedule').mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const { router } = renderScreen(<GeneratorPanel />, { route: '/generator' })

    await waitFor(() => expect(document.querySelector('#generator-from')).toHaveValue('2026-09-21'))
    fireEvent.click(screen.getByRole('button', { name: 'Utwórz szkic' }))
    fireEvent.click(await screen.findByRole('button', { name: /Ustawienia generatora/ }))
    const mode = await screen.findByRole('combobox', { name: /Tryb rotacji/ })
    await waitFor(() => expect(mode).toBeEnabled())
    fireEvent.change(mode, { target: { value: 'weekly' } })

    act(() => finish(draft({ id: 'd1' })))
    await waitFor(() => expect(router.state.location.search).toBe('?szkic=d1'))
    expect(screen.queryByRole('dialog', { name: 'Odrzucić niezapisane zmiany?' })).not.toBeInTheDocument()
    expect(mode).toHaveValue('weekly')
  })

  it('drops a deleted open draft from the URL without asking about the unsaved settings', async () => {
    stub([summary({ id: 'd1' })])
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({ id: 'd1' }))
    vi.spyOn(api, 'deleteSchedule').mockResolvedValue(undefined)
    const { router } = renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })

    expect(await screen.findByText('Szkic · v1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Szkice/ }))
    await chooseFromMenu('Więcej', /Ustawienia generatora/)
    const mode = await screen.findByRole('combobox', { name: /Tryb rotacji/ })
    await waitFor(() => expect(mode).toBeEnabled())
    fireEvent.change(mode, { target: { value: 'weekly' } })
    fireEvent.click(screen.getByRole('button', { name: /Usuń szkic/ }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Usunąć szkic?' })).getByRole('button', { name: 'Usuń' }))

    await waitFor(() => expect(router.state.location.search).toBe(''))
    expect(screen.queryByText('Szkic · v1')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Odrzucić niezapisane zmiany?' })).not.toBeInTheDocument()
    expect(mode).toHaveValue('weekly')
  })

  it('restores the stored settings when closing the panel discards the changes', async () => {
    stub([summary({ id: 'd1' })])
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({ id: 'd1' }))
    renderScreen(<GeneratorPanel />)

    fireEvent.click(await screen.findByRole('button', { name: /Ustawienia generatora/ }))
    const mode = await screen.findByRole('combobox', { name: /Tryb rotacji/ })
    await waitFor(() => expect(mode).toBeEnabled())
    fireEvent.change(mode, { target: { value: 'weekly' } })
    fireEvent.click(screen.getByRole('button', { name: 'Zamknij panel' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Odrzucić niezapisane zmiany?' })).getByRole('button', { name: 'Odrzuć zmiany' }))
    await waitFor(() => expect(screen.queryByRole('combobox', { name: /Tryb rotacji/ })).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Otwórz' }))
    await waitFor(() => expect(api.schedule).toHaveBeenCalledWith('d1'))
    expect(screen.queryByRole('dialog', { name: 'Odrzucić niezapisane zmiany?' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Ustawienia generatora/ }))
    expect(await screen.findByRole('combobox', { name: /Tryb rotacji/ })).toHaveValue('hybrid')
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
    // Changed settings are stored and generated with one button.
    expect(screen.queryByRole('button', { name: 'Generuj' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Zapisz i generuj' })).toBeEnabled()

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
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }))
    expect(await screen.findByRole('button', { name: /Zapisuję…/ })).toBeDisabled()
    expect(save.mock.calls[0][0]).toMatchObject({ fairness_weight: 5 })

    finish({ ...policy, fairness_weight: 5 })
    expect(await screen.findByText('Zapisano.')).toBeInTheDocument()
  })

  it('stores changed settings and generates the open draft range in one step', async () => {
    stub([summary({ id: 'd1' })])
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({ id: 'd1' }))
    const save = vi.spyOn(api, 'updateSchedulingPolicy').mockResolvedValue({ ...policy, fairness_weight: 5 })
    const generate = vi.spyOn(api, 'generateSchedule').mockReturnValue(new Promise(() => {}))
    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })

    expect(await screen.findByText('Szkic · v1')).toBeInTheDocument()
    await chooseFromMenu('Więcej', /Ustawienia generatora/)
    fireEvent.change(await screen.findByRole('spinbutton', { name: /Równy udział/ }), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz i generuj' }))

    await waitFor(() => expect(generate).toHaveBeenCalledWith({ starts_on: '2026-09-17', ends_on: '2026-09-18' }, expect.anything()))
    expect(save.mock.calls[0][0]).toMatchObject({ fairness_weight: 5 })
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(generate.mock.invocationCallOrder[0])
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Ustawienia generatora' })).not.toBeInTheDocument())
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
    renderScreen(<><GeneratorPanel /><Location /></>, { route: '/generator?szkic=d1' })

    // The carried change is stated on the page, before the sheet.
    const decision = await screen.findByRole('region', { name: 'Decyzja o szkicu' })
    expect(await within(decision).findByText('1 zmiana przeniesiona')).toBeInTheDocument()
    fireEvent.click(within(decision).getByRole('button', { name: 'Przeniesione zmiany i anulowane zamiany' }))
    expect(within(decision).getByText('przeniesiona · czw 17 wrz · SECONDARY: Ola Wiśniewska')).toBeInTheDocument()

    fireEvent.click(within(decision).getByRole('button', { name: 'Publikuj v2…' }))
    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: 'Publikuj v2' })
    expect(confirm).toBeDisabled()
    expect(await within(dialog).findByText('Do rozstrzygnięcia: 1 zgoda.')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Rozumiem, że zmieniam dzień/ }))
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)
    expect(await within(dialog).findByRole('button', { name: /Publikuję…/ })).toBeInTheDocument()
    expect(publish.mock.calls[0][0]).toMatchObject({ id: 'd1', expectedVersion: 2, acknowledgeLostChanges: false, acknowledgeGap: false })

    finish(draft({ ...started, status: 'published', version: 3 }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Publikuję/ })).not.toBeInTheDocument())
    expect(await screen.findByText('Opublikowany · v3')).toBeInTheDocument()
    expect(await screen.findByText('Grafik jest opublikowany i widoczny dla zespołu.')).toBeInTheDocument()
    // The coordinator learns that the team was told, and can go and look;
    // the toast names the version they confirmed, not the bumped row version.
    expect(screen.getByText('Opublikowano v2 · 8 – 18 wrz')).toBeInTheDocument()
    expect(screen.getByText('E-maile i kanały ICS zaktualizowane.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Otwórz grafik' }))
    expect(screen.getByLabelText('location')).toHaveTextContent('/grafik?od=2026-09-08')
  })

  it('names a lost swap without a reason and closes on the way back', async () => {
    stub([summary({ id: 'd1', status: 'proposed', version: 2 })])
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({ id: 'd1', status: 'proposed', version: 2 }))
    vi.spyOn(api, 'publishPreview').mockResolvedValue({
      ...preview,
      lost_changes: [{
        service_date: '2026-09-17',
        role: 'primary',
        previous_assignee_name: 'Anna Kowalska',
        new_assignee_name: 'Marek Nowak',
        source: 'approved_swap',
        original_assignee_name: 'Ola Wiśniewska',
        reason: null,
      }],
    })
    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })

    fireEvent.click(await screen.findByRole('button', { name: 'Publikuj v2…' }))
    const dialog = await screen.findByRole('dialog')
    const row = (await within(dialog).findByText('czw 17 wrz · PRIMARY')).parentElement as HTMLElement
    expect(row).toHaveTextContent(/^czw 17 wrz · PRIMARY · zamiana: Anna Kowalska, szkic: Marek Nowak$/)
    expect(within(dialog).getByRole('option', { name: 'Zachowaj zamianę: Anna Kowalska' })).toBeInTheDocument()
    expect(within(dialog).getByRole('option', { name: 'Zachowaj szkic: Marek Nowak' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('checkbox', { name: /Rozumiem, że zmieniam dzień/ })).not.toBeInTheDocument()
    expect(await within(dialog).findByText('Do rozstrzygnięcia: 1 konflikt.')).toBeInTheDocument()
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

    fireEvent.click(await screen.findByRole('button', { name: 'Publikuj v2…' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zamknij' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(publish).not.toHaveBeenCalled()
  })

  it('keeps a publication failure in the open publication dialog', async () => {
    stub([summary({ id: 'd1', status: 'proposed', version: 2 })])
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({ id: 'd1', status: 'proposed', version: 2 }))
    vi.spyOn(api, 'publishPreview').mockResolvedValue({ lost_changes: [], carried_changes: [], pending_swaps: [], uncovered_before: [], stale_changes_count: 0, rest_violations: [] })
    vi.spyOn(api, 'publishSchedule').mockRejectedValue(new ApiError('Propozycja zmieniła się od otwarcia okna', 409))
    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })

    fireEvent.click(await screen.findByRole('button', { name: 'Publikuj v2…' }))
    const dialog = await screen.findByRole('dialog', { name: /Publikuję propozycję/ })
    const publish = await within(dialog).findByRole('button', { name: 'Publikuj v2' })
    await waitFor(() => expect(publish).toBeEnabled())
    fireEvent.click(publish)

    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent('Nie udało się opublikować')
    expect(alert).toHaveTextContent('Propozycja zmieniła się od otwarcia okna')
    // The server message carries no final period, so the hint is its own line
    // rather than a run-on second sentence.
    expect(within(alert).getByText('Wróć do propozycji, sprawdź zmiany i opublikuj ponownie.')).toHaveClass('box-next')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Wróć do propozycji' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Publikuj v2…' }))
    const reopened = await screen.findByRole('dialog', { name: /Publikuję propozycję/ })
    expect(within(reopened).queryByText('Nie udało się opublikować')).not.toBeInTheDocument()
  })

  it('checks the publication again each time the sheet opens and waits for it', async () => {
    stub([summary({ id: 'd1', status: 'proposed', version: 2 })])
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({ id: 'd1', status: 'proposed', version: 2 }))
    let answer: (value: PublishPreview) => void = () => {}
    const check = vi.spyOn(api, 'publishPreview')
      .mockResolvedValueOnce(emptyPreview)
      .mockReturnValueOnce(new Promise((resolve) => { answer = resolve }))
    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })

    const decision = await screen.findByRole('region', { name: 'Decyzja o szkicu' })
    expect(await within(decision).findByText('Co zmieni publikacja')).toBeInTheDocument()
    expect(check).toHaveBeenCalledTimes(1)
    fireEvent.click(within(decision).getByRole('button', { name: 'Publikuj v2…' }))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(check).toHaveBeenCalledTimes(2))
    expect(within(dialog).getByText('Sprawdzam zmiany i oczekujące zamiany…')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Publikuj v2' })).toBeDisabled()

    act(() => answer({ ...emptyPreview, pending_swaps: [{ id: 's1', service_date: '2026-09-18', role: 'secondary', requester_name: 'Marek Nowak', replacement_name: 'Ola Wiśniewska', status: 'pending_replacement' }] }))
    expect(await within(dialog).findByText('Gotowe do publikacji.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Publikuj v2' })).toBeEnabled()
    expect(within(dialog).getByText('1 zamiana anulowana')).toBeInTheDocument()
    expect(within(decision).getByText('1 zamiana anulowana')).toBeInTheDocument()

  })

  it('refuses to publish when the consequences cannot be checked', async () => {
    stub([summary({ id: 'd1', status: 'proposed', version: 2 })])
    vi.spyOn(api, 'schedule').mockResolvedValue(draft({ id: 'd1', status: 'proposed', version: 2 }))
    vi.spyOn(api, 'publishPreview').mockRejectedValue(new ApiError('Błąd serwera', 500))
    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })

    fireEvent.click(await screen.findByRole('button', { name: 'Publikuj v2…' }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Nie udało się sprawdzić skutków publikacji.')
    expect(within(dialog).getByRole('button', { name: 'Publikuj v2' })).toBeDisabled()
  })
})
