import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Box, Button, Chip, MenuItem, Paper, TextField, Typography } from '@mui/material'
import { CalendarEvent, CalendarEventColor, CalendarEventInput, api } from '../../api'
import { DateField } from '../../components/DateField'
import { addDays, formatDate, warsawDate } from '../../lib/dates'

const COLORS: Array<{ value: CalendarEventColor; label: string }> = [
  { value: 'blue', label: 'Niebieski' }, { value: 'green', label: 'Zielony' },
  { value: 'amber', label: 'Bursztynowy' }, { value: 'red', label: 'Czerwony' },
  { value: 'violet', label: 'Fioletowy' }, { value: 'teal', label: 'Turkusowy' },
]

const emptyInput = (): CalendarEventInput => ({
  starts_on: warsawDate(), ends_on: warsawDate(), title: '', color: 'blue',
})

export function CalendarEventsPanel() {
  const today = warsawDate()
  const [range, setRange] = useState({ starts_on: today, ends_on: addDays(today, 89) })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<CalendarEventInput>(emptyInput)
  const queryClient = useQueryClient()
  const queryKey = ['calendar-events', range.starts_on, range.ends_on]
  const events = useQuery({ queryKey, queryFn: () => api.calendarEvents(range.starts_on, range.ends_on) })
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['calendar-events'] })
    queryClient.invalidateQueries({ queryKey: ['calendar'] })
  }
  const reset = () => { setEditingId(null); setForm(emptyInput()) }
  const save = useMutation({
    mutationFn: () => editingId
      ? api.updateCalendarEvent({ id: editingId, ...form })
      : api.createCalendarEvent(form),
    onSuccess: () => { reset(); refresh() },
  })
  const remove = useMutation({ mutationFn: api.deleteCalendarEvent, onSuccess: refresh })
  const edit = (event: CalendarEvent) => {
    setEditingId(event.id)
    setForm({ starts_on: event.starts_on, ends_on: event.ends_on, title: event.title, color: event.color })
  }

  return (
    <Box className="reports-section" id="wydarzenia">
      <Box>
        <Typography className="eyebrow">[WARSTWA INFORMACYJNA]</Typography>
        <Typography variant="h1">Wydarzenia kalendarza</Typography>
        <Typography color="text.secondary">
          Wydarzenia są tylko oznaczeniem wizualnym - nie zmieniają grafiku, stawek ani raportów.
        </Typography>
      </Box>
      <Paper variant="outlined" className="calendar-controls">
        <DateField id="events-from" label="Pokaż od" value={range.starts_on}
          onChange={(starts_on) => setRange({ ...range, starts_on })} />
        <DateField id="events-to" label="Pokaż do" value={range.ends_on}
          onChange={(ends_on) => setRange({ ...range, ends_on })} />
      </Paper>
      <Paper variant="outlined" className="calendar-event-admin-form">
        <Typography variant="h2">{editingId ? 'Edytuj wydarzenie' : 'Nowe wydarzenie'}</Typography>
        <TextField label="Nazwa" value={form.title}
          onChange={(event) => setForm({ ...form, title: event.target.value })} />
        <DateField id="event-start" label="Od" value={form.starts_on}
          onChange={(starts_on) => setForm({ ...form, starts_on })} />
        <DateField id="event-end" label="Do" value={form.ends_on}
          onChange={(ends_on) => setForm({ ...form, ends_on })} />
        {/* "Kolor" and the submit action share this grid cell so the button
            lands in the same row as the fields, not on a row of its own
            underneath them (QA7-L16). */}
        <Box className="inline-actions" sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'flex-end' }}>
          <TextField select label="Kolor" value={form.color} sx={{ flexGrow: 1, minWidth: 140 }}
            onChange={(event) => setForm({ ...form, color: event.target.value as CalendarEventColor })}>
            {COLORS.map((color) => <MenuItem key={color.value} value={color.value}>{color.label}</MenuItem>)}
          </TextField>
          <Button variant="contained" disabled={!form.title.trim() || save.isPending}
            onClick={() => save.mutate()}>{editingId ? 'Zapisz' : 'Dodaj'}</Button>
          {editingId && <Button onClick={reset}>Anuluj</Button>}
        </Box>
      </Paper>
      {(events.error || save.error || remove.error) && (
        <Alert severity="error">{events.error?.message ?? save.error?.message ?? remove.error?.message}</Alert>
      )}
      {events.data?.map((event) => (
        <Paper key={event.id} variant="outlined" className="calendar-event-admin-row">
          <Chip label={event.title} className={`calendar-event-chip event-${event.color}`} />
          <Typography>{formatDate(event.starts_on)}{event.ends_on !== event.starts_on && ` – ${formatDate(event.ends_on)}`}</Typography>
          <Box className="inline-actions">
            <Button size="small" onClick={() => edit(event)}>Edytuj</Button>
            <Button size="small" color="error" disabled={remove.isPending}
              onClick={() => remove.mutate(event.id)}>Usuń</Button>
          </Box>
        </Paper>
      ))}
      {events.data?.length === 0 && <Alert severity="info">Brak wydarzeń w wybranym zakresie.</Alert>}
    </Box>
  )
}
