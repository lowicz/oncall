import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { renderScreen } from '../test/render'
import { api } from '../api'
import type { DraftFairnessImpact, DraftSchedule, PublishPreview } from '../api'
import { loadRealStylesheet } from '../test/stylesheet'
import { DraftDecision, PublicationEffects } from './DraftDecision'

const draft = (over: Partial<DraftSchedule> = {}): DraftSchedule => ({
  id: 'd1',
  name: 'Szkic',
  starts_on: '2026-09-17',
  ends_on: '2026-09-18',
  status: 'draft',
  version: 2,
  rotation_mode: 'hybrid',
  solver_status: 'OPTIMAL',
  acceptance_floor: null,
  assignments: [],
  ...over,
})

const impact = (over: Partial<DraftFairnessImpact> = {}): DraftFairnessImpact => ({
  schedule_id: 'd1',
  schedule_version: 2,
  baseline_as_of: '2026-09-16',
  projected_as_of: '2026-09-18',
  baseline_members: [],
  projected_members: [],
  late_shift_balanced: false,
  criterion_points: 1,
  criterion_met: true,
  spreads: [{ lens: 'primary', before: 1, after: 0.5, meets_criterion: true }],
  acceptance_floor: null,
  ...over,
})

const preview = (over: Partial<PublishPreview> = {}): PublishPreview => ({
  lost_changes: [],
  carried_changes: [],
  pending_swaps: [],
  uncovered_before: [],
  stale_changes_count: 0,
  rest_violations: [],
  ...over,
})

function show(result: DraftSchedule, { fairness = impact(), effects, error }: { fairness?: DraftFairnessImpact; effects?: PublishPreview; error?: string } = {}) {
  vi.spyOn(api, 'draftFairnessImpact').mockResolvedValue(fairness)
  const actions = { onFix: vi.fn(), onPropose: vi.fn(), onPublish: vi.fn(), onWithdraw: vi.fn() }
  renderScreen(<DraftDecision result={result} preview={effects} busy={false} error={error} {...actions} />)
  return { panel: screen.getByRole('region', { name: 'Decyzja o szkicu' }), ...actions }
}

afterEach(() => vi.restoreAllMocks())

describe('DraftDecision', () => {
  it('sends a draft with conflicts to fixing them, the publication after', async () => {
    const { panel, onFix } = show(draft({
      unavailability_conflicts: [{ service_date: '2026-09-17', role: 'primary', assignee_name: 'Anna Kowalska' }],
    }))
    expect(await within(panel).findByText('kryterium 1 pkt spełnione')).toBeInTheDocument()
    expect(within(panel).getByText('1 naruszenie reguł twardych')).toBeInTheDocument()
    expect(panel).toHaveTextContent('Blokują publikację: Anna Kowalska · PRIMARY czw 17 wrz.')
    expect(within(panel).getByText('Rozrzut 1 → 0,5 pkt.')).toBeInTheDocument()
    expect(within(panel).getByText('potem: Opublikuj…')).toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: 'Opublikuj…' })).not.toBeInTheDocument()
    fireEvent.click(within(panel).getByRole('button', { name: 'Popraw 1 problem' }))
    expect(onFix).toHaveBeenCalledWith({ service_date: '2026-09-17', role: 'primary', assignee_name: 'Anna Kowalska' })
  })

  it('publishes a clean draft straight away and keeps the hand-off in the menu', async () => {
    const { panel, onPublish, onPropose } = show(draft())
    expect(within(panel).getByText('Reguły twarde spełnione')).toBeInTheDocument()
    expect(within(panel).getByText('Szkic spełnia reguły twarde i można go opublikować.')).toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: 'Przekaż do akceptacji' })).not.toBeInTheDocument()
    fireEvent.click(within(panel).getByRole('button', { name: 'Opublikuj…' }))
    expect(onPublish).toHaveBeenCalled()
    expect(onPropose).not.toHaveBeenCalled()

    fireEvent.click(within(panel).getByRole('button', { name: 'Inne akcje' }))
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Przekaż do akceptacji' }))
    expect(onPropose).toHaveBeenCalled()
  })

  it('says inline why the draft could not be readied for publication', () => {
    const { panel } = show(draft(), { error: 'Szkic zmienił się od otwarcia' })
    expect(within(panel).getByRole('alert')).toHaveTextContent('Szkic zmienił się od otwarcia')
  })

  it('sends a proposal with a conflict back to the draft as its one action', () => {
    const { panel, onWithdraw } = show(draft({
      status: 'proposed',
      unavailability_conflicts: [{ service_date: '2026-09-18', role: 'secondary', assignee_name: 'Marek Nowak' }],
    }))
    expect(panel).toHaveTextContent('Blokują publikację: Marek Nowak · SECONDARY pt 18 wrz.')
    expect(within(panel).queryByRole('button', { name: /^Publikuj/ })).not.toBeInTheDocument()
    fireEvent.click(within(panel).getByRole('button', { name: 'Wróć do szkicu' }))
    expect(onWithdraw).toHaveBeenCalled()
  })

  it('publishes a clean proposal and still lets it go back to the draft', () => {
    const { panel, onPublish, onWithdraw } = show(draft({ status: 'proposed' }))
    fireEvent.click(within(panel).getByRole('button', { name: 'Publikuj v2…' }))
    fireEvent.click(within(panel).getByRole('button', { name: 'Wróć do szkicu' }))
    expect(onPublish).toHaveBeenCalled()
    expect(onWithdraw).toHaveBeenCalled()
  })

  it.each([
    ['published', 'Grafik jest opublikowany i widoczny dla zespołu.'],
    ['superseded', 'Ten grafik zastąpiła nowsza publikacja.'],
  ] as const)('offers no action on a %s schedule', (status, sentence) => {
    const { panel } = show(draft({ status }))
    expect(within(panel).getByText(sentence)).toBeInTheDocument()
    expect(within(panel).queryByRole('button')).not.toBeInTheDocument()
  })

  it('points an incomplete solution at the cells with a gap', () => {
    const { panel } = show(draft({ solver_status: 'INFEASIBLE' }))
    expect(within(panel).getByText('Niepełne rozwiązanie')).toBeInTheDocument()
    expect(within(panel).getByText(/status INFEASIBLE\)\. Kliknij komórkę z luką, aby wpisać osobę/)).toBeInTheDocument()
  })

  it('points broken hard rules without a conflict at the problems tab', () => {
    const { panel } = show(draft({ warnings: [{ source: 'rules', message: 'Anna: 4 dni z rzędu.' }] }))
    expect(within(panel).getByText('Złamane reguły opisuje zakładka Problemy pod macierzą.')).toBeInTheDocument()
  })

  it('calls a criterion missed before the draft an inherited debt', async () => {
    const { panel } = show(draft(), {
      fairness: impact({ criterion_met: false, spreads: [{ lens: 'weekends', before: 2, after: 1.5, meets_criterion: false }] }),
    })
    expect(await within(panel).findByText('kryterium 1 pkt niespełnione · zastany dług')).toBeInTheDocument()
    expect(within(panel).getByText(/^Rozrzut 2 → 1,5 pkt; soczewki poza kryterium były poza nim przed szkicem\./)).toBeInTheDocument()
  })

  it('blames the draft when a lens that met the criterion stops meeting it', async () => {
    const { panel } = show(draft(), {
      fairness: impact({ criterion_met: false, spreads: [{ lens: 'primary', before: 0.5, after: 1.5, meets_criterion: false }] }),
    })
    expect(await within(panel).findByText('kryterium 1 pkt niespełnione')).toBeInTheDocument()
    expect(within(panel).getByText('Rozrzut 0,5 → 1,5 pkt; soczewka, która mieściła się w kryterium, po publikacji je przekracza.')).toBeInTheDocument()
  })

  it('lists what the publication changes, with the carried and cancelled ones behind a disclosure', () => {
    const { panel } = show(draft({ status: 'proposed', warnings: [{ source: 'solver', message: 'Zawieszone.' }] }), {
      effects: preview({
        carried_changes: [{
          service_date: '2026-09-17',
          role: 'primary',
          previous_assignee_name: 'Ola Wiśniewska',
          new_assignee_name: 'Anna Kowalska',
          source: 'override',
          original_assignee_name: 'Anna Kowalska',
          reason: null,
        }],
        pending_swaps: [{
          id: 's1',
          service_date: '2026-09-18',
          role: 'secondary',
          requester_name: 'Marek Nowak',
          replacement_name: 'Ola Wiśniewska',
          status: 'pending_replacement',
        }],
        stale_changes_count: 3,
      }),
    })
    const list = within(panel).getByRole('list')
    expect([...list.querySelectorAll('li')].map((item) => item.textContent)).toEqual([
      '1 zmiana przeniesiona',
      '1 zamiana anulowana',
      '3 wpisy zmienione od wygenerowania',
      '1 ostrzeżenie miękkie do audytu',
      'wcześniejszy grafik obowiązuje dalej poza tym zakresem',
    ])
    fireEvent.click(within(panel).getByRole('button', { name: 'Przeniesione zmiany i anulowane zamiany' }))
    expect(within(panel).getByText('przeniesiona · czw 17 wrz · PRIMARY: Ola Wiśniewska')).toBeInTheDocument()
    expect(within(panel).getByText('anulowana · pt 18 wrz · SECONDARY: Marek Nowak → Ola Wiśniewska')).toBeInTheDocument()
  })

  it('says only that the earlier schedule stays when the publication changes nothing else', () => {
    const { panel } = show(draft({ status: 'proposed' }), { effects: preview() })
    expect(within(panel).getByText('Co zmieni publikacja')).toBeInTheDocument()
    expect(within(panel).getByRole('list')).toHaveTextContent(/^wcześniejszy grafik obowiązuje dalej poza tym zakresem$/)
    expect(within(panel).queryByRole('button', { name: 'Przeniesione zmiany i anulowane zamiany' })).not.toBeInTheDocument()
  })

  it('keeps the effects on one wrapping line inside the publication sheet', () => {
    loadRealStylesheet()
    renderScreen(<div className="dialog-body"><PublicationEffects preview={preview({ stale_changes_count: 1 })} soft={2} /></div>)
    const list = screen.getByText('1 wpis zmieniony od wygenerowania').closest('ul') as HTMLElement
    // The sheet's own list rule must not turn the sentence into an indented column.
    expect(getComputedStyle(list).display).toBe('flex')
    expect(getComputedStyle(list).paddingLeft).toBe('0px')
  })
})
