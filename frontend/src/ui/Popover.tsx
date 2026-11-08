import { ReactElement, ReactNode, RefObject } from 'react'
import { Popover as BasePopover } from '@base-ui/react/popover'
import { cx } from './cx'

/** A small anchored surface: the legend, contextual help. Escape closes it and
 *  focus returns to the trigger. */
export function Popover({ trigger, title, children, className, open, onOpenChange, anchor }: {
  /** The element that opens the popover; it receives the trigger props. */
  trigger?: ReactElement
  title?: ReactNode
  children: ReactNode
  className?: string
  /** Opened from elsewhere, a menu item: the state is the caller's, and the
   *  popover hangs off `anchor`, which also takes the focus back. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  anchor?: RefObject<HTMLElement | null>
}) {
  return (
    <BasePopover.Root open={open} onOpenChange={onOpenChange && ((next) => onOpenChange(next))}>
      {trigger && <BasePopover.Trigger render={trigger} />}
      <BasePopover.Portal>
        <BasePopover.Positioner anchor={anchor} side="bottom" align="end" sideOffset={6} className="pop-positioner">
          <BasePopover.Popup className={cx('pop', className)} finalFocus={anchor}>
            {title && <BasePopover.Title className="pop-title">{title}</BasePopover.Title>}
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  )
}
