import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { HistoryImportPreview, HistoryImportRecord, api } from '../../api'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { useMessages } from '../../i18n'
import { formatDate } from '../../lib/dates'
import { roleLabels } from '../../lib/labels'
import { inFileOrder } from '../../lib/historyImport'
import { AnchorButton, Box, Button, EmptyState, ErrorState, List, ListRow, LoadingBlock, PageHeader, RoleMark, SectionHeading, Steps, Tag } from '../../ui'

// The template's column names and role codes are the API's own, and the
// sample names are placeholders in every language. 2026-01-05 is an ordinary
// working Monday: on a holiday the "late_shift" row would fail its own import.
const TEMPLATE = [
  'service_date,role,assignee_name',
  '2026-01-05,primary,Anna Nowak',
  '2026-01-05,secondary,Jan Kowalski',
  '2026-01-05,late_shift,Anna Nowak',
].join('\n')

export function HistoryImportPanel() {
  const t = useMessages().historyImport
  const roles = roleLabels()
  const queryClient = useQueryClient()
  const imports = useQuery({ queryKey: ['history-imports'], queryFn: api.historyImports })
  const [preview, setPreview] = useState<HistoryImportPreview | null>(null)
  const upload = useMutation({ mutationFn: api.previewHistory, onSuccess: setPreview })
  // A real button opens the hidden input, so the keyboard and a screen reader reach it.
  const fileInput = useRef<HTMLInputElement>(null)
  const commit = useMutation({
    mutationFn: api.commitHistory,
    onSuccess: () => {
      setPreview(null)
      queryClient.invalidateQueries({ queryKey: ['history-imports'] })
      queryClient.invalidateQueries({ queryKey: ['fairness'] })
    },
  })
  // Undoing an import deletes its rows for good, so it is confirmed first.
  const [toRevoke, setToRevoke] = useState<HistoryImportRecord | null>(null)
  const revoke = useMutation({
    mutationFn: api.deleteSchedule,
    onSuccess: () => {
      setToRevoke(null)
      queryClient.invalidateQueries({ queryKey: ['history-imports'] })
      queryClient.invalidateQueries({ queryKey: ['fairness'] })
    },
  })
  const stage = commit.isSuccess ? 3 : preview ? 2 : 1
  const errors = preview ? inFileOrder(preview.errors) : []
  const errorCount = t.errors(errors.length)

  return (
    <div className="page">
      <PageHeader title={t.title} sub={t.subtitle} />
      <Steps
        label={t.stage}
        steps={[
          { label: t.steps.file, state: stage > 1 ? 'done' : 'on' },
          { label: t.steps.preview, state: stage > 2 ? 'done' : stage === 2 ? 'on' : 'todo' },
          { label: t.steps.done, state: stage === 3 ? 'done' : 'todo' },
        ]}
      />
      <div className="panel panel-padded stack-sm">
        <div className="row">
          <Button variant="primary" loading={upload.isPending} onClick={() => fileInput.current!.click()}>
            {upload.isPending ? t.checking : t.chooseCsv}
          </Button>
          <input
            ref={fileInput}
            hidden
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) upload.mutate(file)
              event.target.value = ''
            }}
          />
          <AnchorButton href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`} download={t.templateFileName} icon="download">
            {t.downloadTemplate}
          </AnchorButton>
          <span className="muted small">{t.limits}</span>
        </div>
        <p className="muted small">{t.templateNote}</p>
      </div>
      {upload.error && <Box tone="bad" role="alert" title={upload.error.message} />}
      {commit.error && <Box tone="bad" role="alert" title={commit.error.message} />}
      {commit.isSuccess && <Box tone="ok" role="status" title={t.imported} />}
      {preview && (
        <section className="stack-sm" aria-label={preview.filename}>
          <SectionHeading
            title={preview.filename}
            meta={`${t.rows(preview.rows.length)} · ${errorCount}`}
            controls={(
              <Button variant="primary" disabled={!preview.valid || commit.isPending} loading={commit.isPending} onClick={() => commit.mutate(preview)}>
                {commit.isPending ? t.importing : t.confirmImport}
              </Button>
            )}
          />
          {errors.length > 0 && (
            <Box tone="bad" title={t.fixAndReupload(errorCount)}>
              <ul className="box-list">
                {errors.slice(0, 20).map((error, index) => (
                  <li key={`${error.row_number}-${error.field}-${index}`}>{error.row_number ? t.rowPrefix(error.row_number) : ''}{error.message}</li>
                ))}
                {errors.length > 20 && <li>{t.moreErrors(errors.length - 20)}</li>}
              </ul>
            </Box>
          )}
          <List className="panel">
            {preview.rows.slice(0, 10).map((row) => (
              <ListRow key={`${row.service_date}-${row.role}`} aside={<span className="mono muted">{formatDate(row.service_date)}</span>}>
                <div className="row"><RoleMark role={row.role} /><b>{row.assignee_name}</b><span className="muted small">{roles[row.role]}</span></div>
              </ListRow>
            ))}
            {preview.rows.length > 10 && <div className="list-row muted small">{t.moreRows(t.rows(preview.rows.length - 10))}</div>}
          </List>
        </section>
      )}
      <section className="stack-sm">
        <SectionHeading title={t.previous.title} meta={imports.data ? `${imports.data.length}` : undefined} />
        {imports.isLoading && <LoadingBlock label={t.previous.loading} rows={2} />}
        {imports.error && <ErrorState error={imports.error} onRetry={() => imports.refetch()} />}
        {imports.data?.length === 0 && <EmptyState compact icon="upload" title={t.previous.empty} />}
        {imports.data && imports.data.length > 0 && (
          <List className="panel">
            {imports.data.map((item) => (
              <ListRow key={item.id} aside={<Button size="sm" variant="ghost" icon="undo" disabled={revoke.isPending} onClick={() => { revoke.reset(); setToRevoke(item) }}>{t.previous.undo}</Button>}>
                <b>{item.name}</b>
                <small>{formatDate(item.starts_on)} – {formatDate(item.ends_on)} · {t.rows(item.rows)} · <Tag>{formatDate(item.created_at)}</Tag></small>
              </ListRow>
            ))}
          </List>
        )}
      </section>
      <ConfirmDialog
        open={Boolean(toRevoke)}
        title={toRevoke ? t.revokeDialog.title(toRevoke.name) : ''}
        description={toRevoke && t.revokeDialog.description(toRevoke.rows)}
        confirmLabel={t.previous.undo}
        confirmColor="error"
        pending={revoke.isPending}
        error={revoke.error ? revoke.error.message : null}
        onCancel={() => setToRevoke(null)}
        onConfirm={() => toRevoke && revoke.mutate(toRevoke.id)}
      />
    </div>
  )
}
