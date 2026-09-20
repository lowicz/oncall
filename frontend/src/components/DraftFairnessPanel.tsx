import { useQuery } from '@tanstack/react-query'
import { DraftFairnessImpact, DraftSchedule, FairnessMember, api } from '../api'
import { lensLabels } from '../lib/labels'
import { Box, Chip, ChipRow, ErrorState, LoadingBlock, cx } from '../ui'

export function impactLabel(before: number, after: number) {
  const change = Math.round((Math.abs(before) - Math.abs(after)) * 100) / 100
  if (Math.abs(change) < 0.05) return 'bez istotnej zmiany'
  if (change > 0) return `bliżej równowagi o ${change}`
  if (change < 0) return `dalej od równowagi o ${Math.abs(change)}`
  if (before === after) return 'saldo bez zmiany'
  return 'ta sama odległość, druga strona bilansu'
}

const signed = (value: number) => `${value > 0 ? '+' : ''}${value}`

function ImpactCell({ before, after }: { before: FairnessMember['primary']; after: FairnessMember['primary'] }) {
  const improves = Math.abs(after.deviation) < Math.abs(before.deviation)
  const worsens = Math.abs(after.deviation) > Math.abs(before.deviation)
  return (
    <div className="fcell">
      <span className="mono">{signed(before.deviation)} → <b>{signed(after.deviation)}</b></span>
      <small className={cx(improves ? 'impact-d-ok' : worsens ? 'impact-d-warn' : 'muted')}>{impactLabel(before.deviation, after.deviation)}</small>
    </div>
  )
}

function LensCell({ before, after, eligible = true }: {
  before: FairnessMember['primary']
  after: FairnessMember['primary']
  eligible?: boolean
}) {
  return eligible ? <ImpactCell before={before} after={after} /> : <span className="muted small">nie pełni tej roli</span>
}

/** Balance before the range → projected balance after this draft version. */
export function DraftFairnessPanel({ result }: { result: DraftSchedule }) {
  const impact = useQuery<DraftFairnessImpact>({
    queryKey: ['draft-fairness-impact', result.id, result.version],
    queryFn: () => api.draftFairnessImpact(result.id, result.version),
  })
  // D1: with an anchor the 11–19 count follows the anchor role and the column
  // hides; only `independent` shows it as a lens balanced on its own.
  const lateShiftBalanced = impact.data?.late_shift_balanced !== false
  const criterionMembers = impact.data?.projected_members.filter((item) => item.in_criterion !== false) ?? []
  const formerMembers = impact.data?.projected_members.filter((item) => item.in_criterion === false) ?? []
  const memberRows = (members: FairnessMember[]) => members.map((after) => {
    const before = impact.data?.baseline_members.find((item) => item.member_id === after.member_id) ?? after
    return (
      <tr key={after.member_id}>
        <th scope="row">{after.display_name}</th>
        <td><LensCell before={before.primary} after={after.primary} eligible={after.eligible_days.primary > 0} /></td>
        <td><LensCell before={before.secondary} after={after.secondary} eligible={after.eligible_days.secondary > 0} /></td>
        {lateShiftBalanced && <td><LensCell before={before.late_shift} after={after.late_shift} eligible={after.eligible_days.late_shift > 0} /></td>}
        <td><ImpactCell before={before.weekends} after={after.weekends} /></td>
        <td><ImpactCell before={before.holidays} after={after.holidays} /></td>
      </tr>
    )
  })
  return (
    <div className="stack-sm">
      {impact.isLoading && <LoadingBlock label="Przeliczanie sprawiedliwości" rows={2} />}
      {impact.error && <ErrorState error={impact.error} onRetry={() => impact.refetch()} />}
      {impact.data && !impact.data.criterion_met && impact.data.acceptance_floor != null && (
        <Box tone="warn" title={`Kryterium ${impact.data.criterion_points} punktów jest nieosiągalne przy zastanym długu historycznym.`}>
          Najniższa osiągalna rozpiętość to {impact.data.acceptance_floor} punktów - przyczyną jest zastana nierówność, nie jakość generowania.
        </Box>
      )}
      {impact.data && (
        <ChipRow label="Kryterium odbioru">
          <span className="tag">rozpiętość ≤ {impact.data.criterion_points} pkt na soczewce</span>
          {impact.data.spreads.map((item) => (
            <Chip key={item.lens} tone={item.meets_criterion ? 'ok' : 'warn'}>
              {lensLabels[item.lens] ?? item.lens}: {item.before} → {item.after} · {item.meets_criterion ? 'spełnia' : 'nie spełnia'}
            </Chip>
          ))}
        </ChipRow>
      )}
      {impact.data && (
        <div className="panel wide-scroll">
          <table className="lg" aria-label="Wpływ szkicu na bilans">
            <thead>
              <tr>
                <th scope="col">Osoba</th>
                <th scope="col">PRIMARY</th>
                <th scope="col">SECONDARY</th>
                {lateShiftBalanced && <th scope="col">11–19</th>}
                <th scope="col">Weekendy</th>
                <th scope="col">Święta</th>
              </tr>
            </thead>
            <tbody>
              {memberRows(criterionMembers)}
              {formerMembers.length > 0 && (
                <tr><th scope="rowgroup" colSpan={lateShiftBalanced ? 6 : 5} className="list-h">Poza rotacją</th></tr>
              )}
              {memberRows(formerMembers)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
