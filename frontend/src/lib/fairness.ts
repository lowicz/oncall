import { queryOptions, skipToken } from '@tanstack/react-query'
import { DraftFairnessImpact, DraftSchedule, FairnessCategory, FairnessDuty, FairnessMember, api } from '../api'
import { messages } from '../i18n/messages'
import { formatDecimal, formatPoints } from './numbers'

/** Widest deviation a bar renders at full length; beyond it the bar pins. */
export const DEVIATION_SCALE = 3

/** The fairness impact of one draft version: one cache entry the generator,
 *  its matrix and its fairness panel share. Nothing is fetched without a draft. */
export const draftFairnessImpactQuery = (draft: Pick<DraftSchedule, 'id' | 'version'> | null) => queryOptions<DraftFairnessImpact>({
  queryKey: ['draft-fairness-impact', draft?.id, draft?.version],
  queryFn: draft ? () => api.draftFairnessImpact(draft.id, draft.version) : skipToken,
})

export const roundPoints = (value: number) => Math.round(value * 100) / 100

export function deviationWords(value: number) {
  const t = messages().fairness.deviation
  if (Math.abs(value) < 0.01) return t.onShare
  return value > 0 ? t.aboveShare(formatDecimal(value)) : t.belowShare(formatDecimal(Math.abs(value)))
}

/**
 * The on-call balance of one person across the lenses that carry points.
 * Weekends and holidays are subsets of those points and never added (D4,
 * MED6-01); the 11–19 lens counts only when it is balanced on its own (D1).
 * The deviation is rebuilt from the parts, not from the rounded sums.
 */
export function totalBalance(member: FairnessMember, lateShiftBalanced: boolean): FairnessCategory {
  const sum = (field: keyof FairnessCategory) =>
    roundPoints(member.primary[field] + member.secondary[field] + (lateShiftBalanced ? member.late_shift[field] : 0))
  return { actual: sum('actual'), expected: sum('expected'), deviation: sum('deviation') }
}

export interface MonthTotals {
  /** "2026-09" */
  month: string
  points: number
  duties: number
  weekends: number
}

/** Duties folded into calendar months, newest first. */
export function monthlyTotals(duties: FairnessDuty[]): MonthTotals[] {
  const byMonth = new Map<string, MonthTotals>()
  for (const duty of duties) {
    const month = duty.service_date.slice(0, 7)
    const row = byMonth.get(month) ?? { month, points: 0, duties: 0, weekends: 0 }
    row.points = roundPoints(row.points + duty.points)
    row.duties += 1
    if (duty.is_day_off) row.weekends += 1
    byMonth.set(month, row)
  }
  return [...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month))
}

export function impactLabel(before: number, after: number) {
  const t = messages().generator.fairness.impact
  const change = Math.round((Math.abs(before) - Math.abs(after)) * 100) / 100
  if (Math.abs(change) < 0.05) return t.noChange
  return change > 0 ? t.closer(formatPoints(change)) : t.further(formatPoints(-change))
}

/** The widest lens spread: the number the acceptance criterion judges. */
export function worstSpread(impact: DraftFairnessImpact) {
  return {
    before: Math.max(0, ...impact.spreads.map((item) => item.before)),
    after: Math.max(0, ...impact.spreads.map((item) => item.after)),
  }
}

/**
 * Why the criterion is missed. `inherited` when every lens outside it was
 * outside it before the draft too: history the generator repays at a bounded
 * pace, not a defect of this draft. `draft` when a lens that met the criterion
 * stops meeting it - that is what editing cells or regenerating can fix.
 */
export function shortfallCause(impact: DraftFairnessImpact): 'met' | 'inherited' | 'draft' {
  if (impact.criterion_met) return 'met'
  const failing = impact.spreads.filter((item) => !item.meets_criterion)
  return failing.length > 0 && failing.every((item) => item.before > impact.criterion_points) ? 'inherited' : 'draft'
}
