import { useQuery } from '@tanstack/react-query'
import { AssignmentRole, FairnessMember, SwapImpactMember, api } from '../api'
import { formatDay } from '../lib/dates'
import { Box, InlineError, LoadingBlock, cx } from '../ui'

type Lens = keyof Pick<FairnessMember, 'primary' | 'secondary' | 'late_shift' | 'weekends' | 'holidays'>

const LENSES: Array<[string, Lens]> = [
  ['PRIMARY', 'primary'],
  ['SECONDARY', 'secondary'],
  ['11–19', 'late_shift'],
  ['Weekendy', 'weekends'],
  ['Święta', 'holidays'],
]

function delta(before: number, after: number) {
  const change = Math.round((after - before) * 100) / 100
  if (change === 0) return null
  return change > 0 ? `+${change}` : String(change)
}

const dev = (value: number) => `${value > 0 ? '+' : ''}${value.toLocaleString('pl-PL', { maximumFractionDigits: 2 })}`

function Side({ side, direction }: { side: SwapImpactMember; direction: string }) {
  const rows = LENSES.map(([label, key]) => {
    const before = side.before[key]
    const after = side.after[key]
    const moved = delta(before.actual, after.actual)
    if (!moved) return null
    const closer = Math.abs(after.deviation) < Math.abs(before.deviation)
    const further = Math.abs(after.deviation) > Math.abs(before.deviation)
    return (
      <div className="impact-row" key={key}>
        <span>
          <b>{label}</b>
          <span className="muted small"> punkty {before.actual} → {after.actual} ({moved})</span>
        </span>
        <span className={cx('impact-d', closer ? 'impact-d-ok' : further ? 'impact-d-warn' : '')}>
          {dev(before.deviation)} → {dev(after.deviation)}
          <br />
          <small>{closer ? 'bliżej równowagi' : further ? 'dalej od równowagi' : 'bez zmiany'}</small>
        </span>
      </div>
    )
  }).filter(Boolean)
  return (
    <div className="stack-sm">
      <div className="impact-h">{side.display_name} · {direction}</div>
      {rows.length > 0 ? rows : <span className="muted small">Saldo tej osoby się nie zmienia.</span>}
    </div>
  )
}

/**
 * Points preview before the change is committed, as archive/docs/PLAN.md §4 requires.
 * The projection is read-only; nothing is written until the swap is created or
 * the coordinator confirms the override.
 *
 * `mode` only swaps the wording of the two sides: a swap is something the
 * on-call person `oddaje` (chooses to hand over), a coordinator override is
 * something they `tracą` (it is done to them).
 */
export function SwapImpactPreview({ serviceDate, role, replacementId, mode = 'swap' }: {
  serviceDate: string
  role: AssignmentRole
  replacementId: string
  mode?: 'swap' | 'override'
}) {
  const impact = useQuery({
    queryKey: ['swap-impact', serviceDate, role, replacementId],
    queryFn: () => api.swapImpact(serviceDate, role, replacementId),
    enabled: Boolean(serviceDate && role && replacementId),
  })
  const fromDirection = mode === 'override' ? 'traci dyżur' : 'oddaje dyżur'

  if (impact.isLoading) return <LoadingBlock label="Przeliczanie wpływu zamiany" rows={2} />
  if (impact.error) return <InlineError error={impact.error} />
  if (!impact.data) return null

  return (
    <div className="impact" aria-label="Wpływ na bilans">
      <div className="impact-h">Wpływ na bilans</div>
      <div className="small muted">
        {formatDay(impact.data.service_date)} to {impact.data.points === 2 ? '2 punkty (2X)' : '1 punkt'}.
        {' '}Okno {impact.data.window_start} - {impact.data.window_end}.
      </div>
      <Side side={impact.data.requester} direction={fromDirection} />
      <Side side={impact.data.replacement} direction="przejmuje dyżur" />
      {(impact.data.warnings?.length ?? 0) > 0 && (
        <Box tone="warn" title="Ostrzeżenia przed decyzją">
          <ul className="plain-list">
            {impact.data.warnings?.map((warning, index) => (
              <li key={`${warning.rule}-${index}`}>{warning.message} ({warning.member_name})</li>
            ))}
          </ul>
        </Box>
      )}
    </div>
  )
}
