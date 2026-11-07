import type { ReactNode } from 'react'
import { messages } from '../i18n'
import type { ToastApi } from '../ui/Toast'

export interface UndoMessage {
  title: ReactNode
  description?: ReactNode
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
}

/**
 * Executes a reversible mutation and offers its inverse in a toast until the
 * server's Undo window closes. The window is counted from before the request,
 * so it never outlasts the server's; when it closes the toast drops "Cofnij"
 * and says the e-mails have gone out, even if hover or focus keeps it open.
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
    if (undoing) return
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
    until: { at: until, expired: messages().common.undoClosed },
  })
  return result
}
