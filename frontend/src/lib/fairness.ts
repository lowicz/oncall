import { FairnessCategory, FairnessDuty, FairnessMember } from '../api'
import { formatDecimal } from './numbers'

/** Widest deviation a bar renders at full length; beyond it the bar pins. */
export const DEVIATION_SCALE = 3

export const roundPoints = (value: number) => Math.round(value * 100) / 100

export function deviationWords(value: number) {
  if (Math.abs(value) < 0.01) return 'zgodnie z udziałem'
  return value > 0 ? `${formatDecimal(value)} ponad udział` : `${formatDecimal(Math.abs(value))} poniżej udziału`
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
