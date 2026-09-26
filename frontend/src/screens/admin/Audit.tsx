import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '../../api'
import { useMessages } from '../../i18n'
import { usePublicConfig } from '../../hooks/usePublicConfig'
import { auditActionLabel, humanizeAuditSummary } from '../../lib/labels'
import { formatMoment } from '../../lib/dates'
import { DateField } from '../../components/DateField'
import { Button, Checkbox, EmptyState, Field, InlineError, Input, List, ListRow, LoadingBlock, PageHeader, Select, Tag } from '../../ui'

const AUDIT_PAGE_SIZE = 50

export function AuditPanel() {
  const t = useMessages()
  // The catalog's `labels.auditActions` is the single source of truth for
  // known action codes; the filter offers exactly what it can also render as
  // a label.
  const auditActions = Object.keys(t.labels.auditActions)
  const [action, setAction] = useState('')
  const [actor, setActor] = useState('')
  const [queryText, setQueryText] = useState('')
  const [startsOn, setStartsOn] = useState('')
  const [endsOn, setEndsOn] = useState('')
  const [includeLogins, setIncludeLogins] = useState(false)
  const [offset, setOffset] = useState(0)
  const [events, setEvents] = useState<Awaited<ReturnType<typeof api.auditEvents>>>([])
  const [hasMore, setHasMore] = useState(false)
  // The retention the worker applies comes from the deployment, not from
  // this bundle: the footer states it only once the configuration is here.
  const config = usePublicConfig()
  const load = useMutation({
    mutationFn: ({ nextOffset }: { nextOffset: number }) =>
      api.auditEvents({
        action: action || undefined,
        actor: actor || undefined,
        q: queryText || undefined,
        starts_on: startsOn || undefined,
        ends_on: endsOn || undefined,
        include_logins: includeLogins,
        limit: AUDIT_PAGE_SIZE,
        offset: nextOffset,
      }),
    onSuccess: (data, { nextOffset }) => {
      setEvents((current) => (nextOffset === 0 ? data : [...current, ...data]))
      setHasMore(data.length === AUDIT_PAGE_SIZE)
      setOffset(nextOffset + data.length)
    },
  })

  useEffect(() => {
    load.mutate({ nextOffset: 0 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, actor, queryText, startsOn, endsOn, includeLogins])

  const exportCsv = () => {
    const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
    const columns = t.audit.csv.columns
    const rows = [[columns.occurredAt, columns.action, columns.actor, columns.summary, columns.details], ...events.map((event) => [
      event.occurred_at, event.action, event.actor_label, event.summary,
      event.details ? JSON.stringify(event.details) : '',
    ])]
    const blob = new Blob(['﻿', rows.map((row) => row.map(escape).join(',')).join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = t.audit.csv.fileName
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="page">
      <PageHeader
        title={t.audit.title}
        sub={t.audit.subtitle}
        actions={<Button icon="download" onClick={exportCsv} disabled={events.length === 0}>{t.audit.exportCsv}</Button>}
      />
      <form className="toolbar panel" onSubmit={(event) => event.preventDefault()} aria-label={t.audit.filters.title}>
        <Field label={t.audit.filters.action} id="audit-action">
          {({ id }) => (
            <Select
              id={id}
              name="action"
              value={action}
              onChange={(event) => {
                const next = event.target.value
                setAction(next)
                if (next === 'auth.login') setIncludeLogins(true)
              }}
            >
              <option value="">{t.audit.filters.allActions}</option>
              {auditActions.map((item) => <option key={item} value={item}>{auditActionLabel(item)}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t.audit.filters.person} id="audit-actor">
          {({ id }) => <Input id={id} value={actor} onChange={(event) => setActor(event.target.value)} />}
        </Field>
        <Field label={t.audit.filters.search} id="audit-q">
          {({ id }) => <Input id={id} type="search" value={queryText} onChange={(event) => setQueryText(event.target.value)} />}
        </Field>
        <DateField id="audit-from" label={t.audit.filters.from} value={startsOn} onChange={setStartsOn} />
        <DateField id="audit-to" label={t.audit.filters.to} value={endsOn} onChange={setEndsOn} />
        <Checkbox label={t.audit.filters.showRoutineLogins} checked={includeLogins} onChange={(event) => setIncludeLogins(event.target.checked)} />
      </form>
      {(actor || queryText) && !includeLogins && (
        <p className="muted small">{t.audit.routineLoginsHidden}</p>
      )}
      {load.error && <InlineError error={load.error} />}
      {events.length === 0 && !load.isPending && (
        <EmptyState
          icon="audit"
          title={t.audit.empty}
          description={action === 'auth.login'
            ? t.audit.emptyLogins(auditActionLabel('auth.login'))
            : t.audit.emptyHint}
        />
      )}
      {events.length > 0 && (
        <List className="panel">
          {events.map((event) => (
            <ListRow key={event.id} aside={<Tag>{auditActionLabel(event.action)}</Tag>}>
              <div className="row">
                <span className="mono muted small">{formatMoment(event.occurred_at)}</span>
                <b>{humanizeAuditSummary(event.summary)}</b>
              </div>
              <small>{event.actor_label}</small>
              {event.details && (
                <details className="audit-details">
                  <summary>{t.audit.details}</summary>
                  <pre className="mono">{JSON.stringify(event.details, null, 2)}</pre>
                </details>
              )}
            </ListRow>
          ))}
        </List>
      )}
      {load.isPending && <LoadingBlock label={t.audit.loading} rows={3} />}
      {hasMore && !load.isPending && (
        <div className="row" style={{ justifyContent: 'center' }}>
          <Button onClick={() => load.mutate({ nextOffset: offset })}>{t.audit.loadMore}</Button>
        </div>
      )}
      {config.data && (
        <p className="muted small" data-testid="audit-retention">
          {t.audit.retention(config.data.audit_retention_days, config.data.login_audit_retention_days)}
        </p>
      )}
    </div>
  )
}
