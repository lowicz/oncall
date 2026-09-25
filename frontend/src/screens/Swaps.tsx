import { Fragment, useState } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { ApiError, AssignmentRole, RuleViolation, SwapImpact, SwapRequest, SwapStatus, UserRole, api } from '../api'
import { locale, messages, useMessages } from '../i18n'
import { roleLabels, swapStatusLabels } from '../lib/labels'
import { formatDecimal, signedPoints } from '../lib/numbers'
import { formatDate, formatDayShort, relativeDay, warsawDate } from '../lib/dates'
import { SwapViewer, canCoordinate, canWithdraw, isOpen, needsMyDecision } from '../lib/swaps'
import { SwapImpactPreview } from '../components/SwapImpactPreview'
import {
  AvailabilityMark,
  Box,
  Button,
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

const slotsOf = (item: SwapRequest) => (item.slots?.length ? item.slots : [item])
const isExpired = (item: SwapRequest) => slotsOf(item).some((slot) => slot.service_date < warsawDate())

function ViolationList({ violations, title, tone = 'warn' }: {
  violations: RuleViolation[]
  title: string
  tone?: 'warn' | 'bad'
}) {
  if (violations.length === 0) return null
  return (
    <Box tone={tone} title={title}>
      <ul className="box-list">
        {violations.map((violation, index) => (
          <li key={`${violation.rule}-${index}`}>
            <b>{violation.member_name}</b>: {violation.message}
            {violation.days.length > 0 && <span className="mono muted"> ({violation.days.map(formatDate).join(', ')})</span>}
          </li>
        ))}
      </ul>
    </Box>
  )
}

function slotSummary(slots: { service_date: string; role: AssignmentRole }[]): string {
  return slots.map((slot) => `${formatDayShort(slot.service_date)} · ${roleLabels()[slot.role]}`).join(' + ')
}

/** "pon 14 wrz PRIMARY" - the day and role that name a request in a title. */
const dayRole = (slot: { service_date: string; role: AssignmentRole }) => `${formatDayShort(slot.service_date)} ${roleLabels()[slot.role]}`

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

const firstName = (name: string) => name.split(' ')[0]

/** Who acts next, under the status in the inbox table. */
function stageDetail(item: SwapRequest, viewer: SwapViewer): string {
  const t = messages().swaps.stage
  const me = (name: string) => name === viewer.displayName
  if (item.status === 'pending_replacement') return me(item.replacement_name) ? t.waitingForYou : t.waitingFor(item.replacement_name)
  if (item.status === 'pending_coordinator') {
    return canCoordinate(viewer.role)
      ? t.acceptedWaitingForYou(firstName(item.replacement_name))
      : t.acceptedWaitingForCoordinator(firstName(item.replacement_name))
  }
  if (item.status === 'approved') return t.inSchedule
  return item.decision_note ? t.reason(item.decision_note) : ''
}

/**
 * The "effect" column: who gains the points once the swap is in the schedule.
 * Read from the same impact endpoint the decision sheet uses, only for open
 * rows; a settled request no longer has a projection to show.
 */
function Effect({ impact }: { impact: SwapImpact | undefined }) {
  if (!impact) return <span className="muted">–</span>
  const gained = impact.replacement.after.total_points - impact.replacement.before.total_points
  return (
    <span className="mono">
      {firstName(impact.replacement.display_name)} {signedPoints(gained)}
    </span>
  )
}

/** What the viewer may do with a request: decide it, withdraw it, or only read it. */
function decisionOf(item: SwapRequest, viewer: SwapViewer) {
  const expired = isExpired(item)
  const pending = item.status.startsWith('pending_')
  return {
    expired,
    pending,
    mustDecide: needsMyDecision(item, viewer) && !expired,
    withdrawable: canWithdraw(item, viewer),
  }
}

/**
 * The decision sheet: who gives, who takes, the requester's reason, the
 * stage, the effect on both balances, and the reason for a rejection or a
 * withdrawal, typed here and visible to both sides. The buttons sit in the
 * panel footer, rendered by the screen.
 */
function SwapSheet({ item, viewer, approvalRequired, error, reason, onReason }: {
  item: SwapRequest
  viewer: SwapViewer
  approvalRequired: boolean
  error: Error | null
  reason: string
  onReason: (value: string) => void
}) {
  const t = useMessages().swaps.sheet
  const { expired, pending, mustDecide, withdrawable } = decisionOf(item, viewer)
  const reasonLabel = mustDecide ? t.rejectionReason : t.withdrawalReason
  return (
    <>
      <SwapSteps status={item.status} approvalRequired={approvalRequired} />
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
      <dl className="kv">
        <div className="kv-row"><dt>{t.duty}</dt><dd>{slotSummary(slotsOf(item))}</dd></div>
        <div className="kv-row"><dt>{t.filed}</dt><dd className="mono">{formatDayShort(item.created_at.slice(0, 10))}</dd></div>
      </dl>
      {item.note && <Box title={t.reasonFrom(item.requester_name)}>{t.quoted(item.note)}</Box>}
      {item.decision_note && <Box tone={item.status === 'rejected' ? 'bad' : 'muted'} title={t.decisionReason}>{t.quoted(item.decision_note)}</Box>}
      <ViolationList violations={item.warnings ?? []} title={t.warnings} />
      {item.replacement_member_id && pending && (
        <SwapImpactPreview serviceDate={item.service_date} role={item.role} replacementId={item.replacement_member_id} />
      )}
      {expired && pending && <Box tone="warn" title={t.expired} />}
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
  const [composing, setComposing] = useState(Boolean(linkedSlot) && hasTeamMember)
  const [openId, setOpenId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const openSheet = (id: string | null) => { setOpenId(id); setReason('') }
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
      queryKey: ['swap-impact', serviceDate, assignmentRole, option.member_id],
      queryFn: () => api.swapImpact(serviceDate, assignmentRole, option.member_id),
      enabled: Boolean(serviceDate && assignmentRole),
    })),
  })
  // The balance shown next to a name comes from the impact the screen already
  // fetches for every option, not from a second fairness computation (MED5-09).
  const impactOf = (memberId: string) => {
    const index = options.data?.findIndex((option) => option.member_id === memberId) ?? -1
    return index >= 0 ? optionImpacts[index]?.data : undefined
  }
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
  const orderedOptions = [...(options.data ?? [])].sort((left, right) => {
    // Candidates the backend would refuse sink to the bottom - they are shown
    // with a reason, not hidden (BLK6-01), but they are not the ones to pick.
    const blockedDelta = Number((left.blocking_violations?.length ?? 0) > 0) - Number((right.blocking_violations?.length ?? 0) > 0)
    if (blockedDelta !== 0) return blockedDelta
    const leftBenefit = optionBenefit(left.member_id)
    const rightBenefit = optionBenefit(right.member_id)
    if (leftBenefit === null && rightBenefit === null) return left.display_name.localeCompare(right.display_name, locale())
    if (leftBenefit === null) return 1
    if (rightBenefit === null) return -1
    return rightBenefit - leftBenefit || left.display_name.localeCompare(right.display_name, locale())
  })
  const selectedOption = options.data?.find((option) => option.member_id === replacementId)
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['swaps'] })
    queryClient.invalidateQueries({ queryKey: ['published-schedule'] })
    queryClient.invalidateQueries({ queryKey: ['calendar'] })
  }
  const setInbox = (value: Inbox | null) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (value) next.set('skrzynka', value)
      else next.delete('skrzynka')
      return next
    }, { replace: true })
  }
  const create = useMutation({
    mutationFn: api.createSwap,
    onSuccess: (_result, input) => {
      const name = options.data?.find((option) => option.member_id === input.replacement_member_id)?.display_name
      setSlot('')
      setReplacementId('')
      setNote('')
      setComposing(false)
      setInbox('moje')
      refresh()
      toast.success(name ? t.swaps.toasts.sentTo(name) : t.swaps.toasts.sent)
    },
  })
  const settle = (message: string) => ({
    onSuccess: () => {
      openSheet(null)
      refresh()
      toast.success(message)
    },
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
  const projected = visible.filter((item) => isOpen(item) && item.replacement_member_id && !isExpired(item))
  const rowImpacts = useQueries({
    queries: projected.map((item) => ({
      queryKey: ['swap-impact', item.service_date, item.role, item.replacement_member_id],
      queryFn: () => api.swapImpact(item.service_date, item.role, item.replacement_member_id as string),
    })),
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
  const decision = openItem ? decisionOf(openItem, viewer) : null
  const submitDisabled = create.isPending || !schedule?.id || !serviceDate || !replacementId
    || (selectedOption?.blocking_violations?.length ?? 0) > 0
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
                    const expired = isExpired(item)
                    const pending = item.status.startsWith('pending_')
                    const decide = needsMyDecision(item, viewer) && !expired
                    const verb = decide ? t.swaps.table.decide : t.swaps.table.preview
                    return (
                      <tr key={item.id} className={openId === item.id ? 'on' : undefined}>
                        <th scope="row">
                          <b>{formatDayShort(item.service_date)}</b> {roles[item.role]}
                          <small>
                            {relativeDay(item.service_date)}
                            {(item.slots?.length ?? 0) > 1 && ` · ${t.swaps.table.twoSlots}`}
                            {expired && pending && ` · ${t.swaps.table.expired}`}
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
                          <Button size="sm" variant={decide ? 'primary' : 'ghost'} onClick={() => openSheet(item.id)} aria-label={t.swaps.table.rowAction(verb, dayRole(item))}>
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
        onOpenChange={(open) => { if (!open) openSheet(null) }}
        title={openItem ? t.swaps.sheet.title(dayRole(openItem)) : ''}
        meta={openItem && <StatusBadge tone={statusTone[openItem.status]}>{statuses[openItem.status]}</StatusBadge>}
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
                  disabled={busy}
                  loading={busy}
                  onClick={() => (openItem.status === 'pending_replacement' ? accept.mutate(openItem.id) : approve.mutate(openItem.id))}
                >
                  {openItem.status === 'pending_replacement' ? t.swaps.sheet.accept : t.swaps.sheet.approve}
                </Button>
              </>
            )}
          </>
        )}
      >
        {openItem && (
          <SwapSheet item={openItem} viewer={viewer} approvalRequired={approvalRequired} error={decisionError} reason={reason} onReason={setReason} />
        )}
      </Panel>

      <Panel
        open={composing}
        onOpenChange={(open) => { if (!open) setComposing(false) }}
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
              create.mutate({ schedule_id: schedule.id, service_date: serviceDate, role: assignmentRole, replacement_member_id: replacementId, note })
            }
          }}
        >
          <Steps
            label={t.swaps.compose.step}
            steps={[
              { label: t.swaps.compose.stepDuty, state: slot ? 'done' : 'on' },
              { label: t.swaps.compose.stepCandidate, state: replacementId ? 'done' : slot ? 'on' : 'todo' },
              { label: t.swaps.compose.stepReason, state: replacementId ? 'on' : 'todo' },
            ]}
          />
          {serviceDate && assignmentRole && (
            <p className="muted small">{t.swaps.compose.giving(slotSummary([{ service_date: serviceDate, role: assignmentRole }]))}</p>
          )}
          <Field label={t.swaps.compose.myDuty} id="swap-slot" required hint={t.swaps.compose.myDutyHint}>
            {({ id }) => (
              <Select id={id} name="slot" value={slot} onChange={(event) => { setSlot(event.target.value); setReplacementId('') }} required>
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
            {slot && options.data && options.data.length === 0 && <EmptyState compact icon="people" title={t.swaps.compose.noCandidates} />}
            {slot && orderedOptions.length > 0 && (
              <div className="rank">
                {orderedOptions.map((option, index) => {
                  const blocked = (option.blocking_violations?.length ?? 0) > 0
                  const deviation = optionDeviation(option.member_id)
                  const benefit = optionBenefit(option.member_id)
                  const best = index === 0 && !blocked && (benefit ?? 0) > 0
                  return (
                    <button
                      type="button"
                      key={option.member_id}
                      role="radio"
                      aria-checked={replacementId === option.member_id}
                      disabled={blocked}
                      className={cx('rank-c', best && 'rank-best', replacementId === option.member_id && 'rank-sel', blocked && 'rank-blocked')}
                      onClick={() => setReplacementId(option.member_id)}
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
                          ].filter(Boolean).map((fact, index) => (
                            <Fragment key={index}>{index > 0 && ' · '}{fact}</Fragment>
                          ))}
                          {blocked && <span className="who-out"> {t.swaps.compose.blocked(option.blocking_violations?.[0]?.message ?? '')}</span>}
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
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          {(selectedOption?.slots?.length ?? 0) > 1 && (
            <Box tone="sig" title={t.swaps.compose.bothSlotsTitle}>
              {slotSummary(selectedOption?.slots ?? [])}. {approvalRequired ? t.swaps.compose.bothSlotsWithApproval : t.swaps.compose.bothSlotsWithoutApproval}
            </Box>
          )}
          {selectedOption && (
            <ViolationList
              violations={selectedOption.warning_violations ?? []}
              title={approvalRequired ? t.swaps.compose.warningsWithApproval : t.swaps.compose.warningsWithoutApproval}
            />
          )}
          {serviceDate && assignmentRole && replacementId && (
            <SwapImpactPreview serviceDate={serviceDate} role={assignmentRole} replacementId={replacementId} />
          )}
          <Field label={t.swaps.compose.note} id="swap-note" hint={t.swaps.compose.noteHint}>
            {({ id }) => <Textarea id={id} name="note" rows={2} value={note} onChange={(event) => setNote(event.target.value)} />}
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
