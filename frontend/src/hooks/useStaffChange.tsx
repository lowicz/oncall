import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, AssignmentRole, CalendarData, api } from '../api'
import { useUndoable } from './useUndoable'
import { messages, useMessages } from '../i18n'
import { LateShiftLink, OnCall, StaffChange, StaffingCandidate, correctionRoles, lateShiftLink, staffChanges, staffingCandidates } from '../lib/calendar'
import { correctionTiming } from '../lib/coverage'
import { formatShortDate } from '../lib/dates'
import { availabilityLabels, roleLabels } from '../lib/labels'
import { Button, Field, InlineError, Input, LoadingBlock, Select, useToast } from '../ui'
import { DecisionFrame } from '../components/DecisionFrame'
import { RolesFieldset, StaffChangeImpact, StaffChangePreview } from '../components/StaffChangePreview'

const MIN_REASON_LENGTH = 10
const FORM_ID = 'staff-change-form'

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

/** The change the form describes: its roles, who may take them, the person
 *  chosen, the slots they take over and the lines sent to the API. */
function selection({ data, serviceDate, link, onCall, lateChoice, memberId, open }: {
  data: CalendarData | undefined
  serviceDate: string | undefined
  link: LateShiftLink | null
  onCall: OnCall | null
  lateChoice: boolean | null
  memberId: string | null
  open: boolean
}) {
  const { late, roles } = correctionRoles(onCall, lateChoice, link)
  const candidates = open && data && serviceDate && roles.length > 0 ? staffingCandidates(data, serviceDate, roles) : []
  const chosen = candidates.find((item) => item.id === memberId)
  const ref = data?.assignments.find((item) => item.service_date === serviceDate)
  const changes: StaffChange[] = data && serviceDate ? staffChanges(data, serviceDate, roles) : []
  const lines = chosen && serviceDate
    ? roles.map((role) => ({ service_date: serviceDate, role, replacement_member_id: chosen.id }))
    : []
  const ready = Boolean(ref && chosen && !chosen.disabledReason && !chosen.partial)
  return { late, roles, candidates, chosen, ref, changes, lines, ready }
}

/** The toast title of a saved change: the roles it moved, or its one slot. */
function savedTitle(changes: StaffChange[], roles: AssignmentRole[], date: string, name: string) {
  const { toast, staffChange } = messages().schedule
  const [first] = changes
  if (changes.length > 1) return toast.changedRoles(date, name, staffChange.roleList(labels(roles)))
  if (first.from) return toast.changed(date, roleLabels()[first.role], first.from, name)
  return toast.filled(roleLabels()[first.role], date, name)
}

/** Who the e-mails of a saved change go to. */
function emailsTo(people: number, name: string) {
  const { toast } = messages().schedule
  if (people === 1) return toast.emailOne(name)
  if (people === 2) return toast.emailBoth
  return toast.emailMany(people)
}

/** What the person picker says about the chosen person: why they take only
 *  some of the roles, and the hint under it. */
function personTexts(chosen: StaffingCandidate | undefined, roles: AssignmentRole[], serviceDate: string | undefined) {
  const { staffChange: t, staffBlock } = messages().schedule
  let error: string | undefined
  if (chosen?.partial) {
    const { notEligible, holds } = chosen.partial
    error = notEligible.length > 0
      ? t.notEligible(chosen.display_name, t.roleList(labels(notEligible)))
      : t.holds(chosen.display_name, t.roleList(labels(holds)))
  }
  let hint = staffBlock.pickPerson(roles.length)
  if (chosen?.disabledReason) hint = staffBlock.chosenPerson(chosen.disabledReason)
  else if (chosen && serviceDate) hint = candidateHint(chosen, serviceDate)
  return { error, hint }
}

/** A candidate's line in the person picker, with the roles they cannot take. */
function optionText(candidate: StaffingCandidate, roles: AssignmentRole[]) {
  const t = messages().schedule.staffChange
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

  const { late, roles, candidates, chosen, ref, changes, lines, ready } = selection({ data, serviceDate, link, onCall, lateChoice, memberId, open })
  const { historical, silent } = correctionTiming(day, roles)

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
      const title = savedTitle(changes, roles, date, name)
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
        toast.success(title, {
          description: [silent ? schedule.toast.pastDayNoEmail : emailsTo(people, name), audited].filter(Boolean).join(' '),
          action: { label: schedule.toast.openDay, onClick: () => onOpenDay(changes[0].role) },
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
          description: [silent ? schedule.toast.pastDayNoEmail : schedule.toast.emailsLater(people), audited].filter(Boolean).join(' '),
          expired: silent ? undefined : common.undoEmailsSent,
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

  const { error: personError, hint: personHint } = personTexts(chosen, roles, serviceDate)
  const pending = save.isPending

  // A day that drops out of the publication while the form is open has
  // nothing left to correct; the inspector says why.
  // The 11–19 choices follow the policy's anchor, so they wait for it rather
  // than change under the cursor.
  const waiting = policy.isError ? <InlineError error={policy.error} /> : <LoadingBlock label={common.loading} rows={2} />
  const form = open && day?.published && serviceDate && (!policy.data ? waiting : (
    <section id={FORM_ID} className="swap-frame" aria-labelledby={`${FORM_ID}-title`}>
      <h3 id={`${FORM_ID}-title`} className="swap-frame-h">{t.title}</h3>
      <RolesFieldset
        data={data!}
        serviceDate={serviceDate}
        link={link}
        onCall={onCall}
        late={late}
        dayOff={day.is_day_off}
        disabled={pending}
        onOnCall={setOnCall}
        onLate={setLateChoice}
      />
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
                  {optionText(candidate, roles)}
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
            <Field label={t.reason} id="staff-change-reason" hint={silent ? schedule.toast.pastDayNoEmail : undefined}>
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
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
  ))

  const footer = form && policy.data && (
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
