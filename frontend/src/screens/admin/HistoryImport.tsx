import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Box, Button, Paper, Stack, Typography } from '@mui/material'
import { HistoryImportPreview, api } from '../../api'
import { formatDate } from '../../lib/dates'
import { roleLabels } from '../../lib/labels'

/** Polish plural: 1 wiersz, 2-4 wiersze, 5+ wierszy (12-14 wierszy again). */
function pluralRows(count: number): string {
  const teens = count % 100 >= 12 && count % 100 <= 14
  const form = count === 1 ? 'wiersz' : (!teens && count % 10 >= 2 && count % 10 <= 4) ? 'wiersze' : 'wierszy'
  return `${count} ${form}`
}

export function HistoryImportPanel() {
  const queryClient = useQueryClient()
  const imports = useQuery({ queryKey: ['history-imports'], queryFn: api.historyImports })
  const [preview, setPreview] = useState<HistoryImportPreview | null>(null)
  const upload = useMutation({
    mutationFn: api.previewHistory,
    onSuccess: setPreview,
  })
  const commit = useMutation({
    mutationFn: api.commitHistory,
    onSuccess: () => { setPreview(null); queryClient.invalidateQueries({ queryKey: ['history-imports'] }) },
  })
  const revoke = useMutation({
    mutationFn: api.deleteSchedule,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['history-imports'] }),
  })
  // 2026-01-05 is an ordinary working Monday - 2026-01-01 (Nowy Rok) made the
  // template's own "late_shift" row fail its own import, since that shift is
  // only allowed on a working day (QA7-L04).
  const template = [
    'service_date,role,assignee_name',
    '2026-01-05,primary,Anna Nowak',
    '2026-01-05,secondary,Jan Kowalski',
    '2026-01-05,late_shift,Anna Nowak',
  ].join('\n')

  return (
    <Box className="history-section" id="historia">
      <Box>
        <Typography className="eyebrow">[IMPORT HISTORII]</Typography>
        <Typography variant="h1">Import historii</Typography>
        <Typography color="text.secondary">
          Najpierw sprawdzimy cały CSV. Nic nie zostanie zapisane bez zatwierdzenia.
        </Typography>
      </Box>
      <Paper variant="outlined" className="history-panel">
        <Stack direction={{ xs: 'column', sm: 'row' }} gap={2} alignItems={{ sm: 'center' }}>
          <Button component="label" variant="contained" disabled={upload.isPending}>
            {upload.isPending ? 'Sprawdzam…' : 'Wybierz CSV'}
            <input
              hidden
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) upload.mutate(file)
                event.target.value = ''
              }}
            />
          </Button>
          <Button
            component="a"
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(template)}`}
            download="oncall-history-template.csv"
          >
            Pobierz szablon
          </Button>
          <Typography color="text.secondary">UTF-8 · maks. 1 MB / 5000 wierszy</Typography>
        </Stack>
        <Typography color="text.secondary" variant="body2">
          Nazwy w szablonie są przykładowe - zastąp je nazwami z zespołu, dokładnie tak, jak
          są zapisane w panelu Osoby.
        </Typography>
      </Paper>
      {upload.error && <Alert severity="error">{upload.error.message}</Alert>}
      {commit.error && <Alert severity="error">{commit.error.message}</Alert>}
      {commit.isSuccess && <Alert severity="success">Historia została zaimportowana.</Alert>}
      {preview && (
        <Paper variant="outlined" className="history-preview">
          <Stack direction="row" justifyContent="space-between" gap={2} alignItems="center">
            <Box className="grow">
              <Typography variant="h2">{preview.filename}</Typography>
              <Typography color="text.secondary">
                {preview.rows.length} odczytanych wierszy · {preview.errors.length} błędów
              </Typography>
            </Box>
            <Button
              variant="contained"
              disabled={!preview.valid || commit.isPending}
              onClick={() => commit.mutate(preview)}
            >
              {commit.isPending ? 'Importuję…' : 'Zatwierdź import'}
            </Button>
          </Stack>
          {preview.errors.length > 0 && (
            <Alert severity="error" className="history-errors">
              {preview.errors.slice(0, 20).map((error, index) => (
                <Typography key={`${error.row_number}-${error.field}-${index}`}>
                  {error.row_number ? `Wiersz ${error.row_number}: ` : ''}{error.message}
                </Typography>
              ))}
            </Alert>
          )}
          {preview.rows.slice(0, 10).map((row) => (
            <Box className="history-row" key={`${row.service_date}-${row.role}`}>
              <Typography className="date-code">{formatDate(row.service_date)}</Typography>
              <Typography className="role-label">{roleLabels[row.role]}</Typography>
              <Typography>{row.assignee_name}</Typography>
            </Box>
          ))}
          {preview.rows.length > 10 && (
            <Typography color="text.secondary" className="history-more">
              + {preview.rows.length - 10} kolejnych wierszy
            </Typography>
          )}
        </Paper>
      )}
      <Paper variant="outlined" className="history-preview">
        <Typography variant="h2">Wcześniejsze importy</Typography>
        {imports.data?.length === 0 && <Typography color="text.secondary">Brak wcześniejszych importów.</Typography>}
        {imports.data?.map((item) => (
          <Box className="history-row" key={item.id}>
            <Box className="grow"><Typography>{item.name}</Typography>
              <Typography color="text.secondary">{formatDate(item.starts_on)} – {formatDate(item.ends_on)} · {pluralRows(item.rows)}</Typography></Box>
            <Button color="error" disabled={revoke.isPending} onClick={() => revoke.mutate(item.id)}>Cofnij import</Button>
          </Box>
        ))}
      </Paper>
    </Box>
  )
}
