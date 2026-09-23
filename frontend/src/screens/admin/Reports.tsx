import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '../../api'
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
      link.download = `oncall-${month}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
    },
  })
  const totals = Object.fromEntries(COLUMNS.map((key) => [key, rows.reduce((sum, row) => sum + row[key], 0)])) as Record<typeof COLUMNS[number], number>

  return (
    <div className="page">
      <PageHeader
        title="Raport miesięczny"
        sub="CSV dla kadr: zwykłe dni robocze, weekendy i święta osobno dla każdej osoby, wraz z punktami (1X/2X). Święto w sobotę lub niedzielę liczy się jako weekend."
        actions={(
          <form className="row" onSubmit={(event) => { event.preventDefault(); download.mutate() }}>
            <MonthField id="report-month" label="Miesiąc rozliczenia" value={month} onChange={setMonth} />
            <Button type="submit" variant="primary" icon="download" disabled={download.isPending || !month} loading={download.isPending} style={{ alignSelf: 'end' }}>
              {download.isPending ? 'Przygotowuję…' : 'Pobierz CSV'}
            </Button>
          </form>
        )}
      />
      {download.isSuccess && <Box tone="ok" role="status" title="Raport został pobrany." />}
      {download.error && <Box tone="bad" role="alert" title={download.error.message} />}
      {preview.isLoading && <LoadingBlock label="Wczytywanie podglądu" />}
      {preview.error && <ErrorState error={preview.error} onRetry={() => preview.refetch()} />}
      {preview.data && !hasCoverage && <Box tone="warn" title="Wybrany miesiąc nie ma żadnych opublikowanych dyżurów." />}
      {preview.data && hasCoverage && partialCoverage && (
        <Box tone="warn" title={`Opublikowany grafik pokrywa ${preview.data.staffed_days} z ${preview.data.days_in_month} dni tego miesiąca.`}>
          Raport uwzględnia tylko dni z pełną obsadą.
        </Box>
      )}
      {rows.length > 0 && (
        <ScrollArea label={`Raport za ${formatMonth(month)}`} hint="Tabela jest szersza niż ekran - przewiń ją w bok, aby zobaczyć wszystkie kolumny, w tym punkty.">
          <table className="lg report-table" aria-label={`Raport za ${formatMonth(month)}`}>
            <thead>
              <tr>
                <th scope="col" rowSpan={2} className="person">Osoba</th>
                <th scope="colgroup" colSpan={3} className="n">PRIMARY</th>
                <th scope="colgroup" colSpan={3} className="n">SECONDARY</th>
                <th scope="colgroup" colSpan={3} className="n">On-call razem</th>
                <th scope="col" rowSpan={2} className="n">11–19</th>
                <th scope="colgroup" colSpan={3} className="n">Punkty</th>
              </tr>
              <tr>
                <th scope="col" className="n">robocze</th><th scope="col" className="n">weekendy</th><th scope="col" className="n">święta</th>
                <th scope="col" className="n">robocze</th><th scope="col" className="n">weekendy</th><th scope="col" className="n">święta</th>
                <th scope="col" className="n">robocze</th><th scope="col" className="n">weekendy</th><th scope="col" className="n">święta</th>
                <th scope="col" className="n">primary</th><th scope="col" className="n">secondary</th><th scope="col" className="n">razem</th>
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
                <th scope="row" className="person">Razem</th>
                {COLUMNS.map((key) => <td key={key} className="n">{formatDecimal(totals[key])}</td>)}
              </tr>
            </tfoot>
          </table>
        </ScrollArea>
      )}
    </div>
  )
}
