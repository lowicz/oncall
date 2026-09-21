import { DraftSchedule } from '../api'
import { roleLabels } from '../lib/labels'
import { formatDate, formatDayShort } from '../lib/dates'
import { Button, EmptyState, RoleMark, StatusBadge, StatusTone } from '../ui'
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
/** Hard rules block the hand-off; the rest is advice the coordinator accepts. */
const HARD: Kind[] = ['conflict', 'rule']
const WHOLE = 'Cały szkic'

export type ProblemGrouping = 'person' | 'rule'

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

/** How many problems block the hand-off and how many are only advice. */
export function problemCounts(result: DraftSchedule) {
  const problems = draftProblems(result)
  const hard = problems.filter((problem) => HARD.includes(problem.kind)).length
  return { hard, soft: problems.length - hard, total: problems.length }
}

/**
 * The problems table under a draft, grouped by person or by rule (captain's
 * choice B); the grouping and the hard-only filter live in the section
 * heading above it. A conflict row opens the matrix cell it points at.
 */
export function DraftProblems({ result, onFocus, editable, by, hardOnly = false }: {
  result: DraftSchedule
  onFocus: (focus: DraftFocus) => void
  editable: boolean
  by: ProblemGrouping
  hardOnly?: boolean
}) {
  const all = draftProblems(result)
  const problems = hardOnly ? all.filter((problem) => HARD.includes(problem.kind)) : all
  if (all.length === 0) {
    return (
      <div className="panel">
        <EmptyState compact icon="check" title="Szkic nie ma otwartych problemów" description="Twarde reguły spełnione, brak kolizji z niedostępnością, nic nie czeka na poprawkę." />
      </div>
    )
  }
  if (problems.length === 0) {
    return (
      <div className="panel">
        <EmptyState compact icon="check" title="Reguły twarde: 0 naruszeń" description={`Pozostają ${all.length === 1 ? '1 ostrzeżenie miękkie' : `${all.length} ostrzeżenia miękkie`}; wyłącz filtr „Tylko twarde”, żeby je zobaczyć.`} />
      </div>
    )
  }
  const groups = new Map<string, Problem[]>()
  for (const problem of problems) {
    const key = by === 'person' ? problem.person : KIND_LABEL[problem.kind]
    groups.set(key, [...(groups.get(key) ?? []), problem])
  }
  const hard = all.filter((problem) => HARD.includes(problem.kind)).length
  return (
    <div className="panel wide-scroll">
      <table className="lg" aria-label="Problemy szkicu">
        <thead>
          <tr>
            <th scope="col">{by === 'person' ? 'Osoba' : 'Reguła'}</th>
            <th scope="col">{by === 'person' ? 'Reguła' : 'Kogo · kiedy'}</th>
            <th scope="col">Szczegół</th>
            <th scope="col" className="n">Akcja</th>
          </tr>
        </thead>
        <tbody>
          {[...groups.entries()].map(([group, items]) => items.map((problem, index) => (
            <tr key={problem.key}>
              {index === 0 ? (
                <th scope="rowgroup" rowSpan={items.length}>
                  {by === 'person' ? group : <StatusBadge tone={KIND_TONE[problem.kind]}>{group}</StatusBadge>}
                </th>
              ) : null}
              <td>
                {by === 'person'
                  ? <StatusBadge tone={KIND_TONE[problem.kind]}>{KIND_LABEL[problem.kind]}</StatusBadge>
                  : <><b>{problem.person}</b>{problem.date && <small>{formatDayShort(problem.date)} · {problem.role ? roleLabels[problem.role] : ''}</small>}</>}
              </td>
              <td>
                <span className="problems-cell">
                  {problem.role && <RoleMark role={problem.role} size="sm" />}
                  {problem.detail}
                  <small className="muted">{HARD.includes(problem.kind) ? 'twarda · blokuje przekazanie' : 'miękka'}</small>
                </span>
              </td>
              <td className="n">
                {problem.focus && (
                  <Button size="sm" onClick={() => onFocus(problem.focus!)} disabled={!editable}>
                    {editable ? 'Popraw' : 'Pokaż dzień'}
                  </Button>
                )}
              </td>
            </tr>
          )))}
          <tr>
            <td colSpan={4} className="muted small problems-foot">
              Reguły twarde (jedna rola na osobę i dzień, przerwa między dyżurami, kwalifikacje, „nie mogę”): {hard === 0 ? '0 naruszeń' : `${hard} ${hard === 1 ? 'naruszenie' : hard < 5 ? 'naruszenia' : 'naruszeń'}`}.
              {' '}Pełna lista reguł: <a href="/docs/produkt/generator.html">docs / generator</a>.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
