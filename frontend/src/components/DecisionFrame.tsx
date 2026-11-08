import { ReactNode } from 'react'
import { RuleViolation } from '../api'
import { formatDate } from '../lib/dates'
import { useMessages } from '../i18n'
import { Box, Checkbox, Field, Textarea, cx } from '../ui'

/**
 * A decision the user has to take knowingly: a frame with a checkbox that the
 * caller makes gate its action button, so consent lives where the facts are.
 */
export function AcknowledgeBox({ title, label, checked, onChange, disabled, children }: {
  title: ReactNode
  label: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  children?: ReactNode
}) {
  return (
    <Box tone="bad" title={title}>
      {children}
      <Checkbox label={label} checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
    </Box>
  )
}

/**
 * Everything a change needs before it is saved, inside the panel that makes
 * it rather than in a confirmation dialog: one rule line, or the broken rules
 * with their acknowledgement; the balance (`children`); a reason for a day
 * already past; and the save error, focused so it is announced and in reach.
 * The caller owns the state and gates its save button on it.
 */
export function DecisionFrame({
  violations,
  checkFailed = false,
  violationsTitle,
  acknowledged,
  onAcknowledge,
  reason,
  error,
  pending = false,
  children,
}: {
  /** The hard rules the change would break; undefined while they are checked. */
  violations: RuleViolation[] | undefined
  /** The check itself failed: the save checks the rules again. */
  checkFailed?: boolean
  violationsTitle: string
  acknowledged: boolean
  onAcknowledge: (acknowledged: boolean) => void
  reason?: { label: string; value: string; minLength: number; onChange: (value: string) => void }
  error?: string | null
  pending?: boolean
  children?: ReactNode
}) {
  const { common } = useMessages()
  const t = common.decision
  const reasonTooShort = reason && reason.value.trim().length > 0 && reason.value.trim().length < reason.minLength
  return (
    <div className="decision">
      {violations?.length ? (
        <AcknowledgeBox
          title={violationsTitle}
          label={t.acknowledge}
          checked={acknowledged}
          onChange={onAcknowledge}
          disabled={pending}
        >
          <ul className="box-list">
            {violations.map((violation, index) => (
              <li key={index}>
                {violation.message} ({violation.member_name}: {violation.days.map(formatDate).join(', ')})
              </li>
            ))}
          </ul>
          <div className="box-next">{t.auditNote}</div>
        </AcknowledgeBox>
      ) : (
        <div className={cx('rule-line', checkFailed ? 'rule-line-warn' : !violations && 'rule-line-wait')} role="status">
          {checkFailed ? t.checkFailed : violations ? t.clean : t.checking}
        </div>
      )}
      {children}
      {reason && (
        <Field label={reason.label} required error={reasonTooShort ? common.reasonTooShort(reason.minLength) : undefined}>
          {({ id, describedBy, invalid }) => (
            <Textarea
              id={id}
              name="reason"
              rows={3}
              value={reason.value}
              onChange={(event) => reason.onChange(event.target.value)}
              required
              invalid={invalid}
              aria-describedby={describedBy}
              disabled={pending}
            />
          )}
        </Field>
      )}
      {error && <Box tone="bad" role="alert" focus title={error} />}
    </div>
  )
}
