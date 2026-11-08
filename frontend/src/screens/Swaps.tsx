import { Fragment, ReactNode, useCallback, useEffect, useState } from 'react'
import { useInfiniteQuery, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError, AssignmentRole, RuleViolation, SwapImpact, SwapImpactMember, SwapOption, SwapRequest, SwapReturnOption, SwapScope, SwapSlot, SwapStatus, UserRole, api } from '../api'
import { locale, messages, useMessages } from '../i18n'
import { UNDONE_RIGHT_AFTER_SENDING } from '../i18n/pl/swaps'
import { firstName, roleLabels, swapStatusLabels } from '../lib/labels'
import { formatDecimal, signed, signedPoints } from '../lib/numbers'
import { formatDate, formatDayShort, relativeDay, warsawDate } from '../lib/dates'
import { docsHref } from '../lib/nav'
import { undoable } from '../lib/undo'
import {
  OPEN_STATUSES,
  SwapChoice,
  SwapViewer,
  brokenRules,
  canCoordinate,
  canWithdraw,
  dayRole,
  defaultChoice,
  dutyDays,
  isLapsed,
  isOpen,
  movesOf,
  needsMyDecision,
  returnOf,
  returnSlotsOf,
  slotsOf,
  swapHeadline,
  swapImpactQuery,
  WITHDRAWN_BY_AUTHOR,
} from '../lib/swaps'
import { SwapImpactPreview } from '../components/SwapImpactPreview'
import { UnsavedChangesDialog } from '../components/UnsavedChangesDialog'
import { useUnsavedChanges } from '../hooks/useUnsavedChanges'
import { useNarrow } from '../hooks/useMediaQuery'
import { usePublicConfig } from '../hooks/usePublicConfig'
import {
  AvailabilityMark,
  Box,
  Button,
  Checkbox,
  Disclosure,
  EmptyState,
  ErrorState,
  Field,
  Icon,
  LinkButton,
  List,
  ListRow,
  LoadingBlock,
  PageHeader,
  Panel,
  SectionHeading,
  ScrollArea,
  Segmented,
  Select,
  StatusBadge,
  StatusTone,
  Steps,
  Tag,
  Textarea,
  Tooltip,
  cx,
  navigateRadioGroup,
  radioTabIndex,
  useToast,
} from '../ui'
import type { RadioNavigationOption } from '../ui'

const statusTone: Record<SwapStatus, StatusTone> = {
  pending_replacement: 'prop',
  pending_coordinator: 'prop',
  approved: 'ok',
  rejected: 'bad',
  cancelled: 'muted',
}

/** The inbox filters: who the request is waiting on, seen from this person. */
type Inbox = 'do-mnie' | 'moje' | 'w-toku' | 'zamkniete'
const INBOXES: Inbox[] = ['do-mnie', 'moje', 'w-toku', 'zamkniete']
const isInbox = (value: string | null): value is Inbox => INBOXES.includes(value as Inbox)

const CLOSED_STATUSES: SwapStatus[] = ['approved', 'rejected', 'cancelled']
/** Closed requests come a page at a time, newest first. */
const CLOSED_PAGE = 50
// ponytail: open requests in one request at the API's cap; page them too if a team ever keeps 200 open.
const OPEN_LIMIT = 200

function inboxOf(item: SwapRequest, me: string): Inbox {
  if (!isOpen(item)) return 'zamkniete'
  if (item.status === 'pending_replacement' && item.replacement_name === me) return 'do-mnie'
  if (item.requester_name === me) return 'moje'
  return 'w-toku'
}

const slotKey = (slot: SwapSlot) => `${slot.service_date}|${slot.role}`

const wayOrder = (way: SwapReturnOption) => (way.scope === 'whole' ? 0 : way.role === 'late_shift' ? 2 : 1)
/** Every way to take a day of the replacement, in the order the "I give" choice has them: the whole duty, the on-call role, 11-19. */
const waysOf = (option: SwapReturnOption) => [option, ...(option.parts ?? [])].sort((left, right) => wayOrder(left) - wayOrder(right))
/** One way to take a day, as the form keeps it. */
const wayKey = (way: SwapReturnOption) => `${slotKey(way)}|${way.scope ?? ''}`

/** What an acknowledgement was given for: each rule, whose it is and on which days. */
const rulesKey = (violations: RuleViolation[]) =>
  JSON.stringify(violations.map(({ rule, member_name, days }) => [rule, member_name, days]))

/**
 * Who breaks or bends which rule, on which days. `me` marks the reader's own
 * line; `children` follow the list inside the box, which is where a broken
 * rule is acknowledged.
 */
function ViolationList({ violations, title, tone = 'warn', me, children, refused = false }: {
  violations: RuleViolation[]
  title: string
  tone?: 'warn' | 'bad'
  me?: string
  children?: ReactNode
  /** A refused submit: announced and focused like any other submit error. */
  refused?: boolean
}) {
  const t = useMessages().swaps.rules
  if (violations.length === 0) return null
  return (
    <Box tone={tone} title={title} role={refused ? 'alert' : undefined} focus={refused}>
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

/** "SECONDARY + 11–19": the roles of the slots one direction of a swap moves, all on one day. */
const roleList = (slots: SwapSlot[]) => slots.map((slot) => roleLabels()[slot.role]).join(' + ')

/** "pon 14 wrz · SECONDARY + 11–19". */
function slotSummary(slots: SwapSlot[]): string {
  return `${formatDayShort(slots[0].service_date)} · ${roleList(slots)}`
}

/** What a move breaks or bends: a hand-over to a candidate, or a whole exchange. */
type Verdict = Pick<SwapOption, 'blocking_violations' | 'rule_violations' | 'warning_violations'>

/**
 * One card of a choice list: a candidate, or what the request takes in
 * return. It carries a name, one verdict and at most one number; a blocked
 * card says why in place of its detail. `breaks` are the broken rules that
 * make the choice need an acknowledgement. The facts that matter only once
 * the card is picked are the caller's, under the selected card.
 */
function RankChoice({ no, title, detail, verdict, breaks, best, points, radioValue, selectedValue, navigation, onSelect }: {
  no: ReactNode
  title: string
  detail?: ReactNode
  verdict: Verdict
  breaks: RuleViolation[]
  best?: boolean
  points?: ReactNode
  radioValue: string
  selectedValue: string
  navigation: RadioNavigationOption<string>[]
  onSelect: (value: string) => void
}) {
  const t = useMessages().swaps.compose
  const blockedBy = verdict.blocking_violations?.[0]
  const selected = radioValue === selectedValue
  const disabled = Boolean(navigation.find((item) => item.value === radioValue)?.disabled)
  const note = blockedBy ? blockedBy.message : detail
  let word = <span className="rank-fact-ok">{t.noViolations}</span>
  if (blockedBy) word = <span className="rank-fact-bad">{t.hardRule}</span>
  else if (breaks.length > 0) word = <span className="rank-fact-warn">{t.needsAcknowledgement}</span>
  else if (verdict.warning_violations?.length) word = <span>{t.warning}</span>
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-disabled={disabled || undefined}
      tabIndex={radioTabIndex(selectedValue, radioValue, navigation)}
      data-value={radioValue}
      className={cx('rank-c', best && 'rank-best', selected && 'rank-sel', blockedBy && 'rank-blocked')}
      onClick={() => { if (!disabled && !selected) onSelect(radioValue) }}
      onKeyDown={(event) => navigateRadioGroup(event, radioValue, navigation, onSelect)}
    >
      <span className="rank-no">{blockedBy ? '–' : no}</span>
      <span className="rank-nm">
        {title}
        {best && <> <Tag tone="sig">{t.bestMatch}</Tag></>}
        {note && <small>{note}</small>}
      </span>
      <span className="rank-facts">
        {word}
        {!blockedBy && points}
      </span>
    </button>
  )
}

/**
 * What else matters about the picked candidate, one sentence each, under
 * their card: the rules a request to them breaks, a duty they already hold,
 * what they take of a whole duty, and where their balance stands.
 */
function CandidateFacts({ option, breaks, deviation, benefit, takesOnly }: {
  option: SwapOption
  breaks: RuleViolation[]
  deviation: number | null
  benefit: number | null
  takesOnly?: AssignmentRole
}) {
  const t = useMessages().swaps.compose
  const facts = [
    ...breaks.map((violation) => t.breaksRule(violation.message, violation.days.map(formatDate).join(', '))),
    option.on_duty_that_day && t.onDutyThatDay,
    takesOnly && t.takesOnly(roleLabels()[takesOnly]),
    option.warning_violations?.some((violation) => violation.rule === 'day_off_block') && t.splitsDaysOff,
    deviation ? (deviation > 0 ? t.aboveShare : t.belowShare)(formatDecimal(Math.abs(deviation))) : null,
    (benefit ?? 0) > 0 && t.improvesBalance,
  ].filter(Boolean)
  if (facts.length === 0) return null
  return <p className="rank-detail">{facts.join(' ')}</p>
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
              <small>{roleList(slots)}</small>
              <small>{parties}</small>
            </span>
            <span className="role-x">{relativeDay(slots[0].service_date)}</span>
          </div>
        )
      })}
    </div>
  )
}

/** Focus and bring into view a field that has just appeared; `autoFocus` leaves it half under the panel footer. */
const focusOnMount = (element: HTMLElement | null) => {
  element?.focus()
  element?.scrollIntoView({ block: 'nearest' })
}

/** Which of the broken rules a person may knowingly break, in the user documentation; opens apart so a half-written request survives. */
function RulesDocsLink() {
  const t = useMessages().swaps.rules
  return <a href={`${docsHref()}${t.docsPath}`} target="_blank" rel="noreferrer">{t.whichRules}</a>
}

/**
 * The decision sheet: who gives, who takes, the requester's reason, the
 * stage, the effect on both balances, and the reason for a rejection or a
 * withdrawal, typed here and visible to both sides. A request that breaks a
 * hard rule names it, and whoever decides acknowledges it here. The buttons
 * sit in the panel footer, rendered by the screen.
 */
function SwapSheet({ item, viewer, approvalRequired, error, rejecting, reason, onReason, acknowledged, onAcknowledged, busy }: {
  item: SwapRequest
  viewer: SwapViewer
  approvalRequired: boolean
  error: Error | null
  /** The decider has clicked Reject: the reason field is shown. */
  rejecting: boolean
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
            <div className="box-next">{item.status === 'pending_replacement' ? rules.acceptanceAcknowledges : rules.approvalAcknowledges} <RulesDocsLink /></div>
            <Checkbox label={rules.acknowledge} checked={acknowledged} onChange={(event) => onAcknowledged(event.target.checked)} disabled={busy} />
          </>
        )}
      </ViolationList>
      {exchange && open && brokenRules(item).length === 0 && <Box tone="ok" title={rules.exchangeClean} />}
      <ViolationList violations={item.warnings ?? []} title={t.warnings} />
      {item.replacement_member_id && open && (
        <SwapImpactPreview serviceDate={item.service_date} role={item.role} replacementId={item.replacement_member_id} {...movesOf(item)} />
      )}
      {expired && <Box tone="warn" title={t.expired} />}
      {!approvalRequired && mustDecide && item.status === 'pending_replacement' && (
        <Box tone="sig" title={t.immediateTitle}>
          {t.immediateBody}
        </Box>
      )}
      {(mustDecide ? rejecting : withdrawable) && (
        <Field label={reasonLabel} id={`swap-reason-${item.id}`} hint={mustDecide ? t.rejectionReasonHint : t.withdrawalReasonHint}>
          {({ id, describedBy }) => (
            <Textarea id={id} rows={2} ref={mustDecide ? focusOnMount : undefined} value={reason} aria-describedby={describedBy} onChange={(event) => onReason(event.target.value)} />
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
  const navigate = useNavigate()
  const narrow = useNarrow()
  const undoWindow = usePublicConfig().data?.undo_window_seconds
  const [searchParams, setSearchParams] = useSearchParams()
  const viewer = { displayName, role }
  const coordinator = canCoordinate(role)
  const swapPolicy = useQuery({ queryKey: ['swap-policy'], queryFn: api.swapPolicy })
  // Until the policy is read, the screen words things the way the default
  // policy has them.
  const approvalRequired = swapPolicy.data?.coordinator_approval_required ?? true
  // A coordinator has requests to approve only while the policy sends them any.
  const approver = coordinator && approvalRequired
  // The points of each open request are drawn and fetched only once the
  // policy is read and says the coordinator approves.
  const projecting = coordinator && swapPolicy.data?.coordinator_approval_required === true
  const linkedRole = searchParams.get('role') ?? searchParams.get('rola')
  const linkedDate = searchParams.get('date') ?? searchParams.get('data') ?? searchParams.get('dzien')
  const linkedDay = linkedDate && linkedRole ? linkedDate : ''
  const [serviceDate, setServiceDate] = useState(linkedDay)
  // What is given of the day: nothing picked yet means the default for it.
  const [choice, setChoice] = useState<SwapChoice | ''>('')
  const [replacementId, setReplacementId] = useState('')
  const [note, setNote] = useState('')
  // "I knowingly break these rules": one tick for the request being written,
  // one for the request being decided. Each holds the rules it was given for,
  // so it is taken back when those change or another request is in front.
  const [composeAcknowledgedFor, setComposeAcknowledgedFor] = useState<string | null>(null)
  const [sheetAcknowledgedFor, setSheetAcknowledgedFor] = useState<string | null>(null)
  // The way the replacement's day is taken in exchange, as `wayKey` names
  // it; empty for a one-way hand-over.
  const [inReturn, setInReturn] = useState('')
  const pickReturn = (key: string) => { setInReturn(key); setComposeAcknowledgedFor(null) }
  const pickReplacement = (memberId: string) => { setReplacementId(memberId); pickReturn('') }
  const pickChoice = (value: SwapChoice | '') => { setChoice(value); pickReplacement('') }
  const pickDay = (value: string) => { setServiceDate(value); pickChoice('') }
  const [composing, setComposing] = useState(Boolean(linkedDay) && hasTeamMember)
  const composeDirty = composing && Boolean((serviceDate && serviceDate !== linkedDay) || choice || replacementId || note || composeAcknowledgedFor || inReturn)
  const resetCompose = () => {
    pickDay('')
    setNote('')
    setComposing(false)
  }
  const unsavedChanges = useUnsavedChanges(composeDirty, resetCompose)
  const closeComposer = () => unsavedChanges.requestAction(() => setComposing(false))
  const [openId, setOpenId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const openSheet = (id: string | null) => { setOpenId(id); setReason(''); setRejecting(false); setSheetAcknowledgedFor(null) }
  const openSwaps = useQuery({ queryKey: ['swaps', 'open'], queryFn: () => api.swaps({ status: OPEN_STATUSES, limit: OPEN_LIMIT }) })
  const closedSwaps = useInfiniteQuery({
    queryKey: ['swaps', 'closed'],
    queryFn: ({ pageParam }) => api.swaps({ status: CLOSED_STATUSES, limit: CLOSED_PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.length < CLOSED_PAGE ? undefined : pages.length * CLOSED_PAGE),
  })
  const swapsError = openSwaps.error ?? closedSwaps.error
  const swapsLoaded = Boolean(openSwaps.data && closedSwaps.data)
  const publishedSchedule = useQuery({ queryKey: ['published-schedule'], queryFn: api.publishedSchedule })
  const schedule = publishedSchedule.data
  const availability = useQuery({ queryKey: ['availability', 'me'], queryFn: api.availability, enabled: hasTeamMember })
  const isUnavailable = (date: string) => availability.data?.some(
    (item) => item.kind === 'unavailable' && item.starts_on <= date && item.ends_on >= date,
  ) ?? false
  const ownDays = dutyDays(schedule?.assignments ?? [], displayName, warsawDate()).sort((left, right) => {
    const conflict = Number(isUnavailable(right.service_date)) - Number(isUnavailable(left.service_date))
    return conflict || left.service_date.localeCompare(right.service_date)
  })
  // A day with two roles asks what of it is given: the whole duty or one
  // role, the request moving exactly that. A day with one role asks nothing.
  const dayRoles = ownDays.find((item) => item.service_date === serviceDate)?.roles ?? []
  const anchor = swapPolicy.data?.late_shift_anchor ?? 'secondary'
  const given = choice || defaultChoice(dayRoles, anchor, serviceDate === linkedDay ? linkedRole : null)
  const twoRoles = dayRoles.length > 1
  // The role that names the request: the on-call role of a whole duty. Empty
  // until a day is picked; every use below waits for it.
  const assignmentRole = (given === 'whole' ? dayRoles[0] : given) as AssignmentRole
  const scope: SwapScope | undefined = twoRoles ? (given === 'whole' ? 'whole' : 'single') : undefined
  // One role of the pair the 11-19 anchor binds: a broken rule for every
  // candidate alike, so the hint says it once and the box acknowledges it.
  const splitsPair = twoRoles && dayRoles[0] === anchor && scope === 'single'
  const options = useQuery({
    queryKey: ['swap-options', serviceDate, assignmentRole, scope],
    queryFn: () => api.swapOptions(serviceDate, assignmentRole, scope),
    enabled: Boolean(serviceDate && assignmentRole && hasTeamMember),
  })
  const optionImpacts = useQueries({
    queries: (options.data ?? []).map((option) => ({
      ...swapImpactQuery(serviceDate, assignmentRole, option.member_id, { scope }),
      enabled: Boolean(serviceDate && assignmentRole),
    })),
  })
  const returnOptions = useQuery({
    queryKey: ['swap-return-options', serviceDate, assignmentRole, scope, replacementId],
    queryFn: () => api.swapReturnOptions(serviceDate, assignmentRole, replacementId, scope),
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
  // What a request has to acknowledge beyond the split of the day given.
  const ownRules = (verdict: Verdict) => (verdict.rule_violations ?? []).filter((violation) => !(
    splitsPair && violation.rule === 'late_shift_anchor' && violation.days.every((day) => day === serviceDate)
  ))
  // Candidates who break no rule first, then those a request has to
  // acknowledge a rule for, and last the ones the backend would refuse: shown
  // with a reason, not hidden (BLK6-01), but not the ones to pick.
  const tierOf = (option: SwapOption) => ((option.blocking_violations?.length ?? 0) > 0 ? 2 : ownRules(option).length > 0 ? 1 : 0)
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
  const candidateNavigation = orderedOptions.map((option) => ({
    value: option.member_id,
    disabled: Boolean(option.blocking_violations?.length),
  }))
  const selectedOption = options.data?.find((option) => option.member_id === replacementId)
  const returnDay = returnOptions.data?.find((option) => waysOf(option).some((way) => wayKey(way) === inReturn))
  const selectedReturn = returnDay && waysOf(returnDay).find((way) => wayKey(way) === inReturn)
  // The selected day reads as the way it is taken.
  const returnWays = (returnOptions.data ?? []).map((option) => (option === returnDay && selectedReturn ? selectedReturn : option))
  const selectedReturnValue = selectedReturn ? wayKey(selectedReturn) : ''
  // A blocked choice cannot be picked and the arrows skip it, except the one
  // already selected: it stays readable and removable.
  const returnNavigation = [
    { value: '', disabled: Boolean(selectedOption?.blocking_violations?.length) && Boolean(selectedReturn) },
    ...returnWays.map((way) => ({ value: wayKey(way), disabled: Boolean(way.blocking_violations?.length) && way !== selectedReturn })),
  ]
  // An exchange is judged as one move, so its verdict replaces the hand-over's.
  const verdict: Verdict | undefined = selectedReturn ?? selectedOption
  // The hard rules the request being written breaks: it is sent only
  // acknowledged; a reason is the person's to give or not.
  const composeRules = verdict?.rule_violations ?? []
  const composeWarnings = verdict?.warning_violations ?? []
  const breaksRules = composeRules.length > 0
  const composeAcknowledged = composeAcknowledgedFor === rulesKey(composeRules)
  const exchangeLine = `${approvalRequired ? t.swaps.compose.bothSlotsWithApproval : t.swaps.compose.bothSlotsWithoutApproval} ${t.swaps.compose.exchangeTogether}`
  // The one line the folded balance and warnings show: "Ty -1 · Anna +1 · 1 ostrzeżenie".
  const moveImpact = useQuery({
    ...swapImpactQuery(serviceDate, assignmentRole, replacementId, { inReturn: selectedReturn, scope, returnScope: selectedReturn?.scope ?? undefined }),
    enabled: Boolean(serviceDate && assignmentRole && replacementId),
  })
  const pointsMoved = (side: SwapImpactMember) => signed(side.after.total_points - side.before.total_points)
  const detailsMeta = [
    moveImpact.data && t.swaps.compose.detailsPoints(t.swaps.table.you, pointsMoved(moveImpact.data.requester)),
    moveImpact.data && t.swaps.compose.detailsPoints(firstName(moveImpact.data.replacement.display_name), pointsMoved(moveImpact.data.replacement)),
    composeWarnings.length > 0 && t.swaps.compose.detailsWarnings(composeWarnings.length),
  ].filter(Boolean).join(' · ')
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['swaps'] })
    queryClient.invalidateQueries({ queryKey: ['published-schedule'] })
    queryClient.invalidateQueries({ queryKey: ['calendar'] })
  }
  const setInbox = useCallback((value: Inbox) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.set('skrzynka', value)
      return next
    }, { replace: true })
  }, [setSearchParams])
  // A request sent by mistake is withdrawn while its e-mail is still held,
  // so the replacement never reads it.
  const withdrawSent = (sent: SwapRequest) => api.cancelSwap({ id: sent.id, reason: UNDONE_RIGHT_AFTER_SENDING }).then(refresh)
  const sendSwap = (input: Parameters<typeof api.createSwap>[0]) => {
    const name = options.data?.find((option) => option.member_id === input.replacement_member_id)?.display_name
    const title = name ? t.swaps.toasts.sentTo(name) : t.swaps.toasts.sent
    if (!undoWindow) return api.createSwap(input).then((sent) => { toast.success(title); return sent })
    return undoable({
      execute: () => api.createSwap(input),
      undo: withdrawSent,
      toast,
      message: () => ({ title, expired: t.common.undoEmailsSent }),
      undoLabel: t.common.undo,
      onUndoError: (error) => toast.error(t.swaps.toasts.undoFailed, { description: (error as Error).message }),
      windowSeconds: undoWindow,
    })
  }
  const create = useMutation({
    mutationFn: sendSwap,
    onSuccess: () => {
      resetCompose()
      refresh()
    },
    // A refusal may mean the roster moved under the list of candidates.
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ['swap-options'] })
      queryClient.invalidateQueries({ queryKey: ['swap-return-options'] })
    },
  })
  const { isSuccess: sent, reset: resetCreate } = create
  useEffect(() => {
    // Run after the cleared form has rendered, so its own success navigation is
    // not mistaken for abandoning unfinished work.
    if (!sent) return
    setInbox('moje')
    resetCreate()
  }, [sent, resetCreate, setInbox])
  const settle = (notify: (result: SwapRequest) => void) => ({
    onSuccess: (result: SwapRequest) => {
      openSheet(null)
      refresh()
      notify(result)
    },
    // A refusal may mean the request or the roster moved: read both again, so
    // the sheet shows what the decision is about now.
    onError: refresh,
  })
  // The server reads the approval policy again on acceptance, so the swap it returns says where it went.
  const accept = useMutation({
    mutationFn: api.acceptSwap,
    ...settle((result) => result.status === 'approved'
      ? toast.success(t.swaps.toasts.acceptedInSchedule, { action: { label: t.swaps.toasts.openDay, onClick: () => navigate(`/grafik?dzien=${result.service_date}`) } })
      : toast.success(t.swaps.toasts.dutyTaken)),
  })
  const approve = useMutation({ mutationFn: api.approveSwap, ...settle(() => toast.success(t.swaps.toasts.inSchedule)) })
  const reject = useMutation({ mutationFn: api.rejectSwap, ...settle(() => toast.success(t.swaps.toasts.rejected)) })
  const cancel = useMutation({ mutationFn: api.cancelSwap, ...settle(() => toast.success(t.swaps.toasts.withdrawn)) })
  const busy = accept.isPending || approve.isPending || reject.isPending || cancel.isPending
  const decisionError = [accept.error, approve.error, reject.error, cancel.error].find(Boolean) ?? null

  // A request that closes between two pages may come twice.
  const items = [...new Map([...(openSwaps.data ?? []), ...(closedSwaps.data?.pages.flat() ?? [])].map((item) => [item.id, item])).values()]
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
  // One projection per open row, for the "effect" column. Only a coordinator
  // who approves swaps decides on points, so only they get the column.
  const projected = projecting ? visible.filter((item) => isOpen(item) && item.replacement_member_id) : []
  const rowImpacts = useQueries({
    queries: projected.map((item) => swapImpactQuery(item.service_date, item.role, item.replacement_member_id as string, movesOf(item))),
  })
  const impactOfRow = (item: SwapRequest) => {
    const index = projected.indexOf(item)
    return index >= 0 ? rowImpacts[index]?.data : undefined
  }
  const party = (name: string) => (name === displayName ? t.swaps.table.you : name)
  const rowAction = (item: SwapRequest) => {
    const decide = needsMyDecision(item, viewer)
    const verb = decide ? t.swaps.table.decide : t.swaps.table.preview
    return (
      <Button size="sm" variant={decide ? 'primary' : 'ghost'} onClick={() => openSheet(item.id)} aria-label={t.swaps.table.rowAction(verb, swapHeadline(item, t.common.swapWith))}>
        {verb}
      </Button>
    )
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
  // What still keeps the request from being sent, said beside the button.
  // Empty while the schedule is read, and when reading it failed: the form
  // shows that error instead.
  let sendBlocker: string | null = null
  if (!schedule?.id) sendBlocker = publishedSchedule.isPending || publishedSchedule.error ? '' : t.swaps.compose.status.noSchedule
  else if (!serviceDate) sendBlocker = t.swaps.compose.status.pickDuty
  else if (!replacementId) sendBlocker = t.swaps.compose.status.pickReplacement
  else if (verdict?.blocking_violations?.length) sendBlocker = t.swaps.compose.status.hardRule
  else if (breaksRules && !composeAcknowledged) sendBlocker = t.swaps.compose.status.acknowledge
  const subtitle = swapsLoaded && [
    t.swaps.summary.awaitingMe(actionable),
    t.swaps.summary.awaitingOthers(otherOpen),
    t.swaps.summary.closed(counts.zamkniete, closedSwaps.hasNextPage),
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
      {swapsError && <ErrorState error={swapsError} onRetry={() => { openSwaps.refetch(); closedSwaps.refetch() }} />}
      {!swapsError && !swapsLoaded && <LoadingBlock label={t.swaps.loading} />}
      {swapsLoaded && (
        <>
          <SectionHeading
            title={t.swaps.inbox.heading}
            controls={(
              <Segmented<Inbox>
                label={t.swaps.inbox.heading}
                value={inbox}
                onChange={setInbox}
                options={INBOXES.map((value) => ({
                  value,
                  // The badge would otherwise run into the label ("Do mnie0").
                  ariaLabel: value === 'zamkniete' ? undefined : t.swaps.inbox.count(inboxLabels[value], badges[value]),
                  label: (
                    <>
                      {inboxLabels[value]}
                      {value !== 'zamkniete' && (
                        <Tag tone={value === 'w-toku' && approver && badges[value] > 0 ? 'sig' : undefined} className="tab-count">
                          {badges[value]}
                        </Tag>
                      )}
                    </>
                  ),
                }))}
              />
            )}
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
          ) : narrow ? (
            // A phone gets one row per request with its action in reach, as on Moje.
            <List className="panel">
              {visible.map((item) => {
                const returned = returnOf(item)
                return (
                  // The status rides with the day, so the narrow main column keeps its width.
                  <ListRow key={item.id} highlight={openId === item.id} aside={rowAction(item)}>
                    <b>
                      {slotSummary(slotsOf(item))}
                      {returned && <> <span aria-hidden="true">⇄</span> <span className="sr-only">{t.common.swapWith}</span> {slotSummary(returnSlotsOf(item))}</>}
                    </b>
                    {' '}<StatusBadge tone={statusTone[item.status]}>{statuses[item.status]}</StatusBadge>
                    {brokenRules(item).length > 0 && <> <Tag tone="bad">{t.swaps.rules.tag}</Tag></>}
                    <small>
                      {[
                        t.swaps.table.parties(party(item.requester_name), party(item.replacement_name)),
                        stageDetail(item, viewer),
                        isLapsed(item) && t.swaps.table.expired,
                      ].filter(Boolean).join(' · ')}
                    </small>
                  </ListRow>
                )
              })}
            </List>
          ) : (
            <ScrollArea label={inboxLabels[inbox]} hint={t.common.scrollHint}>
              <table className="lg">
                <thead>
                  <tr>
                    <th scope="col">{t.swaps.table.dayRole}</th>
                    <th scope="col">{t.swaps.table.gives}</th>
                    <th scope="col">{t.swaps.table.takes}</th>
                    {projecting && (
                      <th scope="col">
                        {t.swaps.table.effect}
                        <Tooltip text={t.swaps.table.effectHint}>
                          <button type="button" className="ib ib-sm th-help" aria-label={t.swaps.table.effectHelp}><Icon name="info" size={14} /></button>
                        </Tooltip>
                      </th>
                    )}
                    <th scope="col">{t.swaps.table.stage}</th>
                    <th scope="col"><span className="sr-only">{t.swaps.table.actions}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((item) => {
                    const returned = returnOf(item)
                    return (
                      <tr key={item.id} className={openId === item.id ? 'on' : undefined}>
                        <th scope="row">
                          <b>{formatDayShort(item.service_date)}</b> {roleList(slotsOf(item))}
                          {returned && <> <span aria-hidden="true">⇄</span> <span className="sr-only">{t.common.swapWith}</span> <b>{formatDayShort(returned.service_date)}</b> {roleList(returnSlotsOf(item))}</>}
                          {brokenRules(item).length > 0 && <> <Tag tone="bad">{t.swaps.rules.tag}</Tag></>}
                          <small>
                            {relativeDay(item.service_date)}
                            {returned && ` · ${t.swaps.table.exchange}`}
                            {isLapsed(item) && ` · ${t.swaps.table.expired}`}
                          </small>
                        </th>
                        <td>{item.requester_name}</td>
                        <td>{item.replacement_name}</td>
                        {projecting && <td><Effect impact={impactOfRow(item)} /></td>}
                        <td>
                          <StatusBadge tone={statusTone[item.status]}>{statuses[item.status]}</StatusBadge>
                          {stageDetail(item, viewer) && <small>{stageDetail(item, viewer)}</small>}
                        </td>
                        <td className="td-actions">{rowAction(item)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </ScrollArea>
          )}
          {inbox === 'zamkniete' && closedSwaps.hasNextPage && (
            <Button size="sm" variant="ghost" loading={closedSwaps.isFetchingNextPage} onClick={() => closedSwaps.fetchNextPage()}>{t.swaps.inbox.showOlder}</Button>
          )}
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
            {openRules.length > 0 && <Tag tone="bad">{t.swaps.rules.tag}</Tag>}
          </>
        )}
        footer={openItem && decision && (
          <>
            <Button size="sm" variant="ghost" onClick={() => openSheet(null)}>{t.common.close}</Button>
            <span className="sp" />
            {decision.withdrawable && !decision.mustDecide && (
              <Button size="sm" disabled={busy} loading={busy} onClick={() => cancel.mutate({ id: openItem.id, reason: reason.trim() || WITHDRAWN_BY_AUTHOR })}>{t.swaps.sheet.withdraw}</Button>
            )}
            {decision.mustDecide && (
              <>
                {rejecting
                  ? <Button size="sm" variant="danger" disabled={busy || !reason.trim()} loading={reject.isPending} onClick={() => reject.mutate({ id: openItem.id, reason: reason.trim() })}>{t.swaps.sheet.confirmReject}</Button>
                  : <Button size="sm" disabled={busy} onClick={() => setRejecting(true)}>{t.swaps.sheet.reject}</Button>}
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
            rejecting={rejecting}
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
        onClose={closeComposer}
        title={t.swaps.compose.title}
        wide
        footer={(
          <>
            <output className="foot-status" id="swap-send-status">{sendBlocker}</output>
            <Button variant="ghost" onClick={closeComposer}>{t.common.cancel}</Button>
            <Button
              type="submit"
              form="new-swap"
              variant="primary"
              icon="send"
              disabled={create.isPending || sendBlocker !== null}
              aria-describedby={sendBlocker ? 'swap-send-status' : undefined}
              loading={create.isPending}
            >
              {t.swaps.compose.send}
            </Button>
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
                in_return: selectedReturn && { service_date: selectedReturn.service_date, role: selectedReturn.role, scope: selectedReturn.scope ?? undefined },
                scope,
              })
            }
          }}
        >
          {!schedule?.id && publishedSchedule.error && <ErrorState error={publishedSchedule.error} onRetry={() => publishedSchedule.refetch()} />}
          <Steps
            label={t.swaps.compose.step}
            steps={[
              { label: t.swaps.compose.stepDuty, state: serviceDate ? 'done' : 'on' },
              { label: t.swaps.compose.stepCandidate, state: replacementId ? 'done' : serviceDate ? 'on' : 'todo' },
              // Optional: "nothing in return" is already picked with the replacement.
              { label: t.swaps.compose.stepReturn, state: replacementId ? 'done' : 'todo' },
              { label: t.swaps.compose.stepSend, state: replacementId ? 'on' : 'todo' },
            ]}
          />
          <Field label={t.swaps.compose.myDuty} id="swap-slot" required>
            {({ id }) => (
              <Select id={id} name="slot" value={serviceDate} onChange={(event) => pickDay(event.target.value)} required>
                <option value="" disabled>{ownDays.length === 0 ? t.swaps.compose.noUpcomingDuties : t.swaps.compose.pickDuty}</option>
                {ownDays.map((item) => (
                  <option key={item.service_date} value={item.service_date}>
                    {formatDayShort(item.service_date)} · {item.roles.map((role) => roles[role]).join(' + ')} ({relativeDay(item.service_date)}){isUnavailable(item.service_date) ? ` · ${t.swaps.compose.unavailableCollision}` : ''}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {twoRoles && given && (
            <div className="field">
              <span className="field-label">{t.swaps.compose.scope}</span>
              <Segmented
                label={t.swaps.compose.scope}
                describedBy="swap-scope-hint"
                className="seg-tight"
                value={given}
                onChange={pickChoice}
                options={[
                  { value: 'whole', label: t.swaps.compose.wholeDuty },
                  ...dayRoles.map((role) => ({ value: role, label: t.swaps.compose.only(roles[role]) })),
                ]}
              />
              <p className="field-hint" id="swap-scope-hint">
                {given === 'whole'
                  ? t.swaps.compose.wholeHint(dayRoles.map((role) => roles[role]).join(' + '))
                  : given === 'late_shift'
                    ? t.swaps.compose.keeps(roles[dayRoles[0]])
                    : t.swaps.compose.keepsLateShift}
                {splitsPair && ` ${t.swaps.compose.splitNeedsAcknowledgement}`}
              </p>
            </div>
          )}
          {/* Each card carries a name, one verdict and one number, so six
              candidates compare at a glance; what else matters about a person
              is read under their card once they are picked. */}
          <div className="stack-sm">
            <SectionHeading as="h3" title={t.swaps.compose.replacement} meta={t.swaps.compose.candidatesMeta} />
            {!serviceDate && <div className="muted small">{t.swaps.compose.pickDutyFirst}</div>}
            {serviceDate && options.isLoading && <LoadingBlock label={t.swaps.compose.searching} rows={2} />}
            {serviceDate && options.error && <ErrorState error={options.error} onRetry={() => options.refetch()} />}
            {serviceDate && options.data?.length === 0 && <EmptyState compact icon="people" title={t.swaps.compose.noCandidates} />}
            {serviceDate && orderedOptions.length > 0 && (
              <div className="rank" role="radiogroup" aria-label={t.swaps.compose.replacement}>
                {orderedOptions.map((option, index) => {
                  // What a request to this person would have to acknowledge.
                  const breaks = ownRules(option)
                  const deviation = optionDeviation(option.member_id)
                  const benefit = optionBenefit(option.member_id)
                  return (
                    <Fragment key={option.member_id}>
                      <RankChoice
                        no={index + 1}
                        title={option.display_name}
                        detail={option.availability && <AvailabilityMark kind={option.availability} withLabel />}
                        verdict={option}
                        breaks={breaks}
                        best={index === 0 && tierOf(option) === 0 && (benefit ?? 0) > 0}
                        points={deviation !== null && (
                          <span className={deviation > 0 ? 'rank-fact-warn' : 'rank-fact-ok'}>
                            {t.swaps.compose.points(signed(deviation))}
                            <span className="sr-only"> {t.swaps.compose.pointsMeaning}</span>
                          </span>
                        )}
                        radioValue={option.member_id}
                        selectedValue={replacementId}
                        navigation={candidateNavigation}
                        onSelect={pickReplacement}
                      />
                      {replacementId === option.member_id && (
                        <CandidateFacts option={option} breaks={breaks} deviation={deviation} benefit={benefit} takesOnly={given === 'whole' && twoRoles && option.slots?.length === 1 ? option.slots[0].role : undefined} />
                      )}
                    </Fragment>
                  )
                })}
              </div>
            )}
          </div>
          {selectedOption && (
            <div className="stack-sm">
              <SectionHeading as="h3" title={t.swaps.compose.inReturn} meta={t.swaps.compose.inReturnMeta(firstName(selectedOption.display_name))} />
              {returnOptions.isLoading && <LoadingBlock label={t.swaps.compose.returnSearching} rows={2} />}
              {returnOptions.error && <ErrorState error={returnOptions.error} onRetry={() => returnOptions.refetch()} />}
              {returnOptions.data?.length === 0 && (
                <div className="muted small">{t.swaps.compose.noReturnDuties(firstName(selectedOption.display_name))}</div>
              )}
              {returnOptions.data && returnOptions.data.length > 0 && (
                <div className="rank" role="radiogroup" aria-label={t.swaps.compose.inReturn}>
                  <RankChoice
                    no="–"
                    title={t.swaps.compose.nothingInReturn}
                    verdict={selectedOption}
                    breaks={selectedOption.rule_violations ?? []}
                    radioValue=""
                    selectedValue={selectedReturnValue}
                    navigation={returnNavigation}
                    onSelect={pickReturn}
                  />
                  {returnOptions.data.map((option, index) => {
                    const way = returnWays[index]
                    return (
                      <Fragment key={slotKey(option)}>
                        <RankChoice
                          no={index + 1}
                          // The day names the duty; its roles would not fit beside the verdict.
                          title={formatDayShort(option.service_date)}
                          detail={`${roleList(way.slots)} · ${relativeDay(option.service_date)}`}
                          verdict={way}
                          breaks={way.rule_violations}
                          // The first exchange that spares the request an acknowledgement.
                          best={index === 0 && Boolean(selectedOption.rule_violations?.length) && option.rule_violations.length + option.blocking_violations.length === 0}
                          radioValue={wayKey(way)}
                          selectedValue={selectedReturnValue}
                          navigation={returnNavigation}
                          onSelect={pickReturn}
                        />
                        {/* A day with two roles is taken whole or one role of it, like the day given. */}
                        {option === returnDay && option.parts?.length ? (
                          <div className="rank-sub">
                            <Segmented
                              label={t.swaps.compose.takeScope}
                              className="seg-tight"
                              value={wayKey(way)}
                              onChange={pickReturn}
                              options={waysOf(option).map((each) => ({
                                value: wayKey(each),
                                label: each.scope === 'whole' ? t.swaps.compose.wholeDuty : t.swaps.compose.only(roles[each.role]),
                              }))}
                            />
                          </div>
                        ) : null}
                      </Fragment>
                    )
                  })}
                </div>
              )}
            </div>
          )}
          {/* One frame sums the request up: the rules it breaks with their
              acknowledgement, or a clean exchange; the balance and the
              warnings fold under one line. */}
          {selectedOption && (breaksRules ? (
            <ViolationList violations={composeRules} title={t.swaps.rules.breaks}>
              {selectedReturn && <div className="box-next">{exchangeLine}</div>}
              <div className="box-next">
                {(approvalRequired ? t.swaps.compose.seenWithApproval : t.swaps.compose.seenWithoutApproval)(firstName(selectedOption.display_name))} <RulesDocsLink />
              </div>
              <Checkbox
                label={t.swaps.rules.acknowledge}
                checked={composeAcknowledged}
                onChange={(event) => setComposeAcknowledgedFor(event.target.checked ? rulesKey(composeRules) : null)}
                disabled={create.isPending}
              />
            </ViolationList>
          ) : selectedReturn && (
            <Box tone="ok" title={t.swaps.rules.exchangeClean}>{exchangeLine} {t.swaps.compose.exchangeCleanBody}</Box>
          ))}
          {serviceDate && assignmentRole && replacementId && (
            <Disclosure title={composeWarnings.length > 0 ? t.swaps.compose.details : t.swaps.compose.detailsBalance} meta={detailsMeta}>
              <div className="stack-sm">
                <ViolationList
                  violations={composeWarnings}
                  title={approvalRequired ? t.swaps.compose.warningsWithApproval : t.swaps.compose.warningsWithoutApproval}
                />
                <SwapImpactPreview
                  serviceDate={serviceDate}
                  role={assignmentRole}
                  replacementId={replacementId}
                  inReturn={selectedReturn}
                  scope={scope}
                  returnScope={selectedReturn?.scope ?? undefined}
                />
              </div>
            </Disclosure>
          )}
          <Field label={t.swaps.compose.note} id="swap-note" hint={t.swaps.compose.noteHint}>
            {({ id, describedBy }) => (
              <Textarea id={id} name="note" rows={2} value={note} aria-describedby={describedBy} onChange={(event) => setNote(event.target.value)} />
            )}
          </Field>
          {create.error instanceof ApiError && create.error.violations.length > 0 ? (
            <>
              <ViolationList violations={create.error.violations} title={create.error.message} tone="bad" refused />
              {create.error.nextStep && <Box tone="sig" title={create.error.nextStep} />}
            </>
          ) : create.error && <Box tone="bad" role="alert" focus title={create.error.message} />}
        </form>
      </Panel>
      <UnsavedChangesDialog guard={unsavedChanges} />
    </div>
  )
}
