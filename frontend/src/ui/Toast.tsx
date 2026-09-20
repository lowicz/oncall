import { ReactNode, useCallback, useMemo } from 'react'
import { Toast as BaseToast } from '@base-ui/react/toast'
import { cx } from './cx'
import { Icon } from './Icon'

type Tone = 'ok' | 'warn' | 'bad' | 'info'

/**
 * Transient confirmations at the bottom right (top on a phone): "Zapisano",
 * "Wysłano do Marka". Errors of a form stay next to the form; a toast is only
 * for what happened in the background or was already done. Polite live
 * region so a screen reader reads it after the current utterance.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <BaseToast.Provider timeout={6000} limit={3}>
      {children}
      <BaseToast.Portal>
        <BaseToast.Viewport className="toasts" aria-label="Powiadomienia">
          <ToastList />
        </BaseToast.Viewport>
      </BaseToast.Portal>
    </BaseToast.Provider>
  )
}

function ToastList() {
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
          <BaseToast.Close className="ib ib-sm" aria-label="Zamknij powiadomienie"><Icon name="x" /></BaseToast.Close>
        </BaseToast.Root>
      ))}
    </>
  )
}

export function useToast() {
  const manager = BaseToast.useToastManager()
  const show = useCallback((tone: Tone, title: ReactNode, options?: { description?: ReactNode; action?: { label: string; onClick: () => void }; timeout?: number }) => {
    manager.add({
      type: tone,
      title,
      description: options?.description,
      timeout: options?.timeout,
      actionProps: options?.action ? { children: options.action.label, onClick: options.action.onClick } : undefined,
    })
  }, [manager])
  return useMemo(() => ({
    success: (title: ReactNode, options?: Parameters<typeof show>[2]) => show('ok', title, options),
    warn: (title: ReactNode, options?: Parameters<typeof show>[2]) => show('warn', title, options),
    error: (title: ReactNode, options?: Parameters<typeof show>[2]) => show('bad', title, { timeout: 10000, ...options }),
    info: (title: ReactNode, options?: Parameters<typeof show>[2]) => show('info', title, options),
  }), [show])
}
