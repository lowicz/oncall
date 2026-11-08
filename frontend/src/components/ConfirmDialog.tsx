import { ReactNode, useEffect, useRef, useState } from 'react'
import { Box, Button, Dialog, Field, Textarea } from '../ui'
import { useMessages } from '../i18n'

/**
 * Confirmation for actions that are hard to undo.
 *
 * When `reasonLabel` is set the dialog also collects a mandatory reason, which
 * keeps rejection and withdrawal reasons out of the list rows: they used to sit
 * permanently in every actionable row, even when the intent was to approve.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  confirmColor = 'primary',
  reasonLabel,
  reasonMinLength = 1,
  initialReason = '',
  confirmDisabled = false,
  pending = false,
  error,
  onCancel,
  onConfirm,
}: {
  open: boolean
  title: string
  description?: ReactNode
  confirmLabel: string
  confirmColor?: 'primary' | 'error' | 'warning'
  reasonLabel?: string
  reasonMinLength?: number
  /** The reason the dialog opens with, e.g. one typed before a refusal. */
  initialReason?: string
  /** Something in `description` still needs the user's input, e.g. an
   *  acknowledgement checkbox. */
  confirmDisabled?: boolean
  pending?: boolean
  /** Mutation failure, rendered here so it is visible while this dialog covers
   *  whatever surface launched the action. */
  error?: string | null
  onCancel: () => void
  onConfirm: (reason: string) => void
}) {
  const t = useMessages()
  const [reason, setReason] = useState('')
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (open) setReason(initialReason)
  }, [open, initialReason])
  const needsReason = Boolean(reasonLabel)
  const tooShort = reason.trim().length > 0 && reason.trim().length < reasonMinLength
  const blocked = pending || confirmDisabled || (needsReason && reason.trim().length < reasonMinLength)

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      tone={confirmColor === 'error' ? 'danger' : 'default'}
      dismissible={!pending}
      initialFocus={reasonRef}
      actions={(
        <>
          <Button onClick={onCancel} disabled={pending}>{t.common.cancel}</Button>
          <Button
            variant={confirmColor === 'error' ? 'danger' : 'primary'}
            disabled={blocked}
            loading={pending}
            onClick={() => onConfirm(reason.trim())}
          >
            {pending ? t.common.saving : confirmLabel}
          </Button>
        </>
      )}
    >
      {description && <div className="stack-sm">{description}</div>}
      {error && <Box tone="bad" role="alert" title={error} focus />}
      {reasonLabel && (
        <Field label={reasonLabel} required error={tooShort ? t.common.reasonTooShort(reasonMinLength) : undefined}>
          {({ id, describedBy, invalid }) => (
            <Textarea
              ref={reasonRef}
              id={id}
              name="reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              required
              invalid={invalid}
              aria-describedby={describedBy}
            />
          )}
        </Field>
      )}
    </Dialog>
  )
}
