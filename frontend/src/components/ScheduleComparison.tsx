import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ScheduleSummary, api } from '../api'
import { rotationLabels } from '../lib/labels'
import { Button, Field, InlineError, Select } from '../ui'

const METRICS: Array<[string, 'assignment_count' | 'handovers' | 'max_consecutive_days' | 'load_spread' | 'override_count']> = [
  ['Przydziały', 'assignment_count'],
  ['Zmiany osoby dzień po dniu', 'handovers'],
  ['Najdłuższa seria dni', 'max_consecutive_days'],
  ['Rozpiętość obciążenia', 'load_spread'],
  ['Korekty ręczne', 'override_count'],
]

export function ScheduleComparison({ drafts }: { drafts: ScheduleSummary[] }) {
  const daily = drafts.filter((item) => item.rotation_mode === 'daily')
  const weekly = drafts.filter((item) => item.rotation_mode === 'weekly')
  const [leftId, setLeftId] = useState('')
  const [rightId, setRightId] = useState('')
  const [requested, setRequested] = useState<[string, string] | null>(null)
  const comparison = useQuery({
    queryKey: ['schedule-comparison', requested],
    queryFn: () => api.compareSchedules(requested![0], requested![1]),
    enabled: Boolean(requested),
  })
  return (
    <div className="stack-sm">
      <p className="muted small">Warianty muszą obejmować ten sam zakres dat.</p>
      <div className="frow">
        <Field label="Wariant dzienny" id="compare-daily">
          {({ id }) => (
            <Select id={id} value={leftId} onChange={(event) => setLeftId(event.target.value)}>
              <option value="">Wybierz</option>
              {daily.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Wariant tygodniowy" id="compare-weekly">
          {({ id }) => (
            <Select id={id} value={rightId} onChange={(event) => setRightId(event.target.value)}>
              <option value="">Wybierz</option>
              {weekly.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
          )}
        </Field>
        <Button disabled={!leftId || !rightId} onClick={() => setRequested([leftId, rightId])} loading={comparison.isLoading} style={{ alignSelf: 'end' }}>Porównaj</Button>
      </div>
      {comparison.error && <InlineError error={comparison.error} />}
      {comparison.data && (
        <div className="panel wide-scroll">
          <table className="lg">
            <thead><tr><th>Metryka</th>{comparison.data.variants.map((item) => <th key={item.id} className="n">{rotationLabels[item.rotation_mode]}</th>)}</tr></thead>
            <tbody>
              {METRICS.map(([label, key]) => (
                <tr key={key}><th scope="row">{label}</th>{comparison.data!.variants.map((item) => <td key={item.id} className="n">{item[key]}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
