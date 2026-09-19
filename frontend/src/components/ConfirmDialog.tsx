import { ReactNode, useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
} from '@mui/material'

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
  const blocked = pending || (needsReason && reason.trim().length < reasonMinLength)

  return (
    <Dialog open={open} onClose={() => !pending && onCancel()} fullWidth maxWidth="xs">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent className="confirm-content">
        {description && <DialogContentText component="div">{description}</DialogContentText>}
        {error && <Alert severity="error">{error}</Alert>}
        {reasonLabel && (
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={2}
            id="confirm-reason"
            name="reason"
            label={reasonLabel}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
            helperText={reason.trim().length > 0 && reason.trim().length < reasonMinLength
              ? `Wpisz co najmniej ${reasonMinLength} znaków`
              : undefined}
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={pending}>Anuluj</Button>
        <Button
          variant="contained"
          color={confirmColor}
          disabled={blocked}
          onClick={() => onConfirm(reason.trim())}
        >
          {pending ? 'Zapisuję…' : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
