import { ReactNode } from 'react'
import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import { cx } from './cx'
import { IconButton } from './Button'
import { useMessages } from '../i18n/messages'

/**
 * A sheet from the bottom of a phone screen: one short decision where a
 * popover would cover the control that opened it. A modal named by its `<h2>`
 * title; its close button, Escape and the backdrop close it, and focus
 * returns to where it was.
 */
export function Sheet({ open, onClose, title, children, className }: {
  open: boolean
  /** Opened by the page through `open`, so the only change it asks for is to close. */
  onClose: () => void
  title: ReactNode
  children: ReactNode
  className?: string
}) {
  const t = useMessages()
  return (
    <BaseDialog.Root open={open} onOpenChange={() => onClose()} modal>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="dialog-backdrop" />
        <BaseDialog.Popup className={cx('sheet', className)}>
          <div className="sheet-grip" aria-hidden="true" />
          <div className="sheet-head">
            <BaseDialog.Title className="sheet-title">{title}</BaseDialog.Title>
            <BaseDialog.Close render={<IconButton label={t.common.close} icon="x" size="sm" />} />
          </div>
          {children}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}
