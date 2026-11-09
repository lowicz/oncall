import type { DraftSchedule } from '../api'
import type { DraftFocus } from '../components/DraftScheduleMatrix'
import { messages } from '../i18n/messages'
import { formatDate } from './dates'
import { roleLabels } from './labels'

/** CP-SAT statuses that mean the model was actually solved. */
export const SOLVER_OK = new Set(['OPTIMAL', 'FEASIBLE'])

export type Kind = 'conflict' | 'rule' | 'solver' | 'gap' | 'stale'

export interface Problem {
  key: string
  kind: Kind
  person: string
  detail: string
  date?: string
  role?: DraftFocus['role']
  focus?: DraftFocus
}

/** Hard problems: a conflict blocks the publication, a broken rule needs consent in the sheet; the rest is advice. */
export const HARD = new Set<Kind>(['conflict', 'rule'])

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
    const person = warning.member_name
    const date = warning.days?.[0]
    // A broken rule opens the person's on-call duty on its first day.
    const duty = person && date
      ? result.assignments.find((item) => item.service_date === date && item.assignee_name === person && item.role !== 'late_shift')
      : undefined
    problems.push({
      key: `${warning.source}:${warning.message}`,
      kind: warning.source === 'rules' ? 'rule' : 'solver',
      person: person ?? t.wholeDraft,
      detail: warning.message,
      date: duty?.service_date,
      role: duty?.role,
      focus: duty && { service_date: duty.service_date, assignee_name: duty.assignee_name, role: duty.role },
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
  const hard = problems.filter((problem) => HARD.has(problem.kind)).length
  return { hard, soft: problems.length - hard, total: problems.length }
}
