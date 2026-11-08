import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, AssignmentRole, CalendarData, api } from '../api'
import { useUndoable } from './useUndoable'
import { messages, useMessages } from '../i18n'
import { StaffChange, StaffingCandidate, lateShiftLink, slotOf, staffChanges, staffingCandidates } from '../lib/calendar'
import { formatShortDate, warsawDate } from '../lib/dates'
import { availabilityLabels, roleLabels } from '../lib/labels'
import { Button, Checkbox, Field, Fieldset, Input, Select, useToast } from '../ui'
import { DecisionFrame } from '../components/DecisionFrame'
import { StaffChangeImpact, StaffChangePreview } from '../components/StaffChangePreview'

type OnCall = 'primary' | 'secondary'

const MIN_REASON_LENGTH = 10
const FORM_ID = 'staff-change-form'

/** The roles in the order a day reads them, PRIMARY or SECONDARY first. */
function rolesOf(onCall: OnCall | null, late: boolean): AssignmentRole[] {
  return [...(onCall ? [onCall] : []), ...(late ? ['late_shift' as const] : [])]
}

function labels(roles: AssignmentRole[]) {
  return roles.map((role) => roleLabels()[role])
}

/** What the hint under the person picker says about the chosen person: the
 *  roles they may hold that day and what they reported for it. */
function candidateHint(candidate: StaffingCandidate, serviceDate: string) {
  const t = messages().schedule.inspector.candidate
  const date = formatShortDate(serviceDate)
  return [
    candidate.roles && t.roles(candidate.display_name, labels(candidate.roles).join(', ')),
    candidate.availability ? t.reported(date, availabilityLabels()[candidate.availability]) : t.notReported(date),
  ].filter(Boolean).join(' ')
}

/**
 * The staffing change of one published day in the inspector (P7): the roles
 * to change as one group, PRIMARY and SECONDARY excluding each other and 11–19
 * ticked by default exactly where the API would carry it; one person for all
 * of them; the slots, the rules and the balance in the panel; one correction
 * saved without a dialog and offered back in the toast.
 *
 * The inspector places the parts: `form` under the role rows and `footer` as
 * the panel's actions while the form is open.
 */
export function useStaffChange({ data, serviceDate, coordinates, onSaved, onOpenDay }: {
  data: CalendarData | undefined
  serviceDate: string | undefined
  coordinates: boolean
  /** The change is saved: the inspector closes. */
  onSaved: () => void
  /** The toast of a change Undo cannot take back opens the day again. */
  onOpenDay: (role: AssignmentRole) => void
}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const undoable = useUndoable()
  const { schedule, common } = useMessages()
  const t = schedule.staffChange
  // The day as the latest payload has it: it may leave the publication while
  // the form is open.
  const day = data?.days.find((item) => item.service_date === serviceDate)
  const policy = useQuery({ queryKey: ['swap-policy'], queryFn: api.swapPolicy, enabled: coordinates && Boolean(day?.published) })
  const link = data && serviceDate && policy.data ? lateShiftLink(data, serviceDate, policy.data.late_shift_anchor) : null

  const [open, setOpen] = useState(false)
  const [onCall, setOnCall] = useState<OnCall | null>(null)
  /** The coordinator's own choice about 11–19; null follows the policy. */
  const [lateChoice, setLateChoice] = useState<boolean | null>(null)
  const [memberId, setMemberId] = useState<string | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [reason, setReason] = useState('')

  // 11–19 goes along by default exactly where the API would carry it: with
  // its anchor role, from the person holding both.
  const late = lateChoice ?? Boolean(link?.coupled && link.anchor === onCall)
  const roles = rolesOf(onCall, late)
  const candidates = open && data && serviceDate && roles.length > 0 ? staffingCandidates(data, serviceDate, roles) : []
  const chosen = candidates.find((item) => item.id === memberId)
  const ref = data?.assignments.find((item) => item.service_date === serviceDate)
  const changes: StaffChange[] = data && serviceDate ? staffChanges(data, serviceDate, roles) : []
  const lines = chosen && serviceDate
    ? roles.map((role) => ({ service_date: serviceDate, role, replacement_member_id: chosen.id }))
    : []
  const ready = Boolean(ref && chosen && !chosen.disabledReason && !chosen.partial)
  const historical = Boolean(serviceDate && serviceDate < warsawDate())

  const check = useQuery({
    queryKey: ['staff-change-check', ref?.schedule_id, ref?.schedule_version, lines],
    queryFn: () => api.batchOverrideCheck({ batches: [{ schedule_id: ref!.schedule_id, assignments: lines }] }),
    enabled: open && ready,
  })
  const violations = check.data?.violations
  // An acknowledgement covers the violations it was given for.
  useEffect(() => setAcknowledged(false), [check.data])

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['calendar'] })
    queryClient.invalidateQueries({ queryKey: ['published-schedule'] })
  }
  const close = () => {
    setOpen(false)
    save.reset()
  }
  /** Opens the form on the clicked role; a day off has no 11–19 to open on. */
  const openFor = (role: AssignmentRole) => {
    const safe: AssignmentRole = role === 'late_shift' && day?.is_day_off ? 'primary' : role
    setOnCall(safe === 'late_shift' ? null : safe)
    setLateChoice(safe === 'late_shift' ? true : null)
    setMemberId(null)
    setReason('')
    save.reset()
    setOpen(true)
  }

  const save = useMutation({
    mutationFn: async ({ scheduleId, version }: { scheduleId: string; version: number }) => {
      const date = formatShortDate(serviceDate!)
      const name = chosen!.display_name
      const given = historical ? reason.trim() : undefined
      const acknowledge = (violations?.length ?? 0) > 0 && acknowledged
      const people = new Set([...changes.flatMap((item) => (item.from ? [item.from] : [])), name]).size
      const [first] = changes
      const title = changes.length > 1
        ? schedule.toast.changedRoles(date, name, t.roleList(labels(roles)))
        : first.from
          ? schedule.toast.changed(date, roleLabels()[first.role], first.from, name)
          : schedule.toast.filled(roleLabels()[first.role], date, name)
      const audited = acknowledge ? schedule.toast.violationAudited : ''
      const execute = () => api.batchOverride({
        schedule_id: scheduleId,
        expected_version: version,
        kind: 'multi_role',
        assignments: lines,
        reason: given,
        acknowledge_rule_violations: acknowledge,
      })
      // Undo hands each slot back to its holder; an empty slot, or a holder
      // who could not take it back, leaves nothing to undo it with.
      if (changes.some((item) => !item.restoreTo)) {
        const result = await execute()
        const emails = people === 1
          ? schedule.toast.emailOne(name)
          : people === 2 ? schedule.toast.emailBoth : schedule.toast.emailMany(people)
        toast.success(title, {
          description: [emails, audited].filter(Boolean).join(' '),
          action: { label: schedule.toast.openDay, onClick: () => onOpenDay(first.role) },
        })
        return result
      }
      return undoable({
        execute,
        undo: async () => {
          await api.batchOverride({
            schedule_id: scheduleId,
            expected_version: version + 1,
            kind: 'multi_role',
            assignments: changes.map((item) => ({ service_date: serviceDate!, role: item.role, replacement_member_id: item.restoreTo! })),
            reason: given,
            acknowledge_rule_violations: true,
          })
          refresh()
        },
        message: () => ({
          title,
          description: [schedule.toast.emailsLater(people), audited].filter(Boolean).join(' '),
          expired: common.undoEmailsSent,
        }),
      })
    },
    onSuccess: () => {
      close()
      refresh()
      onSaved()
    },
    onError: (error) => {
      // The roster moved and the change now breaks a rule the frame did not
      // show: check again so the rules and their consent appear.
      if (error instanceof ApiError && error.violations.length > 0) {
        queryClient.invalidateQueries({ queryKey: ['staff-change-check'] })
      }
    },
  })

  const blocked = !ready
    || check.isLoading
    || ((violations?.length ?? 0) > 0 && !acknowledged)
    || (historical && reason.trim().length < MIN_REASON_LENGTH)

  const lateSlot = data && serviceDate ? slotOf(data, serviceDate, 'late_shift') : undefined
  const anchorLabel = link && roleLabels()[link.anchor]
  let lateNote = t.unstaffed
  if (link?.coupled) lateNote = t.withAnchor(anchorLabel!)
  else if (lateSlot) lateNote = t.heldBy(lateSlot.assignee_name)
  // Why 11–19 is ticked or not, said only while its anchor role is changed.
  let lateHint: string | undefined
  if (link && onCall === link.anchor) {
    if (late) lateHint = link.coupled ? t.lateByPolicy(link.holder, anchorLabel!) : t.lateByYou(anchorLabel!, link.anchorHolder)
    else if (link.coupled) lateHint = t.lateStays(link.holder)
  }
  const other: OnCall | null = onCall && (onCall === 'primary' ? 'secondary' : 'primary')
  const groupHint = [other && t.excluded(roleLabels()[other]), lateHint].filter(Boolean).join(' ') || undefined

  let personError: string | undefined
  if (chosen?.partial) {
    const { notEligible, holds } = chosen.partial
    personError = notEligible.length > 0
      ? t.notEligible(chosen.display_name, t.roleList(labels(notEligible)))
      : t.holds(chosen.display_name, t.roleList(labels(holds)))
  }
  const staffBlock = schedule.staffBlock
  let personHint = staffBlock.pickPerson(roles.length)
  if (chosen?.disabledReason) personHint = staffBlock.chosenPerson(chosen.disabledReason)
  else if (chosen && serviceDate) personHint = candidateHint(chosen, serviceDate)
  const optionText = (candidate: StaffingCandidate) => {
    if (candidate.disabledReason) return `${candidate.display_name} · ${candidate.disabledReason}`
    if (candidate.partial) {
      const { notEligible, holds } = candidate.partial
      const takes = roles.filter((role) => !notEligible.includes(role) && !holds.includes(role))
      return notEligible.length > 0
        ? t.optionOnly(candidate.display_name, labels(takes), labels(notEligible))
        : t.optionHolds(candidate.display_name, labels(holds))
    }
    return roles.length > 1 ? t.option(candidate.display_name, labels(roles)) : candidate.display_name
  }
  const pending = save.isPending

  const onCallCheck = (role: OnCall) => (
    <Checkbox
      className="role-check"
      label={roleLabels()[role]}
      checked={onCall === role}
      blocked={other === role}
      disabled={pending}
      onChange={() => setOnCall(onCall === role ? null : role)}
    />
  )

  // A day that drops out of the publication while the form is open has
  // nothing left to correct; the inspector says why.
  const form = open && day?.published && serviceDate && (
    <section id={FORM_ID} className="swap-frame" aria-labelledby={`${FORM_ID}-title`}>
      <h3 id={`${FORM_ID}-title`} className="swap-frame-h">{t.title}</h3>
      <Fieldset legend={t.roles} hint={groupHint} error={roles.length === 0 ? t.pickRole : undefined}>
        <div className="role-checks">
          {onCallCheck('primary')}
          {onCallCheck('secondary')}
          {!day.is_day_off && (
            <Checkbox
              className="role-check"
              label={<>{roleLabels().late_shift} <small>· {lateNote}</small></>}
              checked={late}
              disabled={pending}
              onChange={() => setLateChoice(!late)}
            />
          )}
        </div>
      </Fieldset>
      {roles.length > 0 && (
        <Field label={t.person(t.roleList(labels(roles)))} id="calendar-override-member" hint={personHint} error={personError}>
          {({ id, describedBy, invalid }) => (
            <Select
              id={id}
              name={id}
              value={memberId ?? ''}
              aria-describedby={describedBy}
              invalid={invalid}
              disabled={pending}
              onChange={(event) => setMemberId(event.target.value || null)}
            >
              <option value="">{schedule.inspector.pickPerson}</option>
              {candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id} disabled={Boolean(candidate.disabledReason)}>
                  {optionText(candidate)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      {ready && (
        <DecisionFrame
          violations={violations}
          checkFailed={check.isError}
          violationsTitle={schedule.confirm.breaksRules}
          clean={roles.length > 1 ? t.clean : undefined}
          endsHandover={check.data?.ends_handover}
          acknowledged={acknowledged}
          onAcknowledge={setAcknowledged}
          error={save.error?.message}
          pending={pending}
        >
          <StaffChangePreview changes={changes} name={chosen!.display_name} onCall={onCall} link={link} />
          <StaffChangeImpact scheduleId={ref!.schedule_id} lines={lines} changes={changes} name={chosen!.display_name} />
          {historical && (
            <Field label={t.reason} id="staff-change-reason">
              {({ id }) => (
                <Input
                  id={id}
                  name={id}
                  value={reason}
                  minLength={MIN_REASON_LENGTH}
                  disabled={pending}
                  onChange={(event) => setReason(event.target.value)}
                />
              )}
            </Field>
          )}
        </DecisionFrame>
      )}
    </section>
  )

  const footer = form && (
    <>
      <Button variant="ghost" disabled={pending} onClick={close}>{common.cancel}</Button>
      <span className="sp" />
      {/* Focusable while blocked, so the form above says what is missing. */}
      <Button
        variant="primary"
        loading={pending}
        aria-disabled={blocked || undefined}
        onClick={() => {
          if (!blocked) save.mutate({ scheduleId: ref!.schedule_id, version: ref!.schedule_version })
        }}
      >
        {roles.length > 1 ? t.saveRoles(roles.length) : schedule.confirm.save}
      </Button>
    </>
  )

  /** Whether a role row is part of the open change, lit while it is open. */
  const covers = (role: AssignmentRole) => roles.includes(role)

  return { form, footer, open: Boolean(form), covers, openFor, close, pending, link, controls: FORM_ID }
}
