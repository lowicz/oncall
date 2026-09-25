import { useQuery } from '@tanstack/react-query'
import { AssignmentRole, FairnessMember, SwapImpactMember, api } from '../api'
import { useMessages } from '../i18n'
import { formatDate, formatDay } from '../lib/dates'
import { lensLabels } from '../lib/labels'
import { formatDecimal, signed } from '../lib/numbers'
import { Box, InlineError, LoadingBlock, cx } from '../ui'

type Lens = keyof Pick<FairnessMember, 'primary' | 'secondary' | 'late_shift' | 'weekends' | 'holidays'>

const LENSES: Lens[] = ['primary', 'secondary', 'late_shift', 'weekends', 'holidays']

function delta(before: number, after: number) {
  const change = Math.round((after - before) * 100) / 100
  return change === 0 ? null : signed(change)
}

function Side({ side, direction }: { side: SwapImpactMember; direction: string }) {
  const t = useMessages().swaps.impact
  const lenses = lensLabels()
  const rows = LENSES.map((key) => {
    const before = side.before[key]
    const after = side.after[key]
    const moved = delta(before.actual, after.actual)
    if (!moved) return null
    const closer = Math.abs(after.deviation) < Math.abs(before.deviation)
    const further = Math.abs(after.deviation) > Math.abs(before.deviation)
    return (
      <div className="impact-row" key={key}>
        <span>
          <b>{lenses[key]}</b>
          <span className="muted small"> {t.points(formatDecimal(before.actual), formatDecimal(after.actual), moved)}</span>
        </span>
        <span className={cx('impact-d', closer ? 'impact-d-ok' : further ? 'impact-d-warn' : '')}>
          {signed(before.deviation)} → {signed(after.deviation)}
          <br />
          <small>{closer ? t.closer : further ? t.further : t.unchanged}</small>
        </span>
      </div>
    )
  }).filter(Boolean)
  return (
    <div className="stack-sm">
      <div className="impact-h">{side.display_name} · {direction}</div>
      {rows.length > 0 ? rows : <span className="muted small">{t.noChange}</span>}
    </div>
  )
}

/**
 * Points preview before the change is committed, as archive/docs/PLAN.md §4 requires.
 * The projection is read-only; nothing is written until the swap is created or
 * the coordinator confirms the override.
 *
 * `mode` only swaps the wording of the two sides: a swap is something the
 * on-call person hands over (their own choice), a coordinator override is
 * something they lose (it is done to them).
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
  const t = useMessages().swaps.impact
  const fromDirection = mode === 'override' ? t.loses : t.handsOver

  if (impact.isLoading) return <LoadingBlock label={t.loading} rows={2} />
  if (impact.error) return <InlineError error={impact.error} />
  if (!impact.data) return null

  return (
    <div className="impact" aria-label={t.heading}>
      <div className="impact-h">{t.heading}</div>
      <div className="small muted">
        {t.dayWorth(formatDay(impact.data.service_date), impact.data.points === 2 ? t.twoPoints : t.onePoint)}
        {' '}{t.window(formatDate(impact.data.window_start), formatDate(impact.data.window_end))}
      </div>
      <Side side={impact.data.requester} direction={fromDirection} />
      <Side side={impact.data.replacement} direction={t.takes} />
      {(impact.data.warnings?.length ?? 0) > 0 && (
        <Box tone="warn" title={t.warnings}>
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
