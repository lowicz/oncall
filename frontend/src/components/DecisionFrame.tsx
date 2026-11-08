import { ReactNode } from 'react'
import { RuleViolation } from '../api'
import { formatDate } from '../lib/dates'
import { useMessages } from '../i18n'
import { Box, Checkbox, cx } from '../ui'

/**
 * A decision the user has to take knowingly: a frame with a checkbox that the
 * caller makes gate its action button, so consent lives where the facts are.
 */
export function AcknowledgeBox({ title, label, checked, onChange, disabled, children }: Readonly<{
  title: ReactNode
  label: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  children?: ReactNode
}>) {
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
 * with their acknowledgement; the balance (`children`); and the save error,
 * focused so it is announced and in reach.
 * The caller owns the state and gates its save button on it.
 */
export function DecisionFrame({
  violations,
  checkFailed = false,
  violationsTitle,
  acknowledged,
  onAcknowledge,
  error,
  pending = false,
  children,
}: Readonly<{
  /** The hard rules the change would break; undefined while they are checked. */
  violations: RuleViolation[] | undefined
  /** The check itself failed: the save checks the rules again. */
  checkFailed?: boolean
  violationsTitle: string
  acknowledged: boolean
  onAcknowledge: (acknowledged: boolean) => void
  error?: string | null
  pending?: boolean
  children?: ReactNode
}>) {
  const { common } = useMessages()
  const t = common.decision
  let rule = { tone: 'rule-line-wait', text: t.checking }
  if (checkFailed) rule = { tone: 'rule-line-warn', text: t.checkFailed }
  else if (violations) rule = { tone: '', text: t.clean }
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
            {violations.map((violation) => (
              <li key={`${violation.rule}-${violation.member_name}-${violation.days.join(',')}`}>
                {violation.message} ({violation.member_name}: {violation.days.map(formatDate).join(', ')})
              </li>
            ))}
          </ul>
          <div className="box-next">{t.auditNote}</div>
        </AcknowledgeBox>
      ) : (
        <output className={cx('rule-line', rule.tone)}>{rule.text}</output>
      )}
      {children}
      {error && <Box tone="bad" role="alert" focus title={error} />}
    </div>
  )
}
