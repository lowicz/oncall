import { ReactNode } from 'react'
import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import { cx } from './cx'
import { IconButton } from './Button'
import { useMessages } from '../i18n/messages'

/**
 * A modal sheet: confirmation of a publication, an offboarding, a rejection
 * reason. Centred on a desktop, a bottom sheet on a phone (styles.css). The
 * title is the dialog's accessible name; `tone="danger"` paints it red for
 * destructive confirmations.
 */
export function Dialog({ open, onClose, title, description, children, actions, size = 'md', tone = 'default', dismissible = true, className }: {
  open: boolean
  /** The dialog has no trigger: the page opens it through `open`, so the only
   *  change it ever asks for is to close (Escape, the close button, the
   *  backdrop). */
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  actions?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  tone?: 'default' | 'danger'
  /** False while a mutation is running so a stray click cannot abandon it. */
  dismissible?: boolean
  className?: string
}) {
  const t = useMessages()
  return (
    <BaseDialog.Root open={open} onOpenChange={() => { if (dismissible) onClose() }} modal>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="dialog-backdrop" />
        <BaseDialog.Popup className={cx('dialog-popup', `dialog-${size}`, tone === 'danger' && 'dialog-danger', className)}>
          <div className="dialog-head">
            <BaseDialog.Title className="dialog-title">{title}</BaseDialog.Title>
            {dismissible && (
              <BaseDialog.Close render={<IconButton label={t.common.close} icon="x" size="sm" />} />
            )}
          </div>
          {description && <BaseDialog.Description className="dialog-desc">{description}</BaseDialog.Description>}
          {children && <div className="dialog-body">{children}</div>}
          {actions && <div className="dialog-actions">{actions}</div>}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}
