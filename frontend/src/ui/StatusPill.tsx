import { ButtonHTMLAttributes, forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { cx } from './cx'

type PillState = 'ok' | 'pending' | 'failed'

/**
 * A state on a pill that opens its details: where the on-call number rings,
 * since when. A button with all its words visible, no `title`; the details
 * open as a dialog (`aria-haspopup`), so it can be a popover's trigger. A
 * change of state is read out politely, a failure at once, as an alert.
 *
 * The announcement is a hidden region beside the button, not around it: a
 * modal leaves `aria-live` regions readable behind it, and the button must
 * not stay reachable there. The region repeats the words only once they
 * change, so a reader meets them once on the page.
 */
export const StatusPill = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & {
  state?: PillState
}>(function StatusPill({ state = 'ok', className, children, ...rest }, ref) {
  const failed = state === 'failed'
  const button = useRef<HTMLButtonElement>(null)
  useImperativeHandle(ref, () => button.current!)
  const shown = useRef<string>(undefined)
  const [said, setSaid] = useState('')
  useLayoutEffect(() => {
    const text = button.current!.textContent!
    const now = `${state} ${text}`
    if (shown.current === undefined ? failed : shown.current !== now) setSaid(text)
    shown.current = now
  })
  return (
    <>
      <button ref={button} type="button" aria-haspopup="dialog" className={cx('pill', `pill-${state}`, className)} {...rest}>
        {children}
      </button>
      <span className="sr-only" role={failed ? 'alert' : undefined} aria-live={failed ? undefined : 'polite'}>{said}</span>
    </>
  )
})
