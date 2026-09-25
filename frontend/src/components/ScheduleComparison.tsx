import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ScheduleSummary, api } from '../api'
import { useMessages } from '../i18n'
import { rotationLabels } from '../lib/labels'
import { formatDecimal } from '../lib/numbers'
import { Button, Field, InlineError, Select } from '../ui'

const METRICS = ['assignment_count', 'handovers', 'max_consecutive_days', 'load_spread', 'override_count'] as const

/** The draft picked on one side: the person's choice while it still exists, else the only candidate. */
function picked(candidates: ScheduleSummary[], choice: string | null) {
  if (choice !== null && candidates.some((item) => item.id === choice)) return choice
  return candidates.length === 1 ? candidates[0].id : ''
}

/**
 * Daily against weekly on the same range. With exactly one draft of each kind
 * there is nothing to choose, so both are picked and compared at once; with
 * more, the person picks the pair and asks for it.
 */
export function ScheduleComparison({ drafts }: { drafts: ScheduleSummary[] }) {
  const t = useMessages().generator.comparison
  const daily = drafts.filter((item) => item.rotation_mode === 'daily')
  const weekly = drafts.filter((item) => item.rotation_mode === 'weekly')
  const [leftChoice, setLeftId] = useState<string | null>(null)
  const [rightChoice, setRightId] = useState<string | null>(null)
  const leftId = picked(daily, leftChoice)
  const rightId = picked(weekly, rightChoice)
  const [asked, setRequested] = useState<[string, string] | null>(null)
  const onlyPair = daily.length === 1 && weekly.length === 1
  const requested = asked ?? (onlyPair ? [leftId, rightId] : null)
  const comparison = useQuery({
    queryKey: ['schedule-comparison', requested],
    queryFn: () => api.compareSchedules(requested![0], requested![1]),
    enabled: Boolean(requested),
  })
  return (
    <div className="stack-sm">
      <p className="muted small">{t.sameRange}</p>
      <div className="frow">
        <Field label={t.daily} id="compare-daily">
          {({ id }) => (
            <Select id={id} value={leftId} onChange={(event) => setLeftId(event.target.value)}>
              <option value="">{t.choose}</option>
              {daily.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t.weekly} id="compare-weekly">
          {({ id }) => (
            <Select id={id} value={rightId} onChange={(event) => setRightId(event.target.value)}>
              <option value="">{t.choose}</option>
              {weekly.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
          )}
        </Field>
        <Button disabled={!leftId || !rightId} onClick={() => setRequested([leftId, rightId])} loading={comparison.isLoading} style={{ alignSelf: 'end' }}>{t.compare}</Button>
      </div>
      {comparison.error && <InlineError error={comparison.error} />}
      {comparison.data && (
        <div className="panel wide-scroll">
          <table className="lg">
            <thead><tr><th>{t.metric}</th>{comparison.data.variants.map((item) => <th key={item.id} className="n">{rotationLabels()[item.rotation_mode]}</th>)}</tr></thead>
            <tbody>
              {METRICS.map((key) => (
                <tr key={key}><th scope="row">{t.metrics[key]}</th>{comparison.data!.variants.map((item) => <td key={item.id} className="n">{formatDecimal(item[key])}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
