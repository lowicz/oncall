import { useQuery } from '@tanstack/react-query'
import { DraftSchedule, PublishPreview, UnavailabilityConflict } from '../api'
import { useMessages } from '../i18n'
import { roleLabels } from '../lib/labels'
import { formatDayShort } from '../lib/dates'
import { formatDecimal } from '../lib/numbers'
import { draftFairnessImpactQuery } from '../lib/fairness'
import { Box, Button, Disclosure, IconButton, Menu, MenuItem, StatusBadge } from '../ui'
import { problemCounts } from './DraftProblems'
import { shortfallCause, worstSpread } from './DraftFairnessPanel'

/** CP-SAT statuses that mean the model was actually solved. */
export const SOLVER_OK = new Set(['OPTIMAL', 'FEASIBLE'])

/**
 * The one panel above the draft matrix: the verdict (hard rules, the fairness
 * criterion), why, and the one action that moves the draft on. On a proposal
 * it also says what the publication will change, before the sheet opens.
 */
export function DraftDecision({ result, preview, busy, error, onFix, onPropose, onPublish, onWithdraw }: Readonly<{
  result: DraftSchedule
  /** What publishing the proposal changes; only a proposal has one. */
  preview?: PublishPreview
  busy: boolean
  /** Why the draft could not be readied for publication. */
  error?: string
  /** Opens the first conflict the draft has to lose. */
  onFix: (conflict: UnavailabilityConflict) => void
  /** Hands the draft over to a second person for approval. */
  onPropose: () => void
  /** Opens the publication sheet, from a draft or a proposal. */
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
        {t.blockingPublish}{' '}
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
        <span className="muted small">{t.thenPublish}</span>
      </>
    )
  } else if (editable) {
    action = (
      <>
        <Button variant="primary" icon="send" disabled={busy} onClick={onPublish}>{t.publishDraft}</Button>
        <Menu trigger={<IconButton icon="more" label={t.more} disabled={busy} />}>
          <MenuItem onClick={onPropose}>{t.propose}</MenuItem>
        </Menu>
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
        {error && <Box tone="bad" role="alert" title={error} />}
        {spread && cause && (
          <div className="muted small">{t.spread[cause](formatDecimal(spread.before), formatDecimal(spread.after))}</div>
        )}
        {preview && <PublicationEffects preview={preview} soft={counts.soft} />}
      </div>
      {action && <div className="draft-decision-acts">{action}</div>}
    </section>
  )
}

/**
 * What publishing changes beyond the draft itself: carried-over changes,
 * cancelled swaps, entries changed since generation and soft warnings going
 * to the audit. Shown on the proposal page and again in the publication sheet.
 */
export function PublicationEffects({ preview, soft }: Readonly<{ preview: PublishPreview; soft: number }>) {
  const t = useMessages().generator.decision.effects
  const effects = [
    preview.carried_changes.length > 0 && t.carried(preview.carried_changes.length),
    preview.pending_swaps.length > 0 && t.cancelled(preview.pending_swaps.length),
    preview.stale_changes_count > 0 && t.stale(preview.stale_changes_count),
    soft > 0 && t.audited(soft),
  ].filter((item): item is string => Boolean(item))
  return (
    <div className="draft-decision-effects">
      <b>{t.title}</b>
      <ul className="inline-list">
        {effects.map((item) => <li key={item}>{item}</li>)}
        <li>{t.earlierSchedule}</li>
      </ul>
      {(preview.carried_changes.length > 0 || preview.pending_swaps.length > 0) && (
        <Disclosure title={t.details}>
          <ul className="box-list">
            {preview.carried_changes.map((change) => (
              <li key={`carried-${change.service_date}-${change.role}`}>{t.carriedItem(formatDayShort(change.service_date), roleLabels()[change.role], change.previous_assignee_name)}</li>
            ))}
            {preview.pending_swaps.map((swap) => (
              <li key={swap.id}>{t.cancelledItem(formatDayShort(swap.service_date), roleLabels()[swap.role], swap.requester_name, swap.replacement_name)}</li>
            ))}
          </ul>
        </Disclosure>
      )}
    </div>
  )
}
