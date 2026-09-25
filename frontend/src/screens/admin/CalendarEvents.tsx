import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarEvent, CalendarEventInput, api } from '../../api'
import { useMessages } from '../../i18n'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { DateField } from '../../components/DateField'
import { eventColors } from '../../components/CalendarMatrix'
import { addDays, formatDate, warsawDate } from '../../lib/dates'
import { Box, Button, EmptyState, ErrorState, Field, Input, List, ListRow, LoadingBlock, PageHeader, SectionHeading, cx } from '../../ui'

const emptyInput = (): CalendarEventInput => ({ starts_on: warsawDate(), ends_on: warsawDate(), title: '', color: 'blue' })

/** "24-09-2026", or "24-09-2026 – 26-09-2026" when the event spans several days. */
const eventDates = (event: { starts_on: string; ends_on: string }) =>
  event.ends_on === event.starts_on ? formatDate(event.starts_on) : `${formatDate(event.starts_on)} – ${formatDate(event.ends_on)}`

export function CalendarEventsPanel() {
  const t = useMessages()
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
        title={t.calendarEvents.title}
        sub={t.calendarEvents.subtitle}
      />
      <div className="split">
        <div className="stack-sm">
          <SectionHeading title={t.calendarEvents.list.title} meta={`${formatDate(range.starts_on)} – ${formatDate(range.ends_on)}`} />
          <form className="toolbar panel" onSubmit={(event) => event.preventDefault()} aria-label={t.calendarEvents.list.range}>
            <DateField id="events-from" label={t.calendarEvents.list.showFrom} value={range.starts_on} onChange={(starts_on) => starts_on && setRange({ ...range, starts_on })} />
            <DateField id="events-to" label={t.calendarEvents.list.showTo} value={range.ends_on} onChange={(ends_on) => ends_on && setRange({ ...range, ends_on })} />
          </form>
          {events.isLoading && <LoadingBlock label={t.calendarEvents.list.loading} rows={3} />}
          {events.error && <ErrorState error={events.error} onRetry={() => events.refetch()} />}
          {events.data?.length === 0 && <EmptyState compact icon="event" title={t.calendarEvents.list.empty} />}
          {events.data && events.data.length > 0 && (
            <List className="panel">
              {events.data.map((event) => (
                <ListRow
                  key={event.id}
                  highlight={editingId === event.id}
                  aside={(
                    <>
                      <Button size="sm" onClick={() => edit(event)}>{t.calendarEvents.list.edit}</Button>
                      <Button size="sm" variant="ghost" icon="trash" disabled={remove.isPending} onClick={() => { remove.reset(); setToDelete(event) }}>{t.calendarEvents.list.delete}</Button>
                    </>
                  )}
                >
                  <b><i className="event-swatch" style={{ background: `var(--ev-${event.color})` }} />{event.title}</b>
                  <small>{eventDates(event)}</small>
                </ListRow>
              ))}
            </List>
          )}
        </div>
        <form
          className="panel panel-padded stack-sm"
          aria-label={editingId ? t.calendarEvents.form.editing : t.calendarEvents.form.newEvent}
          onSubmit={(event) => { event.preventDefault(); if (form.title.trim()) save.mutate() }}
        >
          <SectionHeading as="h3" title={editingId ? t.calendarEvents.form.editEvent : t.calendarEvents.form.newEvent} />
          <Field label={t.calendarEvents.form.name} id="event-title" required>
            {({ id }) => <Input id={id} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required />}
          </Field>
          <div className="frow">
            <DateField id="event-start" label={t.calendarEvents.form.from} value={form.starts_on} onChange={(starts_on) => setForm({ ...form, starts_on, ends_on: starts_on > form.ends_on ? starts_on : form.ends_on })} required />
            <DateField id="event-end" label={t.calendarEvents.form.to} value={form.ends_on} onChange={(ends_on) => setForm({ ...form, ends_on })} required minDate={form.starts_on} />
          </div>
          <Field label={t.calendarEvents.form.color} id="event-color">
            {({ id }) => (
              <div className="color-pick" role="radiogroup" aria-label={t.calendarEvents.form.color} id={id}>
                {eventColors().map((color) => (
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
            <Button type="submit" variant="primary" disabled={!form.title.trim() || save.isPending} loading={save.isPending}>{editingId ? t.calendarEvents.form.save : t.calendarEvents.form.add}</Button>
            {editingId && <Button variant="ghost" onClick={reset}>{t.common.cancel}</Button>}
          </div>
        </form>
      </div>
      <ConfirmDialog
        open={Boolean(toDelete)}
        pending={remove.isPending}
        error={remove.error ? remove.error.message : null}
        onCancel={() => setToDelete(null)}
        onConfirm={() => toDelete && remove.mutate(toDelete.id)}
        title={t.calendarEvents.deleteDialog.title}
        confirmLabel={t.calendarEvents.deleteDialog.confirm}
        confirmColor="error"
        description={toDelete && t.calendarEvents.deleteDialog.description(toDelete.title, eventDates(toDelete))}
      />
    </div>
  )
}
