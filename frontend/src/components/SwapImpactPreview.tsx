import { useQuery } from '@tanstack/react-query'
import { AssignmentRole, FairnessMember, SwapImpactMember, SwapSlot } from '../api'
import { useMessages } from '../i18n'
import { formatDate, formatDay, formatDayShort } from '../lib/dates'
import { lensLabels } from '../lib/labels'
import { formatDecimal, signed } from '../lib/numbers'
import { swapImpactQuery } from '../lib/swaps'
import { InlineError, LoadingBlock, cx } from '../ui'

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
 * `mode` names the move: a swap is something the on-call person hands over
 * (their own choice), a coordinator override is something they lose (it is
 * done to them) and moves 11-19 with its anchor role only. `inReturn` is the
 * duty that comes back when the swap is an exchange.
 *
 * The preview is about points only. The rules the move breaks or bends are
 * listed by the screen around it, which is also where they are acknowledged;
 * repeating them here showed every violation twice.
 */
export function SwapImpactPreview({ serviceDate, role, replacementId, inReturn, mode = 'swap' }: {
  serviceDate: string
  role: AssignmentRole
  replacementId: string
  inReturn?: SwapSlot
  mode?: 'swap' | 'override'
}) {
  const impact = useQuery({
    ...swapImpactQuery(serviceDate, role, replacementId, inReturn, mode === 'override'),
    enabled: Boolean(serviceDate && role && replacementId),
  })
  const t = useMessages().swaps.impact
  const fromDirection = mode === 'override' ? t.loses : t.handsOver
  const worth = (day: string, points: number) => t.dayWorth(formatDay(day), points === 2 ? t.twoPoints : t.onePoint)

  if (impact.isLoading) return <LoadingBlock label={t.loading} rows={2} />
  if (impact.error) return <InlineError error={impact.error} />
  if (!impact.data) return null

  const { service_date: day, return_date: returnDay, return_points: returnPoints } = impact.data
  return (
    <div className="impact" aria-label={t.heading}>
      <div className="impact-h">{t.heading}</div>
      <div className="small muted">
        {worth(day, impact.data.points)}
        {returnDay && ` ${worth(returnDay, returnPoints as number)}`}
        {' '}{t.window(formatDate(impact.data.window_start), formatDate(impact.data.window_end))}
      </div>
      <Side side={impact.data.requester} direction={returnDay ? t.exchanges(formatDayShort(day), formatDayShort(returnDay)) : fromDirection} />
      <Side side={impact.data.replacement} direction={returnDay ? t.exchanges(formatDayShort(returnDay), formatDayShort(day)) : t.takes} />
    </div>
  )
}
