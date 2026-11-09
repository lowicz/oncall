import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { AssignmentRole, RuleViolation, TeamMember, api } from '../api'
import { addDays, formatDate, formatDayShort, formatRange } from '../lib/dates'
import { useDutiesAfterExit } from '../hooks/useDutiesAfterExit'
import { roleLabels } from '../lib/labels'
import { inOrder } from '../lib/sequence'
import { locale, useMessages } from '../i18n'
import { Box, Button, Checkbox, Dialog, Field, ListRow, LoadingBlock, RoleMark, Select, useToast } from '../ui'

/**
 * Ending somebody's rotation: every duty after the exit date gets a
 * replacement picked here, then the eligibility periods are closed and the
 * member's active_until is set, in that order.
 *
 * One button, named after its effect, checks the batches of every affected
 * schedule together (so a rule spanning two schedules is seen as well) and
 * saves at once when nothing breaks; hard-rule violations are listed and
 * acknowledged before the same button saves the first batch.
 * A failure after some schedules were saved says how many duties are already
 * rewritten and returns to the check for the rest.
 */
export function OffboardingDialog({ open, member, activeUntil, onClose, onDone, onChanged }: {
  open: boolean
  member: TeamMember
  activeUntil: string
  onClose: () => void
  onDone: () => void
  /** Reloads `member` after a failure, since the steps before it are saved. */
  onChanged: () => void
}) {
  const m = useMessages()
  const t = m.people.offboarding
  const toast = useToast()
  const navigate = useNavigate()
  // The server refuses an exit before the entry only after the periods were
  // closed, so such a date stops the dialog before its first write.
  const exitBeforeEntry = activeUntil < member.active_from
  const { calendar, found, duties } = useDutiesAfterExit(member, activeUntil, open && !exitBeforeEntry)
  const [replacements, setReplacements] = useState<Record<string, string>>({})
  const [violations, setViolations] = useState<RuleViolation[]>([])
  const [acknowledged, setAcknowledged] = useState(false)
  const [rewritten, setRewritten] = useState(0)
  // Duties rewritten per replacement, across retries, for the closing toast.
  const tally = useRef(new Map<string, number>())
  // A check and acknowledgement cover the exact picks and duties they saw.
  const resetDecision = () => {
    setViolations([])
    setAcknowledged(false)
  }
  const key = (day: string, role: AssignmentRole) => `${day}:${role}`
  // A candidate's load is their duties between the first and the last duty
  // rewritten here: every option shows it, and the least loaded come first.
  const span = duties.map((item) => item.service_date).sort((a, b) => a.localeCompare(b))
  const first = span[0]
  const last = span[span.length - 1]
  const load = new Map<string, number>()
  for (const duty of found.assignments) {
    if (duty.member_id && duty.service_date >= first && duty.service_date <= last) load.set(duty.member_id, (load.get(duty.member_id) ?? 0) + 1)
  }
  const byLoad = (left: { id: string; display_name: string }, right: { id: string; display_name: string }) =>
    (load.get(left.id) ?? 0) - (load.get(right.id) ?? 0) || left.display_name.localeCompare(right.display_name, locale())
  const candidates = (day: string, role: AssignmentRole) => found.members.filter((candidate) => candidate.id !== member.id
    && candidate.eligibility?.some((period) => period.role === role && period.starts_on <= day && (!period.ends_on || period.ends_on >= day))
    && !found.availability.some((entry) => entry.member_id === candidate.id && entry.kind === 'unavailable' && entry.starts_on <= day && entry.ends_on >= day))
    .sort(byLoad)
  // "The same replacement for all" offers anyone who can take at least one
  // duty and fills only the duties they can take; the rest keep their pick.
  const everyCandidate = [...new Map(duties.flatMap((item) => candidates(item.service_date, item.role)).map((candidate) => [candidate.id, candidate])).values()].sort(byLoad)
  const picks = duties.map((item) => replacements[key(item.service_date, item.role)])
  const sameForAll = picks.every((pick) => pick === picks[0]) ? picks[0] ?? '' : ''
  const optionLabel = (candidate: { id: string; display_name: string }) => t.candidate(candidate.display_name, load.get(candidate.id) ?? 0)
  const pick = (next: Record<string, string>) => {
    setReplacements((current) => ({ ...current, ...next }))
    resetDecision()
    check.reset()
    submit.reset()
  }
  const pickForAll = (id: string) => pick(Object.fromEntries(duties
    .filter((item) => candidates(item.service_date, item.role).some((candidate) => candidate.id === id))
    .map((item) => [key(item.service_date, item.role), id])))
  const groupedDuties = () => duties.reduce((result, item) => {
    result.set(item.schedule_id, [...(result.get(item.schedule_id) ?? []), item])
    return result
  }, new Map<string, typeof duties>())
  const assignmentsFor = (group: typeof duties) => group.map((item) => ({
    service_date: item.service_date,
    role: item.role,
    replacement_member_id: replacements[key(item.service_date, item.role)],
  }))
  const check = useMutation({
    mutationFn: async () => {
      const batches = [...groupedDuties()].map(([scheduleId, group]) => ({
        schedule_id: scheduleId,
        assignments: assignmentsFor(group),
      }))
      return batches.length > 0 ? (await api.batchOverrideCheck({ batches })).violations : []
    },
    onSuccess: (result) => {
      setViolations(result)
      setAcknowledged(false)
    },
  })
  const submit = useMutation({
    mutationFn: async () => {
      await inOrder(groupedDuties(), async ([scheduleId, group]) => {
        await api.batchOverride({
          schedule_id: scheduleId,
          expected_version: group[0].schedule_version,
          assignments: assignmentsFor(group),
          reason: t.reason(member.display_name),
          acknowledge_rule_violations: violations.length > 0 && acknowledged,
        })
        setRewritten((count) => count + group.length)
        for (const item of group) {
          const id = replacements[key(item.service_date, item.role)]
          tally.current.set(id, (tally.current.get(id) ?? 0) + 1)
        }
      })
      await inOrder(member.eligibility, async (period) => {
        if (period.starts_on > activeUntil) await api.deleteEligibility(period.id)
        else if (!period.ends_on || period.ends_on > activeUntil) {
          await api.updateEligibility({ id: period.id, input: { ends_on: activeUntil } })
        }
      })
      return api.updateTeamMember({ id: member.id, input: { active_until: activeUntil } })
    },
    onSuccess: () => {
      const counts = [...tally.current]
      const total = counts.reduce((sum, [, count]) => sum + count, 0)
      // Every replacement was picked from `found.members`.
      const names = counts.map(([id, count]) => `${found.members.find((item) => item.id === id)!.display_name} ×${count}`).join(', ')
      toast.success(t.ended(member.display_name, total), {
        description: total > 0 ? t.endedReplacements(names) : undefined,
        action: { label: t.openSchedule, onClick: () => navigate(`/grafik?od=${addDays(activeUntil, 1)}`) },
      })
      onDone()
    },
    onError: async () => {
      // Steps saved before the failure stay saved: reload so a retry checks
      // and sends only the duties and periods this person still holds.
      resetDecision()
      onChanged()
      await calendar.refetch()
    },
  })
  const complete = duties.every((item) => replacements[key(item.service_date, item.role)])
  const busy = check.isPending || submit.isPending

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!busy}
      size="lg"
      title={t.title(member.display_name)}
      description={exitBeforeEntry ? undefined : t.description(formatDate(activeUntil), duties.length)}
      actions={(
        <>
          <Button onClick={onClose} disabled={busy}>{m.common.cancel}</Button>
          <Button
            variant="danger"
            disabled={exitBeforeEntry || calendar.isLoading || !complete || busy || (violations.length > 0 && !acknowledged)}
            loading={busy}
            onClick={() => (violations.length > 0
              ? submit.mutate()
              : check.mutate(undefined, { onSuccess: (breaks) => { if (breaks.length === 0) submit.mutate() } }))}
          >
            {t.rewriteAndEnd(duties.length)}
          </Button>
        </>
      )}
    >
      {exitBeforeEntry && <Box tone="bad" role="alert" title={t.exitBeforeEntry(formatDate(activeUntil), formatDate(member.active_from))} />}
      {calendar.isLoading && <LoadingBlock label={t.searchingDuties} rows={2} />}
      {calendar.error && <Box tone="bad" role="alert" title={calendar.error.message} />}
      {check.error && <Box tone="bad" role="alert" title={check.error.message} />}
      {submit.error && <Box tone="bad" role="alert" title={submit.error.message} />}
      {rewritten > 0 && !submit.isPending && <Box tone="warn" role="status" title={t.alreadyRewritten(rewritten)} />}
      {violations.length > 0 && (
        <Box tone="warn" role="status" title={t.refusalTitle}>
          <ul className="box-list">
            {violations.map((violation, index) => (
              <li key={index}>
                {violation.message} ({violation.member_name}: {violation.days.map(formatDate).join(', ')})
              </li>
            ))}
          </ul>
          <div className="box-next">{t.refusalNext}</div>
          <Checkbox
            label={t.acknowledge}
            checked={acknowledged}
            disabled={busy}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
        </Box>
      )}
      {calendar.data && duties.length === 0 && <p className="muted">{t.noDuties}</p>}
      {duties.length > 1 && (
        <Field id="offboarding-all" label={t.sameForAll} hint={t.sameForAllHint(formatRange(first, last))}>
          {({ id, describedBy }) => (
            <Select id={id} value={sameForAll} aria-describedby={describedBy} onChange={(event) => pickForAll(event.target.value)}>
              <option value="" disabled>{t.pickReplacement}</option>
              {everyCandidate.map((candidate) => <option key={candidate.id} value={candidate.id}>{optionLabel(candidate)}</option>)}
            </Select>
          )}
        </Field>
      )}
      {duties.map((item) => {
        const id = `offboarding-${item.service_date}-${item.role}`
        return (
          <ListRow
            key={key(item.service_date, item.role)}
            aside={(
              <Select
                id={id}
                className="offboarding-pick"
                value={replacements[key(item.service_date, item.role)] ?? ''}
                onChange={(event) => pick({ [key(item.service_date, item.role)]: event.target.value })}
              >
                <option value="">{t.pickReplacement}</option>
                {candidates(item.service_date, item.role).map((candidate) => <option key={candidate.id} value={candidate.id}>{optionLabel(candidate)}</option>)}
              </Select>
            )}
          >
            <label htmlFor={id} className="row"><RoleMark role={item.role} size="sm" /> <b>{formatDayShort(item.service_date)} · {roleLabels()[item.role]}</b></label>
          </ListRow>
        )
      })}
      {duties.length > 0 && <p className="muted small">{t.notice(t.reason(member.display_name))}</p>}
    </Dialog>
  )
}
