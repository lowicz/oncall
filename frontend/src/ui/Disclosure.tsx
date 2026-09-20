import { ReactNode, useId, useState } from 'react'
import { cx } from './cx'
import { Icon } from './Icon'

/**
 * A collapsible section: advanced settings, a comparison, a long list.
 * The body is not rendered while closed, so its controls stay out of the
 * accessibility tree and the tab order until somebody asks for them.
 */
export function Disclosure({ title, children, defaultOpen = false, className, meta }: {
  title: ReactNode
  children: ReactNode
  defaultOpen?: boolean
  className?: string
  meta?: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()
  return (
    <div className={cx('panel details', open && 'details-open', className)}>
      <button type="button" className="details-summary" aria-expanded={open} aria-controls={id} onClick={() => setOpen((current) => !current)}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
        <span>{title}</span>
        {meta && <span className="details-meta">{meta}</span>}
      </button>
      {open && <div className="details-body" id={id}>{children}</div>}
    </div>
  )
}
