import { useQuery } from '@tanstack/react-query'
import { DraftSchedule, PublishPreview, UnavailabilityConflict } from '../api'
import { useMessages } from '../i18n'
import { roleLabels } from '../lib/labels'
import { formatDayShort } from '../lib/dates'
import { formatDecimal } from '../lib/numbers'
import { draftFairnessImpactQuery } from '../lib/fairness'
import { Button, Disclosure, StatusBadge } from '../ui'
import { problemCounts } from './DraftProblems'
import { shortfallCause, worstSpread } from './DraftFairnessPanel'

/** CP-SAT statuses that mean the model was actually solved. */
export const SOLVER_OK = new Set(['OPTIMAL', 'FEASIBLE'])

/**
 * The one panel above the draft matrix: the verdict (hard rules, the fairness
 * criterion), why, and the one action that moves the draft on. What the
 * publication will change is said here, before the publication sheet opens,
 * so the sheet itself holds only decisions and consents.
 */
export function DraftDecision({ result, preview, busy, onFix, onPropose, onPublish, onWithdraw }: Readonly<{
  result: DraftSchedule
  /** What publishing the proposal changes; only a proposal has one. */
  preview?: PublishPreview
  busy: boolean
  /** Opens the first conflict the draft has to lose. */
  onFix: (conflict: UnavailabilityConflict) => void
  onPropose: () => void
  onPublish: () => void
  onWithdraw: () => void
}>) {
  const t = useMessages().generator.decision
  const impact = useQuery(draftFairnessImpactQuery(result))
  const counts = problemCounts(result)
  const conflicts = result.unavailability_conflicts ?? []
  const solved = SOLVER_OK.has(result.solver_status)
  const cause = impact.data ? shortfallCause(impact.data) : null
  const spread = impact.data ? worstSpread(impact.data) : null
  const criterion = impact.data ? formatDecimal(impact.data.criterion_points) : ''
  const editable = result.status === 'draft'

  let why = <>{t.ready[result.status]}</>
  if (conflicts.length > 0) {
    why = (
      <>
        {editable ? t.blockingPropose : t.blockingPublish}{' '}
        {conflicts.map((item, index) => (
          <span key={`${item.service_date}:${item.role}`}>
            {index > 0 && ', '}
            <b>{item.assignee_name}</b> · {t.conflictItem(roleLabels()[item.role], formatDayShort(item.service_date))}
          </span>
        ))}
        .
      </>
    )
  } else if (!solved) {
    why = <>{t.solverIncomplete(result.solver_status)}</>
  } else if (counts.hard > 0) {
    why = <>{t.rulesBroken}</>
  }

  let action = null
  if (editable && conflicts.length > 0) {
    action = (
      <>
        <Button variant="primary" disabled={busy} onClick={() => onFix(conflicts[0])}>{t.fix(conflicts.length)}</Button>
        <span className="muted small">{t.thenPropose}</span>
      </>
    )
  } else if (editable) {
    action = (
      <>
        <Button variant="primary" icon="send" disabled={busy} onClick={onPropose}>{t.propose}</Button>
        <span className="muted small">{t.proposeHint}</span>
      </>
    )
  } else if (result.status === 'proposed' && conflicts.length > 0) {
    action = <Button variant="primary" disabled={busy} onClick={onWithdraw}>{t.backToDraft}</Button>
  } else if (result.status === 'proposed') {
    action = (
      <>
        <Button variant="primary" icon="send" disabled={busy} onClick={onPublish}>{t.publish(result.version)}</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onWithdraw}>{t.backToDraft}</Button>
      </>
    )
  }

  const effects = preview && [
    preview.carried_changes.length > 0 && t.effects.carried(preview.carried_changes.length),
    preview.pending_swaps.length > 0 && t.effects.cancelled(preview.pending_swaps.length),
    preview.stale_changes_count > 0 && t.effects.stale(preview.stale_changes_count),
    counts.soft > 0 && t.effects.audited(counts.soft),
  ].filter((item): item is string => Boolean(item))

  return (
    <section className="panel draft-decision" aria-label={t.label}>
      <div className="draft-decision-main">
        <div className="row">
          {counts.hard > 0
            ? <StatusBadge tone="bad">{t.hardViolations(counts.hard)}</StatusBadge>
            : <StatusBadge tone="ok">{t.hardClean}</StatusBadge>}
          {!solved && <StatusBadge tone="bad">{t.incomplete}</StatusBadge>}
          {cause === 'met' && <StatusBadge tone="ok">{t.criterionMet(criterion)}</StatusBadge>}
          {cause === 'inherited' && <StatusBadge tone="warn">{t.criterionInherited(criterion)}</StatusBadge>}
          {cause === 'draft' && <StatusBadge tone="warn">{t.criterionMissed(criterion)}</StatusBadge>}
        </div>
        <div>{why}</div>
        {spread && cause && (
          <div className="muted small">{t.spread[cause](formatDecimal(spread.before), formatDecimal(spread.after))}</div>
        )}
        {effects && (
          <div className="draft-decision-effects">
            <b>{t.effects.title}</b>
            <ul className="inline-list">
              {effects.map((item) => <li key={item}>{item}</li>)}
              <li>{t.effects.earlierSchedule}</li>
            </ul>
            {(preview.carried_changes.length > 0 || preview.pending_swaps.length > 0) && (
              <Disclosure title={t.effects.details}>
                <ul className="box-list">
                  {preview.carried_changes.map((change) => (
                    <li key={`carried-${change.service_date}-${change.role}`}>{t.effects.carriedItem(formatDayShort(change.service_date), roleLabels()[change.role], change.previous_assignee_name)}</li>
                  ))}
                  {preview.pending_swaps.map((swap) => (
                    <li key={swap.id}>{t.effects.cancelledItem(formatDayShort(swap.service_date), roleLabels()[swap.role], swap.requester_name, swap.replacement_name)}</li>
                  ))}
                </ul>
              </Disclosure>
            )}
          </div>
        )}
      </div>
      {action && <div className="draft-decision-acts">{action}</div>}
    </section>
  )
}
