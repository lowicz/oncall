import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '../../api'
import { useMessages } from '../../i18n'
import { formatMonth, warsawDate } from '../../lib/dates'
import { formatDecimal } from '../../lib/numbers'
import { MonthField } from '../../components/MonthField'
import { Box, Button, ErrorState, LoadingBlock, PageHeader, ScrollArea } from '../../ui'

const COLUMNS = [
  'primary_workdays', 'primary_weekends', 'primary_holidays',
  'secondary_workdays', 'secondary_weekends', 'secondary_holidays',
  'oncall_workdays', 'oncall_weekends', 'oncall_holidays',
  'late_shifts', 'primary_points', 'secondary_points', 'total_points',
] as const

export function MonthlyReportsPanel() {
  const t = useMessages()
  const current = warsawDate()
  const previousMonth = new Date(`${current.slice(0, 7)}-01T12:00:00Z`)
  previousMonth.setUTCMonth(previousMonth.getUTCMonth() - 1)
  const [month, setMonth] = useState(previousMonth.toISOString().slice(0, 7))
  const preview = useQuery({
    queryKey: ['monthly-report-preview', month],
    queryFn: () => api.monthlyReportPreview(month),
    enabled: Boolean(month),
  })
  const rows = preview.data?.rows ?? []
  const hasCoverage = rows.some((row) => row.oncall_workdays + row.oncall_weekends + row.oncall_holidays + row.late_shifts > 0)
  const partialCoverage = Boolean(preview.data && preview.data.staffed_days < preview.data.days_in_month)
  const download = useMutation({
    mutationFn: () => api.monthlyReport(month),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = t.reports.fileName(month)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
    },
  })
  const totals = Object.fromEntries(COLUMNS.map((key) => [key, rows.reduce((sum, row) => sum + row[key], 0)])) as Record<typeof COLUMNS[number], number>
  const columns = t.reports.columns
  const tableName = t.reports.tableName(formatMonth(month))

  return (
    <div className="page">
      <PageHeader
        title={t.reports.title}
        sub={t.reports.subtitle}
        actions={(
          <form className="row" onSubmit={(event) => { event.preventDefault(); download.mutate() }}>
            <MonthField id="report-month" label={t.reports.month} value={month} onChange={setMonth} />
            <Button type="submit" variant="primary" icon="download" disabled={download.isPending || !month} loading={download.isPending} style={{ alignSelf: 'end' }}>
              {download.isPending ? t.reports.preparing : t.reports.downloadCsv}
            </Button>
          </form>
        )}
      />
      {download.isSuccess && <Box tone="ok" role="status" title={t.reports.downloaded} />}
      {download.error && <Box tone="bad" role="alert" title={download.error.message} />}
      {preview.isLoading && <LoadingBlock label={t.reports.loadingPreview} />}
      {preview.error && <ErrorState error={preview.error} onRetry={() => preview.refetch()} />}
      {preview.data && !hasCoverage && <Box tone="warn" title={t.reports.noPublishedDuties} />}
      {preview.data && hasCoverage && partialCoverage && (
        <Box tone="warn" title={t.reports.partialCoverage(preview.data.staffed_days, preview.data.days_in_month)}>
          {t.reports.partialCoverageNote}
        </Box>
      )}
      {rows.length > 0 && (
        <ScrollArea label={tableName} hint={t.reports.scrollHint}>
          <table className="lg report-table" aria-label={tableName}>
            <thead>
              <tr>
                <th scope="col" rowSpan={2} className="person">{columns.person}</th>
                <th scope="colgroup" colSpan={3} className="n">{t.labels.roles.primary}</th>
                <th scope="colgroup" colSpan={3} className="n">{t.labels.roles.secondary}</th>
                <th scope="colgroup" colSpan={3} className="n">{columns.oncallTotal}</th>
                <th scope="col" rowSpan={2} className="n">{t.labels.roles.late_shift}</th>
                <th scope="colgroup" colSpan={3} className="n">{columns.points}</th>
              </tr>
              <tr>
                <th scope="col" className="n">{columns.workdays}</th><th scope="col" className="n">{columns.weekends}</th><th scope="col" className="n">{columns.holidays}</th>
                <th scope="col" className="n">{columns.workdays}</th><th scope="col" className="n">{columns.weekends}</th><th scope="col" className="n">{columns.holidays}</th>
                <th scope="col" className="n">{columns.workdays}</th><th scope="col" className="n">{columns.weekends}</th><th scope="col" className="n">{columns.holidays}</th>
                <th scope="col" className="n">{columns.pointsPrimary}</th><th scope="col" className="n">{columns.pointsSecondary}</th><th scope="col" className="n">{columns.pointsTotal}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.name}>
                  <th scope="row" className="person">{row.name}</th>
                  {COLUMNS.map((key) => <td key={key} className="n">{formatDecimal(row[key])}</td>)}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="total">
                <th scope="row" className="person">{columns.total}</th>
                {COLUMNS.map((key) => <td key={key} className="n">{formatDecimal(totals[key])}</td>)}
              </tr>
            </tfoot>
          </table>
        </ScrollArea>
      )}
    </div>
  )
}
