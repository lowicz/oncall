import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FairnessMember, api } from '../api'
import { lensLabels, roleLabels } from '../lib/labels'
import { formatDate, formatDay, warsawDate } from '../lib/dates'
import { DateField } from '../components/DateField'
import {
  Box,
  Button,
  Chip,
  ChipRow,
  DeviationBar,
  ErrorState,
  List,
  ListRow,
  LoadingBlock,
  PageHeader,
  Panel,
  RoleMark,
  Tag,
  cx,
} from '../ui'

/** Widest deviation the bar renders at full length; beyond it the bar pins. */
const DEVIATION_SCALE = 3

export function deviationWords(value: number) {
  if (Math.abs(value) < 0.01) return 'zgodnie z udziałem'
  return value > 0 ? `${value} ponad udział` : `${Math.abs(value)} poniżej udziału`
}

function FairnessCell({ category, eligible = true, note }: {
  category: FairnessMember['primary']
  /** Somebody without eligibility for the role has no fair share to meet, so
   *  „0 / 0 · zgodnie z udziałem" reads as a verdict where there is none (MED5-05). */
  eligible?: boolean
  /** Structural reason an absolute number is small even when the deviation is
   *  fine - joined mid-window, no 11–19 eligibility (MED6-02). */
  note?: string
}) {
  if (!eligible) return <span className="muted small">nie pełni tej roli</span>
  return (
    <div
      className="fcell"
      aria-label={`Wykonane ${category.actual}, uczciwy udział ${category.expected}, ${deviationWords(category.deviation)}${note ? `, ${note}` : ''}`}
    >
      <span className="mono"><b className="f-actual">{category.actual}</b><span className="muted"> / {category.expected}</span></span>
      <DeviationBar value={category.deviation} max={DEVIATION_SCALE} label={deviationWords(category.deviation)} showValue={false} />
      <small className="muted">{deviationWords(category.deviation)}</small>
      {note && <small className="muted">{note}</small>}
    </div>
  )
}

type Lens = 'primary' | 'secondary' | 'late_shift' | 'weekends' | 'holidays'
type SortKey = 'name' | Lens | 'total'

const SORT_COLUMNS: Array<{ key: SortKey; label: string; hint?: string }> = [
  { key: 'name', label: 'Osoba' },
  { key: 'primary', label: 'PRIMARY', hint: 'pkt / udział' },
  { key: 'secondary', label: 'SECONDARY', hint: 'pkt / udział' },
  { key: 'late_shift', label: '11–19', hint: 'zmiany / udział' },
  { key: 'weekends', label: 'Weekendy', hint: 'dni / udział' },
  { key: 'holidays', label: 'Święta', hint: 'dni / udział' },
  { key: 'total', label: 'Razem', hint: 'pkt / udział' },
]

export function FairnessPanel() {
  const today = warsawDate()
  const [asOf, setAsOf] = useState(today)
  const defaultDateApplied = useRef(false)
  const [drilldown, setDrilldown] = useState<FairnessMember | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' })
  const report = useQuery({
    queryKey: ['fairness', asOf],
    queryFn: () => api.fairness(asOf === today ? undefined : asOf),
  })
  useEffect(() => {
    // `/schedules/published` caps its own `ends_on` at today + 90 days by
    // design (LOW6-08); the report itself carries the real end of the latest
    // publication, which is the useful default horizon.
    if (defaultDateApplied.current || !report.data) return
    defaultDateApplied.current = true
    const latestEnd = report.data.latest_publish_end
    if (latestEnd && latestEnd > today) setAsOf(latestEnd)
  }, [report.data, today])
  // D1: with an anchor the 11–19 count follows the anchor role and the column
  // hides; only `independent` shows it as a lens balanced on its own.
  const lateShiftBalanced = report.data?.late_shift_balanced !== false
  useEffect(() => {
    if (!lateShiftBalanced && sort.key === 'late_shift') setSort({ key: 'name', dir: 'asc' })
  }, [lateShiftBalanced, sort.key])
  const columns = SORT_COLUMNS.filter((column) => column.key !== 'late_shift' || lateShiftBalanced)
  // D4 (MED6-01): the per-person „Razem" and the summary „Razem" have to add up
  // the same columns. Weekends/holidays are subsets of the on-call points and
  // never added.
  const roundPoints = (value: number) => Math.round(value * 100) / 100
  const visibleSum = (member: FairnessMember, field: 'actual' | 'expected') =>
    roundPoints(member.primary[field] + member.secondary[field] + (lateShiftBalanced ? member.late_shift[field] : 0))
  // MED6-02: „Razem" gets an expected value and a deviation like every other
  // column. The deviation is rebuilt from the parts, not from the rounded sums.
  const totalBalance = (member: FairnessMember): FairnessMember['primary'] => ({
    actual: visibleSum(member, 'actual'),
    expected: visibleSum(member, 'expected'),
    deviation: roundPoints(member.primary.deviation + member.secondary.deviation + (lateShiftBalanced ? member.late_shift.deviation : 0)),
  })
  const totalNote = (member: FairnessMember): string | undefined => {
    const reasons: string[] = []
    if (report.data && member.active_from > report.data.window_start) reasons.push(`w rotacji od ${formatDate(member.active_from)}`)
    if (lateShiftBalanced && (member.eligible_days.late_shift ?? 0) === 0) reasons.push('bez zmian 11–19')
    return reasons.length > 0 ? reasons.join(' · ') : undefined
  }
  const duties = useQuery({
    queryKey: ['fairness-duties', drilldown?.member_id, asOf],
    queryFn: () => api.fairnessDuties(drilldown!.member_id, asOf === today ? undefined : asOf),
    enabled: Boolean(drilldown),
  })
  const toggleSort = (key: SortKey) => setSort((current) => ({
    key,
    dir: current.key === key && current.dir === 'desc' ? 'asc' : 'desc',
  }))
  const deviationOf = (member: FairnessMember, key: SortKey): number => {
    if (key === 'name') return 0
    if (key === 'total') return totalBalance(member).deviation
    return member[key].deviation
  }
  const sortedMembers = [...(report.data?.members ?? [])].sort((a, b) => {
    if (sort.key === 'name') {
      return sort.dir === 'asc' ? a.display_name.localeCompare(b.display_name, 'pl') : b.display_name.localeCompare(a.display_name, 'pl')
    }
    const diff = Math.abs(deviationOf(b, sort.key)) - Math.abs(deviationOf(a, sort.key))
    const ordered = sort.dir === 'desc' ? diff : -diff
    return ordered !== 0 ? ordered : a.display_name.localeCompare(b.display_name, 'pl')
  })
  const criterionMembers = sortedMembers.filter((member) => member.in_criterion !== false)
  const formerMembers = sortedMembers.filter((member) => member.in_criterion === false)
  const totals = report.data?.totals
  const expectedSum = (key: Lens) => roundPoints((report.data?.members ?? []).reduce((sum, member) => sum + member[key].expected, 0))
  const totalExpectedSum = roundPoints((report.data?.members ?? []).reduce((sum, member) => sum + visibleSum(member, 'expected'), 0))
  // The spread summary is a team quantity; a member seeing only their own row
  // would read a meaningless 0.0 out of it.
  const teamView = (report.data?.members.length ?? 0) > 1
  const signed = (value: number) => `${value > 0 ? '+' : ''}${value}`

  const memberRow = (member: FairnessMember) => (
    <tr key={member.member_id} className={cx(drilldown?.member_id === member.member_id && 'on')}>
      <th scope="row">
        <button type="button" className="link-btn" onClick={() => setDrilldown(member)} aria-label={`Dyżury: ${member.display_name}`}>
          {member.display_name}
        </button>
      </th>
      <td><FairnessCell category={member.primary} eligible={member.eligible_days.primary > 0} /></td>
      <td><FairnessCell category={member.secondary} eligible={member.eligible_days.secondary > 0} /></td>
      {lateShiftBalanced && <td><FairnessCell category={member.late_shift} eligible={member.eligible_days.late_shift > 0} /></td>}
      <td><FairnessCell category={member.weekends} /></td>
      <td><FairnessCell category={member.holidays} /></td>
      <td><FairnessCell category={totalBalance(member)} note={totalNote(member)} /></td>
    </tr>
  )

  return (
    <div className="page">
      <PageHeader
        eyebrow="bilans 12 miesięcy"
        title="Sprawiedliwość"
        sub={(
          <>
            {asOf > today
              ? `Kroczące 12 miesięcy do ${formatDate(asOf)}, licząc też dyżury już zaplanowane do tego dnia.`
              : 'Kroczące 12 miesięcy faktycznie odbytych dyżurów.'}
            {' '}Kliknij osobę, aby zobaczyć dyżury składające się na wynik.
          </>
        )}
        actions={(
          <form className="row" onSubmit={(event) => event.preventDefault()}>
            <DateField id="fairness-as-of" label="Stan na dzień" value={asOf} onChange={(value) => value && setAsOf(value)} />
            <Button onClick={() => setAsOf(today)} style={{ alignSelf: 'end' }}>Dziś</Button>
          </form>
        )}
      />
      {report.error && <ErrorState error={report.error} onRetry={() => report.refetch()} />}
      {report.isLoading && <LoadingBlock label="Wczytywanie raportu" />}
      {report.data && teamView && (
        <ChipRow label="Kryterium odbioru na soczewkach">
          <Tag>kryterium {report.data.criterion_points} pkt</Tag>
          {report.data.spreads.filter((spread) => spread.lens !== 'late_shift' || lateShiftBalanced).map((spread) => {
            const outliers = report.data?.outliers?.find((entry) => entry.lens === spread.lens)
            const detail = !spread.meets_criterion && outliers?.highest && outliers.lowest
              ? `najwyżej: ${outliers.highest.display_name} (${signed(outliers.highest.deviation)}), najniżej: ${outliers.lowest.display_name} (${signed(outliers.lowest.deviation)})`
              : undefined
            return (
              <Chip key={spread.lens} tone={spread.meets_criterion ? 'ok' : 'warn'} title={detail}>
                {lensLabels[spread.lens] ?? spread.lens}: rozpiętość {spread.spread} · {spread.meets_criterion ? 'spełnia' : 'nie spełnia'}
              </Chip>
            )
          })}
        </ChipRow>
      )}
      {report.data && (
        <div className="panel wide-scroll">
          <table className="lg fairness-table" aria-label="Bilans dyżurów">
            <caption className="sr-only">Okno {formatDate(report.data.window_start)} – {formatDate(report.data.window_end)}</caption>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.key} scope="col" aria-sort={sort.key === column.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    <button type="button" onClick={() => toggleSort(column.key)} title={`Sortuj po kolumnie ${column.label}`} aria-sort={sort.key === column.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                      {column.label}
                      {sort.key === column.key && <span aria-hidden="true">{sort.dir === 'asc' ? ' ▲' : ' ▼'}</span>}
                      {column.hint && <small>{column.hint}</small>}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {criterionMembers.map(memberRow)}
              {formerMembers.length > 0 && (
                <tr><th scope="rowgroup" colSpan={columns.length} className="list-h">Poza rotacją</th></tr>
              )}
              {formerMembers.map(memberRow)}
            </tbody>
            {totals && (
              <tfoot>
                <tr className="total">
                  <th scope="row">Razem</th>
                  <td className="mono"><b className="f-actual">{totals.primary_points}</b><span className="muted"> / {expectedSum('primary')}</span></td>
                  <td className="mono"><b className="f-actual">{totals.secondary_points}</b><span className="muted"> / {expectedSum('secondary')}</span></td>
                  {lateShiftBalanced && <td className="mono"><b className="f-actual">{totals.late_shift_count}</b><span className="muted"> / {expectedSum('late_shift')}</span></td>}
                  <td className="mono"><b className="f-actual">{totals.weekend_duties}</b><span className="muted"> / {expectedSum('weekends')}</span></td>
                  <td className="mono"><b className="f-actual">{totals.holiday_duties}</b><span className="muted"> / {expectedSum('holidays')}</span></td>
                  <td className="mono">
                    <b className="f-actual">{roundPoints(totals.primary_points + totals.secondary_points + (lateShiftBalanced ? totals.late_shift_count : 0))}</b>
                    <span className="muted"> / {totalExpectedSum}</span>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      {report.data && !lateShiftBalanced && (
        <p className="muted small">
          Kolumna „Razem” sumuje tylko widoczne soczewki. Przy kotwiczeniu zmiana 11–19 należy do osoby pełniącej rolę on-call, więc jej punkty są już w kolumnach PRIMARY i SECONDARY. Łączna liczba zmian 11–19 w oknie: {totals?.late_shift_count ?? 0}.
        </p>
      )}
      <Box tone="muted">
        „Uczciwy udział” liczymy tylko za dni, w których osoba należała do danej rotacji. Nowa osoba nie nadrabia okresu sprzed dołączenia. Wynik ponad udział lekko zmniejsza, a wynik poniżej udziału lekko zwiększa szansę kolejnego przydziału - zawsze po spełnieniu twardych reguł i z uwzględnieniem ciągłości oraz preferencji. Święto w sobotę lub niedzielę liczy się w soczewce „Weekendy”, aby ten sam dyżur nie wpływał na dwie soczewki.
      </Box>
      <Panel
        open={Boolean(drilldown)}
        onOpenChange={(open) => { if (!open) setDrilldown(null) }}
        title={drilldown?.display_name ?? ''}
        meta={report.data && <Tag>{formatDate(report.data.window_start)} – {formatDate(report.data.window_end)}</Tag>}
      >
        {drilldown && (
          <div className="kv">
            <div className="kv-row"><dt>Punkty w oknie</dt><dd className="mono">{totalBalance(drilldown).actual} / {totalBalance(drilldown).expected}</dd></div>
            <div className="kv-row"><dt>Odchylenie</dt><dd>{deviationWords(totalBalance(drilldown).deviation)}</dd></div>
            <div className="kv-row"><dt>W rotacji od</dt><dd className="mono">{formatDate(drilldown.active_from)}</dd></div>
          </div>
        )}
        {duties.isLoading && <LoadingBlock label="Wczytywanie dyżurów" rows={3} />}
        {duties.error && <ErrorState error={duties.error} onRetry={() => duties.refetch()} />}
        {duties.data?.length === 0 && <p className="muted">Brak dyżurów w tym oknie.</p>}
        {duties.data && duties.data.length > 0 && (
          <List>
            {duties.data.map((duty) => (
              <ListRow key={`${duty.service_date}-${duty.role}`} aside={<span className="mono">{duty.points} pkt</span>}>
                <div className="row">
                  <RoleMark role={duty.role} />
                  <b>{formatDay(duty.service_date)}</b>
                  {duty.is_day_off && <Tag tone="late">2X</Tag>}
                </div>
                <small>{roleLabels[duty.role]}</small>
              </ListRow>
            ))}
          </List>
        )}
      </Panel>
    </div>
  )
}
