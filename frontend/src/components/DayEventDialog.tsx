import { useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { CalendarEventColor, CalendarEventRef, api } from '../api'
import { formatDay } from '../lib/dates'
import { useMessages } from '../i18n'
import { eventColors } from '../lib/labels'
import { Box, Button, Dialog, Field, Input, cx } from '../ui'

/**
 * Adding an event to one day, in its own window: the day inspector stays
 * about the staffing. The caller renders it beside its panel, not inside.
 */
export function DayEventDialog({ serviceDate, onClose, onCreated }: Readonly<{
  /** The day the event goes on; null keeps the dialog closed. */
  serviceDate: string | null
  onClose: () => void
  onCreated: (event: CalendarEventRef) => void
}>) {
  const { schedule: t, common } = useMessages()
  const [title, setTitle] = useState('')
  const titleField = useRef<HTMLInputElement>(null)
  const [color, setColor] = useState<CalendarEventColor>('blue')
  const create = useMutation({
    mutationFn: api.createCalendarEvent,
    onSuccess: (event) => {
      setTitle('')
      onCreated(event)
    },
  })
  const close = () => {
    create.reset()
    onClose()
  }
  return (
    <Dialog
      open={Boolean(serviceDate)}
      onClose={close}
      dismissible={!create.isPending}
      size="sm"
      title={t.inspector.addEventTitle}
      initialFocus={titleField}
      description={serviceDate && formatDay(serviceDate)}
    >
      <form
        className="stack-sm"
        onSubmit={(event) => {
          event.preventDefault()
          if (!title.trim()) return
          create.mutate({ starts_on: serviceDate!, ends_on: serviceDate!, title: title.trim(), color })
        }}
      >
        <Field label={t.inspector.name} id="calendar-event-title">
          {({ id }) => <Input ref={titleField} id={id} name={id} value={title} onChange={(event) => setTitle(event.target.value)} required />}
        </Field>
        <Field label={t.inspector.color} id="calendar-event-color">
          {({ id, labelId }) => (
            <div className="color-pick" role="radiogroup" aria-labelledby={labelId} id={id}>
              {eventColors().map((item) => (
                <button
                  type="button"
                  key={item.value}
                  role="radio"
                  aria-checked={color === item.value}
                  aria-label={item.label}
                  title={item.label}
                  className={cx(color === item.value && 'on')}
                  style={{ background: `var(--ev-${item.value})` }}
                  onClick={() => setColor(item.value)}
                />
              ))}
            </div>
          )}
        </Field>
        {create.error && <Box tone="bad" role="alert" focus title={create.error.message} />}
        <div className="dialog-actions">
          <Button disabled={create.isPending} onClick={close}>{common.cancel}</Button>
          <Button type="submit" variant="primary" disabled={!title.trim()} loading={create.isPending}>{t.inspector.addEvent}</Button>
        </div>
      </form>
    </Dialog>
  )
}
