import { ReactNode, useEffect, useState } from 'react'
import { Box, Button, Dialog, Field, Textarea } from '../ui'

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
  pending?: boolean
  /** Mutation failure, rendered here so it is visible while this dialog covers
   *  whatever surface launched the action. */
  error?: string | null
  onCancel: () => void
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  useEffect(() => {
    if (open) setReason('')
  }, [open])
  const needsReason = Boolean(reasonLabel)
  const tooShort = reason.trim().length > 0 && reason.trim().length < reasonMinLength
  const blocked = pending || (needsReason && reason.trim().length < reasonMinLength)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => { if (!next) onCancel() }}
      title={title}
      size="sm"
      tone={confirmColor === 'error' ? 'danger' : 'default'}
      dismissible={!pending}
      actions={(
        <>
          <Button onClick={onCancel} disabled={pending}>Anuluj</Button>
          <Button
            variant={confirmColor === 'error' ? 'danger' : 'primary'}
            disabled={blocked}
            loading={pending}
            onClick={() => onConfirm(reason.trim())}
          >
            {pending ? 'Zapisuję…' : confirmLabel}
          </Button>
        </>
      )}
    >
      {description && <div className="stack-sm">{description}</div>}
      {error && <Box tone="bad" role="alert" title={error} />}
      {reasonLabel && (
        <Field label={reasonLabel} required error={tooShort ? `Wpisz co najmniej ${reasonMinLength} znaków` : undefined}>
          {({ id, describedBy, invalid }) => (
            <Textarea
              id={id}
              name="reason"
              autoFocus
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
