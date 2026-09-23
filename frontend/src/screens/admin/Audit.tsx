import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '../../api'
import { auditActionLabels, humanizeAuditSummary } from '../../lib/labels'
import { formatMoment } from '../../lib/dates'
import { DateField } from '../../components/DateField'
import { Button, Checkbox, EmptyState, Field, InlineError, Input, List, ListRow, LoadingBlock, PageHeader, Select, Tag } from '../../ui'

// The map in labels.ts is the single source of truth for known action codes
// (QA7-L16); the filter offers exactly what it can also render as a label.
const AUDIT_ACTIONS = Object.keys(auditActionLabels)
const AUDIT_PAGE_SIZE = 50

export function AuditPanel() {
  const [action, setAction] = useState('')
  const [actor, setActor] = useState('')
  const [queryText, setQueryText] = useState('')
  const [startsOn, setStartsOn] = useState('')
  const [endsOn, setEndsOn] = useState('')
  const [includeLogins, setIncludeLogins] = useState(false)
  const [offset, setOffset] = useState(0)
  const [events, setEvents] = useState<Awaited<ReturnType<typeof api.auditEvents>>>([])
  const [hasMore, setHasMore] = useState(false)
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
    const rows = [['czas_utc', 'akcja', 'aktor', 'opis', 'szczegoly'], ...events.map((event) => [
      event.occurred_at, event.action, event.actor_label, event.summary,
      event.details ? JSON.stringify(event.details) : '',
    ])]
    const blob = new Blob(['﻿', rows.map((row) => row.map(escape).join(',')).join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'audyt.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="page">
      <PageHeader
        title="Audyt"
        sub="Istotne operacje zapisane w systemie, najnowsze na górze. Czasy w strefie Europe/Warsaw."
        actions={<Button icon="download" onClick={exportCsv} disabled={events.length === 0}>Eksportuj CSV</Button>}
      />
      <form className="toolbar panel" onSubmit={(event) => event.preventDefault()} aria-label="Filtry audytu">
        <Field label="Akcja" id="audit-action">
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
              <option value="">Wszystkie</option>
              {AUDIT_ACTIONS.map((item) => <option key={item} value={item}>{auditActionLabels[item] ?? item}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Osoba" id="audit-actor">
          {({ id }) => <Input id={id} value={actor} onChange={(event) => setActor(event.target.value)} />}
        </Field>
        <Field label="Szukaj" id="audit-q">
          {({ id }) => <Input id={id} type="search" value={queryText} onChange={(event) => setQueryText(event.target.value)} />}
        </Field>
        <DateField id="audit-from" label="Od" value={startsOn} onChange={setStartsOn} />
        <DateField id="audit-to" label="Do" value={endsOn} onChange={setEndsOn} />
        <Checkbox label="Pokaż zwykłe logowania" checked={includeLogins} onChange={(event) => setIncludeLogins(event.target.checked)} />
      </form>
      {(actor || queryText) && !includeLogins && (
        <p className="muted small">Rutynowe logowania są w tym widoku ukryte. Włącz „Pokaż zwykłe logowania”, żeby je uwzględnić w wynikach.</p>
      )}
      {load.error && <InlineError error={load.error} />}
      {events.length === 0 && !load.isPending && (
        <EmptyState
          icon="audit"
          title="Brak zdarzeń dla wybranego filtra"
          description={action === 'auth.login'
            ? `W wybranym zakresie nie ma zdarzeń „${auditActionLabels['auth.login']}”. Zmień zakres dat albo pozostałe filtry.`
            : 'Zmień albo wyczyść filtry, żeby zobaczyć więcej zdarzeń.'}
        />
      )}
      {events.length > 0 && (
        <List className="panel">
          {events.map((event) => (
            <ListRow key={event.id} aside={<Tag>{auditActionLabels[event.action] ?? event.action}</Tag>}>
              <div className="row">
                <span className="mono muted small">{formatMoment(event.occurred_at)}</span>
                <b>{humanizeAuditSummary(event.summary)}</b>
              </div>
              <small>{event.actor_label}</small>
              {event.details && (
                <details className="audit-details">
                  <summary>Szczegóły</summary>
                  <pre className="mono">{JSON.stringify(event.details, null, 2)}</pre>
                </details>
              )}
            </ListRow>
          ))}
        </List>
      )}
      {load.isPending && <LoadingBlock label="Wczytywanie zdarzeń" rows={3} />}
      {hasMore && !load.isPending && (
        <div className="row" style={{ justifyContent: 'center' }}>
          <Button onClick={() => load.mutate({ nextOffset: offset })}>Załaduj więcej</Button>
        </div>
      )}
    </div>
  )
}
