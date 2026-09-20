import { ReactNode } from 'react'
import { cx } from './cx'

/** The title of a screen: the fact first (a date, a range, a name), the
 *  context under it, actions on the right in rising weight. */
export function PageHeader({ title, sub, actions, className, eyebrow }: {
  title: ReactNode
  sub?: ReactNode
  actions?: ReactNode
  className?: string
  eyebrow?: ReactNode
}) {
  return (
    <div className={cx('ph', className)}>
      <div className="ph-text">
        {eyebrow && <div className="ph-eyebrow">{eyebrow}</div>}
        <h1 className="ph-title">{title}</h1>
        {sub && <div className="ph-sub">{sub}</div>}
      </div>
      {actions && <div className="ph-actions">{actions}</div>}
    </div>
  )
}

/** A ruled section heading: title, mono meta, controls on the right. */
export function SectionHeading({ title, meta, controls, className, as: Heading = 'h2', id }: {
  title: ReactNode
  meta?: ReactNode
  controls?: ReactNode
  className?: string
  as?: 'h2' | 'h3'
  id?: string
}) {
  return (
    <div className={cx('sech', className)}>
      <Heading className="sech-title" id={id}>{title}</Heading>
      {meta && <span className="sech-meta">{meta}</span>}
      {controls && <div className="sech-ctl">{controls}</div>}
    </div>
  )
}

/** A bordered surface. */
export function Panelbox({ children, className, padded }: { children: ReactNode; className?: string; padded?: boolean }) {
  return <div className={cx('panel', padded && 'panel-padded', className)}>{children}</div>
}

/** A callout with a coloured left rule: a rule result, a consequence, a note. */
export function Box({ tone = 'muted', title, children, className, role }: {
  tone?: 'muted' | 'ok' | 'warn' | 'bad' | 'sig'
  title?: ReactNode
  children?: ReactNode
  className?: string
  role?: 'alert' | 'status'
}) {
  return (
    <div className={cx('box', `box-${tone}`, className)} role={role}>
      {title && <b>{title}</b>}
      {children}
    </div>
  )
}

/** Key on the left, value on the right, one per line. */
export function KeyValue({ items, className }: { items: Array<{ key: ReactNode; value: ReactNode; mono?: boolean }>; className?: string }) {
  return (
    <dl className={cx('kv', className)}>
      {items.map((item, index) => (
        <div key={index} className="kv-row">
          <dt>{item.key}</dt>
          <dd className={cx(item.mono && 'mono')}>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export interface Step {
  label: ReactNode
  state: 'done' | 'on' | 'todo'
}

/** Stages of a flow: swap, import, generation. */
export function Steps({ steps, className, label }: { steps: Step[]; className?: string; label?: string }) {
  return (
    <ol className={cx('steps', className)} aria-label={label}>
      {steps.map((step, index) => (
        <li key={index} className={cx('step', `step-${step.state}`)} aria-current={step.state === 'on' ? 'step' : undefined}>
          {step.label}
        </li>
      ))}
    </ol>
  )
}

/** A stack of rows with a bottom rule, optionally grouped under mono headings. */
export function List({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('list', className)}>{children}</div>
}

export function ListRow({ children, aside, className, highlight, tone }: {
  children: ReactNode
  aside?: ReactNode
  className?: string
  highlight?: boolean
  tone?: 'bad' | 'warn'
}) {
  return (
    <div className={cx('list-row', highlight && 'list-row-hl', tone && `list-row-${tone}`, className)}>
      <div className="list-main">{children}</div>
      {aside && <div className="list-aside">{aside}</div>}
    </div>
  )
}

export function ListHeading({ children }: { children: ReactNode }) {
  return <div className="list-h">{children}</div>
}

/** Visually hidden text for screen readers. */
export function SrOnly({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>
}
