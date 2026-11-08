import { ButtonHTMLAttributes, forwardRef } from 'react'
import { cx } from './cx'

type PillState = 'ok' | 'pending' | 'failed'

/**
 * A state on a pill that opens its details: where the on-call number rings,
 * since when. A button with all its words visible, no `title`; the details
 * open as a dialog (`aria-haspopup`), so it can be a popover's trigger. A
 * change of state is read out politely, a failure at once, as an alert.
 */
export const StatusPill = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & {
  state?: PillState
}>(function StatusPill({ state = 'ok', className, children, ...rest }, ref) {
  const failed = state === 'failed'
  return (
    <span role={failed ? 'alert' : undefined} aria-live={failed ? undefined : 'polite'}>
      <button ref={ref} type="button" aria-haspopup="dialog" className={cx('pill', `pill-${state}`, className)} {...rest}>
        {children}
      </button>
    </span>
  )
})
