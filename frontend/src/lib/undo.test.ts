import { describe, expect, it, vi } from 'vitest'
import { messages } from '../i18n'
import type { ToastApi } from '../ui/useToast'
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
    const started = Date.now()

    const result = await undoable({
      execute,
      undo,
      toast,
      message: ({ id }) => ({ title: `Saved ${id}`, description: 'E-mails are waiting' }),
      undoLabel: 'Undo',
      onUndoError: vi.fn(),
      windowSeconds: 10,
    })

    expect(result).toEqual({ id: 7 })
    expect(execute).toHaveBeenCalledOnce()
    expect(toast.success).toHaveBeenCalledWith('Saved 7', {
      description: 'E-mails are waiting',
      action: { label: 'Undo', onClick: expect.any(Function) },
      until: { at: started + 10_000, expired: messages().common.undoClosed },
    })

    actionFrom(toast)()
    actionFrom(toast)()
    await vi.waitFor(() => expect(undo).toHaveBeenCalledOnce())
    expect(undo).toHaveBeenCalledWith({ id: 7 })
    await vi.waitFor(() => expect(toast.close).toHaveBeenCalledWith('toast-1'))
  })

  it('hands the same Undo to a second control', async () => {
    const toast = toastDouble()
    const undo = vi.fn(async () => {})
    const onOffer = vi.fn()
    const started = Date.now()

    await undoable({
      execute: async () => 'saved',
      undo,
      toast,
      message: () => ({ title: 'Saved' }),
      undoLabel: 'Undo',
      onUndoError: vi.fn(),
      windowSeconds: 10,
      onOffer,
    })

    const [offered, until] = onOffer.mock.calls[0]
    expect(until).toBe(started + 10_000)
    offered()
    actionFrom(toast)()
    await vi.waitFor(() => expect(toast.close).toHaveBeenCalledWith('toast-1'))
    expect(undo).toHaveBeenCalledOnce()
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
      windowSeconds: 10,
    })

    const action = actionFrom(toast)
    action()
    await vi.waitFor(() => expect(onUndoError).toHaveBeenCalledWith(failure))
    expect(toast.close).not.toHaveBeenCalled()

    action()
    await vi.waitFor(() => expect(undo).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(toast.close).toHaveBeenCalledWith('toast-1'))
  })

  it('counts the window from before the request, not from the toast', async () => {
    const toast = toastDouble()
    const started = Date.now()

    const pending = undoable({
      execute: () => new Promise((resolve) => setTimeout(() => resolve('saved'), 3000)),
      undo: async () => {},
      toast,
      message: () => ({ title: 'Saved' }),
      undoLabel: 'Undo',
      onUndoError: vi.fn(),
      windowSeconds: 10,
    })
    await vi.advanceTimersByTimeAsync(3000)
    await pending

    expect(toast.success.mock.calls[0]?.[1]?.until?.at).toBe(started + 10_000)
  })

  it('lets an action that sends e-mails say so once Undo expires', async () => {
    const toast = toastDouble()

    await undoable({
      execute: async () => 'saved',
      undo: async () => {},
      toast,
      message: () => ({ title: 'Saved', expired: messages().common.undoEmailsSent }),
      undoLabel: 'Undo',
      onUndoError: vi.fn(),
      windowSeconds: 10,
    })

    expect(toast.success.mock.calls[0]?.[1]?.until?.expired).toBe(messages().common.undoEmailsSent)
  })

  it('runs no inverse once the deadline has passed, even if the action is still shown', async () => {
    const toast = toastDouble()
    const undo = vi.fn(async () => {})
    const started = Date.now()

    await undoable({
      execute: async () => 'saved',
      undo,
      toast,
      message: () => ({ title: 'Saved' }),
      undoLabel: 'Undo',
      onUndoError: vi.fn(),
      windowSeconds: 10,
    })
    vi.setSystemTime(started + 10_000)
    actionFrom(toast)()

    expect(undo).not.toHaveBeenCalled()
    expect(toast.close).not.toHaveBeenCalled()
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
      windowSeconds: 10,
    })).rejects.toBe(failure)

    expect(toast.success).not.toHaveBeenCalled()
  })
})
