import { ButtonHTMLAttributes, ReactNode, forwardRef } from 'react'
import { cx } from './cx'

export type PillState = 'ok' | 'pending' | 'failed'

/**
 * A state on a pill that opens its details: where the on-call number rings,
 * since when. A button with all its words visible, no `title`; the details
 * open as a dialog (`aria-haspopup`), so it can be a popover's trigger. A
 * change of state is read out politely, a failure at once, as an alert.
 */
export const StatusPill = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & {
  state?: PillState
  /** Read after the visible words but not shown: whose number, confirmed when. */
  detail?: ReactNode
}>(function StatusPill({ state = 'ok', detail, className, children, ...rest }, ref) {
  const failed = state === 'failed'
  return (
    <span className="pill-live" role={failed ? 'alert' : undefined} aria-live={failed ? undefined : 'polite'}>
      <button ref={ref} type="button" aria-haspopup="dialog" className={cx('pill', `pill-${state}`, className)} {...rest}>
        {children}
        {detail && <span className="sr-only">{detail}</span>}
      </button>
    </span>
  )
})
