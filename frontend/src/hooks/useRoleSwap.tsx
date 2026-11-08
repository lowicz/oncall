import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, AssignmentRole, CalendarData, LateShiftAnchor, api } from '../api'
import { usePublicConfig } from './usePublicConfig'
import { useMessages } from '../i18n'
import { RoleSwap, roleSwapLines, roleSwapOf, swapHolders, swapRefused } from '../lib/calendar'
import { formatShortDate, warsawDate } from '../lib/dates'
import { undoable } from '../lib/undo'
import { Button, Field, Input, useToast } from '../ui'
import { DecisionFrame } from '../components/DecisionFrame'
import { RoleSwapImpact, RoleSwapPreview, RoleSwapTrigger } from '../components/RoleSwapPreview'

const MIN_REASON_LENGTH = 10
const FRAME_ID = 'role-swap-frame'
/** The server's Undo window when `/api/v1/config` has not answered yet. */
const DEFAULT_UNDO_SECONDS = 10

/**
 * „Zamień miejscami…" in the day inspector (P6): the PRIMARY and SECONDARY of
 * one published day trade holders in one batch, previewed in the panel with
 * its rules and balance, saved without a dialog and undone from the toast or
 * from the same place in the panel while the Undo window is open.
 *
 * The inspector places the three parts: `trigger` between the PRIMARY and
 * SECONDARY rows, `frame` under the rows and `footer` as the panel's actions
 * while the frame is open.
 */
export function useRoleSwap({ data, serviceDate, coordinates }: {
  data: CalendarData | undefined
  serviceDate: string | undefined
  coordinates: boolean
}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const config = usePublicConfig()
  const { schedule, common } = useMessages()
  const t = schedule.roleSwap
  const enabled = coordinates && Boolean(data?.days.find((day) => day.service_date === serviceDate)?.published)
  const policy = useQuery({ queryKey: ['swap-policy'], queryFn: api.swapPolicy, enabled })
  const anchor: LateShiftAnchor = policy.data?.late_shift_anchor ?? 'secondary'
  const swap = enabled && data && serviceDate ? roleSwapOf(data, serviceDate, anchor) : null
  const refused = swapRefused(swap)
  const ref = data?.assignments.find((item) => item.service_date === serviceDate && item.role === 'primary')

  const [open, setOpen] = useState(false)
  const [carryChoice, setCarryChoice] = useState<boolean | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [reason, setReason] = useState('')
  const [offered, setOffered] = useState<{ serviceDate: string; undo: () => void; until: number; restores: string } | null>(null)

  // 11–19 goes along by default exactly where the API would carry it itself.
  const carry = Boolean(swap?.lateShift?.eligible) && (carryChoice ?? true)
  const historical = Boolean(serviceDate && serviceDate < warsawDate())
  const lines = swap && serviceDate ? roleSwapLines(swap, serviceDate, carry) : []

  const check = useQuery({
    queryKey: ['role-swap-check', serviceDate, ref?.schedule_id, ref?.schedule_version, carry],
    queryFn: () => api.batchOverrideCheck({ batches: [{ schedule_id: ref!.schedule_id, assignments: lines }] }),
    enabled: open && Boolean(ref && swap) && !refused,
  })
  // An acknowledgement covers the violations it was given for.
  useEffect(() => setAcknowledged(false), [check.data])
  // The panel's Undo lasts exactly as long as the toast's.
  useEffect(() => {
    if (!offered) return
    const timer = setTimeout(() => setOffered(null), offered.until - Date.now())
    return () => clearTimeout(timer)
  }, [offered])

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['calendar'] })
    queryClient.invalidateQueries({ queryKey: ['published-schedule'] })
  }
  const close = () => {
    setOpen(false)
    setCarryChoice(null)
    setReason('')
    save.reset()
  }

  const save = useMutation({
    mutationFn: async ({ swap, serviceDate, scheduleId, version }: {
      swap: RoleSwap
      serviceDate: string
      scheduleId: string
      version: number
    }) => {
      const given = historical ? reason.trim() : undefined
      return undoable({
        execute: () => api.batchOverride({
          schedule_id: scheduleId,
          expected_version: version,
          kind: 'role_swap',
          assignments: lines,
          reason: given,
          acknowledge_rule_violations: (check.data?.violations.length ?? 0) > 0 && acknowledged,
        }),
        // The inverse swap: the new holders trade back, 11–19 with them.
        undo: async () => {
          const back = { ...swap, primary: swap.secondary, secondary: swap.primary }
          await api.batchOverride({
            schedule_id: scheduleId,
            expected_version: version + 1,
            kind: 'role_swap',
            assignments: roleSwapLines(back, serviceDate, carry),
            reason: given,
            acknowledge_rule_violations: true,
          })
          setOffered(null)
          refresh()
        },
        toast,
        message: () => ({
          title: t.toast(formatShortDate(serviceDate), swapHolders(swap, carry, true)),
          description: t.emailsLater,
          expired: common.undoEmailsSent,
        }),
        undoLabel: t.undoAction,
        onUndoError: (error) => toast.error(t.undoFailed, { description: (error as Error).message }),
        windowSeconds: config.data?.undo_window_seconds ?? DEFAULT_UNDO_SECONDS,
        onOffer: (undo, until) => setOffered({ serviceDate, undo, until, restores: swapHolders(swap, carry, false) }),
      })
    },
    onSuccess: () => {
      close()
      refresh()
    },
    onError: (error) => {
      // The roster moved and the swap now breaks a rule the frame did not
      // show: check again so the rules and their consent appear.
      if (error instanceof ApiError && error.violations.length > 0) {
        queryClient.invalidateQueries({ queryKey: ['role-swap-check'] })
      }
    },
  })

  const blocked = !ref
    || refused
    || check.isLoading
    || ((check.data?.violations.length ?? 0) > 0 && !acknowledged)
    || (historical && reason.trim().length < MIN_REASON_LENGTH)

  const trigger = swap && (
    <RoleSwapTrigger
      swap={swap}
      open={open}
      controls={FRAME_ID}
      undo={offered?.serviceDate === serviceDate ? offered : null}
      disabled={save.isPending}
      onToggle={() => (open ? close() : setOpen(true))}
    />
  )

  const frame = open && swap && serviceDate && (
    <section id={FRAME_ID} className="swap-frame" aria-labelledby={`${FRAME_ID}-title`}>
      <h3 id={`${FRAME_ID}-title`} className="swap-frame-h">{t.title}</h3>
      <RoleSwapPreview swap={swap} carry={carry} onCarry={setCarryChoice} disabled={save.isPending} />
      {!refused && <DecisionFrame
        violations={check.data?.violations}
        checkFailed={check.isError}
        violationsTitle={t.breaksRules}
        endsHandover={check.data?.ends_handover}
        acknowledged={acknowledged}
        onAcknowledge={setAcknowledged}
        error={save.error?.message}
        pending={save.isPending}
      >
        <RoleSwapImpact swap={swap} serviceDate={serviceDate} carry={carry} />
        {historical && (
          <Field label={t.reason} id="role-swap-reason">
            {({ id }) => (
              <Input
                id={id}
                name={id}
                value={reason}
                minLength={MIN_REASON_LENGTH}
                disabled={save.isPending}
                onChange={(event) => setReason(event.target.value)}
              />
            )}
          </Field>
        )}
      </DecisionFrame>}
    </section>
  )

  const footer = frame && (
    <>
      <Button variant="ghost" disabled={save.isPending} onClick={close}>{common.cancel}</Button>
      <span className="sp" />
      {/* Focusable while blocked, so the frame above says what is missing. */}
      <Button
        variant="primary"
        loading={save.isPending}
        aria-disabled={blocked || undefined}
        onClick={() => {
          if (!blocked) save.mutate({ swap, serviceDate, scheduleId: ref!.schedule_id, version: ref!.schedule_version })
        }}
      >
        {t.save}
      </Button>
    </>
  )

  /** Whether a role row is part of the open swap, lit while it is open. */
  const covers = (role: AssignmentRole) => role !== 'late_shift' || carry

  return { trigger, frame, footer, open: Boolean(frame), covers, close }
}
