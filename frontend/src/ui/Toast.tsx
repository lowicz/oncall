import { ReactNode } from 'react'
import { Toast as BaseToast } from '@base-ui/react/toast'
import { cx } from './cx'
import { Icon } from './Icon'
import { useMessages } from '../i18n/messages'

/**
 * Transient confirmations at the bottom right (above the tabs on a phone): "Zapisano",
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
          {/* How long the action lasts, for the eye only: a screen reader is
              not interrupted every second, and the action says when it is gone. */}
          {toast.data?.countdownMs && (
            <span className="toast-countdown" aria-hidden="true" style={{ animationDuration: `${toast.data.countdownMs}ms` }} />
          )}
          {/* Base UI hides the button from assistive technology while the stack
              is collapsed, yet leaves it in the tab order: a focusable element
              no screen reader can name. It stays exposed instead. */}
          <BaseToast.Close className="ib ib-sm" aria-label={t.common.closeNotification} aria-hidden={false}><Icon name="x" /></BaseToast.Close>
        </BaseToast.Root>
      ))}
    </>
  )
}
