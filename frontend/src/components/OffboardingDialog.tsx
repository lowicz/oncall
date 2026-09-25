import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ApiError, AssignmentRole, RuleViolation, TeamMember, api } from '../api'
import { formatDate } from '../lib/dates'
import { roleLabels } from '../lib/labels'
import { locale, useMessages } from '../i18n'
import { Box, Button, Checkbox, Dialog, Field, LoadingBlock, RoleMark, Select } from '../ui'

/**
 * Ending somebody's rotation: every duty after the exit date gets a
 * replacement picked here, then the eligibility periods are closed and the
 * member's active_until is set, in that order.
 *
 * A rewrite that breaks a hard rule is refused by the API until it is
 * acknowledged. The refusal lists the violations for that one schedule; the
 * coordinator acknowledges them and confirms again, which resends only what
 * is still left to rewrite.
 */
export function OffboardingDialog({ open, member, activeUntil, onClose, onDone }: {
  open: boolean
  member: TeamMember
  activeUntil: string
  onClose: () => void
  onDone: () => void
}) {
  const m = useMessages()
  const t = m.people.offboarding
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
  const duties = (calendar.data?.assignments ?? []).filter((item) => item.member_id === member.id && item.service_date > activeUntil)
  const [replacements, setReplacements] = useState<Record<string, string>>({})
  const [confirming, setConfirming] = useState(false)
  const [refusal, setRefusal] = useState<{ scheduleId: string; violations: RuleViolation[] } | null>(null)
  const [acknowledged, setAcknowledged] = useState<string[]>([])
  const key = (day: string, role: AssignmentRole) => `${day}:${role}`
  const candidates = (day: string, role: AssignmentRole) => {
    const roleLoad = new Map<string, number>()
    for (const duty of calendar.data?.assignments ?? []) {
      if (duty.role === role && duty.member_id) roleLoad.set(duty.member_id, (roleLoad.get(duty.member_id) ?? 0) + 1)
    }
    return (calendar.data?.members ?? []).filter((candidate) => candidate.id !== member.id
      && candidate.eligibility?.some((period) => period.role === role && period.starts_on <= day && (!period.ends_on || period.ends_on >= day))
      && !(calendar.data?.availability ?? []).some((entry) => entry.member_id === candidate.id && entry.kind === 'unavailable' && entry.starts_on <= day && entry.ends_on >= day))
      .sort((left, right) => (roleLoad.get(left.id) ?? 0) - (roleLoad.get(right.id) ?? 0) || left.display_name.localeCompare(right.display_name, locale()))
  }
  const submit = useMutation({
    mutationFn: async () => {
      const groups = duties.reduce((result, item) => {
        result.set(item.schedule_id, [...(result.get(item.schedule_id) ?? []), item])
        return result
      }, new Map<string, typeof duties>())
      for (const [scheduleId, group] of groups) {
        try {
          await api.batchOverride({
            schedule_id: scheduleId,
            expected_version: group[0].schedule_version,
            assignments: group.map((item) => ({
              service_date: item.service_date,
              role: item.role,
              replacement_member_id: replacements[key(item.service_date, item.role)],
            })),
            reason: t.reason(member.display_name),
            acknowledge_rule_violations: acknowledged.includes(scheduleId),
          })
        } catch (error) {
          if (error instanceof ApiError && error.violations.length > 0) {
            setRefusal({ scheduleId, violations: error.violations })
            // Schedules rewritten before this one are already saved: reload
            // so the retry sends only the duties this person still holds.
            await calendar.refetch()
          }
          throw error
        }
      }
      setRefusal(null)
      for (const period of member.eligibility) {
        if (period.starts_on > activeUntil) await api.deleteEligibility(period.id)
        else if (!period.ends_on || period.ends_on > activeUntil) {
          await api.updateEligibility({ id: period.id, input: { ends_on: activeUntil } })
        }
      }
      return api.updateTeamMember({ id: member.id, input: { active_until: activeUntil } })
    },
    onSuccess: onDone,
  })
  const complete = duties.every((item) => replacements[key(item.service_date, item.role)])
  const refusalAcknowledged = refusal !== null && acknowledged.includes(refusal.scheduleId)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => { if (!next) onClose() }}
      dismissible={!submit.isPending}
      size="lg"
      title={t.title(member.display_name)}
      description={t.description(formatDate(activeUntil), duties.length)}
      actions={(
        <>
          <Button onClick={onClose} disabled={submit.isPending}>{m.common.cancel}</Button>
          <Button
            variant={confirming ? 'danger' : 'primary'}
            disabled={calendar.isLoading || !complete || submit.isPending || (refusal !== null && !refusalAcknowledged)}
            loading={submit.isPending}
            onClick={() => (confirming ? submit.mutate() : setConfirming(true))}
          >
            {confirming ? t.confirmEnd : t.rewriteAndEnd}
          </Button>
        </>
      )}
    >
      {calendar.isLoading && <LoadingBlock label={t.searchingDuties} rows={2} />}
      {calendar.error && <Box tone="bad" role="alert" title={calendar.error.message} />}
      {submit.error && !refusal && <Box tone="bad" role="alert" title={submit.error.message} />}
      {refusal && (
        <Box tone="warn" role="alert" title={t.refusalTitle}>
          <ul className="box-list">
            {refusal.violations.map((violation, index) => (
              <li key={index}>
                {violation.message} ({violation.member_name}: {violation.days.map(formatDate).join(', ')})
              </li>
            ))}
          </ul>
          <div className="box-next">{t.refusalNext}</div>
          <Checkbox
            label={t.acknowledge}
            checked={refusalAcknowledged}
            disabled={submit.isPending}
            onChange={(event) => {
              const scheduleId = refusal.scheduleId
              setAcknowledged((current) => event.target.checked
                ? [...current, scheduleId]
                : current.filter((item) => item !== scheduleId))
            }}
          />
        </Box>
      )}
      {confirming && (
        <Box tone="warn" title={t.confirmText(duties.length, formatDate(activeUntil))} />
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
                // An acknowledgement covers the violations it was given for,
                // not whatever a different pick would break.
                setRefusal(null)
                setAcknowledged([])
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
