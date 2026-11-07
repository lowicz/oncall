import type { ReactNode } from 'react'
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
}

/**
 * Executes a reversible mutation and offers its inverse in a ten-second toast.
 * A failed inverse remains available for another attempt and is reported by
 * the caller, which owns the operation-specific error copy.
 */
export async function undoable<Result>(options: UndoableOptions<Result>): Promise<Result> {
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
  })
  return result
}
