import { ReactElement, ReactNode } from 'react'
import { Popover as BasePopover } from '@base-ui/react/popover'
import { cx } from './cx'

/** A small anchored surface: the legend, contextual help. Escape closes it and
 *  focus returns to the trigger. */
export function Popover({ trigger, title, children, className }: {
  /** The element that opens the popover; it receives the trigger props. */
  trigger: ReactElement
  title?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <BasePopover.Root>
      <BasePopover.Trigger render={trigger} />
      <BasePopover.Portal>
        <BasePopover.Positioner side="bottom" align="end" sideOffset={6} className="pop-positioner">
          <BasePopover.Popup className={cx('pop', className)}>
            {title && <BasePopover.Title className="pop-title">{title}</BasePopover.Title>}
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  )
}
