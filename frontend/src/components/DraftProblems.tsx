import { DraftSchedule } from '../api'
import { messages, useMessages } from '../i18n'
import { roleLabels } from '../lib/labels'
import { formatDate, formatDayShort } from '../lib/dates'
import { docsHref } from '../lib/nav'
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

const KIND_TONE: Record<Kind, StatusTone> = { conflict: 'bad', rule: 'bad', solver: 'warn', gap: 'warn', stale: 'warn' }
/** Hard rules block the hand-off; the rest is advice the coordinator accepts. */
const HARD: Kind[] = ['conflict', 'rule']

export type ProblemGrouping = 'person' | 'rule'

/** Everything the draft still has to answer for, one row per problem. */
export function draftProblems(result: DraftSchedule): Problem[] {
  const t = messages().generator.problems
  const problems: Problem[] = []
  for (const item of result.unavailability_conflicts ?? []) {
    problems.push({
      key: `conflict:${item.service_date}:${item.role}`,
      kind: 'conflict',
      person: item.assignee_name,
      date: item.service_date,
      role: item.role,
      detail: t.conflictDetail(roleLabels()[item.role], formatDate(item.service_date)),
      focus: { service_date: item.service_date, assignee_name: item.assignee_name, role: item.role },
    })
  }
  for (const warning of result.warnings ?? []) {
    problems.push({
      key: `${warning.source}:${warning.message}`,
      kind: warning.source === 'rules' ? 'rule' : 'solver',
      person: t.wholeDraft,
      detail: warning.message,
    })
  }
  if (result.uncovered_before?.length) {
    problems.push({
      key: 'gap',
      kind: 'gap',
      person: t.wholeDraft,
      detail: t.gapDetail(result.uncovered_before.length, result.uncovered_before.map(formatDate).join(', ')),
    })
  }
  if (result.stale_changes_count) {
    problems.push({
      key: 'stale',
      kind: 'stale',
      person: t.wholeDraft,
      detail: t.staleDetail(result.stale_changes_count),
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
  const t = useMessages().generator.problems
  const all = draftProblems(result)
  const problems = hardOnly ? all.filter((problem) => HARD.includes(problem.kind)) : all
  if (all.length === 0) {
    return (
      <div className="panel">
        <EmptyState compact icon="check" title={t.noneTitle} description={t.noneHint} />
      </div>
    )
  }
  if (problems.length === 0) {
    return (
      <div className="panel">
        <EmptyState compact icon="check" title={t.noHardTitle} description={t.noHardHint(all.length)} />
      </div>
    )
  }
  const groups = new Map<string, Problem[]>()
  for (const problem of problems) {
    const key = by === 'person' ? problem.person : t.kinds[problem.kind]
    groups.set(key, [...(groups.get(key) ?? []), problem])
  }
  const hard = all.filter((problem) => HARD.includes(problem.kind)).length
  return (
    <div className="panel wide-scroll">
      <table className="lg" aria-label={t.table}>
        <thead>
          <tr>
            <th scope="col">{by === 'person' ? t.person : t.rule}</th>
            <th scope="col">{by === 'person' ? t.rule : t.whoWhen}</th>
            <th scope="col">{t.detail}</th>
            <th scope="col" className="n">{t.action}</th>
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
                  ? <StatusBadge tone={KIND_TONE[problem.kind]}>{t.kinds[problem.kind]}</StatusBadge>
                  : <><b>{problem.person}</b>{problem.date && <small>{formatDayShort(problem.date)} · {problem.role ? roleLabels()[problem.role] : ''}</small>}</>}
              </td>
              <td>
                <span className="problems-cell">
                  {problem.role && <RoleMark role={problem.role} size="sm" />}
                  {problem.detail}
                  <small className="muted">{HARD.includes(problem.kind) ? t.hardBlocks : t.soft}</small>
                </span>
              </td>
              <td className="n">
                {problem.focus && (
                  <Button size="sm" onClick={() => onFocus(problem.focus!)} disabled={!editable}>
                    {editable ? t.fix : t.showDay}
                  </Button>
                )}
              </td>
            </tr>
          )))}
          <tr>
            <td colSpan={4} className="muted small problems-foot">
              {t.hardRulesSummary(t.violations(hard))}
              {' '}{t.fullRules} <a href={`${docsHref()}produkt/generator.html`}>{t.docsLink}</a>.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
