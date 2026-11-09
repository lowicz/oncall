import { useCallback, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AssignmentRole, CalendarData, DraftSchedule, FairnessMember, LateShiftAnchor, api } from '../api'
import { messages, useMessages } from '../i18n'
import {
  OnCall,
  Roster,
  StaffChange,
  StaffingCandidate,
  correctionRoles,
  isCurrentAssignee,
  lateShiftLink,
  slotOf,
  staffChanges,
  staffingCandidates,
} from '../lib/calendar'
import { formatShortDate } from '../lib/dates'
import { draftFairnessImpactQuery, roundPoints } from '../lib/fairness'
import { roleLabels } from '../lib/labels'
import { signed } from '../lib/numbers'
import { useUndoable } from './useUndoable'
import { Box, Button, useToast } from '../ui'
import { problemCounts } from '../components/DraftProblems'
import { RolesFieldset, StaffChangePreview } from '../components/StaffChangePreview'

type Member = CalendarData['members'][number]
type Day = CalendarData['days'][number]
/** The roles ticked in the panel: an on-call role, and the coordinator's own
 *  choice about 11–19 (null follows the policy). */
interface RolesPick { onCall: OnCall | null; lateChoice: boolean | null }

/** The roles a cell opens on: every role it shows, 11–19 alone included. */
function pickFor(roles: AssignmentRole[]): RolesPick {
  return {
    onCall: roles.find((role): role is OnCall => role !== 'late_shift') ?? null,
    lateChoice: roles.includes('late_shift') ? true : null,
  }
}

/** What stops `member` taking `roles` of the day, said under the roles: the
 *  roles they cannot take of several, that they hold them all already, or why
 *  they take none. Nothing when their availability already says why. */
function memberError(
  candidate: StaffingCandidate | undefined,
  roster: Roster,
  serviceDate: string,
  roles: AssignmentRole[],
  member: Member,
  unavailable: boolean,
) {
  const t = messages().generator.matrix
  const { roleList } = messages().schedule.staffChange
  if (candidate?.partial) {
    const { notEligible, holds } = candidate.partial
    return notEligible.length > 0
      ? t.notEligible(member.display_name, roleList(notEligible.map((role) => roleLabels()[role])))
      : t.holds(member.display_name, roleList(holds.map((role) => roleLabels()[role])))
  }
  if (roles.length > 0 && roles.every((role) => isCurrentAssignee(member, slotOf(roster, serviceDate, role)))) {
    return t.holdsAll(member.display_name)
  }
  const reason = candidate ? candidate.disabledReason : messages().calendar.disabledReasons.notEligible
  return reason && !unavailable ? t.cannot(member.display_name, reason) : undefined
}

/** The toast title of a saved correction: the roles it moved, or its one slot. */
function assignedTitle(changes: StaffChange[], serviceDate: string, name: string) {
  const t = messages().generator.matrix
  const date = formatShortDate(serviceDate)
  if (changes.length > 1) {
    return t.assignedRoles(date, name, messages().schedule.staffChange.roleList(changes.map((item) => roleLabels()[item.role])))
  }
  return t.assigned(date, roleLabels()[changes[0].role], changes[0].from ?? t.noAssignment, name)
}

/** The person's balance in each role the correction gives them. */
function balanceBoxes(balance: FairnessMember | undefined, day: Day, changes: StaffChange[]) {
  const t = messages().generator.matrix
  return balance && changes.map((item) => {
    const points = item.role !== 'late_shift' && day.is_day_off ? 2 : 1
    const category = balance[item.role]
    return (
      <Box key={item.role} tone="sig" title={t.balanceTitle(roleLabels()[item.role], balance.display_name)}>
        {t.balanceChange(signed(category.deviation), signed(roundPoints(category.deviation + points)), points > 1 ? t.twoPoints : t.onePoint)}
      </Box>
    )
  })
}

/**
 * „Role do zmiany" in the draft's day panel (NP-04): the inspector's group of
 * roles for the person whose cell was clicked, the slots they take over and
 * their balance, saved as one draft correction; Undo in the toast hands every
 * slot back where each previous holder can take it.
 *
 * The panel places `form` under its facts and `footer` as its actions.
 */
export function useDraftStaffChange({ draft, roster, selected, unavailable, anchor, onSaved, onUndone, onClose }: {
  draft: DraftSchedule
  roster: Roster | undefined
  selected: { member: Member; day: Day } | null
  unavailable: boolean
  /** The policy's 11–19 anchor, once known. */
  anchor: LateShiftAnchor | undefined
  /** The correction is saved: the panel closes on the new draft. */
  onSaved: (value: DraftSchedule) => void
  onUndone: (value: DraftSchedule) => void
  onClose: () => void
}) {
  const { generator: { matrix: t }, common } = useMessages()
  const undoable = useUndoable()
  const toast = useToast()
  const [pick, setPick] = useState<RolesPick>({ onCall: 'primary', lateChoice: null })
  const fairness = useQuery(draftFairnessImpactQuery(draft))
  // The inverse hands each slot back to the person it was taken from; the
  // cells stay marked as corrected, the rest of the draft is untouched.
  const save = useMutation({
    mutationFn: async ({ serviceDate, changes, next }: { serviceDate: string; changes: StaffChange[]; next: Member }) => {
      const input = {
        id: draft.id,
        expected_version: draft.version,
        service_date: serviceDate,
        assignments: changes.map((item) => ({ role: item.role, replacement_member_id: next.id })),
      }
      const message = (value: DraftSchedule) => ({
        title: assignedTitle(changes, serviceDate, next.display_name),
        description: t.remainingProblems(problemCounts(value).total),
      })
      if (changes.some((item) => !item.restoreTo)) {
        const value = await api.overrideDraft(input)
        const { title, description } = message(value)
        toast.success(title, { description })
        return value
      }
      return undoable({
        execute: () => api.overrideDraft(input),
        undo: async (value) => onUndone(await api.overrideDraft({
          ...input,
          expected_version: value.version,
          assignments: changes.map((item) => ({ role: item.role, replacement_member_id: item.restoreTo! })),
        })),
        message,
      })
    },
    onSuccess: onSaved,
  })
  const { reset } = save
  /** Opens the group on a cell's roles, its last error gone. */
  const openFor = useCallback((roles: AssignmentRole[]) => {
    reset()
    setPick(pickFor(roles))
  }, [reset])

  const serviceDate = selected?.day.service_date
  const link = roster && serviceDate && anchor ? lateShiftLink(roster, serviceDate, anchor) : null
  const { late, roles } = correctionRoles(pick.onCall, pick.lateChoice, link)
  const changes = roster && serviceDate ? staffChanges(roster, serviceDate, roles) : []
  const candidate = roster && selected
    ? staffingCandidates(roster, selected.day.service_date, roles).find((item) => item.id === selected.member.id)
    : undefined
  const ready = roles.length > 0 && Boolean(candidate && !candidate.disabledReason && !candidate.partial)

  const form = roster && selected && (
    <>
      <RolesFieldset
        data={roster}
        serviceDate={selected.day.service_date}
        link={link}
        onCall={pick.onCall}
        late={late}
        dayOff={selected.day.is_day_off}
        disabled={save.isPending}
        error={memberError(candidate, roster, selected.day.service_date, roles, selected.member, unavailable)}
        onOnCall={(onCall) => setPick({ ...pick, onCall })}
        onLate={(lateChoice) => setPick({ ...pick, lateChoice })}
      />
      {ready && (
        <>
          <StaffChangePreview changes={changes} name={selected.member.display_name} onCall={pick.onCall} link={link} />
          {changes.every((item) => item.from === null) && <p className="muted small">{t.nobodyHoldsRole(selected.member.display_name)}</p>}
          {balanceBoxes(fairness.data?.projected_members.find((item) => item.member_id === selected.member.id), selected.day, changes)}
        </>
      )}
      {save.error && <Box tone="bad" role="alert" title={save.error.message} />}
    </>
  )

  let label = roles.length > 1 ? t.assignRoles(roles.length) : t.assign
  if (save.isPending) label = common.saving
  const footer = selected && (
    <>
      <Button onClick={onClose}>{common.cancel}</Button>
      <span className="sp" />
      <Button
        variant="primary"
        disabled={!ready || save.isPending}
        loading={save.isPending}
        onClick={() => save.mutate({ serviceDate: selected.day.service_date, changes, next: selected.member })}
      >
        {label}
      </Button>
    </>
  )

  return { form, footer, openFor }
}
