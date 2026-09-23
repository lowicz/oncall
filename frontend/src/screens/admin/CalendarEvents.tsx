import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarEvent, CalendarEventInput, api } from '../../api'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { DateField } from '../../components/DateField'
import { EVENT_COLORS } from '../../components/CalendarMatrix'
import { addDays, formatDate, warsawDate } from '../../lib/dates'
import { Box, Button, EmptyState, ErrorState, Field, Input, List, ListRow, LoadingBlock, PageHeader, SectionHeading, cx } from '../../ui'

const emptyInput = (): CalendarEventInput => ({ starts_on: warsawDate(), ends_on: warsawDate(), title: '', color: 'blue' })

export function CalendarEventsPanel() {
  const today = warsawDate()
  const [range, setRange] = useState({ starts_on: today, ends_on: addDays(today, 89) })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<CalendarEventInput>(emptyInput)
  const [toDelete, setToDelete] = useState<CalendarEvent | null>(null)
  const queryClient = useQueryClient()
  const queryKey = ['calendar-events', range.starts_on, range.ends_on]
  const events = useQuery({ queryKey, queryFn: () => api.calendarEvents(range.starts_on, range.ends_on) })
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['calendar-events'] })
    queryClient.invalidateQueries({ queryKey: ['calendar'] })
  }
  const reset = () => { setEditingId(null); setForm(emptyInput()) }
  const save = useMutation({
    mutationFn: () => (editingId ? api.updateCalendarEvent({ id: editingId, ...form }) : api.createCalendarEvent(form)),
    onSuccess: () => { reset(); refresh() },
  })
  const remove = useMutation({
    mutationFn: api.deleteCalendarEvent,
    onSuccess: () => { setToDelete(null); refresh() },
  })
  const edit = (event: CalendarEvent) => {
    setEditingId(event.id)
    setForm({ starts_on: event.starts_on, ends_on: event.ends_on, title: event.title, color: event.color })
  }
  const error = events.error ?? save.error ?? remove.error

  return (
    <div className="page">
      <PageHeader
        title="Wydarzenia"
        sub="Wydarzenia są tylko oznaczeniem wizualnym w grafiku - nie zmieniają obsady, stawek ani raportów."
      />
      <div className="split">
        <div className="stack-sm">
          <SectionHeading title="Lista" meta={`${formatDate(range.starts_on)} – ${formatDate(range.ends_on)}`} />
          <form className="toolbar panel" onSubmit={(event) => event.preventDefault()} aria-label="Zakres listy">
            <DateField id="events-from" label="Pokaż od" value={range.starts_on} onChange={(starts_on) => starts_on && setRange({ ...range, starts_on })} />
            <DateField id="events-to" label="Pokaż do" value={range.ends_on} onChange={(ends_on) => ends_on && setRange({ ...range, ends_on })} />
          </form>
          {events.isLoading && <LoadingBlock label="Wczytywanie wydarzeń" rows={3} />}
          {events.error && <ErrorState error={events.error} onRetry={() => events.refetch()} />}
          {events.data?.length === 0 && <EmptyState compact icon="event" title="Brak wydarzeń w wybranym zakresie" />}
          {events.data && events.data.length > 0 && (
            <List className="panel">
              {events.data.map((event) => (
                <ListRow
                  key={event.id}
                  highlight={editingId === event.id}
                  aside={(
                    <>
                      <Button size="sm" onClick={() => edit(event)}>Edytuj</Button>
                      <Button size="sm" variant="ghost" icon="trash" disabled={remove.isPending} onClick={() => { remove.reset(); setToDelete(event) }}>Usuń</Button>
                    </>
                  )}
                >
                  <b><i className="event-swatch" style={{ background: `var(--ev-${event.color})` }} />{event.title}</b>
                  <small>{formatDate(event.starts_on)}{event.ends_on !== event.starts_on && ` – ${formatDate(event.ends_on)}`}</small>
                </ListRow>
              ))}
            </List>
          )}
        </div>
        <form
          className="panel panel-padded stack-sm"
          aria-label={editingId ? 'Edycja wydarzenia' : 'Nowe wydarzenie'}
          onSubmit={(event) => { event.preventDefault(); if (form.title.trim()) save.mutate() }}
        >
          <SectionHeading as="h3" title={editingId ? 'Edytuj wydarzenie' : 'Nowe wydarzenie'} />
          <Field label="Nazwa" id="event-title" required>
            {({ id }) => <Input id={id} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required />}
          </Field>
          <div className="frow">
            <DateField id="event-start" label="Od" value={form.starts_on} onChange={(starts_on) => setForm({ ...form, starts_on, ends_on: starts_on > form.ends_on ? starts_on : form.ends_on })} required />
            <DateField id="event-end" label="Do" value={form.ends_on} onChange={(ends_on) => setForm({ ...form, ends_on })} required minDate={form.starts_on} />
          </div>
          <Field label="Kolor" id="event-color">
            {({ id }) => (
              <div className="color-pick" role="radiogroup" aria-label="Kolor" id={id}>
                {EVENT_COLORS.map((color) => (
                  <button
                    type="button"
                    key={color.value}
                    role="radio"
                    aria-checked={form.color === color.value}
                    aria-label={color.label}
                    title={color.label}
                    className={cx(form.color === color.value && 'on')}
                    style={{ background: `var(--ev-${color.value})` }}
                    onClick={() => setForm({ ...form, color: color.value })}
                  />
                ))}
              </div>
            )}
          </Field>
          {error && <Box tone="bad" role="alert" title={error.message} />}
          <div className="row">
            <Button type="submit" variant="primary" disabled={!form.title.trim() || save.isPending} loading={save.isPending}>{editingId ? 'Zapisz' : 'Dodaj'}</Button>
            {editingId && <Button variant="ghost" onClick={reset}>Anuluj</Button>}
          </div>
        </form>
      </div>
      <ConfirmDialog
        open={Boolean(toDelete)}
        pending={remove.isPending}
        error={remove.error ? remove.error.message : null}
        onCancel={() => setToDelete(null)}
        onConfirm={() => toDelete && remove.mutate(toDelete.id)}
        title="Usunąć wydarzenie?"
        confirmLabel="Usuń"
        confirmColor="error"
        description={toDelete && <>{toDelete.title} ({formatDate(toDelete.starts_on)}{toDelete.ends_on !== toDelete.starts_on && ` – ${formatDate(toDelete.ends_on)}`}). Tej operacji nie da się cofnąć.</>}
      />
    </div>
  )
}
