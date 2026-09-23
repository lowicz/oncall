import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { HistoryImportPreview, api } from '../../api'
import { formatDate } from '../../lib/dates'
import { roleLabels } from '../../lib/labels'
import { pluralPl } from '../../lib/plural'
import { inFileOrder } from '../../lib/historyImport'
import { AnchorButton, Box, Button, EmptyState, ErrorState, List, ListRow, LoadingBlock, PageHeader, RoleMark, SectionHeading, Steps, Tag } from '../../ui'

/** Polish plural: 1 wiersz, 2-4 wiersze, 5+ wierszy (12-14 wierszy again). */
export function pluralRows(count: number): string {
  const teens = count % 100 >= 12 && count % 100 <= 14
  const form = count === 1 ? 'wiersz' : (!teens && count % 10 >= 2 && count % 10 <= 4) ? 'wiersze' : 'wierszy'
  return `${count} ${form}`
}

// 2026-01-05 is an ordinary working Monday - 2026-01-01 (Nowy Rok) made the
// template's own "late_shift" row fail its own import (QA7-L04).
const TEMPLATE = [
  'service_date,role,assignee_name',
  '2026-01-05,primary,Anna Nowak',
  '2026-01-05,secondary,Jan Kowalski',
  '2026-01-05,late_shift,Anna Nowak',
].join('\n')

export function HistoryImportPanel() {
  const queryClient = useQueryClient()
  const imports = useQuery({ queryKey: ['history-imports'], queryFn: api.historyImports })
  const [preview, setPreview] = useState<HistoryImportPreview | null>(null)
  const upload = useMutation({ mutationFn: api.previewHistory, onSuccess: setPreview })
  const commit = useMutation({
    mutationFn: api.commitHistory,
    onSuccess: () => {
      setPreview(null)
      queryClient.invalidateQueries({ queryKey: ['history-imports'] })
      queryClient.invalidateQueries({ queryKey: ['fairness'] })
    },
  })
  const revoke = useMutation({
    mutationFn: api.deleteSchedule,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['history-imports'] }),
  })
  const stage = commit.isSuccess ? 3 : preview ? 2 : 1
  const errors = preview ? inFileOrder(preview.errors) : []
  const errorCount = pluralPl(errors.length, ['błąd', 'błędy', 'błędów'])

  return (
    <div className="page">
      <PageHeader title="Import historii" sub="Najpierw sprawdzimy cały CSV. Nic nie zostanie zapisane bez zatwierdzenia." />
      <Steps
        label="Etap importu"
        steps={[
          { label: 'plik CSV', state: stage > 1 ? 'done' : 'on' },
          { label: 'podgląd i błędy', state: stage > 2 ? 'done' : stage === 2 ? 'on' : 'todo' },
          { label: 'zaimportowano', state: stage === 3 ? 'done' : 'todo' },
        ]}
      />
      <div className="panel panel-padded stack-sm">
        <div className="row">
          <label className="btn btn-pri" style={{ cursor: 'pointer' }}>
            {upload.isPending ? 'Sprawdzam…' : 'Wybierz CSV'}
            <input
              hidden
              type="file"
              accept=".csv,text/csv"
              disabled={upload.isPending}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) upload.mutate(file)
                event.target.value = ''
              }}
            />
          </label>
          <AnchorButton href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`} download="oncall-history-template.csv" icon="download">
            Pobierz szablon
          </AnchorButton>
          <span className="muted small">UTF-8 · maks. 1 MB / 5000 wierszy</span>
        </div>
        <p className="muted small">Nazwy w szablonie są przykładowe - zastąp je nazwami z zespołu, dokładnie tak, jak są zapisane w panelu Osoby.</p>
      </div>
      {upload.error && <Box tone="bad" role="alert" title={upload.error.message} />}
      {commit.error && <Box tone="bad" role="alert" title={commit.error.message} />}
      {commit.isSuccess && <Box tone="ok" role="status" title="Historia została zaimportowana." />}
      {preview && (
        <section className="stack-sm" aria-label={preview.filename}>
          <SectionHeading
            title={preview.filename}
            meta={`${pluralRows(preview.rows.length)} · ${errorCount}`}
            controls={(
              <Button variant="primary" disabled={!preview.valid || commit.isPending} loading={commit.isPending} onClick={() => commit.mutate(preview)}>
                {commit.isPending ? 'Importuję…' : 'Zatwierdź import'}
              </Button>
            )}
          />
          {errors.length > 0 && (
            <Box tone="bad" title={`${errorCount} - popraw plik i wgraj go ponownie`}>
              <ul className="box-list">
                {errors.slice(0, 20).map((error, index) => (
                  <li key={`${error.row_number}-${error.field}-${index}`}>{error.row_number ? `Wiersz ${error.row_number}: ` : ''}{error.message}</li>
                ))}
                {errors.length > 20 && <li>… i {errors.length - 20} więcej</li>}
              </ul>
            </Box>
          )}
          <List className="panel">
            {preview.rows.slice(0, 10).map((row) => (
              <ListRow key={`${row.service_date}-${row.role}`} aside={<span className="mono muted">{formatDate(row.service_date)}</span>}>
                <div className="row"><RoleMark role={row.role} /><b>{row.assignee_name}</b><span className="muted small">{roleLabels[row.role]}</span></div>
              </ListRow>
            ))}
            {preview.rows.length > 10 && <div className="list-row muted small">+ {pluralRows(preview.rows.length - 10)} kolejnych</div>}
          </List>
        </section>
      )}
      <section className="stack-sm">
        <SectionHeading title="Wcześniejsze importy" meta={imports.data ? `${imports.data.length}` : undefined} />
        {imports.isLoading && <LoadingBlock label="Wczytywanie importów" rows={2} />}
        {imports.error && <ErrorState error={imports.error} onRetry={() => imports.refetch()} />}
        {imports.data?.length === 0 && <EmptyState compact icon="upload" title="Brak wcześniejszych importów" />}
        {imports.data && imports.data.length > 0 && (
          <List className="panel">
            {imports.data.map((item) => (
              <ListRow key={item.id} aside={<Button size="sm" variant="ghost" icon="undo" disabled={revoke.isPending} onClick={() => revoke.mutate(item.id)}>Cofnij import</Button>}>
                <b>{item.name}</b>
                <small>{formatDate(item.starts_on)} – {formatDate(item.ends_on)} · {pluralRows(item.rows)} · <Tag>{formatDate(item.created_at)}</Tag></small>
              </ListRow>
            ))}
          </List>
        )}
        {revoke.error && <Box tone="bad" role="alert" title={revoke.error.message} />}
      </section>
    </div>
  )
}
