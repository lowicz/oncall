import { ReactNode } from 'react'
import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import { cx } from './cx'
import { IconButton } from './Button'
import { useNarrow } from '../hooks/useMediaQuery'
import { useMessages } from '../i18n/messages'

/**
 * The side panel: the day inspector, a swap decision, a person's account.
 * On a desktop it slides in from the right over the page and stays open
 * while the user clicks elsewhere (so another day can be picked from the
 * matrix without closing it); Escape closes it. On a phone it is a modal
 * bottom sheet with a backdrop.
 */
export function Panel({ open, onOpenChange, title, meta, children, footer, className, wide }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  /** Tags next to the title: multiplier, status. */
  meta?: ReactNode
  children: ReactNode
  footer?: ReactNode
  className?: string
  wide?: boolean
}) {
  const narrow = useNarrow()
  const t = useMessages()
  return (
    <BaseDialog.Root
      open={open}
      onOpenChange={onOpenChange}
      modal={narrow ? true : false}
      disablePointerDismissal={!narrow}
    >
      <BaseDialog.Portal>
        {narrow && <BaseDialog.Backdrop className="dialog-backdrop" />}
        <BaseDialog.Popup className={cx('panel-popup', wide && 'panel-wide', className)}>
          <div className="panel-head">
            <BaseDialog.Title className="panel-title">{title}</BaseDialog.Title>
            {meta && <div className="panel-meta">{meta}</div>}
            <BaseDialog.Close render={<IconButton label={t.common.closePanel} icon="x" size="sm" className="panel-close" />} />
          </div>
          <div className="panel-body">{children}</div>
          {footer && <div className="panel-foot">{footer}</div>}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  )
}
