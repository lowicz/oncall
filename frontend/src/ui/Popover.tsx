import { ReactElement, ReactNode } from 'react'
import { Popover as BasePopover } from '@base-ui/react/popover'
import { cx } from './cx'

/** A small anchored surface: the legend, contextual help. Escape closes it and
 *  focus returns to the trigger. */
export function Popover({ trigger, title, children, side = 'bottom', align = 'end', className, open, onOpenChange }: {
  /** The element that opens the popover; it receives the trigger props. */
  trigger: ReactElement
  title?: ReactNode
  children: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
  className?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  return (
    <BasePopover.Root open={open} onOpenChange={onOpenChange}>
      <BasePopover.Trigger render={trigger} />
      <BasePopover.Portal>
        <BasePopover.Positioner side={side} align={align} sideOffset={6} className="pop-positioner">
          <BasePopover.Popup className={cx('pop', className)}>
            {title && <BasePopover.Title className="pop-title">{title}</BasePopover.Title>}
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  )
}
