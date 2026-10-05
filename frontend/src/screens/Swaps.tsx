import { Fragment, ReactNode, useState } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { ApiError, AssignmentRole, RuleViolation, SwapImpact, SwapOption, SwapRequest, SwapSlot, SwapStatus, UserRole, api } from '../api'
import { locale, messages, useMessages } from '../i18n'
import { firstName, roleLabels, swapStatusLabels } from '../lib/labels'
import { formatDecimal, signedPoints } from '../lib/numbers'
import { formatDate, formatDayShort, relativeDay, warsawDate } from '../lib/dates'
import {
  RULE_BREAK_REASON_LENGTH,
  SwapViewer,
  brokenRules,
  canCoordinate,
  canWithdraw,
  dayRole,
  isLapsed,
  isOpen,
  needsMyDecision,
  returnOf,
  returnSlotsOf,
  slotsOf,
  swapHeadline,
  swapImpactQuery,
} from '../lib/swaps'
import { SwapImpactPreview } from '../components/SwapImpactPreview'
import {
  AvailabilityMark,
  Box,
  Button,
  Checkbox,
  EmptyState,
  ErrorState,
  Field,
  LinkButton,
  LoadingBlock,
  PageHeader,
  Panel,
  SectionHeading,
  Select,
  StatusBadge,
  StatusTone,
  Steps,
  Tag,
  Textarea,
  cx,
  useToast,
} from '../ui'

const statusTone: Record<SwapStatus, StatusTone> = {
  pending_replacement: 'warn',
  pending_coordinator: 'sig',
  approved: 'ok',
  rejected: 'bad',
  cancelled: 'muted',
}

/** The inbox filters: who the request is waiting on, seen from this person. */
type Inbox = 'do-mnie' | 'moje' | 'w-toku' | 'zamkniete'
const INBOXES: Inbox[] = ['do-mnie', 'moje', 'w-toku', 'zamkniete']
const isInbox = (value: string | null): value is Inbox => INBOXES.includes(value as Inbox)

function inboxOf(item: SwapRequest, me: string): Inbox {
  if (!isOpen(item)) return 'zamkniete'
  if (item.status === 'pending_replacement' && item.replacement_name === me) return 'do-mnie'
  if (item.requester_name === me) return 'moje'
  return 'w-toku'
}

const slotKey = (slot: SwapSlot) => `${slot.service_date}|${slot.role}`

/** What an acknowledgement was given for: each rule, whose it is and on which days. */
const rulesKey = (violations: RuleViolation[]) =>
  JSON.stringify(violations.map(({ rule, member_name, days }) => [rule, member_name, days]))

/**
 * Who breaks or bends which rule, on which days. `me` marks the reader's own
 * line; `children` follow the list inside the box, which is where a broken
 * rule is acknowledged.
 */
function ViolationList({ violations, title, tone = 'warn', me, children }: {
  violations: RuleViolation[]
  title: string
  tone?: 'warn' | 'bad'
  me?: string
  children?: ReactNode
}) {
  const t = useMessages().swaps.rules
  if (violations.length === 0) return null
  return (
    <Box tone={tone} title={title}>
      <ul className="box-list">
        {violations.map((violation, index) => (
          <li key={`${violation.rule}-${index}`}>
            <b>{violation.member_name}{violation.member_name === me && ` (${t.you})`}</b>: {violation.message}
            {violation.days.length > 0 && <span className="mono muted"> ({violation.days.map(formatDate).join(', ')})</span>}
          </li>
        ))}
      </ul>
      {children}
    </Box>
  )
}

/** "pon 14 wrz · SECONDARY + 11–19": the slots one direction of a swap moves, all on one day. */
function slotSummary(slots: SwapSlot[]): string {
  return `${formatDayShort(slots[0].service_date)} · ${slots.map((slot) => roleLabels()[slot.role]).join(' + ')}`
}

/** What a move breaks or bends: a hand-over to a candidate, or a whole exchange. */
type Verdict = Pick<SwapOption, 'blocking_violations' | 'rule_violations' | 'warning_violations'>

/**
 * One choice of the "in return" step: nothing, or a duty of the replacement.
 * It says what the request would break or bend with that choice, so a clean
 * exchange is seen before a rule is acknowledged.
 */
function ReturnChoice({ no, title, detail, verdict, selected, best, onSelect }: {
  no: ReactNode
  title: string
  detail?: string
  verdict: Verdict
  selected: boolean
  best?: boolean
  onSelect: () => void
}) {
  const t = useMessages().swaps.compose
  const blockedBy = verdict.blocking_violations?.[0]
  const breaks = blockedBy ? undefined : verdict.rule_violations?.[0]
  const bends = blockedBy || breaks ? undefined : verdict.warning_violations?.[0]
  const facts = [
    detail,
    blockedBy && <span className="who-out">{t.blocked(blockedBy.message)}</span>,
    breaks && <span className="who-out">{t.breaksRule(breaks.message)}</span>,
    bends?.message,
  ].filter(Boolean)
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={Boolean(blockedBy)}
      className={cx('rank-c', best && 'rank-best', selected && 'rank-sel', blockedBy && 'rank-blocked')}
      onClick={onSelect}
    >
      <span className="rank-no">{blockedBy ? '–' : no}</span>
      <span className="rank-nm">
        {title}
        {facts.length > 0 && (
          <small>{facts.map((fact, index) => <Fragment key={index}>{index > 0 && ' · '}{fact}</Fragment>)}</small>
        )}
      </span>
      <span className="rank-facts">
        {blockedBy
          ? <span className="rank-fact-bad">{t.hardRule}</span>
          : breaks
            ? <span className="rank-fact-warn">{t.needsAcknowledgement}</span>
            : bends
              ? <span>{t.warning}</span>
              : <span className="rank-fact-ok">{t.noViolations}</span>}
      </span>
    </button>
  )
}

/**
 * Where a request stands: filed, replacement, coordinator, in the schedule.
 * The coordinator's stage exists only while the policy asks for it; a request
 * already with a coordinator keeps the stage after the switch is turned off.
 */
function SwapSteps({ status, approvalRequired }: { status: SwapStatus; approvalRequired: boolean }) {
  const t = useMessages().swaps.steps
  const done = status === 'approved'
  const stopped = status === 'rejected' || status === 'cancelled'
  const coordinatorStage = approvalRequired || status === 'pending_coordinator'
  return (
    <Steps
      label={t.label}
      steps={[
        { label: t.filed, state: 'done' },
        { label: t.replacement, state: status === 'pending_replacement' ? 'on' : stopped ? 'todo' : 'done' },
        ...(coordinatorStage
          ? [{ label: t.coordinator, state: status === 'pending_coordinator' ? 'on' : done ? 'done' : 'todo' } as const]
          : []),
        { label: stopped ? swapStatusLabels()[status].toLowerCase() : t.inSchedule, state: done ? 'done' : 'todo' },
      ]}
    />
  )
}

/** Who acts next, under the status in the inbox table. */
function stageDetail(item: SwapRequest, viewer: SwapViewer): string {
  const t = messages().swaps.stage
  const me = (name: string) => name === viewer.displayName
  if (item.status === 'approved') return t.inSchedule
  if (!isOpen(item)) return item.decision_note ? t.reason(item.decision_note) : ''
  if (item.status === 'pending_replacement') return me(item.replacement_name) ? t.waitingForYou : t.waitingFor(item.replacement_name)
  return canCoordinate(viewer.role)
    ? t.acceptedWaitingForYou(firstName(item.replacement_name))
    : t.acceptedWaitingForCoordinator(firstName(item.replacement_name))
}

/**
 * The "effect" column: who gains the points once the swap is in the schedule.
 * Read from the same impact endpoint the decision sheet uses, only for open
 * rows; a settled request no longer has a projection to show.
 */
function Effect({ impact }: { impact: SwapImpact | undefined }) {
  const t = useMessages().swaps.table
  if (!impact) return <span className="muted">–</span>
  // An exchange may leave the points with the requester, or where they were.
  const gainer = [impact.replacement, impact.requester]
    .map((side) => ({ name: side.display_name, gained: side.after.total_points - side.before.total_points }))
    .find((side) => side.gained > 0)
  if (!gainer) return <span className="mono muted">{t.noEffect}</span>
  return (
    <span className="mono">
      {firstName(gainer.name)} {signedPoints(gainer.gained)}
    </span>
  )
}

/** What the viewer may do with a request: decide it, withdraw it, or only read it. */
function decisionOf(item: SwapRequest, viewer: SwapViewer) {
  return {
    open: isOpen(item),
    expired: isLapsed(item),
    mustDecide: needsMyDecision(item, viewer),
    withdrawable: canWithdraw(item, viewer),
  }
}

/**
 * The two directions of an exchange: the day and roles of each, and who they
 * pass between. The two people read what they get and what they give; anyone
 * else reads the duty and what comes back for it.
 */
function ExchangeRows({ item, viewer }: { item: SwapRequest; viewer: SwapViewer }) {
  const t = useMessages().swaps.sheet
  const roles = roleLabels()
  const directions = [
    { slots: slotsOf(item), giver: item.requester_name, taker: item.replacement_name, name: t.duty, tone: 'role-r-p' },
    { slots: returnSlotsOf(item), giver: item.replacement_name, taker: item.requester_name, name: t.inReturn, tone: 'role-r-s' },
  ]
  return (
    <div className="roles">
      {directions.map(({ slots, giver, taker, name, tone }) => {
        const [label, labelTone, parties] = giver === viewer.displayName
          ? [t.youGive, 'role-r-p', t.forPerson(taker)]
          : taker === viewer.displayName
            ? [t.youGet, 'role-r-s', t.fromPerson(giver)]
            : [name, tone, t.between(giver, taker)]
        return (
          <div className="role-row" key={name}>
            <span className={cx('role-r', labelTone)}>{label}</span>
            {/* The day names the duty: with its roles beside it the line would not fit the sheet. */}
            <span className="role-n">
              {formatDayShort(slots[0].service_date)}
              <small>{slots.map((slot) => roles[slot.role]).join(' + ')}</small>
              <small>{parties}</small>
            </span>
            <span className="role-x">{relativeDay(slots[0].service_date)}</span>
          </div>
        )
      })}
    </div>
  )
}

/**
 * The decision sheet: who gives, who takes, the requester's reason, the
 * stage, the effect on both balances, and the reason for a rejection or a
 * withdrawal, typed here and visible to both sides. A request that breaks a
 * hard rule names it, and whoever decides acknowledges it here. The buttons
 * sit in the panel footer, rendered by the screen.
 */
function SwapSheet({ item, viewer, approvalRequired, error, reason, onReason, acknowledged, onAcknowledged, busy }: {
  item: SwapRequest
  viewer: SwapViewer
  approvalRequired: boolean
  error: Error | null
  reason: string
  onReason: (value: string) => void
  acknowledged: boolean
  onAcknowledged: (value: boolean) => void
  busy: boolean
}) {
  const t = useMessages().swaps.sheet
  const rules = useMessages().swaps.rules
  const { open, expired, mustDecide, withdrawable } = decisionOf(item, viewer)
  const reasonLabel = mustDecide ? t.rejectionReason : t.withdrawalReason
  const exchange = Boolean(returnOf(item))
  return (
    <>
      <SwapSteps status={item.status} approvalRequired={approvalRequired} />
      {exchange ? <ExchangeRows item={item} viewer={viewer} /> : (
      <div className="roles">
        <div className="role-row">
          <span className="role-r role-r-p">{t.gives}</span>
          <span className="role-n">{item.requester_name}</span>
          <span className="role-x">{item.requester_name === viewer.displayName ? t.thatIsYou : ''}</span>
        </div>
        <div className={cx('role-row', item.status === 'pending_coordinator' && 'role-row-sel')}>
          <span className="role-r role-r-s">{t.takes}</span>
          <span className="role-n">{item.replacement_name}</span>
          <span className="role-x">{item.status === 'pending_coordinator' ? t.agreed : item.replacement_name === viewer.displayName ? t.thatIsYou : ''}</span>
        </div>
      </div>
      )}
      <dl className="kv">
        {!exchange && <div className="kv-row"><dt>{t.duty}</dt><dd>{slotSummary(slotsOf(item))}</dd></div>}
        <div className="kv-row"><dt>{t.filed}</dt><dd className="mono">{formatDayShort(item.created_at.slice(0, 10))}</dd></div>
      </dl>
      {item.note && <Box title={t.reasonFrom(item.requester_name)}>{t.quoted(item.note)}</Box>}
      {item.decision_note && <Box tone={item.status === 'rejected' ? 'bad' : 'muted'} title={t.decisionReason}>{t.quoted(item.decision_note)}</Box>}
      <ViolationList violations={brokenRules(item)} title={item.status === 'approved' ? rules.broken : rules.breaks} me={viewer.displayName}>
        {mustDecide && (
          <>
            <div className="box-next">{item.status === 'pending_replacement' ? rules.acceptanceAcknowledges : rules.approvalAcknowledges}</div>
            <Checkbox label={rules.acknowledge} checked={acknowledged} onChange={(event) => onAcknowledged(event.target.checked)} disabled={busy} />
          </>
        )}
      </ViolationList>
      {exchange && open && brokenRules(item).length === 0 && <Box tone="ok" title={rules.exchangeClean} />}
      <ViolationList violations={item.warnings ?? []} title={t.warnings} />
      {item.replacement_member_id && open && (
        <SwapImpactPreview serviceDate={item.service_date} role={item.role} replacementId={item.replacement_member_id} inReturn={returnOf(item)} />
      )}
      {expired && <Box tone="warn" title={t.expired} />}
      {!approvalRequired && mustDecide && item.status === 'pending_replacement' && (
        <Box tone="sig" title={t.immediateTitle}>
          {t.immediateBody}
        </Box>
      )}
      {(mustDecide || withdrawable) && (
        <Field label={reasonLabel} id={`swap-reason-${item.id}`} hint={mustDecide ? t.rejectionReasonHint : t.withdrawalReasonHint}>
          {({ id, describedBy }) => (
            <Textarea id={id} rows={2} value={reason} aria-describedby={describedBy} onChange={(event) => onReason(event.target.value)} />
          )}
        </Field>
      )}
      {error && <Box tone="bad" role="alert" title={error.message} />}
    </>
  )
}

export function SwapPanel({ displayName, role, hasTeamMember }: {
  displayName: string
  role: UserRole
  hasTeamMember: boolean
}) {
  const t = useMessages()
  const roles = roleLabels()
  const statuses = swapStatusLabels()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const viewer = { displayName, role }
  const coordinator = canCoordinate(role)
  const swapPolicy = useQuery({ queryKey: ['swap-policy'], queryFn: api.swapPolicy })
  // Until the policy is read, the screen words things the way the default
  // policy has them.
  const approvalRequired = swapPolicy.data?.coordinator_approval_required ?? true
  // A coordinator has requests to approve only while the policy sends them any.
  const approver = coordinator && approvalRequired
  const linkedSlot = (() => {
    const serviceDate = searchParams.get('date') ?? searchParams.get('data') ?? searchParams.get('dzien')
    const assignmentRole = searchParams.get('role') ?? searchParams.get('rola')
    return serviceDate && assignmentRole ? `${serviceDate}|${assignmentRole}` : ''
  })()
  const [slot, setSlot] = useState(linkedSlot)
  const [replacementId, setReplacementId] = useState('')
  const [note, setNote] = useState('')
  // "I knowingly break these rules": one tick for the request being written,
  // one for the request being decided. Each holds the rules it was given for,
  // so it is taken back when those change or another request is in front.
  const [composeAcknowledgedFor, setComposeAcknowledgedFor] = useState<string | null>(null)
  const [sheetAcknowledgedFor, setSheetAcknowledgedFor] = useState<string | null>(null)
  // The duty of the replacement taken in exchange, as `slotKey` names it;
  // empty for a one-way hand-over.
  const [inReturn, setInReturn] = useState('')
  const pickReturn = (key: string) => { setInReturn(key); setComposeAcknowledgedFor(null) }
  const pickReplacement = (memberId: string) => { setReplacementId(memberId); pickReturn('') }
  const [composing, setComposing] = useState(Boolean(linkedSlot) && hasTeamMember)
  const [openId, setOpenId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const openSheet = (id: string | null) => { setOpenId(id); setReason(''); setSheetAcknowledgedFor(null) }
  const [serviceDate, assignmentRole] = slot.split('|') as [string, AssignmentRole]
  const swaps = useQuery({ queryKey: ['swaps'], queryFn: () => api.swaps() })
  const publishedSchedule = useQuery({ queryKey: ['published-schedule'], queryFn: api.publishedSchedule })
  const schedule = publishedSchedule.data
  const availability = useQuery({ queryKey: ['availability', 'me'], queryFn: api.availability, enabled: hasTeamMember })
  const options = useQuery({
    queryKey: ['swap-options', serviceDate, assignmentRole],
    queryFn: () => api.swapOptions(serviceDate, assignmentRole),
    enabled: Boolean(serviceDate && assignmentRole && hasTeamMember),
  })
  const optionImpacts = useQueries({
    queries: (options.data ?? []).map((option) => ({
      ...swapImpactQuery(serviceDate, assignmentRole, option.member_id),
      enabled: Boolean(serviceDate && assignmentRole),
    })),
  })
  const returnOptions = useQuery({
    queryKey: ['swap-return-options', serviceDate, assignmentRole, replacementId],
    queryFn: () => api.swapReturnOptions(serviceDate, assignmentRole, replacementId),
    enabled: Boolean(serviceDate && assignmentRole && replacementId),
  })
  // The balance shown next to a name comes from the impact the screen already
  // fetches for every option, not from a second fairness computation (MED5-09).
  const impacts = new Map((options.data ?? []).map((option, index) => [option.member_id, optionImpacts[index].data]))
  const impactOf = (memberId: string) => impacts.get(memberId)
  const optionDeviation = (memberId: string) => {
    const impact = impactOf(memberId)
    if (!impact || !assignmentRole) return null
    return impact.replacement.before[assignmentRole].deviation
  }
  const optionBenefit = (memberId: string) => {
    const impact = impactOf(memberId)
    if (!impact || !assignmentRole) return null
    const before = impact.replacement.before[assignmentRole]
    const after = impact.replacement.after[assignmentRole]
    return Math.abs(before.deviation) - Math.abs(after.deviation)
  }
  // Candidates who break no rule first, then those a request has to
  // acknowledge a rule for, and last the ones the backend would refuse: shown
  // with a reason, not hidden (BLK6-01), but not the ones to pick.
  const tierOf = (option: SwapOption) => ((option.blocking_violations?.length ?? 0) > 0 ? 2 : (option.rule_violations?.length ?? 0) > 0 ? 1 : 0)
  const orderedOptions = [...(options.data ?? [])].sort((left, right) => {
    const tierDelta = tierOf(left) - tierOf(right)
    if (tierDelta !== 0) return tierDelta
    const leftBenefit = optionBenefit(left.member_id)
    const rightBenefit = optionBenefit(right.member_id)
    if (leftBenefit === null && rightBenefit === null) return left.display_name.localeCompare(right.display_name, locale())
    if (leftBenefit === null) return 1
    if (rightBenefit === null) return -1
    return rightBenefit - leftBenefit || left.display_name.localeCompare(right.display_name, locale())
  })
  const selectedOption = options.data?.find((option) => option.member_id === replacementId)
  const selectedReturn = returnOptions.data?.find((option) => slotKey(option) === inReturn)
  // An exchange is judged as one move, so its verdict replaces the hand-over's.
  const verdict: Verdict | undefined = selectedReturn ?? selectedOption
  // The hard rules the request being written breaks: it is sent only
  // acknowledged, and with a reason long enough to be one.
  const composeRules = verdict?.rule_violations ?? []
  const composeWarnings = verdict?.warning_violations ?? []
  const breaksRules = composeRules.length > 0
  const composeAcknowledged = composeAcknowledgedFor === rulesKey(composeRules)
  const noteLength = note.trim().length
  const returnDecided = Boolean(replacementId) && (Boolean(selectedReturn) || noteLength > 0)
  // What the replacement takes: two slots when the day couples them.
  const givenSlots: SwapSlot[] = selectedOption?.slots?.length ? selectedOption.slots : [{ service_date: serviceDate, role: assignmentRole }]
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['swaps'] })
    queryClient.invalidateQueries({ queryKey: ['published-schedule'] })
    queryClient.invalidateQueries({ queryKey: ['calendar'] })
  }
  const setInbox = (value: Inbox) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.set('skrzynka', value)
      return next
    }, { replace: true })
  }
  const create = useMutation({
    mutationFn: api.createSwap,
    onSuccess: (_result, input) => {
      const name = options.data?.find((option) => option.member_id === input.replacement_member_id)?.display_name
      setSlot('')
      pickReplacement('')
      setNote('')
      setComposing(false)
      setInbox('moje')
      refresh()
      toast.success(name ? t.swaps.toasts.sentTo(name) : t.swaps.toasts.sent)
    },
    // A refusal may mean the roster moved under the list of candidates.
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ['swap-options'] })
      queryClient.invalidateQueries({ queryKey: ['swap-return-options'] })
    },
  })
  const settle = (message: string) => ({
    onSuccess: () => {
      openSheet(null)
      refresh()
      toast.success(message)
    },
    // A refusal may mean the request or the roster moved: read both again, so
    // the sheet shows what the decision is about now.
    onError: refresh,
  })
  const accept = useMutation({ mutationFn: api.acceptSwap, ...settle(approvalRequired ? t.swaps.toasts.dutyTaken : t.swaps.toasts.inSchedule) })
  const approve = useMutation({ mutationFn: api.approveSwap, ...settle(t.swaps.toasts.inSchedule) })
  const reject = useMutation({ mutationFn: api.rejectSwap, ...settle(t.swaps.toasts.rejected) })
  const cancel = useMutation({ mutationFn: api.cancelSwap, ...settle(t.swaps.toasts.withdrawn) })
  const busy = accept.isPending || approve.isPending || reject.isPending || cancel.isPending
  const decisionError = [accept.error, approve.error, reject.error, cancel.error].find(Boolean) ?? null

  const isUnavailable = (date: string) => availability.data?.some(
    (item) => item.kind === 'unavailable' && item.starts_on <= date && item.ends_on >= date,
  ) ?? false
  const ownAssignments = (schedule?.assignments.filter(
    (item) => item.assignee_name === displayName && item.service_date >= warsawDate(),
  ) ?? []).sort((left, right) => {
    const conflict = Number(isUnavailable(right.service_date)) - Number(isUnavailable(left.service_date))
    return conflict || left.service_date.localeCompare(right.service_date)
  })

  const items = swaps.data ?? []
  const counts: Record<Inbox, number> = { 'do-mnie': 0, moje: 0, 'w-toku': 0, zamkniete: 0 }
  for (const item of items) counts[inboxOf(item, displayName)] += 1
  // A coordinator's "for approval" inbox lists every open request of others,
  // but its badge counts only those waiting for approval, as the header does.
  const awaitingApproval = items.filter((item) => inboxOf(item, displayName) === 'w-toku' && needsMyDecision(item, viewer)).length
  const badges: Record<Inbox, number> = { ...counts, 'w-toku': approver ? awaitingApproval : counts['w-toku'] }
  const actionable = items.filter((item) => needsMyDecision(item, viewer)).length
  const otherOpen = items.filter((item) => isOpen(item) && !needsMyDecision(item, viewer)).length
  // The address names the inbox; without one, open where something waits.
  const requested = searchParams.get('skrzynka')
  const inbox: Inbox = isInbox(requested)
    ? requested
    : counts['do-mnie'] > 0
      ? 'do-mnie'
      : awaitingApproval > 0
        ? 'w-toku'
        : counts.moje > 0
          ? 'moje'
          : 'do-mnie'
  const visible = items
    .filter((item) => inboxOf(item, displayName) === inbox)
    .sort((left, right) => (inbox === 'zamkniete' ? right.created_at.localeCompare(left.created_at) : left.service_date.localeCompare(right.service_date)))
  // One projection per open row, for the "effect" column.
  const projected = visible.filter((item) => isOpen(item) && item.replacement_member_id)
  const rowImpacts = useQueries({
    queries: projected.map((item) => swapImpactQuery(item.service_date, item.role, item.replacement_member_id as string, returnOf(item))),
  })
  const impactOfRow = (item: SwapRequest) => {
    const index = projected.indexOf(item)
    return index >= 0 ? rowImpacts[index]?.data : undefined
  }
  const inboxLabels: Record<Inbox, string> = {
    'do-mnie': t.swaps.inbox.toMe,
    moje: t.swaps.inbox.mine,
    'w-toku': approver ? t.swaps.inbox.forApproval : t.swaps.inbox.inProgress,
    zamkniete: t.swaps.inbox.closed,
  }
  const openItem = openId ? items.find((entry) => entry.id === openId) : undefined
  const sheetTitle = (item: SwapRequest) => {
    const returned = returnOf(item)
    return returned
      ? t.swaps.sheet.exchangeTitle(formatDayShort(item.service_date), formatDayShort(returned.service_date))
      : t.swaps.sheet.title(dayRole(item))
  }
  const decision = openItem ? decisionOf(openItem, viewer) : null
  const openRules = openItem ? brokenRules(openItem) : []
  const sheetAcknowledged = sheetAcknowledgedFor === rulesKey(openRules)
  const submitDisabled = create.isPending || !schedule?.id || !serviceDate || !replacementId
    || (verdict?.blocking_violations?.length ?? 0) > 0
    || (breaksRules && (!composeAcknowledged || noteLength < RULE_BREAK_REASON_LENGTH))
  const subtitle = swaps.data && [
    t.swaps.summary.awaitingMe(actionable),
    t.swaps.summary.awaitingOthers(otherOpen),
    t.swaps.summary.closed(counts.zamkniete),
  ].join(' · ')

  return (
    <div className="page">
      <PageHeader
        title={t.swaps.title}
        sub={subtitle}
        actions={hasTeamMember && (
          <Button variant="primary" icon="plus" onClick={() => setComposing(true)}>{t.swaps.newSwap}</Button>
        )}
      />
      {swaps.error && <ErrorState error={swaps.error} onRetry={() => swaps.refetch()} />}
      {swaps.isLoading && <LoadingBlock label={t.swaps.loading} />}
      {swaps.data && (
        <>
          <SectionHeading
            title={t.swaps.inbox.heading}
            controls={INBOXES.map((value) => (
              <button
                key={value}
                type="button"
                className={cx('sech-link', inbox === value && 'on')}
                aria-pressed={inbox === value}
                // The badge would otherwise run into the label ("Do mnie0").
                aria-label={value === 'zamkniete' ? undefined : t.swaps.inbox.count(inboxLabels[value], badges[value])}
                onClick={() => setInbox(value)}
              >
                {inboxLabels[value]}
                {value !== 'zamkniete' && (
                  <Tag tone={value === 'w-toku' && approver && badges[value] > 0 ? 'late' : undefined} className="tab-count">
                    {badges[value]}
                  </Tag>
                )}
              </button>
            ))}
          />
          {visible.length === 0 ? (
            <div className="panel">
              {inbox === 'do-mnie' ? (
                <EmptyState
                  icon="swap"
                  title={t.swaps.inbox.emptyToMeTitle}
                  description={t.swaps.inbox.emptyToMeDescription}
                  action={hasTeamMember && <LinkButton to="/moje" size="sm">{t.swaps.inbox.myDuties}</LinkButton>}
                />
              ) : inbox === 'moje' ? (
                <EmptyState compact icon="swap" title={t.swaps.inbox.emptyMineTitle} description={hasTeamMember ? t.swaps.inbox.emptyMineDescription : undefined} />
              ) : inbox === 'w-toku' ? (
                <EmptyState compact icon="check" title={approver ? t.swaps.inbox.nothingToApprove : t.swaps.inbox.noneInProgress} />
              ) : (
                <EmptyState compact icon="swap" title={t.swaps.inbox.noneClosed} />
              )}
            </div>
          ) : (
            <div className="panel tbl-wrap">
              <table className="lg">
                <thead>
                  <tr>
                    <th scope="col">{t.swaps.table.dayRole}</th>
                    <th scope="col">{t.swaps.table.gives}</th>
                    <th scope="col">{t.swaps.table.takes}</th>
                    <th scope="col">{t.swaps.table.effect}</th>
                    <th scope="col">{t.swaps.table.stage}</th>
                    <th scope="col"><span className="sr-only">{t.swaps.table.actions}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((item) => {
                    const decide = needsMyDecision(item, viewer)
                    const verb = decide ? t.swaps.table.decide : t.swaps.table.preview
                    const returned = returnOf(item)
                    return (
                      <tr key={item.id} className={openId === item.id ? 'on' : undefined}>
                        <th scope="row">
                          <b>{formatDayShort(item.service_date)}</b> {roles[item.role]}
                          {returned && <> ⇄ <b>{formatDayShort(returned.service_date)}</b> {roles[returned.role]}</>}
                          {brokenRules(item).length > 0 && <> <Tag tone="late">{t.swaps.rules.tag}</Tag></>}
                          <small>
                            {relativeDay(item.service_date)}
                            {returned
                              ? ` · ${t.swaps.table.exchange(slotsOf(item).length + returnSlotsOf(item).length)}`
                              : (item.slots?.length ?? 0) > 1 && ` · ${t.swaps.table.twoSlots}`}
                            {isLapsed(item) && ` · ${t.swaps.table.expired}`}
                          </small>
                        </th>
                        <td>{item.requester_name}</td>
                        <td>{item.replacement_name}</td>
                        <td><Effect impact={impactOfRow(item)} /></td>
                        <td>
                          <StatusBadge tone={statusTone[item.status]}>{statuses[item.status]}</StatusBadge>
                          {stageDetail(item, viewer) && <small>{stageDetail(item, viewer)}</small>}
                        </td>
                        <td className="td-actions">
                          <Button size="sm" variant={decide ? 'primary' : 'ghost'} onClick={() => openSheet(item.id)} aria-label={t.swaps.table.rowAction(verb, swapHeadline(item))}>
                            {verb}
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted small">{t.swaps.table.footnote}</p>
        </>
      )}

      <Panel
        open={Boolean(openItem)}
        onClose={() => openSheet(null)}
        title={openItem ? sheetTitle(openItem) : ''}
        // Wide enough for both names of an exchange row and the approval's three buttons.
        wide
        meta={openItem && (
          <>
            <StatusBadge tone={statusTone[openItem.status]}>{statuses[openItem.status]}</StatusBadge>
            {openRules.length > 0 && <Tag tone="late">{t.swaps.rules.tag}</Tag>}
          </>
        )}
        footer={openItem && decision && (
          <>
            <Button size="sm" variant="ghost" onClick={() => openSheet(null)}>{t.common.close}</Button>
            <span className="sp" />
            {decision.withdrawable && !decision.mustDecide && (
              <Button size="sm" disabled={busy || !reason.trim()} loading={busy} onClick={() => cancel.mutate({ id: openItem.id, reason: reason.trim() })}>{t.swaps.sheet.withdraw}</Button>
            )}
            {decision.mustDecide && (
              <>
                <Button size="sm" variant="danger" disabled={busy || !reason.trim()} onClick={() => reject.mutate({ id: openItem.id, reason: reason.trim() })}>{t.swaps.sheet.reject}</Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={busy || (openRules.length > 0 && !sheetAcknowledged)}
                  loading={busy}
                  onClick={() => (openItem.status === 'pending_replacement' ? accept : approve).mutate({ id: openItem.id, acknowledge: openRules.length > 0 })}
                >
                  {openItem.status === 'pending_replacement' ? t.swaps.sheet.accept : t.swaps.sheet.approve}
                </Button>
              </>
            )}
          </>
        )}
      >
        {openItem && (
          <SwapSheet
            item={openItem}
            viewer={viewer}
            approvalRequired={approvalRequired}
            error={decisionError}
            reason={reason}
            onReason={setReason}
            acknowledged={sheetAcknowledged}
            onAcknowledged={(value) => setSheetAcknowledgedFor(value ? rulesKey(openRules) : null)}
            busy={busy}
          />
        )}
      </Panel>

      <Panel
        open={composing}
        onClose={() => setComposing(false)}
        title={t.swaps.compose.title}
        wide
        footer={(
          <>
            <Button variant="ghost" onClick={() => setComposing(false)}>{t.common.cancel}</Button>
            <span className="sp" />
            <Button type="submit" form="new-swap" variant="primary" icon="send" disabled={submitDisabled} loading={create.isPending}>{t.swaps.compose.send}</Button>
          </>
        )}
      >
        <form
          id="new-swap"
          className="stack-sm"
          aria-label={t.swaps.compose.form}
          onSubmit={(event) => {
            event.preventDefault()
            if (schedule?.id && serviceDate && assignmentRole && replacementId) {
              create.mutate({
                schedule_id: schedule.id,
                service_date: serviceDate,
                role: assignmentRole,
                replacement_member_id: replacementId,
                note,
                acknowledge_rule_violations: breaksRules,
                in_return: selectedReturn && { service_date: selectedReturn.service_date, role: selectedReturn.role },
              })
            }
          }}
        >
          <Steps
            label={t.swaps.compose.step}
            steps={[
              { label: t.swaps.compose.stepDuty, state: slot ? 'done' : 'on' },
              { label: t.swaps.compose.stepCandidate, state: replacementId ? 'done' : slot ? 'on' : 'todo' },
              // Optional: settled by a pick, or by moving on to the reason.
              { label: t.swaps.compose.stepReturn, state: returnDecided ? 'done' : replacementId ? 'on' : 'todo' },
              { label: t.swaps.compose.stepReason, state: returnDecided ? 'on' : 'todo' },
            ]}
          />
          {serviceDate && assignmentRole && (
            <p className="muted small">{t.swaps.compose.giving(slotSummary(givenSlots))}</p>
          )}
          <Field label={t.swaps.compose.myDuty} id="swap-slot" required hint={t.swaps.compose.myDutyHint}>
            {({ id }) => (
              <Select id={id} name="slot" value={slot} onChange={(event) => { setSlot(event.target.value); pickReplacement('') }} required>
                <option value="" disabled>{ownAssignments.length === 0 ? t.swaps.compose.noUpcomingDuties : t.swaps.compose.pickDuty}</option>
                {ownAssignments.map((item) => (
                  <option key={`${item.service_date}-${item.role}`} value={`${item.service_date}|${item.role}`}>
                    {formatDayShort(item.service_date)} · {roles[item.role]} ({relativeDay(item.service_date)}){isUnavailable(item.service_date) ? ` · ${t.swaps.compose.unavailableCollision}` : ''}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {/* Availability, current balance and a duty marker travel with the
              name, so comparing two candidates no longer means selecting each
              one and reading the impact preview twice (MED5-09). */}
          <div className="stack-sm" role="radiogroup" aria-label={t.swaps.compose.replacement}>
            <SectionHeading as="h3" title={t.swaps.compose.candidates} meta={t.swaps.compose.candidatesMeta} />
            {!slot && <div className="muted small">{t.swaps.compose.pickDutyFirst}</div>}
            {slot && options.isLoading && <LoadingBlock label={t.swaps.compose.searching} rows={2} />}
            {slot && options.error && <ErrorState error={options.error} onRetry={() => options.refetch()} />}
            {slot && options.data?.length === 0 && <EmptyState compact icon="people" title={t.swaps.compose.noCandidates} />}
            {slot && orderedOptions.length > 0 && (
              <div className="rank">
                {orderedOptions.map((option, index) => {
                  const blockedBy = option.blocking_violations?.[0]
                  const blocked = Boolean(blockedBy)
                  // What a request to this person would have to acknowledge.
                  const breaks = blocked ? undefined : option.rule_violations?.[0]
                  const deviation = optionDeviation(option.member_id)
                  const benefit = optionBenefit(option.member_id)
                  const best = index === 0 && tierOf(option) === 0 && (benefit ?? 0) > 0
                  return (
                    <button
                      type="button"
                      key={option.member_id}
                      role="radio"
                      aria-checked={replacementId === option.member_id}
                      disabled={blocked}
                      className={cx('rank-c', best && 'rank-best', replacementId === option.member_id && 'rank-sel', blocked && 'rank-blocked')}
                      onClick={() => pickReplacement(option.member_id)}
                    >
                      <span className="rank-no">{blocked ? '–' : index + 1}</span>
                      <span className="rank-nm">
                        {option.display_name}
                        <small>
                          {[
                            option.availability && <AvailabilityMark key="av" kind={option.availability} withLabel />,
                            option.on_duty_that_day && t.swaps.compose.onDutyThatDay,
                            (option.slots?.length ?? 0) > 1 && t.swaps.compose.takesBothSlots,
                            !blocked && (option.warning_violations?.length ?? 0) > 0 && t.swaps.compose.splitsDaysOff,
                            blockedBy && <span key="blocked" className="who-out">{t.swaps.compose.blocked(blockedBy.message)}</span>,
                            breaks && <span key="breaks" className="who-out">{t.swaps.compose.breaksRule(breaks.message)}</span>,
                          ].filter(Boolean).map((fact, index) => (
                            <Fragment key={index}>{index > 0 && ' · '}{fact}</Fragment>
                          ))}
                        </small>
                      </span>
                      <span className="rank-facts">
                        {deviation !== null && (
                          <span className={cx(deviation > 0 ? 'rank-fact-warn' : 'rank-fact-ok')}>
                            {deviation > 0
                              ? t.swaps.compose.aboveShare(formatDecimal(Math.abs(deviation)))
                              : t.swaps.compose.belowShare(formatDecimal(Math.abs(deviation)))}
                          </span>
                        )}
                        {!blocked && (benefit ?? 0) > 0 && <span className="rank-fact-ok">{t.swaps.compose.improvesBalance}</span>}
                        {blocked && <span className="rank-fact-bad">{t.swaps.compose.hardRule}</span>}
                        {breaks && <span className="rank-fact-warn">{t.swaps.compose.needsAcknowledgement}</span>}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          {selectedOption && (
            <div className="stack-sm" role="radiogroup" aria-label={t.swaps.compose.inReturn}>
              <SectionHeading as="h3" title={t.swaps.compose.inReturn} meta={t.swaps.compose.inReturnMeta(firstName(selectedOption.display_name))} />
              {returnOptions.isLoading && <LoadingBlock label={t.swaps.compose.returnSearching} rows={2} />}
              {returnOptions.error && <ErrorState error={returnOptions.error} onRetry={() => returnOptions.refetch()} />}
              {returnOptions.data?.length === 0 && (
                <div className="muted small">{t.swaps.compose.noReturnDuties(firstName(selectedOption.display_name))}</div>
              )}
              {returnOptions.data && returnOptions.data.length > 0 && (
                <div className="rank">
                  <ReturnChoice no="–" title={t.swaps.compose.nothingInReturn} verdict={selectedOption} selected={!selectedReturn} onSelect={() => pickReturn('')} />
                  {returnOptions.data.map((option, index) => (
                    <ReturnChoice
                      key={slotKey(option)}
                      no={index + 1}
                      // The day names the duty; its roles would not fit beside the verdict.
                      title={formatDayShort(option.service_date)}
                      detail={`${option.slots.map((slot) => roles[slot.role]).join(' + ')} · ${relativeDay(option.service_date)}`}
                      verdict={option}
                      selected={option === selectedReturn}
                      // The first exchange that spares the request an acknowledgement.
                      best={index === 0 && Boolean(selectedOption.rule_violations?.length) && option.rule_violations.length + option.blocking_violations.length === 0}
                      onSelect={() => pickReturn(slotKey(option))}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
          {selectedOption && selectedReturn ? (
            <Box tone="sig" title={t.swaps.compose.exchangeTitle(formatDayShort(serviceDate), formatDayShort(selectedReturn.service_date))}>
              {approvalRequired ? t.swaps.compose.bothSlotsWithApproval : t.swaps.compose.bothSlotsWithoutApproval} {t.swaps.compose.exchangeTogether}
            </Box>
          ) : givenSlots.length > 1 && (
            <Box tone="sig" title={t.swaps.compose.bothSlotsTitle}>
              {slotSummary(givenSlots)}. {approvalRequired ? t.swaps.compose.bothSlotsWithApproval : t.swaps.compose.bothSlotsWithoutApproval}
            </Box>
          )}
          {selectedOption && (
            <>
              {selectedReturn && !breaksRules && <Box tone="ok" title={t.swaps.rules.exchangeClean}>{t.swaps.compose.exchangeCleanBody}</Box>}
              <ViolationList violations={composeRules} title={t.swaps.rules.breaks}>
                <div className="box-next">
                  {(approvalRequired ? t.swaps.compose.seenWithApproval : t.swaps.compose.seenWithoutApproval)(firstName(selectedOption.display_name))}
                </div>
                <Checkbox
                  label={t.swaps.rules.acknowledge}
                  checked={composeAcknowledged}
                  onChange={(event) => setComposeAcknowledgedFor(event.target.checked ? rulesKey(composeRules) : null)}
                  disabled={create.isPending}
                />
              </ViolationList>
              <ViolationList
                violations={composeWarnings}
                title={approvalRequired ? t.swaps.compose.warningsWithApproval : t.swaps.compose.warningsWithoutApproval}
              />
            </>
          )}
          {serviceDate && assignmentRole && replacementId && (
            <SwapImpactPreview serviceDate={serviceDate} role={assignmentRole} replacementId={replacementId} inReturn={selectedReturn} />
          )}
          <Field
            label={t.swaps.compose.note}
            id="swap-note"
            required={breaksRules}
            hint={breaksRules ? t.swaps.compose.noteRequiredHint(RULE_BREAK_REASON_LENGTH) : t.swaps.compose.noteHint}
            error={breaksRules && noteLength > 0 && noteLength < RULE_BREAK_REASON_LENGTH ? t.common.reasonTooShort(RULE_BREAK_REASON_LENGTH) : undefined}
          >
            {({ id, describedBy, invalid }) => (
              <Textarea id={id} name="note" rows={2} value={note} required={breaksRules} invalid={invalid} aria-describedby={describedBy} onChange={(event) => setNote(event.target.value)} />
            )}
          </Field>
          {create.error instanceof ApiError && create.error.violations.length > 0 ? (
            <>
              <ViolationList violations={create.error.violations} title={create.error.message} tone="bad" />
              {create.error.nextStep && <Box tone="sig" title={create.error.nextStep} />}
            </>
          ) : create.error && <Box tone="bad" role="alert" title={create.error.message} />}
        </form>
      </Panel>
    </div>
  )
}
