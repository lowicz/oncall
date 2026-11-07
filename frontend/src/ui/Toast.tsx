import { ReactNode, useCallback, useMemo } from 'react'
import { Toast as BaseToast } from '@base-ui/react/toast'
import { cx } from './cx'
import { Icon } from './Icon'
import { useMessages } from '../i18n/messages'

type Tone = 'ok' | 'warn' | 'bad' | 'info'

interface ToastOptions {
  description?: ReactNode
  action?: { label: string; onClick: () => void }
  timeout?: number
  /** Epoch milliseconds at which the toast closes, even while hover or focus
   *  pauses its countdown. */
  until?: number
}

export type ToastApi = ReturnType<typeof useToast>

/**
 * Transient confirmations at the bottom right (top on a phone): "Zapisano",
 * "Wysłano do Marka". Errors of a form stay next to the form; a toast is only
 * for what happened in the background or was already done. Polite live
 * region so a screen reader reads it after the current utterance.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useMessages()
  return (
    <BaseToast.Provider timeout={6000} limit={3}>
      {children}
      <BaseToast.Portal>
        <BaseToast.Viewport className="toasts" aria-label={t.common.notifications}>
          <ToastList />
        </BaseToast.Viewport>
      </BaseToast.Portal>
    </BaseToast.Provider>
  )
}

function ToastList() {
  const t = useMessages()
  const { toasts } = BaseToast.useToastManager()
  return (
    <>
      {toasts.map((toast) => (
        <BaseToast.Root key={toast.id} toast={toast} className={cx('toast', `toast-${toast.type ?? 'info'}`)} swipeDirection={['right', 'down']}>
          <span className="toast-dot" aria-hidden="true" />
          <BaseToast.Content className="toast-content">
            <BaseToast.Title className="toast-title" />
            <BaseToast.Description className="toast-desc" />
          </BaseToast.Content>
          {toast.actionProps && <BaseToast.Action className="btn btn-ghost btn-sm" />}
          <BaseToast.Close className="ib ib-sm" aria-label={t.common.closeNotification}><Icon name="x" /></BaseToast.Close>
        </BaseToast.Root>
      ))}
    </>
  )
}

export function useToast() {
  const manager = BaseToast.useToastManager()
  const show = useCallback((tone: Tone, title: ReactNode, options?: ToastOptions) => {
    const id = manager.add({
      type: tone,
      title,
      description: options?.description,
      timeout: options?.until === undefined ? options?.timeout : 0,
      actionProps: options?.action ? { children: options.action.label, onClick: options.action.onClick } : undefined,
    })
    if (options?.until !== undefined) setTimeout(() => manager.close(id), options.until - Date.now())
    return id
  }, [manager])
  return useMemo(() => ({
    success: (title: ReactNode, options?: ToastOptions) => show('ok', title, options),
    warn: (title: ReactNode, options?: ToastOptions) => show('warn', title, options),
    error: (title: ReactNode, options?: ToastOptions) => show('bad', title, { timeout: 10000, ...options }),
    info: (title: ReactNode, options?: ToastOptions) => show('info', title, options),
    close: manager.close,
  }), [manager.close, show])
}
