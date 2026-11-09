import { AssignmentRole } from '../api'
import { useMessages } from '../i18n'
import { RoleSwap, swapRoles } from '../lib/calendar'
import { roleLabels } from '../lib/labels'
import { Button, Checkbox, RoleMark } from '../ui'
import { SwapImpactPreview } from './SwapImpactPreview'

function PreviewRow({ role, from, to }: Readonly<{ role: AssignmentRole; from: string; to: string }>) {
  return (
    <div className="swap-preview-row">
      <RoleMark role={role} />
      <div className="swap-cell">
        <span>{from} → <b>{to}</b></span>
      </div>
    </div>
  )
}

/** The role swap row by row, and the coordinator's choice whether 11–19
 *  goes along; in a draft, unticking asks for no confirmation. */
export function RoleSwapPreview({ swap, carry, onCarry, disabled, inDraft = false }: Readonly<{
  swap: RoleSwap
  carry: boolean
  onCarry: (carry: boolean) => void
  disabled: boolean
  inDraft?: boolean
}>) {
  const t = useMessages().schedule.roleSwap
  const late = swap.lateShift
  const carries = (anchor: AssignmentRole) => (inDraft ? t.carriesInDraft : t.carries(roleLabels()[anchor]))
  return (
    <div className="swap-preview">
      <PreviewRow role="primary" from={swap.primary.name} to={swap.secondary.name} />
      <PreviewRow role="secondary" from={swap.secondary.name} to={swap.primary.name} />
      {late && (
        <div className="swap-preview-row">
          <RoleMark role="late_shift" />
          <div className="swap-cell">
            <span>
              {carry ? <>{late.from.name} → <b>{late.to.name}</b></> : <>{late.from.name} ({t.unchanged})</>}
            </span>
            <Checkbox
              label={t.withAnchor(roleLabels()[late.anchor])}
              hint={late.eligible ? carries(late.anchor) : t.notEligible(late.to.name)}
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
 *  Undo window of a swap of this day is open, „Cofnij zamianę" instead. A
 *  swap one of them may not take is refused here, with the reason under the
 *  button, so no frame opens on it. */
export function RoleSwapTrigger({ swap, open, controls, undo, disabled, onToggle }: Readonly<{
  swap: RoleSwap
  open: boolean
  controls: string
  undo: { undo: () => void; restores: string } | null
  disabled: boolean
  onToggle: () => void
}>) {
  const t = useMessages().schedule.roleSwap
  const takers = { primary: swap.secondary.name, secondary: swap.primary.name }
  const refusals = (['primary', 'secondary'] as const).flatMap((role) => {
    const refusal = swap.refused[role]
    return refusal ? [t.refusals[refusal](takers[role], roleLabels()[role])] : []
  })
  const refusalId = `${controls}-refused`
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
          // The frame exists only while open, so it is named only then.
          aria-controls={open ? controls : undefined}
          aria-label={t.triggerLabel(swap.primary.name, swap.secondary.name)}
          aria-describedby={refusals.length ? refusalId : undefined}
          aria-disabled={refusals.length ? true : undefined}
          disabled={disabled}
          onClick={() => {
            if (!refusals.length) onToggle()
          }}
        >
          {t.trigger}
        </Button>
      )}
      {!undo && refusals.length > 0 && <p id={refusalId} className="field-msg">{refusals.join(' ')}</p>}
    </div>
  )
}
