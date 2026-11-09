import { useQuery } from '@tanstack/react-query'
import { AssignmentRole, FairnessMember, SwapImpactMember, SwapScope, SwapSlot } from '../api'
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

/** How far from balance before and after: `closer`, `further` or `unchanged`. */
function trend(before: number, after: number) {
  if (Math.abs(after) < Math.abs(before)) return 'closer'
  if (Math.abs(after) > Math.abs(before)) return 'further'
  return 'unchanged'
}

const TREND_CLASS = { closer: 'impact-d-ok', further: 'impact-d-warn', unchanged: '' } as const

/** One person's balance before and after in one line, the distance from
 *  balance summed over the lenses the change moves; lens by lens on demand. */
export function ImpactSide({ side, direction }: Readonly<{ side: SwapImpactMember; direction: string }>) {
  const t = useMessages().swaps.impact
  const lenses = lensLabels()
  const moved = LENSES.filter((key) => delta(side.before[key].actual, side.after[key].actual))
  const distance = (state: 'before' | 'after') =>
    Math.round(moved.reduce((total, key) => total + Math.abs(side[state][key].deviation), 0) * 100) / 100
  const overall = trend(distance('before'), distance('after'))
  return (
    <div className="stack-sm">
      <div className="impact-h">{side.display_name} · {direction}</div>
      {moved.length === 0 ? <span className="muted small">{t.noChange}</span> : (
        <details className="impact-more">
          <summary className="small">
            {t.distance}{' '}
            <span className={cx('impact-d', TREND_CLASS[overall])}>
              {formatDecimal(distance('before'))} → {formatDecimal(distance('after'))} · {t[overall]}
            </span>
          </summary>
          {moved.map((key) => {
            const before = side.before[key]
            const after = side.after[key]
            const lens = trend(before.deviation, after.deviation)
            return (
              <div className="impact-row" key={key}>
                <span>
                  <b>{lenses[key]}</b>
                  <span className="muted small"> {t.points(formatDecimal(before.actual), formatDecimal(after.actual), delta(before.actual, after.actual)!)}</span>
                </span>
                <span className={cx('impact-d', TREND_CLASS[lens])}>
                  {signed(before.deviation)} → {signed(after.deviation)}
                  <br />
                  <small>{t[lens]}</small>
                </span>
              </div>
            )
          })}
        </details>
      )}
    </div>
  )
}

/**
 * Points preview before the change is committed, as archive/docs/PLAN.md §4 requires.
 * The projection is read-only; nothing is written until the swap is created or
 * the coordinator confirms the override.
 *
 * `inReturn` is the duty that comes back when the swap is an exchange, `scope`
 * what the swap gives of the day and `returnScope` what it takes of the day in
 * return.
 *
 * The preview is about points only. The rules the move breaks or bends are
 * listed by the screen around it, which is also where they are acknowledged;
 * repeating them here showed every violation twice.
 */
export function SwapImpactPreview({ serviceDate, role, replacementId, inReturn, scope, returnScope, directions }: {
  serviceDate: string
  role: AssignmentRole
  replacementId: string
  inReturn?: SwapSlot
  scope?: SwapScope
  returnScope?: SwapScope
  /** What each side gives and takes, when the screen words it better (a role
   *  swap trades two roles of one day). */
  directions?: { requester: string; replacement: string }
}) {
  const impact = useQuery({
    ...swapImpactQuery(serviceDate, role, replacementId, { inReturn, scope, returnScope }),
    enabled: Boolean(serviceDate && role && replacementId),
  })
  const t = useMessages().swaps.impact
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
        {returnDay && returnDay !== day && ` ${worth(returnDay, returnPoints as number)}`}
        {' '}{t.window(formatDate(impact.data.window_start), formatDate(impact.data.window_end))}
      </div>
      <ImpactSide side={impact.data.requester} direction={directions?.requester ?? (returnDay ? t.exchanges(formatDayShort(day), formatDayShort(returnDay)) : t.handsOver)} />
      <ImpactSide side={impact.data.replacement} direction={directions?.replacement ?? (returnDay ? t.exchanges(formatDayShort(returnDay), formatDayShort(day)) : t.takes)} />
    </div>
  )
}
