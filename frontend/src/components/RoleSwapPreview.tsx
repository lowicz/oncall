import { AssignmentRole } from '../api'
import { useMessages } from '../i18n'
import { RoleSwap, swapRoles } from '../lib/calendar'
import { roleLabels } from '../lib/labels'
import { Button, Checkbox, RoleMark } from '../ui'
import { SwapImpactPreview } from './SwapImpactPreview'

function PreviewRow({ role, from, to, eligible = true }: Readonly<{ role: AssignmentRole; from: string; to: string; eligible?: boolean }>) {
  const t = useMessages().schedule.roleSwap
  return (
    <div className="swap-preview-row">
      <RoleMark role={role} />
      <div className="swap-cell">
        <span>{from} → <b>{to}</b></span>
        {!eligible && <p className="field-msg" role="alert">{t.roleNotEligible(to, roleLabels()[role])}</p>}
      </div>
    </div>
  )
}

/** The role swap row by row, and the coordinator's choice whether 11–19 goes along. */
export function RoleSwapPreview({ swap, carry, onCarry, disabled }: Readonly<{
  swap: RoleSwap
  carry: boolean
  onCarry: (carry: boolean) => void
  disabled: boolean
}>) {
  const t = useMessages().schedule.roleSwap
  const late = swap.lateShift
  return (
    <div className="swap-preview">
      <PreviewRow role="primary" from={swap.primary.name} to={swap.secondary.name} eligible={!swap.ineligible.includes('primary')} />
      <PreviewRow role="secondary" from={swap.secondary.name} to={swap.primary.name} eligible={!swap.ineligible.includes('secondary')} />
      {late && (
        <div className="swap-preview-row">
          <RoleMark role="late_shift" />
          <div className="swap-cell">
            <span>
              {carry ? <>{late.from.name} → <b>{late.to.name}</b></> : <>{late.from.name} ({t.unchanged})</>}
            </span>
            <Checkbox
              label={t.withAnchor(roleLabels()[late.anchor])}
              hint={late.eligible ? t.carries(roleLabels()[late.anchor], late.to.name) : t.notEligible(late.to.name)}
              checked={carry}
              blocked={!late.eligible}
              disabled={disabled}
              onChange={(event) => onCarry(event.target.checked)}
            />
          </div>
        </div>
      )}
    </div>
  )
}

/** Both people's balance after the swap: PRIMARY given for SECONDARY of the
 *  same day, 11–19 riding on the anchor role's side when it goes along. */
export function RoleSwapImpact({ swap, serviceDate, carry }: Readonly<{ swap: RoleSwap; serviceDate: string; carry: boolean }>) {
  const t = useMessages().schedule.roleSwap
  const carried = carry ? swap.lateShift?.anchor : undefined
  const direction = (memberId: string) =>
    `${t.roles(swapRoles(swap, memberId, carry, false))} → ${t.roles(swapRoles(swap, memberId, carry, true))}`
  return (
    <SwapImpactPreview
      serviceDate={serviceDate}
      role="primary"
      replacementId={swap.secondary.id}
      inReturn={{ service_date: serviceDate, role: 'secondary' }}
      scope={carried === 'primary' ? undefined : 'single'}
      returnScope={carried === 'secondary' ? undefined : 'single'}
      directions={{ requester: direction(swap.primary.id), replacement: direction(swap.secondary.id) }}
    />
  )
}

/** „Zamień miejscami…" between the PRIMARY and SECONDARY rows; while the
 *  Undo window of a swap of this day is open, „Cofnij zamianę" instead. */
export function RoleSwapTrigger({ swap, open, controls, undo, disabled, onToggle }: Readonly<{
  swap: RoleSwap
  open: boolean
  controls: string
  undo: { undo: () => void; restores: string } | null
  disabled: boolean
  onToggle: () => void
}>) {
  const t = useMessages().schedule.roleSwap
  return (
    <div className="swap-row">
      {undo ? (
        <Button size="sm" icon="swap" onClick={undo.undo} aria-label={t.undoLabel(undo.restores)}>
          {t.undo}
        </Button>
      ) : (
        <Button
          size="sm"
          icon="swap"
          aria-expanded={open}
          aria-controls={controls}
          aria-label={t.triggerLabel(swap.primary.name, swap.secondary.name)}
          disabled={disabled}
          onClick={onToggle}
        >
          {t.trigger}
        </Button>
      )}
    </div>
  )
}
