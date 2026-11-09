import { DraftSchedule } from '../api'
import { useMessages } from '../i18n'
import { roleLabels } from '../lib/labels'
import { formatDayShort } from '../lib/dates'
import { docsHref } from '../lib/nav'
import { useNarrow } from '../hooks/useMediaQuery'
import { Button, EmptyState, RoleMark, StatusBadge, StatusTone } from '../ui'
import { DraftFocus } from './DraftScheduleMatrix'
import { HARD, Kind, Problem, draftProblems } from '../lib/draftProblems'

const KIND_TONE: Record<Kind, StatusTone> = { conflict: 'bad', rule: 'bad', solver: 'warn', gap: 'warn', stale: 'warn' }
const KIND_SEVERITY: Record<Kind, 'hardBlocks' | 'hardConsent' | 'soft'> = { conflict: 'hardBlocks', rule: 'hardConsent', solver: 'soft', gap: 'soft', stale: 'soft' }

export type ProblemGrouping = 'person' | 'rule'

/**
 * The problems table under a draft, grouped by person or by rule (captain's
 * choice B); the grouping and the hard-only filter live in the section
 * heading above it. A conflict row opens the matrix cell it points at. On a
 * phone the rows become a list of cards, so the action stays on screen.
 */
export function DraftProblems({ result, onFocus, editable, by, hardOnly = false }: {
  result: DraftSchedule
  onFocus: (focus: DraftFocus) => void
  editable: boolean
  by: ProblemGrouping
  hardOnly?: boolean
}) {
  const t = useMessages().generator.problems
  const narrow = useNarrow()
  const all = draftProblems(result)
  const problems = hardOnly ? all.filter((problem) => HARD.has(problem.kind)) : all
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
  const hard = all.filter((problem) => HARD.has(problem.kind)).length
  // A card names the day and role in its header, so only the table marks the role.
  const detail = (problem: Problem) => (
    <span className="problems-cell">
      {!narrow && problem.role && <RoleMark role={problem.role} size="sm" />}
      {problem.detail}
      <small className="muted">{t[KIND_SEVERITY[problem.kind]]}</small>
    </span>
  )
  const action = (problem: Problem) => problem.focus && (
    <Button size="sm" onClick={() => onFocus(problem.focus!)} disabled={!editable}>
      {editable ? t.fix : t.showDay}
    </Button>
  )
  const foot = (
    <>
      {t.hardRulesSummary(t.violations(hard))}
      {' '}<a href={`${docsHref()}produkt/generator.html`}>{t.docsLink}</a>.
    </>
  )
  if (narrow) {
    return (
      <div className="panel">
        <ul className="list problems-list" aria-label={t.table}>
          {[...groups.values()].flat().map((problem) => (
            <li key={problem.key} className="list-row">
              <div className="list-main stack-sm">
                <div className="row">
                  <StatusBadge tone={KIND_TONE[problem.kind]}>{t.kinds[problem.kind]}</StatusBadge>
                  <b>{problem.person}</b>
                  {problem.date && problem.role && <small>{formatDayShort(problem.date)} · {roleLabels()[problem.role]}</small>}
                </div>
                {detail(problem)}
              </div>
              {problem.focus && <div className="list-aside">{action(problem)}</div>}
            </li>
          ))}
        </ul>
        <p className="muted small problems-foot">{foot}</p>
      </div>
    )
  }
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
                  : <><b>{problem.person}</b>{problem.date && problem.role && <small>{formatDayShort(problem.date)} · {roleLabels()[problem.role]}</small>}</>}
              </td>
              <td>{detail(problem)}</td>
              <td className="n">{action(problem)}</td>
            </tr>
          )))}
          <tr>
            <td colSpan={4} className="muted small problems-foot">{foot}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
