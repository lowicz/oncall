import { Fragment, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FairnessCategory, FairnessMember, FairnessReport, api } from '../api'
import { lensLabels, roleLabels } from '../lib/labels'
import { DEVIATION_SCALE, deviationWords, formatDecimal, formatPoints, monthlyTotals, roundPoints, signed, totalBalance } from '../lib/fairness'
import { pluralPl } from '../lib/plural'
import { formatDate, formatDayShort, formatShortDate, warsawDate } from '../lib/dates'
import { DateField } from '../components/DateField'
import {
  Box,
  Button,
  Chip,
  ChipRow,
  DeviationBar,
  ErrorState,
  IconButton,
  List,
  ListRow,
  LoadingBlock,
  PageHeader,
  RoleMark,
  SectionHeading,
  StatusBadge,
  Tag,
  cx,
} from '../ui'

/** The lens the deviation column and the sort follow. */
type Lens = 'total' | 'primary' | 'secondary' | 'late_shift' | 'weekends' | 'holidays'
const LENSES: Lens[] = ['total', 'primary', 'secondary', 'late_shift', 'weekends', 'holidays']
const LENS_LABEL: Record<Lens, string> = { total: 'Razem', ...lensLabels } as Record<Lens, string>
const MONTHS_SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru']
const firstName = (name: string) => name.split(' ')[0]

/** "12 / 10.5" - what the person did against the fair share, in mono. */
function Share({ category }: { category: FairnessCategory }) {
  return (
    <span className="mono"><b className="f-actual">{formatDecimal(category.actual)}</b><span className="muted"> / {formatDecimal(category.expected)}</span></span>
  )
}

/** Twelve month columns ending with the window, missing months as zero. */
function monthsOf(windowEnd: string) {
  const [y, m] = windowEnd.split('-').map(Number)
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(y, m - 1 - (11 - index), 1))
    return date.toISOString().slice(0, 7)
  })
}

/**
 * Everything behind one person's row: the months as bars against their own
 * monthly average, the numbers in words, the duties that make them up and
 * what the generator will do about the deviation.
 */
function Drilldown({ member, report, asOf, lateShiftBalanced }: {
  member: FairnessMember
  report: FairnessReport
  asOf: string | undefined
  lateShiftBalanced: boolean
}) {
  const duties = useQuery({
    queryKey: ['fairness-duties', member.member_id, asOf],
    queryFn: () => api.fairnessDuties(member.member_id, asOf),
  })
  const balance = totalBalance(member, lateShiftBalanced)
  const months = monthsOf(report.window_end)
  const totals = new Map(monthlyTotals(duties.data ?? []).map((row) => [row.month, row]))
  const points = months.map((month) => totals.get(month)?.points ?? 0)
  const peak = Math.max(1, ...points)
  const average = roundPoints(points.reduce((sum, value) => sum + value, 0) / months.length)
  const name = firstName(member.display_name)
  const plan = Math.abs(balance.deviation) < 0.01
    ? `${name} jest zgodnie z udziałem; generator nie ma czego wyrównywać.`
    : balance.deviation < 0
      ? `W następnym zakresie ${name} dostanie więcej dyżurów, o ${formatPoints(Math.abs(balance.deviation))} pkt do wyrównania.`
      : `W następnym zakresie ${name} dostanie mniej dyżurów, o ${formatPoints(balance.deviation)} pkt do wyrównania.`
  return (
    <div className="drill">
      <div className="stack-sm">
        <div className="exp">{name} · miesiąc po miesiącu (pkt / średnia {formatPoints(average)})</div>
        {duties.isLoading && <LoadingBlock label="Wczytywanie miesięcy" rows={2} />}
        {duties.error && <ErrorState error={duties.error} onRetry={() => duties.refetch()} />}
        {duties.data && (
          <>
            <div className="bars" role="img" aria-label={`Punkty miesiąc po miesiącu: ${months.map((month, index) => `${MONTHS_SHORT[Number(month.slice(5)) - 1]} ${points[index]}`).join(', ')}`}>
              {points.map((value, index) => (
                <div key={months[index]} title={`${months[index]}: ${value} pkt`}>
                  <i className={cx(value < average && 'low')} style={{ height: `${Math.round((value / peak) * 100)}%` }} />
                  <b style={{ top: `${100 - Math.round((average / peak) * 100)}%` }} />
                </div>
              ))}
            </div>
            <div className="bars-x" aria-hidden="true">
              {months.map((month) => <span key={month}>{MONTHS_SHORT[Number(month.slice(5)) - 1]}</span>)}
            </div>
          </>
        )}
        {duties.data && duties.data.length > 0 && (
          <List className="panel drill-duties">
            {duties.data.map((duty) => (
              <ListRow key={`${duty.service_date}-${duty.role}`} aside={<span className="mono">{duty.points} pkt</span>}>
                <div className="row">
                  <RoleMark role={duty.role} size="sm" />
                  <span>{formatDayShort(duty.service_date)}</span>
                  {duty.is_day_off && <Tag tone="late">2X</Tag>}
                </div>
              </ListRow>
            ))}
          </List>
        )}
        {duties.data?.length === 0 && <p className="muted small">Brak dyżurów w tym oknie.</p>}
      </div>
      <div className="stack-sm">
        <div className="exp">Skąd ten wynik</div>
        <dl className="kv">
          <div className="kv-row"><dt>Punkty w oknie</dt><dd className="mono">{formatDecimal(balance.actual)} / {formatDecimal(balance.expected)}</dd></div>
          <div className="kv-row"><dt>Odchylenie</dt><dd>{deviationWords(balance.deviation)}</dd></div>
          <div className="kv-row"><dt>W rotacji od</dt><dd className="mono">{formatDate(member.active_from)}</dd></div>
          {(['primary', 'secondary', 'late_shift', 'weekends', 'holidays'] as const)
            .filter((lens) => lens !== 'late_shift' || lateShiftBalanced)
            .map((lens) => (
              <div key={lens} className="kv-row"><dt>{lensLabels[lens]}</dt><dd className="mono">{signed(member[lens].deviation)}</dd></div>
            ))}
        </dl>
        <Box tone="sig" title="Co zrobi generator">{plan}</Box>
      </div>
    </div>
  )
}

function csvOf(report: FairnessReport, lateShiftBalanced: boolean) {
  const lenses = (['primary', 'secondary', 'late_shift', 'weekends', 'holidays'] as const).filter((lens) => lens !== 'late_shift' || lateShiftBalanced)
  const head = ['osoba', 'w_rotacji_od', 'razem_pkt', 'razem_udzial', 'razem_odchylenie', ...lenses.flatMap((lens) => [`${lens}_pkt`, `${lens}_udzial`, `${lens}_odchylenie`])]
  const rows = report.members.map((member) => {
    const total = totalBalance(member, lateShiftBalanced)
    return [
      member.display_name, member.active_from, total.actual, total.expected, total.deviation,
      ...lenses.flatMap((lens) => [member[lens].actual, member[lens].expected, member[lens].deviation]),
    ]
  })
  const cell = (value: string | number) => (typeof value === 'number' ? String(value) : `"${value.replace(/"/g, '""')}"`)
  return [head, ...rows].map((row) => row.map(cell).join(';')).join('\n')
}

/**
 * One table for the whole team: the deviation from the fair share as a
 * two-way bar, the numbers in mono, a row that unfolds into the months and
 * the reasons. The lens links change only the sort and the bar's lens.
 */
export function FairnessPanel() {
  const today = warsawDate()
  const [asOf, setAsOf] = useState(today)
  const defaultDateApplied = useRef(false)
  const [lens, setLens] = useState<Lens>('total')
  const [openId, setOpenId] = useState<string | null>(null)
  const asOfParam = asOf === today ? undefined : asOf
  const report = useQuery({
    queryKey: ['fairness', asOf],
    queryFn: () => api.fairness(asOfParam),
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
    if (!lateShiftBalanced && lens === 'late_shift') setLens('total')
  }, [lateShiftBalanced, lens])
  const lenses = LENSES.filter((item) => item !== 'late_shift' || lateShiftBalanced)
  const categoryOf = (member: FairnessMember, key: Lens): FairnessCategory =>
    key === 'total' ? totalBalance(member, lateShiftBalanced) : member[key]
  const holds = (member: FairnessMember, key: Lens) =>
    key === 'total' || key === 'weekends' || key === 'holidays' || (member.eligible_days[key] ?? 0) > 0
  const note = (member: FairnessMember): string | undefined => {
    const reasons: string[] = []
    if (report.data && member.active_from > report.data.window_start) reasons.push(`w rotacji od ${formatDate(member.active_from)}`)
    if (lateShiftBalanced && (member.eligible_days.late_shift ?? 0) === 0) reasons.push('bez zmian 11–19')
    return reasons.length > 0 ? reasons.join(' · ') : undefined
  }
  const members = [...(report.data?.members ?? [])].sort((a, b) => {
    const diff = Math.abs(categoryOf(b, lens).deviation) - Math.abs(categoryOf(a, lens).deviation)
    return diff !== 0 ? diff : a.display_name.localeCompare(b.display_name, 'pl')
  })
  const criterionMembers = members.filter((member) => member.in_criterion !== false)
  const formerMembers = members.filter((member) => member.in_criterion === false)
  const totals = report.data?.totals
  // The spread summary is a team quantity; a member seeing only their own row
  // would read a meaningless 0.0 out of it.
  const teamView = (report.data?.members.length ?? 0) > 1
  const sumOf = (key: Lens, field: 'actual' | 'expected') =>
    roundPoints((report.data?.members ?? []).reduce((sum, member) => sum + categoryOf(member, key)[field], 0))
  const averagePoints = report.data && criterionMembers.length > 0
    ? roundPoints(criterionMembers.reduce((sum, member) => sum + totalBalance(member, lateShiftBalanced).actual, 0) / criterionMembers.length)
    : 0
  const exportCsv = () => {
    if (!report.data) return
    const blob = new Blob([`\uFEFF${csvOf(report.data, lateShiftBalanced)}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `sprawiedliwosc-${report.data.as_of}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }
  const columnCount = 3 + lenses.length + 1

  const memberRow = (member: FairnessMember) => {
    const open = openId === member.member_id
    const current = categoryOf(member, lens)
    const memberNote = note(member)
    return (
      <Fragment key={member.member_id}>
        <tr className={cx(open && 'on')}>
          <th scope="row">
            {member.display_name}
            {memberNote && <small>{memberNote}</small>}
          </th>
          <td>
            {holds(member, lens)
              ? <DeviationBar value={current.deviation} max={DEVIATION_SCALE} label={deviationWords(current.deviation)} />
              : <span className="muted small">nie pełni tej roli</span>}
          </td>
          <td className="n"><Share category={totalBalance(member, lateShiftBalanced)} /></td>
          {lenses.filter((item) => item !== 'total').map((item) => (
            <td key={item} className="n">
              {holds(member, item) ? <Share category={member[item]} /> : <span className="muted small">nie pełni tej roli</span>}
            </td>
          ))}
          <td className="n">
            <IconButton
              size="sm"
              icon={open ? 'chevron-up' : 'chevron-down'}
              label={`${open ? 'Zwiń' : 'Rozwiń'}: ${member.display_name}`}
              aria-expanded={open}
              onClick={() => setOpenId(open ? null : member.member_id)}
            />
          </td>
        </tr>
        {open && report.data && (
          <tr className="on drill-row">
            <td colSpan={columnCount}>
              <Drilldown member={member} report={report.data} asOf={asOfParam} lateShiftBalanced={lateShiftBalanced} />
            </td>
          </tr>
        )}
      </Fragment>
    )
  }

  return (
    <div className="page">
      <PageHeader
        title="Sprawiedliwość"
        sub={report.data ? (
          <>
            <span>
              12 miesięcy do {formatShortDate(report.data.window_end)} · {pluralPl(report.data.members.length, ['osoba', 'osoby', 'osób'])}
              {' · '}kryterium: nikt poza ±{formatPoints(report.data.criterion_points)} pkt od udziału
            </span>
            {teamView && (
              <StatusBadge tone={report.data.criterion_met ? 'ok' : 'warn'}>{report.data.criterion_met ? 'spełnione' : 'niespełnione'}</StatusBadge>
            )}
            <span className="muted">
              {asOf > today ? 'Liczy też dyżury już zaplanowane do tego dnia.' : 'Kroczące 12 miesięcy faktycznie odbytych dyżurów.'}
            </span>
          </>
        ) : 'Kroczące 12 miesięcy dyżurów względem sprawiedliwego udziału.'}
        actions={(
          <form className="row" onSubmit={(event) => event.preventDefault()}>
            <DateField id="fairness-as-of" label="Stan na dzień" value={asOf} onChange={(value) => value && setAsOf(value)} />
            <Button onClick={() => setAsOf(today)} className="self-end">Dziś</Button>
            <Button icon="download" onClick={exportCsv} disabled={!report.data} className="self-end">Eksport CSV</Button>
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
              <Chip key={spread.lens} tone={spread.meets_criterion ? 'ok' : 'warn'} title={detail} onClick={() => setLens(spread.lens as Lens)}>
                {lensLabels[spread.lens] ?? spread.lens}: rozpiętość {formatDecimal(spread.spread)} · {spread.meets_criterion ? 'spełnia' : 'nie spełnia'}
              </Chip>
            )
          })}
          <Chip tone="sig">Średnia {formatPoints(averagePoints)} pkt / os.</Chip>
          {totals && criterionMembers.length > 0 && (
            <Chip>Weekendy: {totals.weekend_duties} / {criterionMembers.length} os. = {formatPoints(totals.weekend_duties / criterionMembers.length)}</Chip>
          )}
        </ChipRow>
      )}
      {report.data && (
        <>
          <SectionHeading
            title="Zespół"
            meta={`${formatDate(report.data.window_start)} – ${formatDate(report.data.window_end)}`}
            controls={lenses.map((item) => (
              <button
                key={item}
                type="button"
                className={cx('sech-link', lens === item && 'on')}
                aria-pressed={lens === item}
                onClick={() => setLens(item)}
              >
                {LENS_LABEL[item]}
              </button>
            ))}
          />
          <div className="panel wide-scroll">
            <table className="lg fairness-table" aria-label="Bilans dyżurów">
              <caption className="sr-only">Okno {formatDate(report.data.window_start)} – {formatDate(report.data.window_end)}; kolumna odchylenia pokazuje soczewkę {LENS_LABEL[lens]}.</caption>
              <thead>
                <tr>
                  <th scope="col">Osoba</th>
                  <th scope="col" className="fairness-dev">Odchylenie · {LENS_LABEL[lens]}</th>
                  <th scope="col" className="n">Razem<small>pkt / udział</small></th>
                  {lenses.filter((item) => item !== 'total').map((item) => (
                    <th key={item} scope="col" className="n">
                      {lensLabels[item]}<small>{item === 'late_shift' ? 'zmiany' : item === 'weekends' || item === 'holidays' ? 'dni' : 'pkt'} / udział</small>
                    </th>
                  ))}
                  <th scope="col"><span className="sr-only">Szczegóły</span></th>
                </tr>
              </thead>
              <tbody>
                {criterionMembers.map(memberRow)}
                {formerMembers.length > 0 && (
                  <tr><th scope="rowgroup" colSpan={columnCount} className="list-h">Poza rotacją</th></tr>
                )}
                {formerMembers.map(memberRow)}
              </tbody>
              {totals && (
                <tfoot>
                  <tr className="total">
                    <th scope="row">Razem</th>
                    <td />
                    <td className="n mono">
                      <b className="f-actual">{formatDecimal(roundPoints(totals.primary_points + totals.secondary_points + (lateShiftBalanced ? totals.late_shift_count : 0)))}</b>
                      <span className="muted"> / {formatDecimal(sumOf('total', 'expected'))}</span>
                    </td>
                    <td className="n mono"><b className="f-actual">{formatDecimal(totals.primary_points)}</b><span className="muted"> / {formatDecimal(sumOf('primary', 'expected'))}</span></td>
                    <td className="n mono"><b className="f-actual">{formatDecimal(totals.secondary_points)}</b><span className="muted"> / {formatDecimal(sumOf('secondary', 'expected'))}</span></td>
                    {lateShiftBalanced && <td className="n mono"><b className="f-actual">{formatDecimal(totals.late_shift_count)}</b><span className="muted"> / {formatDecimal(sumOf('late_shift', 'expected'))}</span></td>}
                    <td className="n mono"><b className="f-actual">{formatDecimal(totals.weekend_duties)}</b><span className="muted"> / {formatDecimal(sumOf('weekends', 'expected'))}</span></td>
                    <td className="n mono"><b className="f-actual">{formatDecimal(totals.holiday_duties)}</b><span className="muted"> / {formatDecimal(sumOf('holidays', 'expected'))}</span></td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <p className="muted small">
            Definicje: pkt = dyżury × mnożnik (1X dzień roboczy, 2X weekend i święto); {roleLabels.late_shift} liczone jako zmiany.
            {' '}Udział liczymy tylko za dni, w których osoba należała do danej rotacji; święto w weekend liczy się raz, w soczewce „Weekendy”.
            {!lateShiftBalanced && ` Przy kotwiczeniu zmiana ${roleLabels.late_shift} należy do osoby pełniącej rolę on-call, więc jej punkty są już w kolumnach PRIMARY i SECONDARY; łączna liczba zmian ${roleLabels.late_shift} w oknie: ${totals?.late_shift_count ?? 0}.`}
            {' '}Pełny opis: <a href="/docs/produkt/sprawiedliwosc.html">docs / sprawiedliwość</a>.
          </p>
        </>
      )}
    </div>
  )
}
