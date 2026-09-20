import { useState } from 'react'
import { DraftSchedule } from '../api'
import { roleLabels } from '../lib/labels'
import { formatDate } from '../lib/dates'
import { Button, EmptyState, RoleMark, Segmented, StatusBadge, StatusTone } from '../ui'
import { DraftFocus } from './DraftScheduleMatrix'

type Kind = 'conflict' | 'rule' | 'solver' | 'gap' | 'stale'

interface Problem {
  key: string
  kind: Kind
  person: string
  detail: string
  date?: string
  role?: DraftFocus['role']
  focus?: DraftFocus
}

const KIND_LABEL: Record<Kind, string> = {
  conflict: 'Dyżur w dniu „nie mogę”',
  rule: 'Złamana reguła twarda',
  solver: 'Ostrzeżenie solvera',
  gap: 'Luka przed szkicem',
  stale: 'Szkic nieaktualny',
}
const KIND_TONE: Record<Kind, StatusTone> = { conflict: 'bad', rule: 'bad', solver: 'warn', gap: 'warn', stale: 'warn' }
const WHOLE = 'Cały szkic'

/** Everything the draft still has to answer for, one row per problem. */
export function draftProblems(result: DraftSchedule): Problem[] {
  const problems: Problem[] = []
  for (const item of result.unavailability_conflicts ?? []) {
    problems.push({
      key: `conflict:${item.service_date}:${item.role}`,
      kind: 'conflict',
      person: item.assignee_name,
      date: item.service_date,
      role: item.role,
      detail: `${roleLabels[item.role]} ${formatDate(item.service_date)}`,
      focus: { service_date: item.service_date, assignee_name: item.assignee_name, role: item.role },
    })
  }
  for (const warning of result.warnings ?? []) {
    problems.push({
      key: `${warning.source}:${warning.message}`,
      kind: warning.source === 'rules' ? 'rule' : 'solver',
      person: WHOLE,
      detail: warning.message,
    })
  }
  if (result.uncovered_before?.length) {
    problems.push({
      key: 'gap',
      kind: 'gap',
      person: WHOLE,
      detail: `${result.uncovered_before.length} ${result.uncovered_before.length === 1 ? 'nieobsadzony dzień' : 'nieobsadzonych dni'}: ${result.uncovered_before.map(formatDate).join(', ')}`,
    })
  }
  if (result.stale_changes_count) {
    problems.push({
      key: 'stale',
      kind: 'stale',
      person: WHOLE,
      detail: `od wygenerowania zmieniło się ${result.stale_changes_count} wpisów`,
    })
  }
  return problems
}

/**
 * The problems table under a draft, grouped by person or by rule (captain's
 * choice B). A conflict row opens the matrix cell it points at.
 */
export function DraftProblems({ result, onFocus, editable }: {
  result: DraftSchedule
  onFocus: (focus: DraftFocus) => void
  editable: boolean
}) {
  const [by, setBy] = useState<'person' | 'rule'>('person')
  const problems = draftProblems(result)
  if (problems.length === 0) {
    return <EmptyState compact icon="check" title="Szkic nie ma otwartych problemów" description="Twarde reguły spełnione, brak kolizji z niedostępnością, nic nie czeka na poprawkę." />
  }
  const groups = new Map<string, Problem[]>()
  for (const problem of problems) {
    const key = by === 'person' ? problem.person : KIND_LABEL[problem.kind]
    groups.set(key, [...(groups.get(key) ?? []), problem])
  }
  return (
    <div className="stack-sm">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="small muted">{problems.length} {problems.length === 1 ? 'problem' : problems.length < 5 ? 'problemy' : 'problemów'}</span>
        <Segmented<'person' | 'rule'>
          size="sm"
          label="Grupowanie problemów"
          value={by}
          onChange={setBy}
          options={[{ value: 'person', label: 'wg osoby' }, { value: 'rule', label: 'wg reguły' }]}
        />
      </div>
      <div className="panel wide-scroll">
        <table className="lg" aria-label="Problemy szkicu">
          <thead>
            <tr>
              <th scope="col">{by === 'person' ? 'Osoba' : 'Reguła'}</th>
              <th scope="col">{by === 'person' ? 'Reguła' : 'Osoba'}</th>
              <th scope="col">Szczegóły</th>
              <th scope="col"><span className="sr-only">Akcja</span></th>
            </tr>
          </thead>
          <tbody>
            {[...groups.entries()].map(([group, items]) => items.map((problem, index) => (
              <tr key={problem.key}>
                {index === 0 ? <th scope="rowgroup" rowSpan={items.length}>{group}</th> : null}
                <td>
                  {by === 'person'
                    ? <StatusBadge tone={KIND_TONE[problem.kind]}>{KIND_LABEL[problem.kind]}</StatusBadge>
                    : problem.person}
                </td>
                <td>
                  <span className="problems-cell">
                    {problem.role && <RoleMark role={problem.role} size="sm" />}
                    {problem.detail}
                  </span>
                </td>
                <td className="n">
                  {problem.focus && (
                    <Button size="sm" onClick={() => onFocus(problem.focus!)} disabled={!editable}>
                      {editable ? 'Popraw' : 'Pokaż'}
                    </Button>
                  )}
                </td>
              </tr>
            )))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
