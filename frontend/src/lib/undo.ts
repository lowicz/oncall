import type { ReactNode } from 'react'
import { messages } from '../i18n'
import type { ToastApi } from '../ui/useToast'

/** The server's Undo window for the moment before `/api/v1/config` has arrived. */
export const DEFAULT_UNDO_WINDOW_SECONDS = 10

export interface UndoMessage {
  title: ReactNode
  description?: ReactNode
  /** Replaces the description once Undo has expired; an action that sends
   *  e-mails passes `common.undoEmailsSent`. */
  expired?: ReactNode
}

export interface UndoableOptions<Result> {
  execute: () => Promise<Result>
  undo: (result: Result) => Promise<void>
  toast: Pick<ToastApi, 'success' | 'close'>
  message: (result: Result) => UndoMessage
  undoLabel: string
  onUndoError: (error: unknown) => void
  /** `undo_window_seconds` from `/api/v1/config`: how long the server holds
   *  the change's e-mails. */
  windowSeconds: number
  /** Receives the same Undo the toast offers and the instant it expires, for
   *  a second way to it beside the change itself. */
  onOffer?: (undo: () => void, until: number) => void
}

/** A random UUID naming one change for its Undo. `crypto.randomUUID` exists
 *  only on HTTPS, and the application may be served over plain HTTP. */
export function newUndoId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Executes a reversible mutation and offers its inverse in a toast until the
 * server's Undo window closes. The window is counted from before the request,
 * so it never outlasts the server's; when it closes the toast drops "Cofnij"
 * and shows the message's `expired` text, even if hover or focus keeps it
 * open, and the inverse is no longer run.
 * A failed inverse remains available for another attempt and is reported by
 * the caller, which owns the operation-specific error copy.
 */
export async function undoable<Result>(options: UndoableOptions<Result>): Promise<Result> {
  const until = Date.now() + options.windowSeconds * 1000
  const result = await options.execute()
  const message = options.message(result)
  let undoing = false
  let toastId = ''

  const undo = () => {
    if (undoing || Date.now() >= until) return
    undoing = true
    options.undo(result).then(
      () => options.toast.close(toastId),
      (error: unknown) => {
        undoing = false
        options.onUndoError(error)
      },
    )
  }

  toastId = options.toast.success(message.title, {
    description: message.description,
    action: { label: options.undoLabel, onClick: undo },
    until: { at: until, expired: message.expired ?? messages().common.undoClosed },
  })
  options.onOffer?.(undo, until)
  return result
}
