import { ReactNode, useCallback, useLayoutEffect, useRef, useState } from 'react'
import { cx } from './cx'

interface Hidden {
  start: boolean
  end: boolean
}

/**
 * A horizontally scrolling panel for content wider than the screen, such as a
 * wide table. While columns are out of view the hidden edge fades and `hint`
 * says so, so they do not look cut off; the region then takes keyboard focus
 * and scrolls with the arrow keys. `scroll-area-start` marks that the content
 * is scrolled, for a sticky first column to draw its edge.
 */
export function ScrollArea({ label, hint, className, children }: {
  label: string
  hint: string
  className?: string
  children: ReactNode
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const [hidden, setHidden] = useState<Hidden>({ start: false, end: false })
  const measure = useCallback(() => {
    const element = viewport.current
    if (!element) return
    const start = element.scrollLeft > 1
    const end = element.scrollWidth - element.clientWidth - element.scrollLeft > 1
    setHidden((current) => (current.start === start && current.end === end ? current : { start, end }))
  }, [])

  useLayoutEffect(() => {
    measure()
    const element = viewport.current
    if (!element || typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    if (element.firstElementChild) observer.observe(element.firstElementChild)
    return () => observer.disconnect()
  }, [measure])

  const scrollable = hidden.start || hidden.end
  return (
    <div className={cx('panel scroll-area', hidden.start && 'scroll-area-start', hidden.end && 'scroll-area-end', className)}>
      {scrollable && <p className="scroll-area-hint">{hint}</p>}
      <div className="scroll-area-frame">
        <div
          ref={viewport}
          className="scroll-area-viewport"
          role="region"
          aria-label={label}
          tabIndex={scrollable ? 0 : undefined}
          onScroll={measure}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
