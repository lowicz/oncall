import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { AssignmentRole, DraftSchedule, LateShiftAnchor, api } from '../api'
import { useMessages } from '../i18n'
import { RoleSwap, Roster, draftSwapLines, roleSwapOf, staffChanges, swapHolders, swapRefused } from '../lib/calendar'
import { formatShortDate } from '../lib/dates'
import { useUndoable } from './useUndoable'
import { Box, Button, useToast } from '../ui'
import { problemCounts } from '../lib/draftProblems'
import { RoleSwapPreview, RoleSwapTrigger } from '../components/RoleSwapPreview'

const FRAME_ID = 'draft-role-swap-frame'

/**
 * „Zamień miejscami…" in the draft's day panel (NP-04): the inspector's swap
 * of one day's PRIMARY and SECONDARY as one draft correction, without the
 * rule check (the draft lists its problems in the table) and without e-mails;
 * Undo in the toast trades them back.
 *
 * The panel places `trigger` above the roles, `frame` in their place and
 * `footer` as its actions while the frame is open.
 */
export function useDraftRoleSwap({ draft, roster, serviceDate, anchor, onSaved, onUndone }: {
  draft: DraftSchedule
  roster: Roster | undefined
  serviceDate: string | undefined
  anchor: LateShiftAnchor
  /** The swap is saved: the panel closes on the new draft. */
  onSaved: (value: DraftSchedule) => void
  onUndone: (value: DraftSchedule) => void
}) {
  const undoable = useUndoable()
  const toast = useToast()
  const { schedule, generator, common } = useMessages()
  const t = schedule.roleSwap
  /** The day the frame is open for: another day's panel starts closed. */
  const [openFor, setOpenFor] = useState<string | null>(null)
  const [carryChoice, setCarryChoice] = useState<boolean | null>(null)
  const open = Boolean(serviceDate) && openFor === serviceDate
  const swap = draft.status === 'draft' && roster && serviceDate ? roleSwapOf(roster, serviceDate, anchor) : null
  // 11–19 goes along by default where the anchor holder has it, as in the inspector.
  const carry = Boolean(swap?.lateShift?.eligible) && (carryChoice ?? true)

  const close = () => {
    setOpenFor(null)
    save.reset()
  }

  const save = useMutation({
    mutationFn: async ({ swap, serviceDate, carry }: { swap: RoleSwap; serviceDate: string; carry: boolean }) => {
      const input = { id: draft.id, expected_version: draft.version, service_date: serviceDate, assignments: draftSwapLines(swap, carry) }
      const message = (value: DraftSchedule) => ({
        title: t.toast(formatShortDate(serviceDate), swapHolders(swap, carry, true)),
        description: generator.matrix.remainingProblems(problemCounts(value).total),
      })
      const moved: AssignmentRole[] = ['primary', 'secondary', ...(carry ? ['late_shift' as const] : [])]
      if (staffChanges(roster!, serviceDate, moved).some((item) => !item.restoreTo)) {
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
          assignments: draftSwapLines(swap, carry, true),
        })),
        message,
      })
    },
    onSuccess: (value) => {
      close()
      onSaved(value)
    },
  })

  const trigger = swap && (
    <RoleSwapTrigger
      swap={swap}
      open={open}
      controls={FRAME_ID}
      undo={null}
      disabled={save.isPending}
      onToggle={() => {
        if (open) {
          close()
        } else {
          setCarryChoice(null)
          setOpenFor(serviceDate!)
        }
      }}
    />
  )

  const frame = open && swap && (
    <section id={FRAME_ID} className="swap-frame" aria-labelledby={`${FRAME_ID}-title`}>
      <h3 id={`${FRAME_ID}-title`} className="swap-frame-h">{t.title}</h3>
      <RoleSwapPreview swap={swap} carry={carry} onCarry={setCarryChoice} disabled={save.isPending} inDraft />
      {save.error && <Box tone="bad" role="alert" focus title={save.error.message} />}
    </section>
  )

  const blocked = swapRefused(swap)
  const footer = frame && (
    <>
      <Button variant="ghost" disabled={save.isPending} onClick={close}>{common.cancel}</Button>
      <span className="sp" />
      {/* Focusable while refused, so the rows above say why. */}
      <Button
        variant="primary"
        loading={save.isPending}
        aria-disabled={blocked || undefined}
        onClick={() => {
          if (!blocked) save.mutate({ swap, serviceDate: serviceDate!, carry })
        }}
      >
        {t.save}
      </Button>
    </>
  )

  return { trigger, frame, footer, open: Boolean(frame), close }
}
