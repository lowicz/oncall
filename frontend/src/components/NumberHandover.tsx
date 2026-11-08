import { FormEvent, useId, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CurrentDuty, api } from '../api'
import { FORWARDING_NOW_KEY, HeldNumber } from '../hooks/useForwardingNow'
import { usePublicConfig } from '../hooks/usePublicConfig'
import { useNarrow } from '../hooks/useMediaQuery'
import { messages, useMessages } from '../i18n'
import { formatClock } from '../lib/dates'
import { roleLabels } from '../lib/labels'
import { undoable } from '../lib/undo'
import { Box, Button, Field, Input, Popover, Segmented, Sheet, StatusPill, useToast } from '../ui'

/** Who looks at the day's pair: either side of it, a coordinator, or nobody who may act. */
export type HandoverViewer = 'primary' | 'secondary' | 'coordinator' | null

type Choice = '1h' | '2h' | 'end' | 'custom'

const PILL_STATES = { confirmed: 'ok', switching: 'pending', failed: 'failed' } as const

/** "numer on-call · przełączam · do 13:40": where it rings, then its state or end. */
function pillWords(now: HeldNumber, where: string) {
  const t = messages().duty.handover
  if (now.status === 'failed') return `${where} · ${t.failed}`
  const until = now.handover ? t.until(formatClock(now.handover.until)) : null
  return [where, now.status === 'switching' ? t.switching : null, until].filter(Boolean).join(' · ')
}

/**
 * The pill that says where the number rings, and opens who answers it, since
 * when and whether WCO confirmed it. `where` is the pill's first words: plain
 * beside the holder's name, "u Ciebie" or the holder's name elsewhere.
 */
export function NumberPill({ now, where }: Readonly<{ now: HeldNumber; where: string }>) {
  const t = useMessages().duty.handover.details
  const statusLine = {
    confirmed: now.confirmed_at ? t.confirmed(formatClock(now.confirmed_at)) : null,
    switching: t.switching,
    failed: t.failed,
  }[now.status]
  return (
    <Popover title={t.title} className="pop-handover" trigger={<StatusPill state={PILL_STATES[now.status]}>{pillWords(now, where)}</StatusPill>}>
      <p>{t.holder(now.holder_name, roleLabels()[now.holder_role])}</p>
      {now.handover && <p>{t.period(formatClock(now.handover.starts_at), formatClock(now.handover.until))}</p>}
      {statusLine && <p>{statusLine}</p>}
      {now.mode === 'dry_run' && <p>{t.dryRun}</p>}
    </Popover>
  )
}

/** The next "HH:MM" after `from`, today or tomorrow; null for a blank field. */
function nextAt(time: string, from: Date): Date | null {
  if (time === '') return null
  const [hours, minutes] = time.split(':').map(Number)
  const moment = new Date(from)
  moment.setHours(hours, minutes, 0, 0)
  if (moment <= from) moment.setDate(moment.getDate() + 1)
  return moment
}

/** "13:40" without "jutro", for the bounds of a time field. */
const hhmm = (moment: Date) => formatClock(moment, moment)

/**
 * One decision: until when the SECONDARY answers the number. Four segments
 * bounded by the end of the duty day (D3), the effect as a sentence, and one
 * button; the receiver without a phone number blocks it with the reason.
 */
function HandoverForm({ now, primary, secondary, viewer, onDone, onCancel, block }: Readonly<{
  now: HeldNumber
  primary: CurrentDuty
  secondary: CurrentDuty
  viewer: HandoverViewer
  onDone: () => void
  onCancel?: () => void
  block?: boolean
}>) {
  const t = useMessages().duty.handover
  const common = useMessages().common
  const toast = useToast()
  const queryClient = useQueryClient()
  const config = usePublicConfig()
  const id = useId()
  const latest = new Date(now.day_ends_at!)
  const clockNow = new Date()
  const inHours = (hours: number) => new Date(clockNow.getTime() + hours * 3_600_000)
  const [choice, setChoice] = useState<Choice>(inHours(2) <= latest ? '2h' : 'end')
  const [time, setTime] = useState('')
  const untils: Record<Choice, Date | null> = { '1h': inHours(1), '2h': inHours(2), end: latest, custom: nextAt(time, clockNow) }
  const until = untils[choice]
  const fits = until !== null && until <= latest
  const latestClock = formatClock(latest)
  const taking = viewer === 'secondary'
  const refresh = () => queryClient.invalidateQueries({ queryKey: FORWARDING_NOW_KEY })
  const start = useMutation({
    mutationFn: (moment: Date) => undoable({
      execute: () => api.startHandover(moment.toISOString()),
      undo: async (handover) => {
        await api.endHandover(handover.id)
        await refresh()
      },
      toast: { success: toast.info, close: toast.close },
      message: (handover) => ({ title: t.switchingToast(handover.to_name, formatClock(handover.until)) }),
      undoLabel: common.undo,
      onUndoError: () => toast.error(t.undoFailed),
      windowSeconds: config.data?.undo_window_seconds ?? 10,
    }),
    onSuccess: () => {
      refresh()
      onDone()
    },
  })
  const phone = secondary.contact_phone
  const blocked = !phone || !fits
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!blocked) start.mutate(until)
  }

  return (
    <form className="stack-sm handover-form" onSubmit={submit}>
      <p>
        {t.receiver} <b>{secondary.assignee_name}</b> · {roleLabels().secondary}
        {phone && <> · <a className="mono handover-tel" href={`tel:${phone.replace(/\s+/g, '')}`}>{phone.replace(/ /g, ' ')}</a></>}
      </p>
      <Field label={t.duration} hint={t.latestHint(latestClock)}>
        {({ labelId, describedBy }) => (
          <Segmented<Choice>
            label={t.duration}
            labelId={labelId}
            describedBy={describedBy}
            value={choice}
            onChange={setChoice}
            wrap
            options={[
              { value: '1h', label: t.durations.hour, disabled: inHours(1) > latest },
              { value: '2h', label: t.durations.twoHours, disabled: inHours(2) > latest },
              { value: 'end', label: t.durations.end(latestClock) },
              { value: 'custom', label: t.durations.custom },
            ]}
          />
        )}
      </Field>
      {choice === 'custom' && (
        <Field label={t.customTime} error={time !== '' && !fits ? t.customInvalid(latestClock) : undefined}>
          {({ id: inputId, describedBy, invalid }) => (
            <Input
              id={inputId}
              type="time"
              min={hhmm(clockNow)}
              max={hhmm(latest)}
              value={time}
              required
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              onChange={(event) => setTime(event.target.value)}
            />
          )}
        </Field>
      )}
      {fits && (
        <p className="handover-result">
          {viewer === 'primary' ? t.returnsToYou(formatClock(until)) : t.returnsTo(primary.assignee_name, formatClock(until))}
        </p>
      )}
      {now.mode === 'dry_run' && <p className="muted small">{t.dryRun}</p>}
      {!phone && <div id={`${id}-reason`}><Box tone="warn" title={taking ? t.noPhoneYou : t.noPhone(secondary.assignee_name)} /></div>}
      {start.error && <Box tone="bad" role="alert" title={start.error.message} />}
      <div className="row handover-actions">
        {onCancel && <Button variant="ghost" onClick={onCancel}>{common.cancel}</Button>}
        {/* Focusable while blocked, so the frame above says why. */}
        <Button
          type="submit"
          variant="primary"
          block={block}
          loading={start.isPending}
          aria-disabled={blocked || undefined}
          aria-describedby={phone ? undefined : `${id}-reason`}
        >
          {taking ? t.takeSubmit : t.handSubmit}
        </Button>
      </div>
    </form>
  )
}

/**
 * What the day's pair and a coordinator may do with the number (D1): hand it
 * over in a popover (a sheet on a phone), or end the handover early with an
 * informing toast and no Undo, since starting again is one click (PT-25).
 * While the switch failed they may also try again or end the handover.
 */
export function HandoverActions({ now, primary, secondary, viewer }: Readonly<{
  now: HeldNumber
  primary: CurrentDuty
  secondary: CurrentDuty
  viewer: Exclude<HandoverViewer, null>
}>) {
  const t = useMessages().duty.handover
  const narrow = useNarrow()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  // Small on a phone's duty card, as large as the other header actions on a desktop.
  const size = narrow ? 'sm' : undefined
  const refresh = () => queryClient.invalidateQueries({ queryKey: FORWARDING_NOW_KEY })
  const end = useMutation({
    mutationFn: (id: string) => api.endHandover(id),
    onSuccess: () => {
      toast.info(viewer === 'primary' ? t.endedYou : t.ended(primary.assignee_name))
      refresh()
    },
    onError: (error) => toast.error(error.message),
  })

  const { handover } = now
  if (handover) {
    const endLabel = { primary: t.takeBack, secondary: t.giveBack, coordinator: t.end }[viewer]
    return (
      <>
        {now.status === 'failed' && <Button size={size} icon="refresh" onClick={refresh}>{t.checkAgain}</Button>}
        <Button size={size} loading={end.isPending} onClick={() => end.mutate(handover.id)}>
          {now.status === 'failed' ? t.end : endLabel}
        </Button>
      </>
    )
  }

  const taking = viewer === 'secondary'
  const title = taking ? t.takeTitle : t.handTitle
  const label = taking ? t.take : t.hand
  const form = (props: { onCancel?: () => void; block?: boolean }) => (
    <HandoverForm now={now} primary={primary} secondary={secondary} viewer={viewer} onDone={() => setOpen(false)} {...props} />
  )
  if (narrow) {
    return (
      <>
        <Button size={size} onClick={() => setOpen(true)}>{label}</Button>
        <Sheet open={open} onClose={() => setOpen(false)} title={title}>
          {form({ block: true })}
        </Sheet>
      </>
    )
  }
  return (
    <Popover trigger={<Button>{label}</Button>} title={title} className="pop-handover" open={open} onOpenChange={setOpen}>
      {form({ onCancel: () => setOpen(false) })}
    </Popover>
  )
}
