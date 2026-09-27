import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { renderScreen } from '../test/render'
import { DraftSchedule } from '../api'
import { DraftProblems, draftProblems, problemCounts } from './DraftProblems'

const draft = (over: Partial<DraftSchedule>): DraftSchedule => ({
  id: 'd1',
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

const detail = (result: DraftSchedule, kind: string) =>
  draftProblems(result).find((problem) => problem.kind === kind)?.detail

describe('draftProblems', () => {
  it.each([
    [1, 'od wygenerowania zmienił się 1 wpis'],
    [3, 'od wygenerowania zmieniły się 3 wpisy'],
    [5, 'od wygenerowania zmieniło się 5 wpisów'],
  ])('words %i stale changes with the verb agreeing', (count, text) => {
    expect(detail(draft({ stale_changes_count: count }), 'stale')).toBe(text)
  })

  it('has no stale row when nothing changed since generation', () => {
    expect(detail(draft({ stale_changes_count: 0 }), 'stale')).toBeUndefined()
  })

  it.each([
    [['2026-09-16'], '1 nieobsadzony dzień: 16-09-2026'],
    [['2026-09-15', '2026-09-16'], '2 nieobsadzone dni: 15-09-2026, 16-09-2026'],
  ])('words the uncovered days before the draft by count', (days, text) => {
    expect(detail(draft({ uncovered_before: days }), 'gap')).toBe(text)
  })
})

const troubled = draft({
  unavailability_conflicts: [
    { service_date: '2026-09-17', role: 'primary', assignee_name: 'Anna Kowalska' },
    { service_date: '2026-09-18', role: 'secondary', assignee_name: 'Anna Kowalska' },
  ],
  warnings: [
    { source: 'rules', message: 'Przerwa między dyżurami krótsza niż 24 h' },
    { source: 'solver', message: 'Limit czasu solvera' },
  ],
  stale_changes_count: 2,
})

describe('problemCounts', () => {
  it('splits the problems into blocking and advisory ones', () => {
    expect(problemCounts(troubled)).toEqual({ hard: 3, soft: 2, total: 5 })
    expect(problemCounts(draft({}))).toEqual({ hard: 0, soft: 0, total: 0 })
  })
})

describe('DraftProblems', () => {
  it('says a clean draft has nothing to answer for', () => {
    renderScreen(<DraftProblems result={draft({})} onFocus={vi.fn()} editable by="person" />)
    expect(screen.getByText('Szkic nie ma otwartych problemów')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('says only advice is left when the hard-only filter hides everything', () => {
    renderScreen(<DraftProblems result={draft({ stale_changes_count: 1 })} onFocus={vi.fn()} editable by="person" hardOnly />)
    expect(screen.getByText('Reguły twarde: 0 naruszeń')).toBeInTheDocument()
    expect(screen.getByText('Pozostają 1 ostrzeżenie miękkie; wyłącz filtr „Tylko twarde”, żeby je zobaczyć.')).toBeInTheDocument()
  })

  it('groups the problems by person and opens the cell a conflict points at', () => {
    const onFocus = vi.fn()
    renderScreen(<DraftProblems result={troubled} onFocus={onFocus} editable by="person" />)

    const table = screen.getByRole('table', { name: 'Problemy szkicu' })
    expect(within(table).getByRole('columnheader', { name: 'Osoba' })).toBeInTheDocument()
    const anna = within(table).getByRole('rowheader', { name: 'Anna Kowalska' })
    expect(anna).toHaveAttribute('rowspan', '2')
    expect(within(table).getByRole('rowheader', { name: 'Cały szkic' })).toHaveAttribute('rowspan', '3')
    expect(within(table).getAllByText('Dyżur w dniu „nie mogę”')).toHaveLength(2)
    expect(within(table).getByText('Limit czasu solvera').parentElement).toHaveTextContent('miękka')
    expect(within(table).getByText('Reguły twarde (jedna rola na osobę i dzień, przerwa między dyżurami, kwalifikacje, „nie mogę”): 3 naruszenia.', { exact: false })).toBeInTheDocument()
    expect(within(table).getByRole('link', { name: 'docs / generator' })).toHaveAttribute('href', '/docs/produkt/generator.html')

    fireEvent.click(within(table).getAllByRole('button', { name: 'Popraw' })[1])
    expect(onFocus).toHaveBeenCalledWith({ service_date: '2026-09-18', assignee_name: 'Anna Kowalska', role: 'secondary' })
  })

  it('groups the blocking problems by rule and only shows the day of a read-only draft', () => {
    renderScreen(<DraftProblems result={troubled} onFocus={vi.fn()} editable={false} by="rule" hardOnly />)

    const table = screen.getByRole('table', { name: 'Problemy szkicu' })
    expect(within(table).getByRole('columnheader', { name: 'Kogo · kiedy' })).toBeInTheDocument()
    expect(within(table).getByRole('rowheader', { name: 'Dyżur w dniu „nie mogę”' })).toHaveAttribute('rowspan', '2')
    expect(within(table).getByRole('rowheader', { name: 'Złamana reguła twarda' })).toBeInTheDocument()
    expect(within(table).queryByText('Szkic nieaktualny')).not.toBeInTheDocument()
    expect(within(table).getByText('czw 17 wrz · PRIMARY')).toBeInTheDocument()
    const buttons = within(table).getAllByRole('button', { name: 'Pokaż dzień' })
    expect(buttons).toHaveLength(2)
    expect(buttons[0]).toBeDisabled()
  })
})
