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
  const cause = impact.data ? shortfallCause(impact.data) : null
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
          {cause === 'met' && (
            <Box tone="ok" title="Kryterium spełnione">
              Po publikacji nikt nie przekracza ±{formatPoints(impact.data.criterion_points)} pkt na żadnej soczewce.
            </Box>
          )}
          {cause === 'inherited' && (
            <Box tone="warn" title={`Kryterium ${impact.data.criterion_points} pkt niespełnione przez zastany dług historyczny.`}>
              Soczewki poza kryterium były poza nim już przed tym szkicem: to zastana nierówność, nie wada szkicu.
              {' '}
              {spread.after < spread.before - 0.05
                ? `Szkic zmniejsza rozrzut z ${formatDecimal(spread.before)} do ${formatDecimal(spread.after)} pkt.`
                : `Szkic nie zmniejsza rozrzutu (${formatDecimal(spread.before)} → ${formatDecimal(spread.after)} pkt); jeśli wprowadzono ręczne korekty, sprawdź je.`}
              {' '}
              Generator spłaca dług stopniowo - w jednym zakresie koryguje udział osoby o najwyżej połowę jej udziału, żeby nikt nie został bez dyżurów - więc wyrównanie dokończą kolejne zakresy; ponowne generowanie tego nie zmieni.
              {impact.data.acceptance_floor != null && ` Najniższa rozpiętość osiągalna w tym zakresie to ${impact.data.acceptance_floor} pkt.`}
            </Box>
          )}
          {cause === 'draft' && (
            <Box tone="warn" title="Kryterium niespełnione">
              Co najmniej jedna soczewka, która przed szkicem mieściła się w {impact.data.criterion_points} pkt, po publikacji przekracza tę rozpiętość; popraw komórki w macierzy albo wygeneruj ponownie.
              {impact.data.acceptance_floor != null && ` Najniższa rozpiętość osiągalna w tym zakresie to ${impact.data.acceptance_floor} pkt.`}
            </Box>
          )}
        </>
      )}
    </div>
  )
}
