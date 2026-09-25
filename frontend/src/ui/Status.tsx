import { ReactNode, useState } from 'react'
import { cx } from './cx'
import { AssignmentRole, AvailabilityKind } from '../api'
import { availabilityLabels, roleLabels, shortRoleLabels } from '../lib/labels'
import { signedPoints } from '../lib/numbers'

export type StatusTone = 'draft' | 'prop' | 'pub' | 'ok' | 'warn' | 'bad' | 'sig' | 'muted'

/** Small uppercase mono badge: a schedule status, a swap stage, a rotation state. */
export function StatusBadge({ tone = 'muted', children, className }: { tone?: StatusTone; children: ReactNode; className?: string }) {
  return <span className={cx('st', `st-${tone}`, className)}>{children}</span>
}

/** Mono tag next to a title: "1X · dzień roboczy", a version. */
export function Tag({ children, tone, className }: { children: ReactNode; tone?: 'late' | 'sig' | 'bad'; className?: string }) {
  return <span className={cx('tag', tone && `tag-${tone}`, className)}>{children}</span>
}

/**
 * A risk chip: one fact with a coloured dot, clickable when it leads
 * somewhere (a filter, a section). The dot colour is never the only signal;
 * the text says what it is.
 */
export function Chip({ tone = 'muted', children, onClick, className, title }: {
  tone?: 'ok' | 'warn' | 'bad' | 'sig' | 'muted'
  children: ReactNode
  onClick?: () => void
  className?: string
  title?: string
}) {
  const content = (
    <>
      <i className="chip-dot" aria-hidden="true" />
      {children}
    </>
  )
  if (onClick) {
    return (
      <button type="button" className={cx('chip', `chip-${tone}`, 'chip-btn', className)} onClick={onClick} title={title}>
        {content}
      </button>
    )
  }
  return <span className={cx('chip', `chip-${tone}`, className)} title={title}>{content}</span>
}

export function ChipRow({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  return <div className={cx('risk', className)} role={label ? 'list' : undefined} aria-label={label}>{children}</div>
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
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('')
  const photo = src && src !== broken ? src : null
  return (
    <span className={cx('ava', photo && 'ava-photo', className)} style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }} aria-hidden="true">
      {photo ? <img className="ava-img" src={photo} alt="" onError={() => setBroken(photo)} /> : (initials || '?')}
    </span>
  )
}

/**
 * Two-way deviation bar with the zero line in the middle: points above the
 * fair share extend right in amber, below extend left in the signal colour.
 * `max` is the value that fills one half.
 */
export function DeviationBar({ value, max, label, className, showValue = true }: {
  value: number
  max: number
  label?: string
  className?: string
  showValue?: boolean
}) {
  const width = Math.min(100, Math.abs(value) / Math.max(max, 0.01) * 100)
  const over = value > 0
  const formatted = signedPoints(value)
  return (
    <span className={cx('dev', className)} role="img" aria-label={label ?? `odchylenie ${formatted}`}>
      <span className="dev-track">
        <i className={over ? 'dev-over' : 'dev-under'} style={{ width: `${width / 2}%` }} />
      </span>
      {showValue && <span className={cx('dev-v', over ? 'dev-v-over' : value < 0 ? 'dev-v-under' : '')}>{formatted}</span>}
    </span>
  )
}
