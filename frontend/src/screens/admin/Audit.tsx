import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Alert, Box, Button, Chip, CircularProgress, FormControlLabel, MenuItem, Paper, Switch, TextField, Typography } from '@mui/material'
import { api } from '../../api'
import { auditActionLabels, humanizeAuditSummary } from '../../lib/labels'
import { formatAuditTime } from '../../lib/dates'
import { EmptyState } from '../../components/EmptyState'
import { DateField } from '../../components/DateField'

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
      api.auditEvents({ action: action || undefined, actor: actor || undefined, q: queryText || undefined,
        starts_on: startsOn || undefined, ends_on: endsOn || undefined, include_logins: includeLogins,
        limit: AUDIT_PAGE_SIZE, offset: nextOffset }),
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
    const blob = new Blob(['\ufeff', rows.map((row) => row.map(escape).join(',')).join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a'); link.href = url; link.download = 'audyt.csv'; link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Box className="share-section" id="audyt">
      <Box>
        <Typography className="eyebrow">[ŚLAD AUDYTOWY]</Typography>
        <Typography variant="h1">Audyt</Typography>
        <Typography color="text.secondary">
          Istotne operacje zapisane w systemie, najnowsze na górze. Czasy podane w strefie
          Europe/Warsaw.
        </Typography>
      </Box>
      <Paper variant="outlined" className="calendar-controls">
        <TextField
          select
          id="audit-action"
          name="action"
          label="Akcja"
          value={action}
          onChange={(event) => {
            const next = event.target.value
            setAction(next)
            if (next === 'auth.login') setIncludeLogins(true)
          }}
          className="audit-filter"
        >
          <MenuItem value="">Wszystkie</MenuItem>
          {AUDIT_ACTIONS.map((item) => (
            <MenuItem key={item} value={item}>{auditActionLabels[item] ?? item}</MenuItem>
          ))}
        </TextField>
        <TextField label="Osoba" value={actor} onChange={(event) => setActor(event.target.value)} />
        <TextField label="Szukaj" value={queryText} onChange={(event) => setQueryText(event.target.value)} />
        <DateField id="audit-from" label="Od" value={startsOn} onChange={setStartsOn} />
        <DateField id="audit-to" label="Do" value={endsOn} onChange={setEndsOn} />
        <FormControlLabel control={<Switch checked={includeLogins} onChange={(event) => setIncludeLogins(event.target.checked)} />} label="Pokaż zwykłe logowania" />
        <Button onClick={exportCsv} disabled={events.length === 0}>Eksportuj CSV</Button>
      </Paper>
      {(actor || queryText) && !includeLogins && (
        <Typography variant="body2" color="text.secondary">
          Rutynowe logowania są w tym widoku ukryte. Włącz „Pokaż zwykłe logowania”, żeby je uwzględnić w wynikach.
        </Typography>
      )}
      {load.error && <Alert severity="error">{load.error.message}</Alert>}
      <Paper variant="outlined" className="share-list">
        {events.length === 0 && !load.isPending && (
          <EmptyState
            title="Brak zdarzeń dla wybranego filtra"
            description={
              action === 'auth.login'
                ? `W wybranym zakresie nie ma zdarzeń „${auditActionLabels['auth.login']}”. `
                  + 'Zmień zakres dat albo pozostałe filtry.'
                : 'Zmień albo wyczyść filtry, żeby zobaczyć więcej zdarzeń.'
            }
          />
        )}
        {events.map((event) => (
          <Box className="share-row" key={event.id}>
            <Typography className="date-code audit-time">{formatAuditTime(event.occurred_at)}</Typography>
            <Chip
              label={auditActionLabels[event.action] ?? event.action}
              size="small"
              variant="outlined"
              className="audit-action"
            />
            <Box className="grow">
              <Typography>{humanizeAuditSummary(event.summary)}</Typography>
              <Typography color="text.secondary">{event.actor_label}</Typography>
              {event.details && (
                <details><summary>Szczegóły</summary><pre>{JSON.stringify(event.details, null, 2)}</pre></details>
              )}
            </Box>
          </Box>
        ))}
        {load.isPending && <CircularProgress size={24} />}
        {hasMore && !load.isPending && (
          <Button onClick={() => load.mutate({ nextOffset: offset })}>
            Załaduj więcej
          </Button>
        )}
      </Paper>
    </Box>
  )
}
