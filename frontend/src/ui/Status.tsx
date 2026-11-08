import { Children, Fragment, ReactNode, isValidElement, useId, useState } from 'react'
import { cx } from './cx'
import { Icon } from './Icon'
import { Tooltip } from './Tooltip'
import { AssignmentRole, AvailabilityKind } from '../api'
import { availabilityLabels, roleLabels, shortRoleLabels } from '../lib/labels'
import { printedPoints, signedPoints } from '../lib/numbers'
import { useMessages } from '../i18n/messages'

export type StatusTone = 'draft' | 'prop' | 'pub' | 'ok' | 'warn' | 'bad' | 'sig' | 'muted'

/** Small uppercase mono badge: a schedule status, a swap stage, a rotation state. */
export function StatusBadge({ tone = 'muted', children, className }: { tone?: StatusTone; children: ReactNode; className?: string }) {
  return <span className={cx('st', `st-${tone}`, className)}>{children}</span>
}

/** The one-line outcome of a check, after a dot: "Bez naruszeń reguł twardych
 *  po zamianie". Read out whenever it changes. */
export function StatusLine({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx('status-line', className)} role="status">{children}</p>
}

/** Mono tag next to a title: "1X · dzień roboczy", a version. */
export function Tag({ children, tone, className }: { children: ReactNode; tone?: 'sig' | 'bad'; className?: string }) {
  return <span className={cx('tag', tone && `tag-${tone}`, className)}>{children}</span>
}

/**
 * A risk chip: one fact with a coloured dot, clickable when it leads
 * somewhere (a filter, a section). The dot colour is never the only signal;
 * the text says what it is. A clickable chip ends in a chevron, and where it
 * leads (`title`) is its description and a tooltip that focus opens too.
 */
export function Chip({ tone = 'muted', children, onClick, className, title }: {
  tone?: 'ok' | 'warn' | 'bad' | 'sig' | 'muted'
  children: ReactNode
  onClick?: () => void
  className?: string
  title?: string
}) {
  const descriptionId = useId()
  const content = (
    <>
      <i className="chip-dot" aria-hidden="true" />
      {children}
    </>
  )
  if (onClick) {
    const button = (
      <button type="button" className={cx('chip', `chip-${tone}`, 'chip-btn', className)} onClick={onClick} aria-describedby={title ? descriptionId : undefined}>
        {content}
        <Icon name="chevron-right" size={16} className="chip-go" />
        {title && <span id={descriptionId} hidden>{title}</span>}
      </button>
    )
    return title ? <Tooltip text={title}>{button}</Tooltip> : button
  }
  return (
    <span className={cx('chip', `chip-${tone}`, className)} title={title}>
      {content}
      {title && <span className="sr-only"> {title}</span>}
    </span>
  )
}

/** The chips inside any Fragments, each with a key unique along its path. */
const chipsOf = (children: ReactNode, path = ''): [string, ReactNode][] => Children.toArray(children).flatMap((child, index) => {
  const key = `${path}/${isValidElement(child) ? child.key : index}`
  return isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment ? chipsOf(child.props.children, key) : [[key, child]]
})

export function ChipRow({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <div className={cx('risk', className)} role={label ? 'list' : undefined} aria-label={label}>
      {label ? chipsOf(children).map(([key, child]) => <div className="chip-row-item" role="listitem" key={key}>{child}</div>) : children}
    </div>
  )
}

const roleClass: Record<AssignmentRole, string> = { primary: 'p', secondary: 's', late_shift: 'l' }

/** The role mark drawn in a matrix cell: P, S or 11–19 on the role's colour. */
export function RoleMark({ role, change, className, size }: {
  role: AssignmentRole
  /** Superscript index: Z after a swap, K after a coordinator's override. */
  change?: 'swap' | 'manual_override' | null
  className?: string
  size?: 'sm'
}) {
  return (
    <span className={cx('rm', `rm-${roleClass[role]}`, change === 'swap' && 'rm-sw', change === 'manual_override' && 'rm-ko', size === 'sm' && 'rm-sm', className)}>
      {shortRoleLabels()[role]}
    </span>
  )
}

/** The role name as a coloured mono label: PRIMARY / SECONDARY / 11–19. */
export function RoleLabel({ role, className }: { role: AssignmentRole; className?: string }) {
  return <span className={cx('lbl', `lbl-${roleClass[role]}`, className)}>{roleLabels()[role]}</span>
}

const availClass: Record<AvailabilityKind, string> = { unavailable: 'na', prefer_not: 'wn', prefer: 'ch' }
const availCode: Record<AvailabilityKind, string> = { unavailable: 'N', prefer_not: 'W', prefer: 'C' }

/** One-letter availability code on its colour: N (nie mogę), W (wolę nie), C (chętnie). */
export function AvailabilityMark({ kind, className, withLabel }: { kind: AvailabilityKind; className?: string; withLabel?: boolean }) {
  return (
    <span className={cx('am-wrap', className)}>
      <span className={cx('am', `am-${availClass[kind]}`)} aria-hidden={withLabel ? true : undefined} title={withLabel ? undefined : availabilityLabels()[kind]}>
        {availCode[kind]}
      </span>
      {withLabel && <span>{availabilityLabels()[kind]}</span>}
      {!withLabel && <span className="sr-only">{availabilityLabels()[kind]}</span>}
    </span>
  )
}

/**
 * Circle with initials, for the account menu and people lists; the person's
 * photo instead when there is one (`src`), and the initials again the moment
 * the browser cannot show it. Decorative: the element around it names the
 * person.
 */
export function Avatar({ name, size = 26, className, src }: { name: string; size?: number; className?: string; src?: string | null }) {
  // The source the browser refused, so a new one is tried afresh.
  const [broken, setBroken] = useState<string | null>(null)
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('')
  const photo = src && src !== broken ? src : null
  return (
    <span className={cx('ava', photo && 'ava-photo', className)} style={{ width: size, height: size }} aria-hidden="true">
      {photo ? <img className="ava-img" src={photo} alt="" onError={() => setBroken(photo)} /> : (initials || '?')}
    </span>
  )
}

/**
 * Two-way deviation bar with the zero line in the middle: points above the
 * fair share extend right in amber, below extend left in the signal colour.
 * `max` is the value that fills one half.
 */
export function DeviationBar({ value, max, label, className }: {
  value: number
  max: number
  label?: string
  className?: string
}) {
  const printed = printedPoints(value)
  const width = Math.min(100, Math.abs(printed) / Math.max(max, 0.01) * 100)
  const over = printed > 0
  const formatted = signedPoints(value)
  const { common } = useMessages()
  return (
    <span className={cx('dev', className)} role="img" aria-label={label ?? common.deviation(formatted)}>
      <span className="dev-track">
        <i className={over ? 'dev-over' : 'dev-under'} style={{ width: `${width / 2}%` }} />
      </span>
      <span className={cx('dev-v', over ? 'dev-v-over' : printed < 0 ? 'dev-v-under' : '')}>{formatted}</span>
    </span>
  )
}
