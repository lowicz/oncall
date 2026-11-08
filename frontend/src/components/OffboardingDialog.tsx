import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AssignmentRole, RuleViolation, TeamMember, api } from '../api'
import { addDays, formatDate } from '../lib/dates'
import { roleLabels } from '../lib/labels'
import { locale, useMessages } from '../i18n'
import { Box, Button, Checkbox, Dialog, Field, LoadingBlock, RoleMark, Select, useToast } from '../ui'

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
  const ranges = useMemo(() => {
    const start = new Date(`${activeUntil}T12:00:00`)
    if (Number.isNaN(start.getTime())) return []
    start.setDate(start.getDate() + 1)
    return Array.from({ length: 5 }, (_, index) => {
      const from = new Date(start)
      from.setDate(from.getDate() + index * 90)
      const to = new Date(from)
      to.setDate(to.getDate() + 89)
      return [from.toISOString().slice(0, 10), to.toISOString().slice(0, 10)] as const
    })
  }, [activeUntil])
  const calendar = useQuery({
    queryKey: ['offboarding', member.id, activeUntil],
    queryFn: async () => {
      const pages = await Promise.all(ranges.map(([from, to]) => api.calendar(from, to)))
      return {
        assignments: pages.flatMap((page) => page.assignments),
        members: pages[0]?.members ?? [],
        availability: pages.flatMap((page) => page.availability),
      }
    },
    enabled: open && Boolean(activeUntil),
  })
  const found = calendar.data ?? { assignments: [], members: [], availability: [] }
  const duties = found.assignments.filter((item) => item.member_id === member.id && item.service_date > activeUntil)
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
  const candidates = (day: string, role: AssignmentRole) => {
    const roleLoad = new Map<string, number>()
    for (const duty of found.assignments) {
      if (duty.role === role && duty.member_id) roleLoad.set(duty.member_id, (roleLoad.get(duty.member_id) ?? 0) + 1)
    }
    return found.members.filter((candidate) => candidate.id !== member.id
      && candidate.eligibility?.some((period) => period.role === role && period.starts_on <= day && (!period.ends_on || period.ends_on >= day))
      && !found.availability.some((entry) => entry.member_id === candidate.id && entry.kind === 'unavailable' && entry.starts_on <= day && entry.ends_on >= day))
      .sort((left, right) => (roleLoad.get(left.id) ?? 0) - (roleLoad.get(right.id) ?? 0) || left.display_name.localeCompare(right.display_name, locale()))
  }
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
      return batches.length > 0 ? api.batchOverrideCheck({ batches }) : []
    },
    onSuccess: (result) => {
      setViolations(result)
      setAcknowledged(false)
    },
  })
  const submit = useMutation({
    mutationFn: async () => {
      for (const [scheduleId, group] of groupedDuties()) {
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
      }
      for (const period of member.eligibility) {
        if (period.starts_on > activeUntil) await api.deleteEligibility(period.id)
        else if (!period.ends_on || period.ends_on > activeUntil) {
          await api.updateEligibility({ id: period.id, input: { ends_on: activeUntil } })
        }
      }
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
      description={t.description(formatDate(activeUntil), duties.length)}
      actions={(
        <>
          <Button onClick={onClose} disabled={busy}>{m.common.cancel}</Button>
          <Button
            variant="danger"
            disabled={calendar.isLoading || !complete || busy || (violations.length > 0 && !acknowledged)}
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
      {duties.map((item) => (
        <Field
          key={key(item.service_date, item.role)}
          id={`offboarding-${item.service_date}-${item.role}`}
          label={<span className="row"><RoleMark role={item.role} size="sm" /> {formatDate(item.service_date)} · {roleLabels()[item.role]}</span>}
        >
          {({ id }) => (
            <Select
              id={id}
              value={replacements[key(item.service_date, item.role)] ?? ''}
              onChange={(event) => {
                setReplacements((current) => ({ ...current, [key(item.service_date, item.role)]: event.target.value }))
                resetDecision()
                check.reset()
                submit.reset()
              }}
            >
              <option value="">{t.pickReplacement}</option>
              {candidates(item.service_date, item.role).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.display_name}</option>)}
            </Select>
          )}
        </Field>
      ))}
    </Dialog>
  )
}
