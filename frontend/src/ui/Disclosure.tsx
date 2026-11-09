import { ReactNode, useId, useState } from 'react'
import { cx } from './cx'
import { Icon } from './Icon'

/**
 * A collapsible section: advanced settings, a comparison, a long list.
 * The body is not rendered while closed, so its controls stay out of the
 * accessibility tree and the tab order until somebody asks for them.
 * `meta` sums the body up on the closed summary line.
 */
export function Disclosure({ title, meta, children, className }: {
  title: ReactNode
  meta?: ReactNode
  children: ReactNode
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <div className={cx('panel details', open && 'details-open', className)}>
      <button type="button" className="details-summary" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((current) => !current)}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
        <span>{title}</span>
        {/* The space keeps the accessible name from running the two together; a flex row does not draw it. */}
        {meta && <>{' '}<span className="details-meta">{meta}</span></>}
      </button>
      {open && <div className="details-body" id={id}>{children}</div>}
    </div>
  )
}
