import { useQuery } from '@tanstack/react-query'
import { DraftFairnessImpact, DraftSchedule, FairnessMember, api } from '../api'
import { lensLabels } from '../lib/labels'
import { DEVIATION_SCALE, deviationWords, formatDecimal, formatPoints, signedPoints, totalBalance } from '../lib/fairness'
import { Box, Chip, ChipRow, DeviationBar, ErrorState, LoadingBlock, StatusBadge } from '../ui'

export function impactLabel(before: number, after: number) {
  const change = Math.round((Math.abs(before) - Math.abs(after)) * 100) / 100
  if (Math.abs(change) < 0.05) return 'bez istotnej zmiany'
  if (change > 0) return `bliżej równowagi o ${formatPoints(change)}`
  if (change < 0) return `dalej od równowagi o ${formatPoints(Math.abs(change))}`
  if (before === after) return 'saldo bez zmiany'
  return 'ta sama odległość, druga strona bilansu'
}

/** The widest lens spread: the number the acceptance criterion judges. */
export function worstSpread(impact: DraftFairnessImpact) {
  return {
    before: Math.max(0, ...impact.spreads.map((item) => item.before)),
    after: Math.max(0, ...impact.spreads.map((item) => item.after)),
  }
}

/**
 * Balance after this draft version: the spread as one number against the
 * state before, the criterion chips per lens, one row per person with the
 * projected deviation and the points, and the verdict.
 */
export function DraftFairnessPanel({ result }: { result: DraftSchedule }) {
  const impact = useQuery<DraftFairnessImpact>({
    queryKey: ['draft-fairness-impact', result.id, result.version],
    queryFn: () => api.draftFairnessImpact(result.id, result.version),
  })
  // D1: with an anchor the 11–19 count follows the anchor role and the lens
  // hides; only `independent` shows it as a lens balanced on its own.
  const lateShiftBalanced = impact.data?.late_shift_balanced !== false
  const projected = [...(impact.data?.projected_members ?? [])].sort((a, b) =>
    Math.abs(totalBalance(b, lateShiftBalanced).deviation) - Math.abs(totalBalance(a, lateShiftBalanced).deviation)
    || a.display_name.localeCompare(b.display_name, 'pl'))
  const criterionMembers = projected.filter((item) => item.in_criterion !== false)
  const formerMembers = projected.filter((item) => item.in_criterion === false)
  const spread = impact.data ? worstSpread(impact.data) : null
  const verdict = spread
    ? spread.after < spread.before - 0.05 ? 'lepiej' : spread.after > spread.before + 0.05 ? 'gorzej' : 'bez zmian'
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
          <small>{joined ? `od ${after.active_from}` : `${signedPoints(beforeTotal.deviation)} → ${signedPoints(afterTotal.deviation)} · ${impactLabel(beforeTotal.deviation, afterTotal.deviation)}`}</small>
        </th>
        <td><DeviationBar value={afterTotal.deviation} max={DEVIATION_SCALE} label={deviationWords(afterTotal.deviation)} /></td>
        <td className="n">{afterTotal.actual}</td>
      </tr>
    )
  })
  return (
    <div className="panel panel-padded stack-sm">
      {impact.isLoading && <LoadingBlock label="Przeliczanie sprawiedliwości" rows={2} />}
      {impact.error && <ErrorState error={impact.error} onRetry={() => impact.refetch()} />}
      {impact.data && spread && (
        <>
          <div className="big-number">
            <span className="big">{formatPoints(spread.after)}</span>
            <span className="muted small">rozrzut punktów (było {formatPoints(spread.before)})</span>
            {verdict && <StatusBadge tone={verdict === 'lepiej' ? 'ok' : verdict === 'gorzej' ? 'warn' : 'muted'} className="ml-auto">{verdict}</StatusBadge>}
          </div>
          <ChipRow label="Kryterium odbioru">
            <span className="tag">rozpiętość ≤ {impact.data.criterion_points} pkt na soczewce</span>
            {impact.data.spreads.map((item) => (
              <Chip key={item.lens} tone={item.meets_criterion ? 'ok' : 'warn'}>
                {lensLabels[item.lens] ?? item.lens}: {formatDecimal(item.before)} → {formatDecimal(item.after)} · {item.meets_criterion ? 'spełnia' : 'nie spełnia'}
              </Chip>
            ))}
          </ChipRow>
          {projected.length > 0 && (
            <table className="lg" aria-label="Wpływ szkicu na bilans">
              <thead>
                <tr>
                  <th scope="col">Osoba</th>
                  <th scope="col" className="fairness-dev">Odchylenie</th>
                  <th scope="col" className="n">Pkt</th>
                </tr>
              </thead>
              <tbody>
                {memberRows(criterionMembers)}
                {formerMembers.length > 0 && (
                  <tr><th scope="rowgroup" colSpan={3} className="list-h">Poza rotacją</th></tr>
                )}
                {memberRows(formerMembers)}
              </tbody>
            </table>
          )}
          {!impact.data.criterion_met && impact.data.acceptance_floor != null ? (
            <Box tone="warn" title={`Kryterium ${impact.data.criterion_points} punktów jest nieosiągalne przy zastanym długu historycznym.`}>
              Najniższa osiągalna rozpiętość to {impact.data.acceptance_floor} punktów - przyczyną jest zastana nierówność, nie jakość generowania.
            </Box>
          ) : (
            <Box tone={impact.data.criterion_met ? 'ok' : 'warn'} title={impact.data.criterion_met ? 'Kryterium spełnione' : 'Kryterium niespełnione'}>
              {impact.data.criterion_met
                ? `Po publikacji nikt nie przekracza ±${formatPoints(impact.data.criterion_points)} pkt na żadnej soczewce.`
                : `Po publikacji rozrzut na co najmniej jednej soczewce przekracza ${formatPoints(impact.data.criterion_points)} pkt; popraw komórki w macierzy albo wygeneruj ponownie.`}
            </Box>
          )}
        </>
      )}
    </div>
  )
}
