import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Alert, Box, Button, CircularProgress, Paper, Typography } from '@mui/material'
import { api } from '../../api'
import { warsawDate } from '../../lib/dates'
import { MonthField } from '../../components/MonthField'

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
  const hasCoverage = rows.some(
    (row) => row.oncall_workdays + row.oncall_weekends + row.oncall_holidays + row.late_shifts > 0,
  )
  const partialCoverage = Boolean(
    preview.data && preview.data.staffed_days < preview.data.days_in_month,
  )
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
  const totals = rows.reduce(
    (sum, row) => ({
      primary_workdays: sum.primary_workdays + row.primary_workdays,
      primary_weekends: sum.primary_weekends + row.primary_weekends,
      primary_holidays: sum.primary_holidays + row.primary_holidays,
      secondary_workdays: sum.secondary_workdays + row.secondary_workdays,
      secondary_weekends: sum.secondary_weekends + row.secondary_weekends,
      secondary_holidays: sum.secondary_holidays + row.secondary_holidays,
      oncall_workdays: sum.oncall_workdays + row.oncall_workdays,
      oncall_weekends: sum.oncall_weekends + row.oncall_weekends,
      oncall_holidays: sum.oncall_holidays + row.oncall_holidays,
      late_shifts: sum.late_shifts + row.late_shifts,
      primary_points: sum.primary_points + row.primary_points,
      secondary_points: sum.secondary_points + row.secondary_points,
      total_points: sum.total_points + row.total_points,
    }),
    {
      primary_workdays: 0, primary_weekends: 0, primary_holidays: 0,
      secondary_workdays: 0, secondary_weekends: 0, secondary_holidays: 0,
      oncall_workdays: 0, oncall_weekends: 0, oncall_holidays: 0, late_shifts: 0,
      primary_points: 0, secondary_points: 0, total_points: 0,
    },
  )
  return (
    <Box className="reports-section" id="raporty">
      <Box>
        <Typography className="eyebrow">[EKSPORT DLA KADR]</Typography>
        <Typography variant="h1">Raport miesięczny</Typography>
        <Typography color="text.secondary">
          CSV dla kadr: zwykłe dni robocze, weekendy i święta osobno dla każdej osoby, wraz z punktami (1X/2X).
          Święto przypadające w sobotę lub niedzielę jest liczone jako weekend.
        </Typography>
      </Box>
      <Paper variant="outlined" className="calendar-controls">
        <MonthField
          id="report-month"
          label="Miesiąc rozliczenia"
          value={month}
          onChange={setMonth}
        />
        <Button
          variant="contained"
          disabled={download.isPending || !month}
          onClick={() => download.mutate()}
        >
          {download.isPending ? 'Przygotowuję…' : 'Pobierz CSV'}
        </Button>
      </Paper>
      {download.isSuccess && <Alert severity="success">Raport został pobrany.</Alert>}
      {download.error && <Alert severity="error">{download.error.message}</Alert>}
      {preview.isLoading && <CircularProgress size={24} />}
      {preview.error && <Alert severity="error">{preview.error.message}</Alert>}
      {preview.data && !hasCoverage && (
        <Alert severity="warning">Wybrany miesiąc nie ma żadnych opublikowanych dyżurów.</Alert>
      )}
      {preview.data && hasCoverage && partialCoverage && (
        <Alert severity="warning">
          Opublikowany grafik pokrywa {preview.data.staffed_days} z {preview.data.days_in_month} dni
          tego miesiąca. Raport uwzględnia tylko dni z pełną obsadą.
        </Alert>
      )}
      {rows.length > 0 && (
        <Paper variant="outlined" className="calendar-scroll">
          <table className="calendar-matrix fairness-table report-table">
            <thead>
              <tr>
                <th scope="col" rowSpan={2}>Osoba</th>
                <th scope="colgroup" colSpan={3}>PRIMARY</th>
                <th scope="colgroup" colSpan={3}>SECONDARY</th>
                <th scope="colgroup" colSpan={3}>On-call razem</th>
                <th scope="col" rowSpan={2}>11–19</th>
                <th scope="colgroup" colSpan={3}>Punkty</th>
              </tr>
              <tr>
                <th scope="col">robocze</th><th scope="col">weekendy</th><th scope="col">święta</th>
                <th scope="col">robocze</th><th scope="col">weekendy</th><th scope="col">święta</th>
                <th scope="col">robocze</th><th scope="col">weekendy</th><th scope="col">święta</th>
                <th scope="col">primary</th><th scope="col">secondary</th><th scope="col">razem</th>
              </tr>
            </thead>
            <tbody>{rows.map((row) => (
              <tr key={row.name}><th scope="row">{row.name}</th>
                <td>{row.primary_workdays}</td>
                <td>{row.primary_weekends}</td>
                <td>{row.primary_holidays}</td>
                <td>{row.secondary_workdays}</td>
                <td>{row.secondary_weekends}</td>
                <td>{row.secondary_holidays}</td>
                <td>{row.oncall_workdays}</td>
                <td>{row.oncall_weekends}</td>
                <td>{row.oncall_holidays}</td>
                <td>{row.late_shifts}</td>
                <td>{row.primary_points}</td>
                <td>{row.secondary_points}</td>
                <td>{row.total_points}</td></tr>
            ))}</tbody>
            <tfoot>
              <tr><th scope="row">Razem</th>
                <td>{totals.primary_workdays}</td>
                <td>{totals.primary_weekends}</td>
                <td>{totals.primary_holidays}</td>
                <td>{totals.secondary_workdays}</td>
                <td>{totals.secondary_weekends}</td>
                <td>{totals.secondary_holidays}</td>
                <td>{totals.oncall_workdays}</td>
                <td>{totals.oncall_weekends}</td>
                <td>{totals.oncall_holidays}</td>
                <td>{totals.late_shifts}</td>
                <td>{totals.primary_points}</td>
                <td>{totals.secondary_points}</td>
                <td>{totals.total_points}</td></tr>
            </tfoot>
          </table>
        </Paper>
      )}
    </Box>
  )
}
