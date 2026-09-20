import { ReactElement, ReactNode } from 'react'
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip'

/** Hover and focus hint. The trigger must be focusable so keyboard users get it too. */
export function Tooltip({ text, children, side = 'top' }: {
  text: ReactNode
  children: ReactElement
  side?: 'top' | 'bottom' | 'left' | 'right'
}) {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} sideOffset={6} className="pop-positioner">
          <BaseTooltip.Popup className="tip">{text}</BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  )
}

export function TooltipProvider({ children }: { children: ReactNode }) {
  return <BaseTooltip.Provider delay={400}>{children}</BaseTooltip.Provider>
}
