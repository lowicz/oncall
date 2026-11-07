import { describe, expect, it, vi } from 'vitest'
import type { ToastApi } from '../ui/Toast'
import { undoable } from './undo'

function toastDouble() {
  return {
    success: vi.fn<ToastApi['success']>().mockReturnValue('toast-1'),
    close: vi.fn(),
  }
}

function actionFrom(toast: ReturnType<typeof toastDouble>) {
  const options = toast.success.mock.calls[0]?.[1]
  if (!options?.action) throw new Error('Undo action was not shown')
  return options.action.onClick
}

describe('undoable', () => {
  it('executes a mutation and offers its inverse', async () => {
    const toast = toastDouble()
    const execute = vi.fn(async () => ({ id: 7 }))
    const undo = vi.fn(async () => {})

    const result = await undoable({
      execute,
      undo,
      toast,
      message: ({ id }) => ({ title: `Saved ${id}`, description: 'E-mails are waiting' }),
      undoLabel: 'Undo',
      onUndoError: vi.fn(),
    })

    expect(result).toEqual({ id: 7 })
    expect(execute).toHaveBeenCalledOnce()
    expect(toast.success).toHaveBeenCalledWith('Saved 7', {
      description: 'E-mails are waiting',
      action: { label: 'Undo', onClick: expect.any(Function) },
    })

    actionFrom(toast)()
    actionFrom(toast)()
    await vi.waitFor(() => expect(undo).toHaveBeenCalledOnce())
    expect(undo).toHaveBeenCalledWith({ id: 7 })
    await vi.waitFor(() => expect(toast.close).toHaveBeenCalledWith('toast-1'))
  })

  it('leaves a failed inverse available for a retry', async () => {
    const toast = toastDouble()
    const failure = new Error('network')
    const undo = vi.fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(undefined)
    const onUndoError = vi.fn()

    await undoable({
      execute: async () => 'saved',
      undo,
      toast,
      message: () => ({ title: 'Saved' }),
      undoLabel: 'Undo',
      onUndoError,
    })

    const action = actionFrom(toast)
    action()
    await vi.waitFor(() => expect(onUndoError).toHaveBeenCalledWith(failure))
    expect(toast.close).not.toHaveBeenCalled()

    action()
    await vi.waitFor(() => expect(undo).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(toast.close).toHaveBeenCalledWith('toast-1'))
  })

  it('does not show a toast when the mutation fails', async () => {
    const toast = toastDouble()
    const failure = new Error('not saved')

    await expect(undoable({
      execute: async () => { throw failure },
      undo: async () => {},
      toast,
      message: () => ({ title: 'Saved' }),
      undoLabel: 'Undo',
      onUndoError: vi.fn(),
    })).rejects.toBe(failure)

    expect(toast.success).not.toHaveBeenCalled()
  })
})
