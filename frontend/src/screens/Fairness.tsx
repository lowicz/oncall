import { Fragment, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FairnessCategory, FairnessMember, FairnessReport, api } from '../api'
import { lensLabels, roleLabels } from '../lib/labels'
import { docsHref } from '../lib/nav'
import { DEVIATION_SCALE, deviationWords, monthlyTotals, roundPoints, totalBalance } from '../lib/fairness'
import { formatDecimal, formatPoints, signed } from '../lib/numbers'
import { formatDate, formatDayShort, formatShortDate, monthsShort, warsawDate } from '../lib/dates'
import { locale, messages, useLanguage, useMessages } from '../i18n'
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
  const t = useMessages().fairness.drilldown
  const duties = useQuery({
    queryKey: ['fairness-duties', member.member_id, asOf],
    queryFn: () => api.fairnessDuties(member.member_id, asOf),
  })
  const balance = totalBalance(member, lateShiftBalanced)
  const months = monthsOf(report.window_end)
  const monthNames = monthsShort()
  const totals = new Map(monthlyTotals(duties.data ?? []).map((row) => [row.month, row]))
  const points = months.map((month) => totals.get(month)?.points ?? 0)
  const peak = Math.max(1, ...points)
  const average = roundPoints(points.reduce((sum, value) => sum + value, 0) / months.length)
  const name = firstName(member.display_name)
  const plan = Math.abs(balance.deviation) < 0.01
    ? t.plan.onShare(name)
    : balance.deviation < 0
      ? t.plan.moreDuties(name, formatPoints(Math.abs(balance.deviation)))
      : t.plan.fewerDuties(name, formatPoints(balance.deviation))
  return (
    <div className="drill">
      <div className="stack-sm">
        <div className="exp">{t.monthByMonth(name, formatPoints(average))}</div>
        {duties.isLoading && <LoadingBlock label={t.loadingMonths} rows={2} />}
        {duties.error && <ErrorState error={duties.error} onRetry={() => duties.refetch()} />}
        {duties.data && (
          <>
            <div className="bars" role="img" aria-label={t.barsLabel(months.map((month, index) => `${monthNames[Number(month.slice(5)) - 1]} ${points[index]}`).join(', '))}>
              {points.map((value, index) => (
                <div key={months[index]} title={t.barTitle(months[index], value)}>
                  <i className={cx(value < average && 'low')} style={{ height: `${Math.round((value / peak) * 100)}%` }} />
                  <b style={{ top: `${100 - Math.round((average / peak) * 100)}%` }} />
                </div>
              ))}
            </div>
            <div className="bars-x" aria-hidden="true">
              {months.map((month) => <span key={month}>{monthNames[Number(month.slice(5)) - 1]}</span>)}
            </div>
          </>
        )}
        {duties.data && duties.data.length > 0 && (
          <List className="panel drill-duties">
            {duties.data.map((duty) => (
              <ListRow key={`${duty.service_date}-${duty.role}`} aside={<span className="mono">{t.points(formatDecimal(duty.points))}</span>}>
                <div className="row">
                  <RoleMark role={duty.role} size="sm" />
                  <span>{formatDayShort(duty.service_date)}</span>
                  {duty.is_day_off && <Tag tone="late">2X</Tag>}
                </div>
              </ListRow>
            ))}
          </List>
        )}
        {duties.data?.length === 0 && <p className="muted small">{t.noDuties}</p>}
      </div>
      <div className="stack-sm">
        <div className="exp">{t.whyHeading}</div>
        <dl className="kv">
          <div className="kv-row"><dt>{t.pointsInWindow}</dt><dd className="mono">{formatDecimal(balance.actual)} / {formatDecimal(balance.expected)}</dd></div>
          <div className="kv-row"><dt>{t.deviation}</dt><dd>{deviationWords(balance.deviation)}</dd></div>
          <div className="kv-row"><dt>{t.inRotationSince}</dt><dd className="mono">{formatDate(member.active_from)}</dd></div>
          {(['primary', 'secondary', 'late_shift', 'weekends', 'holidays'] as const)
            .filter((lens) => lens !== 'late_shift' || lateShiftBalanced)
            .map((lens) => (
              <div key={lens} className="kv-row"><dt>{lensLabels()[lens]}</dt><dd className="mono">{signed(member[lens].deviation)}</dd></div>
            ))}
        </dl>
        <Box tone="sig" title={t.generatorPlan}>{plan}</Box>
      </div>
    </div>
  )
}

function csvOf(report: FairnessReport, lateShiftBalanced: boolean) {
  const t = messages().fairness.csv
  const lenses = (['primary', 'secondary', 'late_shift', 'weekends', 'holidays'] as const).filter((lens) => lens !== 'late_shift' || lateShiftBalanced)
  const head = [t.person, t.inRotationSince, t.totalPoints, t.totalShare, t.totalDeviation, ...lenses.flatMap((lens) => [t.lensPoints(lens), t.lensShare(lens), t.lensDeviation(lens)])]
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
  const t = useMessages().fairness
  const [language] = useLanguage()
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
  const lensLabel = (item: Lens) => (item === 'total' ? t.total : lensLabels()[item])
  const categoryOf = (member: FairnessMember, key: Lens): FairnessCategory =>
    key === 'total' ? totalBalance(member, lateShiftBalanced) : member[key]
  const holds = (member: FairnessMember, key: Lens) =>
    key === 'total' || key === 'weekends' || key === 'holidays' || (member.eligible_days[key] ?? 0) > 0
  const note = (member: FairnessMember): string | undefined => {
    const reasons: string[] = []
    if (report.data && member.active_from > report.data.window_start) reasons.push(t.note.inRotationSince(formatDate(member.active_from)))
    if (lateShiftBalanced && (member.eligible_days.late_shift ?? 0) === 0) reasons.push(t.note.noLateShifts)
    return reasons.length > 0 ? reasons.join(' · ') : undefined
  }
  const members = [...(report.data?.members ?? [])].sort((a, b) => {
    const diff = Math.abs(categoryOf(b, lens).deviation) - Math.abs(categoryOf(a, lens).deviation)
    return diff !== 0 ? diff : a.display_name.localeCompare(b.display_name, locale())
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
    link.download = t.csv.fileName(report.data.as_of)
    link.click()
    URL.revokeObjectURL(url)
  }
  const columnCount = lenses.length + 3

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
              : <span className="muted small">{t.notHoldingRole}</span>}
          </td>
          <td className="n"><Share category={totalBalance(member, lateShiftBalanced)} /></td>
          {lenses.filter((item) => item !== 'total').map((item) => (
            <td key={item} className="n">
              {holds(member, item) ? <Share category={member[item]} /> : <span className="muted small">{t.notHoldingRole}</span>}
            </td>
          ))}
          <td className="n">
            <IconButton
              size="sm"
              icon={open ? 'chevron-up' : 'chevron-down'}
              label={open ? t.collapseRow(member.display_name) : t.expandRow(member.display_name)}
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
        title={t.title}
        sub={report.data ? (
          <>
            <span>
              {t.summary(formatShortDate(report.data.window_end), t.people(report.data.members.length), formatPoints(report.data.criterion_points))}
            </span>
            {teamView && (
              <StatusBadge tone={report.data.criterion_met ? 'ok' : 'warn'}>{report.data.criterion_met ? t.criterionMet : t.criterionNotMet}</StatusBadge>
            )}
            <span className="muted">
              {asOf > today ? t.includesPlanned : t.rollingActual}
            </span>
          </>
        ) : t.subtitle}
        actions={(
          <form className="row" onSubmit={(event) => event.preventDefault()}>
            <DateField id="fairness-as-of" label={t.asOf} value={asOf} onChange={(value) => value && setAsOf(value)} />
            <Button onClick={() => setAsOf(today)} className="self-end">{t.today}</Button>
            <Button icon="download" onClick={exportCsv} disabled={!report.data} className="self-end">{t.exportCsv}</Button>
          </form>
        )}
      />
      {report.error && <ErrorState error={report.error} onRetry={() => report.refetch()} />}
      {report.isLoading && <LoadingBlock label={t.loadingReport} />}
      {report.data && teamView && (
        <ChipRow label={t.lensCriteria}>
          <Tag>{t.criterionChip(formatDecimal(report.data.criterion_points))}</Tag>
          {report.data.spreads.filter((spread) => spread.lens !== 'late_shift' || lateShiftBalanced).map((spread) => {
            const outliers = report.data?.outliers?.find((entry) => entry.lens === spread.lens)
            const detail = !spread.meets_criterion && outliers?.highest && outliers.lowest
              ? t.outliers(outliers.highest.display_name, signed(outliers.highest.deviation), outliers.lowest.display_name, signed(outliers.lowest.deviation))
              : undefined
            return (
              <Chip key={spread.lens} tone={spread.meets_criterion ? 'ok' : 'warn'} title={detail} onClick={() => setLens(spread.lens as Lens)}>
                {t.spreadChip(lensLabels()[spread.lens] ?? spread.lens, formatDecimal(spread.spread), spread.meets_criterion ? t.meets : t.fails)}
              </Chip>
            )
          })}
          <Chip tone="sig">{t.averageChip(formatPoints(averagePoints))}</Chip>
          {totals && criterionMembers.length > 0 && (
            <Chip>{t.weekendsChip(totals.weekend_duties, criterionMembers.length, formatPoints(totals.weekend_duties / criterionMembers.length))}</Chip>
          )}
        </ChipRow>
      )}
      {report.data && (
        <>
          <SectionHeading
            title={t.team}
            meta={`${formatDate(report.data.window_start)} – ${formatDate(report.data.window_end)}`}
            controls={lenses.map((item) => (
              <button
                key={item}
                type="button"
                className={cx('sech-link', lens === item && 'on')}
                aria-pressed={lens === item}
                onClick={() => setLens(item)}
              >
                {lensLabel(item)}
              </button>
            ))}
          />
          <div className="panel wide-scroll">
            <table className="lg fairness-table" aria-label={t.tableLabel}>
              <caption className="sr-only">{t.caption(formatDate(report.data.window_start), formatDate(report.data.window_end), lensLabel(lens))}</caption>
              <thead>
                <tr>
                  <th scope="col">{t.columns.person}</th>
                  <th scope="col" className="fairness-dev">{t.columns.deviation(lensLabel(lens))}</th>
                  <th scope="col" className="n">{t.total}<small>{t.columns.unitShare(t.units.points)}</small></th>
                  {lenses.filter((item) => item !== 'total').map((item) => (
                    <th key={item} scope="col" className="n">
                      {lensLabels()[item]}<small>{t.columns.unitShare(item === 'late_shift' ? t.units.shifts : item === 'weekends' || item === 'holidays' ? t.units.days : t.units.points)}</small>
                    </th>
                  ))}
                  <th scope="col"><span className="sr-only">{t.columns.details}</span></th>
                </tr>
              </thead>
              <tbody>
                {criterionMembers.map(memberRow)}
                {formerMembers.length > 0 && (
                  <tr><th scope="rowgroup" colSpan={columnCount} className="list-h">{t.formerMembers}</th></tr>
                )}
                {formerMembers.map(memberRow)}
              </tbody>
              {totals && (
                <tfoot>
                  <tr className="total">
                    <th scope="row">{t.total}</th>
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
            {t.definitions.points(roleLabels().late_shift)}
            {' '}{t.definitions.share}
            {!lateShiftBalanced && ` ${t.definitions.anchored(roleLabels().late_shift, totals?.late_shift_count ?? 0)}`}
            {' '}{t.definitions.fullDescription} <a href={`${docsHref(language)}produkt/sprawiedliwosc.html`}>{t.definitions.docsLink}</a>.
          </p>
        </>
      )}
    </div>
  )
}
