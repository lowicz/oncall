import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Typography,
} from '@mui/material'
import { FairnessMember, api } from '../api'
import { roleLabels } from '../lib/labels'
import { formatDate, warsawDate } from '../lib/dates'
import { DateField } from '../components/DateField'

/** Widest deviation the bar renders at full length; beyond it the bar pins. */
const DEVIATION_SCALE = 3

function deviationWords(value: number) {
  if (Math.abs(value) < 0.01) return 'zgodnie z udziałem'
  return value > 0
    ? `${value} ponad udział`
    : `${Math.abs(value)} poniżej udziału`
}

/**
 * Deviation as a bar growing from a centre line, so a column can be scanned
 * for who is out of balance without reading every number. The number and the
 * accessible description carry the same information, since colour alone must
 * never be the sole carrier (docs/PLAN.md §6).
 */
function DeviationBar({ value }: { value: number }) {
  const neutral = Math.abs(value) < 0.01
  const ratio = Math.min(Math.abs(value) / DEVIATION_SCALE, 1)
  const side = value > 0 ? 'over' : 'under'
  return (
    <Box className="deviation" title={deviationWords(value)}>
      <Box className="deviation-track" aria-hidden="true">
        <Box
          className={`deviation-fill deviation-${neutral ? 'neutral' : side}`}
          style={neutral ? undefined : { width: `${ratio * 50}%` }}
        />
      </Box>
      <Typography className={`deviation-value deviation-${neutral ? 'neutral' : side}`}>
        {neutral ? '0' : `${value > 0 ? '+' : ''}${value}`}
      </Typography>
    </Box>
  )
}

function FairnessCell({ category, suffix = '', eligible = true, note }: {
  category: FairnessMember['primary']
  suffix?: string
  /** Somebody without eligibility for the role has no fair share to meet, so
   *  „0 / 0 · zgodnie z udziałem" reads as a verdict where there is none
   *  (MED5-05). `DraftFairnessPanel` has always said this properly. */
  eligible?: boolean
  /** Structural reason an absolute number is small even when the deviation is
   *  fine - joined mid-window, no 11-19 eligibility (MED6-02). */
  note?: string
}) {
  if (!eligible) return <Typography color="text.secondary">nie pełni tej roli</Typography>
  return (
    <Box
      className="fairness-cell"
      aria-label={`Wykonane ${category.actual}${suffix}, uczciwy udział ${category.expected}, ${deviationWords(category.deviation)}${note ? `, ${note}` : ''}`}
    >
      <Typography className="fairness-actual" title={`Uczciwy udział: ${category.expected}`}>
        {category.actual}{suffix}
        <span className="fairness-expected"> / {category.expected}</span>
      </Typography>
      <DeviationBar value={category.deviation} />
      <Typography variant="caption" color="text.secondary">
        {deviationWords(category.deviation)}
      </Typography>
      {note && (
        <Typography variant="caption" color="text.secondary" className="fairness-context-note">
          {note}
        </Typography>
      )}
    </Box>
  )
}

type SortKey = 'name' | 'primary' | 'secondary' | 'late_shift' | 'weekends' | 'holidays' | 'total'

const SORT_COLUMNS: Array<{ key: SortKey; label: string; hint?: string }> = [
  { key: 'name', label: 'Osoba' },
  { key: 'primary', label: 'PRIMARY', hint: 'pkt / udział' },
  { key: 'secondary', label: 'SECONDARY', hint: 'pkt / udział' },
  {
    key: 'late_shift',
    label: '11–19',
    hint: 'zmiany / udział · informacyjnie przy kotwiczeniu',
  },
  { key: 'weekends', label: 'Weekendy', hint: 'dni / udział' },
  { key: 'holidays', label: 'Święta', hint: 'dni / udział' },
  { key: 'total', label: 'Razem', hint: 'pkt / udział' },
]

export function FairnessPanel() {
  const today = warsawDate()
  const [asOf, setAsOf] = useState(today)
  const defaultDateApplied = useRef(false)
  const [drilldown, setDrilldown] = useState<FairnessMember | null>(null)
  // The screen exists to find the most deviated people, so sorting by the
  // absolute deviation (largest first) is the useful default beyond name.
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' })
  const report = useQuery({
    queryKey: ['fairness', asOf],
    queryFn: () => api.fairness(asOf === today ? undefined : asOf),
  })
  useEffect(() => {
    // `/schedules/published` caps its own `ends_on` at today + 90 days by
    // design (LOW6-08), so it cannot answer "when does the latest
    // publication actually end" for a longer horizon; the report itself
    // carries the real date (QA7 par. 8, C2 review).
    if (defaultDateApplied.current || !report.data) return
    defaultDateApplied.current = true
    const latestEnd = report.data.latest_publish_end
    if (latestEnd && latestEnd > today) {
      setAsOf(latestEnd)
    }
  }, [report.data, today])
  // D1: with an anchor the 11-19 count follows the anchor role and the column
  // hides; only `independent` shows it as a lens balanced on its own.
  const lateShiftBalanced = report.data?.late_shift_balanced !== false
  useEffect(() => {
    if (!lateShiftBalanced && sort.key === 'late_shift') {
      setSort({ key: 'name', dir: 'asc' })
    }
  }, [lateShiftBalanced, sort.key])
  const columns = SORT_COLUMNS.filter(
    (column) => column.key !== 'late_shift' || lateShiftBalanced,
  )
  // D4 (MED6-01): the per-person „Razem" and the summary „Razem" have to add up
  // the same columns. With the 11-19 lens anchored its column is hidden, so it
  // leaves both totals; the footnote under the table keeps the hidden count in
  // view. Weekends/holidays are subsets of the on-call points and never added.
  const roundPoints = (value: number) => Math.round(value * 100) / 100
  const visibleSum = (member: FairnessMember, field: 'actual' | 'expected') =>
    roundPoints(
      member.primary[field]
      + member.secondary[field]
      + (lateShiftBalanced ? member.late_shift[field] : 0),
    )
  const visibleTotal = (member: FairnessMember) => visibleSum(member, 'actual')
  // MED6-02: „Razem" gets an expected value and a deviation like every other
  // column, so a small absolute number reads against the fair share instead of
  // in isolation. The deviation is rebuilt from the parts, not from the two
  // already-rounded sums, so a member whose every lens is „zgodnie z udziałem"
  // does not pick up a phantom 0.01 here.
  const totalBalance = (member: FairnessMember): FairnessMember['primary'] => {
    const perLens =
      member.primary.deviation
      + member.secondary.deviation
      + (lateShiftBalanced ? member.late_shift.deviation : 0)
    return {
      actual: visibleTotal(member),
      expected: visibleSum(member, 'expected'),
      deviation: roundPoints(perLens),
    }
  }
  // Why an absolute total can be far below the pack while the deviation is fine.
  const totalNote = (member: FairnessMember): string | undefined => {
    const reasons: string[] = []
    if (report.data && member.active_from > report.data.window_start) {
      reasons.push(`w rotacji od ${formatDate(member.active_from)}`)
    }
    if (lateShiftBalanced && (member.eligible_days.late_shift ?? 0) === 0) {
      reasons.push('bez zmian 11–19')
    }
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
      return sort.dir === 'asc'
        ? a.display_name.localeCompare(b.display_name, 'pl')
        : b.display_name.localeCompare(a.display_name, 'pl')
    }
    // Largest deviation first; ties fall back to the name so the order is stable.
    const diff = Math.abs(deviationOf(b, sort.key)) - Math.abs(deviationOf(a, sort.key))
    const ordered = sort.dir === 'desc' ? diff : -diff
    return ordered !== 0 ? ordered : a.display_name.localeCompare(b.display_name, 'pl')
  })
  const criterionMembers = sortedMembers.filter((member) => member.in_criterion !== false)
  const formerMembers = sortedMembers.filter((member) => member.in_criterion === false)
  const totals = report.data?.totals
  const expectedSum = (key: 'primary' | 'secondary' | 'late_shift' | 'weekends' | 'holidays') =>
    Math.round(
      (report.data?.members ?? []).reduce((sum, member) => sum + member[key].expected, 0) * 100,
    ) / 100
  const totalExpectedSum = roundPoints(
    (report.data?.members ?? []).reduce((sum, member) => sum + visibleSum(member, 'expected'), 0),
  )
  // The spread summary is a team quantity; a member seeing only their own row
  // would read a meaningless 0.0 out of it.
  const teamView = (report.data?.members.length ?? 0) > 1
  const criterionCell = (lens: 'primary' | 'secondary' | 'late_shift' | 'weekends' | 'holidays') => {
    const item = report.data?.spreads.find((spread) => spread.lens === lens)
    if (!item) return <td key={lens} />
    const outliers = report.data?.outliers?.find((entry) => entry.lens === lens)
    const signed = (value: number) => `${value > 0 ? '+' : ''}${value}`
    return (
      <td key={lens}>
        <span className="fairness-actual">{item.spread}</span>
        <Typography
          variant="caption"
          display="block"
          color={item.meets_criterion ? 'text.secondary' : 'warning.main'}
        >
          {item.meets_criterion ? 'spełnia' : 'nie spełnia'}
        </Typography>
        {!item.meets_criterion && outliers?.highest && outliers.lowest && (
          <Typography variant="caption" display="block" color="text.secondary">
            najwyżej: {outliers.highest.display_name} ({signed(outliers.highest.deviation)}),{' '}
            najniżej: {outliers.lowest.display_name} ({signed(outliers.lowest.deviation)})
          </Typography>
        )}
      </td>
    )
  }

  const memberRow = (member: FairnessMember) => (
    <tr key={member.member_id}>
      <th scope="row" className="member-column">
        <button type="button" className="fairness-member" onClick={() => setDrilldown(member)} aria-label={`Dyżury: ${member.display_name}`}>
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
    <Box className="fairness-section" id="sprawiedliwosc">
      <Box>
        <Typography className="eyebrow">[BILANS 12 MIESIĘCY]</Typography>
        <Typography variant="h1">Sprawiedliwość</Typography>
        <Typography color="text.secondary">
          {asOf > today
            ? `Kroczące 12 miesięcy do ${formatDate(asOf)}, licząc też dyżury już zaplanowane do tego dnia.`
            : 'Kroczące 12 miesięcy faktycznie odbytych dyżurów.'}
          {' '}Kliknij osobę, aby zobaczyć dyżury składające się na wynik.
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Święto przypadające w sobotę lub niedzielę jest tutaj liczone w soczewce
          „Weekendy”, aby ten sam dyżur nie wpływał na dwie soczewki jednocześnie.
        </Typography>
      </Box>
      <Alert severity="info">
        „Uczciwy udział” liczymy tylko za dni, w których osoba należała do danej rotacji.
        Nowa osoba nie nadrabia okresu sprzed dołączenia. Wynik ponad udział lekko zmniejsza,
        a wynik poniżej udziału lekko zwiększa szansę kolejnego przydziału - zawsze po
        spełnieniu twardych reguł i z uwzględnieniem ciągłości oraz preferencji.
      </Alert>
      <Paper variant="outlined" className="calendar-controls">
        <DateField
          id="fairness-as-of"
          label="Stan na dzień"
          value={asOf}
          onChange={setAsOf}
        />
        <Button onClick={() => setAsOf(today)}>Dziś</Button>
        {report.data && (
          <Typography color="text.secondary">
            Okno: {formatDate(report.data.window_start)} – {formatDate(report.data.window_end)}
          </Typography>
        )}
      </Paper>
      {report.error && <Alert severity="error">{report.error.message}</Alert>}
      {report.isLoading && <CircularProgress aria-label="Ładowanie raportu" />}
      {report.data && (
        <Paper variant="outlined" className="calendar-scroll" tabIndex={0}>
          <table className="calendar-matrix fairness-table">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={column.key === 'name' ? 'member-column' : undefined}
                    aria-sort={
                      sort.key === column.key
                        ? (sort.dir === 'asc' ? 'ascending' : 'descending')
                        : undefined
                    }
                  >
                    <button
                      type="button"
                      className="fairness-sort"
                      onClick={() => toggleSort(column.key)}
                      title={`Sortuj po kolumnie ${column.label}`}
                    >
                      {column.label}
                      {sort.key === column.key && (
                        <span aria-hidden="true">{sort.dir === 'asc' ? ' ▲' : ' ▼'}</span>
                      )}
                      {column.hint && <small>{column.hint}</small>}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {criterionMembers.map(memberRow)}
              {formerMembers.length > 0 && (
                <tr className="fairness-group-row">
                  <th scope="rowgroup" colSpan={columns.length}>Poza rotacją</th>
                </tr>
              )}
              {formerMembers.map(memberRow)}
            </tbody>
            {totals && (
              <tfoot>
                {teamView && (
                  <tr className="fairness-criterion-row">
                    <th scope="row" className="member-column">
                      Rozpiętość
                      <span className="fairness-expected"> kryterium {report.data.criterion_points} pkt</span>
                    </th>
                    {criterionCell('primary')}
                    {criterionCell('secondary')}
                    {lateShiftBalanced && criterionCell('late_shift')}
                    {criterionCell('weekends')}
                    {criterionCell('holidays')}
                    <td>
                      <Typography variant="caption" color="text.secondary">—</Typography>
                    </td>
                  </tr>
                )}
                <tr>
                  <th scope="row" className="member-column">Razem</th>
                  <td><span className="fairness-actual">{totals.primary_points}</span>
                    <span className="fairness-expected"> / {expectedSum('primary')}</span></td>
                  <td><span className="fairness-actual">{totals.secondary_points}</span>
                    <span className="fairness-expected"> / {expectedSum('secondary')}</span></td>
                  {lateShiftBalanced && (
                    <td><span className="fairness-actual">{totals.late_shift_count}</span>
                      <span className="fairness-expected"> / {expectedSum('late_shift')}</span></td>
                  )}
                  <td><span className="fairness-actual">{totals.weekend_duties}</span>
                    <span className="fairness-expected"> / {expectedSum('weekends')}</span></td>
                  <td><span className="fairness-actual">{totals.holiday_duties}</span>
                    <span className="fairness-expected"> / {expectedSum('holidays')}</span></td>
                  <td><span className="fairness-actual">
                    {roundPoints(
                      totals.primary_points
                      + totals.secondary_points
                      + (lateShiftBalanced ? totals.late_shift_count : 0),
                    )}
                    <span className="fairness-expected"> / {totalExpectedSum}</span>
                  </span></td>
                </tr>
              </tfoot>
            )}
          </table>
        </Paper>
      )}
      {report.data && !lateShiftBalanced && (
        <Typography variant="caption" color="text.secondary" component="p">
          Kolumna „Razem” sumuje tylko widoczne soczewki. Przy kotwiczeniu zmiana
          11–19 należy do osoby pełniącej rolę on-call, więc jej punkty są już
          w kolumnach PRIMARY i SECONDARY - osobno nie są doliczane. Łączna
          liczba zmian 11–19 w oknie: {totals?.late_shift_count ?? 0}.
        </Typography>
      )}
      <Dialog
        open={Boolean(drilldown)}
        onClose={() => setDrilldown(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>{drilldown?.display_name} · dyżury w oknie</DialogTitle>
        <DialogContent className="calendar-dialog-content">
          {duties.isLoading && <CircularProgress size={24} />}
          {duties.error && <Alert severity="error">{duties.error.message}</Alert>}
          {duties.data?.length === 0 && (
            <Typography color="text.secondary">Brak dyżurów w tym oknie.</Typography>
          )}
          {duties.data?.map((duty) => (
            <Box className="history-row" key={`${duty.service_date}-${duty.role}`}>
              <Typography className="date-code">{formatDate(duty.service_date)}</Typography>
              <Typography className="role-label">
                {roleLabels[duty.role]}{duty.is_day_off ? ' · 2X' : ''}
              </Typography>
              <Typography>{duty.points} pkt</Typography>
            </Box>
          ))}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDrilldown(null)}>Zamknij</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
