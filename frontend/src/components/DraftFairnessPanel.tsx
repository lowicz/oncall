import { useQuery } from '@tanstack/react-query'
import { DraftFairnessImpact, DraftSchedule, FairnessMember, api } from '../api'
import { locale, messages, useMessages } from '../i18n'
import { lensLabels } from '../lib/labels'
import { DEVIATION_SCALE, deviationWords, totalBalance } from '../lib/fairness'
import { formatDecimal, formatPoints, signedPoints } from '../lib/numbers'
import { formatDate } from '../lib/dates'
import { Box, Chip, ChipRow, DeviationBar, ErrorState, LoadingBlock, StatusBadge } from '../ui'

export function impactLabel(before: number, after: number) {
  const t = messages().generator.fairness.impact
  const change = Math.round((Math.abs(before) - Math.abs(after)) * 100) / 100
  if (Math.abs(change) < 0.05) return t.noChange
  if (change > 0) return t.closer(formatPoints(change))
  if (change < 0) return t.further(formatPoints(Math.abs(change)))
  if (before === after) return t.sameBalance
  return t.otherSide
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

/**
 * Balance after this draft version: the spread as one number against the
 * state before, the criterion chips per lens, one row per person with the
 * projected deviation and the points, and the verdict.
 */
export function DraftFairnessPanel({ result }: { result: DraftSchedule }) {
  const t = useMessages().generator.fairness
  const impact = useQuery<DraftFairnessImpact>({
    queryKey: ['draft-fairness-impact', result.id, result.version],
    queryFn: () => api.draftFairnessImpact(result.id, result.version),
  })
  // D1: with an anchor the 11–19 count follows the anchor role and the lens
  // hides; only `independent` shows it as a lens balanced on its own.
  const lateShiftBalanced = impact.data?.late_shift_balanced !== false
  const projected = [...(impact.data?.projected_members ?? [])].sort((a, b) =>
    Math.abs(totalBalance(b, lateShiftBalanced).deviation) - Math.abs(totalBalance(a, lateShiftBalanced).deviation)
    || a.display_name.localeCompare(b.display_name, locale()))
  const criterionMembers = projected.filter((item) => item.in_criterion !== false)
  const formerMembers = projected.filter((item) => item.in_criterion === false)
  const spread = impact.data ? worstSpread(impact.data) : null
  const cause = impact.data ? shortfallCause(impact.data) : null
  const verdict = spread
    ? spread.after < spread.before - 0.05 ? 'better' : spread.after > spread.before + 0.05 ? 'worse' : 'same'
    : null
  const memberRows = (members: FairnessMember[]) => members.map((after) => {
    const before = impact.data?.baseline_members.find((item) => item.member_id === after.member_id) ?? after
    const afterTotal = totalBalance(after, lateShiftBalanced)
    const beforeTotal = totalBalance(before, lateShiftBalanced)
    const joined = impact.data && after.active_from > impact.data.baseline_as_of
    return (
      <tr key={after.member_id}>
        <th scope="row">
          {after.display_name}
          <small>{joined ? t.since(formatDate(after.active_from)) : t.memberChange(signedPoints(beforeTotal.deviation), signedPoints(afterTotal.deviation), impactLabel(beforeTotal.deviation, afterTotal.deviation))}</small>
        </th>
        <td><DeviationBar value={afterTotal.deviation} max={DEVIATION_SCALE} label={deviationWords(afterTotal.deviation)} /></td>
        <td className="n">{formatDecimal(afterTotal.actual)}</td>
      </tr>
    )
  })
  return (
    <div className="panel panel-padded stack-sm">
      {impact.isLoading && <LoadingBlock label={t.loading} rows={2} />}
      {impact.error && <ErrorState error={impact.error} onRetry={() => impact.refetch()} />}
      {impact.data && spread && (
        <>
          <div className="big-number">
            <span className="big">{formatPoints(spread.after)}</span>
            <span className="muted small">{t.spread(formatPoints(spread.before))}</span>
            {verdict && <StatusBadge tone={verdict === 'better' ? 'ok' : verdict === 'worse' ? 'warn' : 'muted'} className="ml-auto">{t.verdict[verdict]}</StatusBadge>}
          </div>
          <ChipRow label={t.criterion}>
            <span className="tag">{t.criterionTag(formatDecimal(impact.data.criterion_points))}</span>
            {impact.data.spreads.map((item) => (
              <Chip key={item.lens} tone={item.meets_criterion ? 'ok' : 'warn'}>
                {t.lensChip(lensLabels()[item.lens] ?? item.lens, formatDecimal(item.before), formatDecimal(item.after), item.meets_criterion)}
              </Chip>
            ))}
          </ChipRow>
          {projected.length > 0 && (
            <table className="lg" aria-label={t.table}>
              <thead>
                <tr>
                  <th scope="col">{t.person}</th>
                  <th scope="col" className="fairness-dev">{t.deviation}</th>
                  <th scope="col" className="n">{t.points}</th>
                </tr>
              </thead>
              <tbody>
                {memberRows(criterionMembers)}
                {formerMembers.length > 0 && (
                  <tr><th scope="rowgroup" colSpan={3} className="list-h">{t.outsideRotation}</th></tr>
                )}
                {memberRows(formerMembers)}
              </tbody>
            </table>
          )}
          {cause === 'met' && (
            <Box tone="ok" title={t.metTitle}>
              {t.metBody(formatPoints(impact.data.criterion_points))}
            </Box>
          )}
          {cause === 'inherited' && (
            <Box tone="warn" title={t.inheritedTitle(formatDecimal(impact.data.criterion_points))}>
              {t.inheritedBody}
              {' '}
              {spread.after < spread.before - 0.05
                ? t.spreadReduced(formatDecimal(spread.before), formatDecimal(spread.after))
                : t.spreadNotReduced(formatDecimal(spread.before), formatDecimal(spread.after))}
              {' '}
              {t.repaidGradually}
              {impact.data.acceptance_floor != null && t.floor(formatDecimal(impact.data.acceptance_floor))}
            </Box>
          )}
          {cause === 'draft' && (
            <Box tone="warn" title={t.missedTitle}>
              {t.missedBody(formatDecimal(impact.data.criterion_points))}
              {impact.data.acceptance_floor != null && t.floor(formatDecimal(impact.data.acceptance_floor))}
            </Box>
          )}
        </>
      )}
    </div>
  )
}
