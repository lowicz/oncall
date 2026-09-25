import { ReactNode } from 'react'
import { cx } from './cx'
import { Icon, IconName } from './Icon'
import { Button } from './Button'
import { ApiError } from '../api'
import { useMessages } from '../i18n/messages'

/** A list with nothing in it says why and what to do next. */
export function EmptyState({ icon = 'info', title, description, action, className, compact }: {
  icon?: IconName
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
  compact?: boolean
}) {
  return (
    <div className={cx('empty', compact && 'empty-compact', className)}>
      <Icon name={icon} size={compact ? 22 : 32} />
      <p className="empty-title">{title}</p>
      {description && <p className="empty-desc">{description}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  )
}

/** What the API said, with the retry and the status code for a ticket. */
export function ErrorState({ error, title, onRetry, className }: {
  error: unknown
  title?: ReactNode
  onRetry?: () => void
  className?: string
}) {
  const t = useMessages()
  const message = error instanceof Error ? error.message : String(error)
  const status = error instanceof ApiError ? error.status : null
  return (
    <div className={cx('empty', 'empty-error', className)} role="alert">
      <Icon name="alert" size={28} />
      <p className="empty-title">{title ?? t.common.fetchFailed}</p>
      <p className="empty-desc">{message}</p>
      {onRetry && <div className="empty-action"><Button variant="primary" size="sm" icon="refresh" onClick={onRetry}>{t.common.retry}</Button></div>}
      {status !== null && <p className="empty-code">HTTP {status}</p>}
    </div>
  )
}

/** Inline error under a form or an action: the message plus the rule details a
 *  hard-rule rejection carries. */
export function InlineError({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null
  const message = error instanceof Error ? error.message : String(error)
  const violations = error instanceof ApiError ? error.violations : []
  const nextStep = error instanceof ApiError ? error.nextStep : null
  return (
    <div className={cx('box box-bad', className)} role="alert">
      <b>{message}</b>
      {violations.length > 0 && (
        <ul className="box-list">
          {violations.map((violation, index) => (
            <li key={`${violation.rule}-${index}`}>
              {violation.message}
              {violation.member_name && <> · {violation.member_name}</>}
              {violation.days.length > 0 && <> · {violation.days.join(', ')}</>}
            </li>
          ))}
        </ul>
      )}
      {nextStep && <p className="box-next">{nextStep}</p>}
    </div>
  )
}

/** A grey shimmering block the size of what will replace it. */
export function Skeleton({ width, height = 14, className, inline }: { width?: number | string; height?: number | string; className?: string; inline?: boolean }) {
  return <span className={cx('sk', inline && 'sk-inline', className)} style={{ width, height }} aria-hidden="true" />
}

/** A screen-sized loading state announced once to assistive technology. */
export function LoadingBlock({ label, rows = 4, className }: { label?: string; rows?: number; className?: string }) {
  const t = useMessages()
  return (
    <div className={cx('sk-block', className)} role="status" aria-label={label ?? t.common.loading}>
      <Skeleton width="40%" height={22} />
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} width={`${85 - index * 9}%`} />
      ))}
    </div>
  )
}
