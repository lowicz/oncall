import { useState } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { ApiError, AssignmentRole, RuleViolation, SwapRequest, SwapStatus, UserRole, api } from '../api'
import { roleLabels, swapStatusLabels } from '../lib/labels'
import { formatDate, formatDay, relativeDay, warsawDate } from '../lib/dates'
import { canCoordinate, canWithdraw, groupSwaps, needsMyDecision } from '../lib/swaps'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { SwapImpactPreview } from '../components/SwapImpactPreview'
import {
  AvailabilityMark,
  Box,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  List,
  ListRow,
  LoadingBlock,
  PageHeader,
  Panel,
  RoleMark,
  SectionHeading,
  Select,
  StatusBadge,
  StatusTone,
  Steps,
  Tag,
  cx,
} from '../ui'

const statusTone: Record<SwapStatus, StatusTone> = {
  pending_replacement: 'warn',
  pending_coordinator: 'sig',
  approved: 'ok',
  rejected: 'bad',
  cancelled: 'muted',
}

type PendingAction =
  | { kind: 'reject'; id: string }
  | { kind: 'withdraw'; id: string }
  | { kind: 'approve'; id: string }
  | null

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
  return slots.map((slot) => `${formatDay(slot.service_date)} · ${roleLabels[slot.role]}`).join(' + ')
}

/** Where a request stands: replacement first, coordinator second, done. */
function SwapSteps({ status }: { status: SwapStatus }) {
  const done = status === 'approved'
  const stopped = status === 'rejected' || status === 'cancelled'
  return (
    <Steps
      label="Etap wniosku"
      steps={[
        { label: 'zastępca', state: status === 'pending_replacement' ? 'on' : stopped ? 'todo' : 'done' },
        { label: 'koordynator', state: status === 'pending_coordinator' ? 'on' : done ? 'done' : 'todo' },
        { label: stopped ? swapStatusLabels[status].toLowerCase() : 'w grafiku', state: done ? 'done' : 'todo' },
      ]}
    />
  )
}

function SwapRow({ item, viewer, onAction, busy, onOpen, open }: {
  item: SwapRequest
  viewer: { displayName: string; role: UserRole }
  onAction: (action: NonNullable<PendingAction>) => void
  busy: boolean
  onOpen: () => void
  open: boolean
}) {
  const mustDecide = needsMyDecision(item, viewer)
  const withdrawable = canWithdraw(item, viewer)
  const expired = (item.slots?.length ? item.slots : [item]).some((slot) => slot.service_date < warsawDate())
  const pendingStatus = item.status.startsWith('pending_')
  return (
    <ListRow
      highlight={open}
      tone={expired && pendingStatus ? 'warn' : undefined}
      aside={(
        <>
          <StatusBadge tone={statusTone[item.status]}>{swapStatusLabels[item.status]}</StatusBadge>
          {!expired && item.status === 'pending_replacement' && item.replacement_name === viewer.displayName && (
            <Button variant="primary" size="sm" disabled={busy} onClick={() => onAction({ kind: 'approve', id: item.id })}>Akceptuję</Button>
          )}
          {!expired && item.status === 'pending_coordinator' && canCoordinate(viewer.role) && (
            <Button variant="primary" size="sm" disabled={busy} onClick={() => onAction({ kind: 'approve', id: item.id })}>Zatwierdź</Button>
          )}
          {mustDecide && (
            <Button size="sm" variant="danger" disabled={busy} onClick={() => onAction({ kind: 'reject', id: item.id })}>Odrzuć</Button>
          )}
          {withdrawable && (
            <Button size="sm" disabled={busy} onClick={() => onAction({ kind: 'withdraw', id: item.id })}>Wycofaj</Button>
          )}
          <Button size="sm" variant="ghost" onClick={onOpen} aria-expanded={open}>Szczegóły</Button>
        </>
      )}
    >
      <div className="row">
        <RoleMark role={item.role} />
        <b>{formatDay(item.service_date)}</b>
        <span className="muted small">{relativeDay(item.service_date)}</span>
        {(item.slots?.length ?? 0) > 1 && <Tag tone="sig">2 sloty</Tag>}
        {expired && pendingStatus && <Tag tone="bad">termin minął</Tag>}
      </div>
      <small>
        {item.requester_name} → {item.replacement_name}
        {item.note ? ` · „${item.note}”` : ''}
      </small>
    </ListRow>
  )
}

/** The side panel with everything about one request. */
function SwapDetails({ item, viewer, onAction, busy }: {
  item: SwapRequest
  viewer: { displayName: string; role: UserRole }
  onAction: (action: NonNullable<PendingAction>) => void
  busy: boolean
}) {
  const expired = (item.slots?.length ? item.slots : [item]).some((slot) => slot.service_date < warsawDate())
  const mustDecide = needsMyDecision(item, viewer)
  const withdrawable = canWithdraw(item, viewer)
  return (
    <>
      <SwapSteps status={item.status} />
      <div className="kv">
        <div className="kv-row"><dt>Dyżur</dt><dd>{(item.slots?.length ?? 0) > 1 ? slotSummary(item.slots ?? []) : `${formatDay(item.service_date)} · ${roleLabels[item.role]}`}</dd></div>
        <div className="kv-row"><dt>Oddaje</dt><dd>{item.requester_name}</dd></div>
        <div className="kv-row"><dt>Przejmuje</dt><dd>{item.replacement_name}</dd></div>
        <div className="kv-row"><dt>Zgłoszono</dt><dd className="mono">{formatDate(item.created_at)}</dd></div>
        {item.note && <div className="kv-row"><dt>Notatka</dt><dd>{item.note}</dd></div>}
        {item.decision_note && <div className="kv-row"><dt>Powód decyzji</dt><dd>{item.decision_note}</dd></div>}
      </div>
      <ViolationList violations={item.warnings ?? []} title="Ostrzeżenia" />
      {item.replacement_member_id && item.status.startsWith('pending_') && (
        <SwapImpactPreview serviceDate={item.service_date} role={item.role} replacementId={item.replacement_member_id} />
      )}
      {expired && item.status.startsWith('pending_') && <Box tone="warn" title="Termin dyżuru minął." />}
      <div className="row">
        {!expired && item.status === 'pending_replacement' && item.replacement_name === viewer.displayName && (
          <Button variant="primary" disabled={busy} onClick={() => onAction({ kind: 'approve', id: item.id })}>Akceptuję</Button>
        )}
        {!expired && item.status === 'pending_coordinator' && canCoordinate(viewer.role) && (
          <Button variant="primary" disabled={busy} onClick={() => onAction({ kind: 'approve', id: item.id })}>Zatwierdź</Button>
        )}
        {mustDecide && <Button variant="danger" disabled={busy} onClick={() => onAction({ kind: 'reject', id: item.id })}>Odrzuć</Button>}
        {withdrawable && <Button disabled={busy} onClick={() => onAction({ kind: 'withdraw', id: item.id })}>Wycofaj</Button>}
      </div>
    </>
  )
}

export function SwapPanel({ displayName, role, hasTeamMember }: {
  displayName: string
  role: UserRole
  hasTeamMember: boolean
}) {
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const viewer = { displayName, role }
  const [slot, setSlot] = useState(() => {
    const serviceDate = searchParams.get('date') ?? searchParams.get('data')
    const assignmentRole = searchParams.get('role') ?? searchParams.get('rola')
    return serviceDate && assignmentRole ? `${serviceDate}|${assignmentRole}` : ''
  })
  const [replacementId, setReplacementId] = useState('')
  const [note, setNote] = useState('')
  const [pending, setPending] = useState<PendingAction>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [showResolved, setShowResolved] = useState(false)
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
    if (leftBenefit === null && rightBenefit === null) return left.display_name.localeCompare(right.display_name, 'pl')
    if (leftBenefit === null) return 1
    if (rightBenefit === null) return -1
    return rightBenefit - leftBenefit || left.display_name.localeCompare(right.display_name, 'pl')
  })
  const selectedOption = options.data?.find((option) => option.member_id === replacementId)
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['swaps'] })
    queryClient.invalidateQueries({ queryKey: ['published-schedule'] })
    queryClient.invalidateQueries({ queryKey: ['calendar'] })
  }
  const create = useMutation({
    mutationFn: api.createSwap,
    onSuccess: () => {
      setSlot('')
      setReplacementId('')
      setNote('')
      refresh()
    },
  })
  const close = () => setPending(null)
  const settle = { onSuccess: () => { close(); refresh() } }
  const accept = useMutation({ mutationFn: api.acceptSwap, ...settle })
  const approve = useMutation({ mutationFn: api.approveSwap, ...settle })
  const reject = useMutation({ mutationFn: api.rejectSwap, ...settle })
  const cancel = useMutation({ mutationFn: api.cancelSwap, ...settle })
  const busy = accept.isPending || approve.isPending || reject.isPending || cancel.isPending

  const isUnavailable = (date: string) => availability.data?.some(
    (item) => item.kind === 'unavailable' && item.starts_on <= date && item.ends_on >= date,
  ) ?? false
  const ownAssignments = (schedule?.assignments.filter(
    (item) => item.assignee_name === displayName && item.service_date >= warsawDate(),
  ) ?? []).sort((left, right) => {
    const conflict = Number(isUnavailable(right.service_date)) - Number(isUnavailable(left.service_date))
    return conflict || left.service_date.localeCompare(right.service_date)
  })
  const groups = groupSwaps(swaps.data ?? [], viewer)
  const errors = [swaps.error, accept.error, approve.error, reject.error, cancel.error].find(Boolean)

  const confirm = (reason: string) => {
    if (!pending) return
    if (pending.kind === 'reject') reject.mutate({ id: pending.id, reason })
    else if (pending.kind === 'withdraw') cancel.mutate({ id: pending.id, reason })
    else {
      // Choose the endpoint from the row's own status; falling through to
      // approve would send a member at the coordinator-only endpoint.
      const item = swaps.data?.find((entry) => entry.id === pending.id)
      if (!item) return
      if (item.status === 'pending_replacement') accept.mutate(pending.id)
      else if (item.status === 'pending_coordinator') approve.mutate(pending.id)
    }
  }
  const pendingItem = pending ? swaps.data?.find((entry) => entry.id === pending.id) : undefined
  const openItem = openId ? swaps.data?.find((entry) => entry.id === openId) : undefined

  const renderGroup = (items: SwapRequest[]) => items.map((item) => (
    <SwapRow key={item.id} item={item} viewer={viewer} onAction={setPending} busy={busy} open={openId === item.id} onOpen={() => setOpenId(item.id)} />
  ))
  const submitDisabled = create.isPending || !schedule?.id || !serviceDate || !replacementId
    || (selectedOption?.blocking_violations?.length ?? 0) > 0

  return (
    <div className="page">
      <PageHeader
        title="Zamiany"
        sub="Zamiana obejmuje wskazany dzień i rolę. Gdy polityka wiąże zmianę 11–19 z rolą dyżurną, prośba obejmuje oba sloty tego dnia jako jedną decyzję."
      />
      {hasTeamMember && (
        <form
          className="panel panel-padded stack-sm"
          aria-label="Nowa prośba o zamianę"
          onSubmit={(event) => {
            event.preventDefault()
            if (schedule?.id && serviceDate && assignmentRole && replacementId) {
              create.mutate({ schedule_id: schedule.id, service_date: serviceDate, role: assignmentRole, replacement_member_id: replacementId, note })
            }
          }}
        >
          <SectionHeading as="h3" title="Nowa prośba" meta="dzień i rola z opublikowanego grafiku" />
          <div className="frow">
            <Field label="Mój dyżur" id="swap-slot" required>
              {({ id }) => (
                <Select id={id} name="slot" value={slot} onChange={(event) => { setSlot(event.target.value); setReplacementId('') }} required>
                  <option value="" disabled>{ownAssignments.length === 0 ? 'Brak nadchodzących dyżurów' : 'Wybierz dyżur'}</option>
                  {ownAssignments.map((item) => (
                    <option key={`${item.service_date}-${item.role}`} value={`${item.service_date}|${item.role}`}>
                      {formatDay(item.service_date)} · {roleLabels[item.role]} ({relativeDay(item.service_date)}){isUnavailable(item.service_date) ? ' · kolizja: nie mogę' : ''}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Notatka dla zastępcy" id="swap-note">
              {({ id }) => <Input id={id} name="note" value={note} onChange={(event) => setNote(event.target.value)} />}
            </Field>
          </div>
          {/* Availability, current balance and a duty marker travel with the
              name, so comparing two candidates no longer means selecting each
              one and reading the impact preview twice (MED5-09). */}
          <div className="stack-sm" role="radiogroup" aria-label="Zastępca">
            <span className="field-label">Zastępca <span className="field-req">*</span></span>
            {!slot && <div className="muted small">Najpierw wybierz swój dyżur.</div>}
            {slot && options.isLoading && <LoadingBlock label="Szukam dostępnych osób" rows={2} />}
            {slot && options.error && <ErrorState error={options.error} onRetry={() => options.refetch()} />}
            {slot && options.data && options.data.length === 0 && <EmptyState compact icon="people" title="Brak dostępnych zastępców" />}
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
                      <span className="rank-no">{index + 1}</span>
                      <span className="rank-nm">
                        {option.display_name}
                        <small>
                          {option.availability && <AvailabilityMark kind={option.availability} withLabel />}
                          {option.on_duty_that_day && ' · ma już dyżur tego dnia'}
                          {(option.slots?.length ?? 0) > 1 && ' · obejmie oba sloty dnia'}
                          {blocked && <span className="who-out"> nie można: {option.blocking_violations?.[0]?.message}</span>}
                          {!blocked && (option.warning_violations?.length ?? 0) > 0 && ' · dzieli blok dni wolnych'}
                        </small>
                      </span>
                      <span className="rank-facts">
                        {deviation !== null && (
                          <span className={cx(deviation > 0 ? 'rank-fact-warn' : 'rank-fact-ok')}>
                            {Math.abs(deviation).toLocaleString('pl-PL')} pkt {deviation > 0 ? 'powyżej' : 'poniżej'} udziału
                          </span>
                        )}
                        {!blocked && (benefit ?? 0) > 0 && <span className="rank-fact-ok">poprawia bilans</span>}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          {(selectedOption?.slots?.length ?? 0) > 1 && (
            <Box tone="sig" title="Prośba obejmie oba sloty tego dnia">
              {slotSummary(selectedOption?.slots ?? [])}. Jedna akceptacja zastępcy, jedno zatwierdzenie koordynatora.
            </Box>
          )}
          {selectedOption && <ViolationList violations={selectedOption.warning_violations ?? []} title="Wyślesz mimo to - koordynator zobaczy ostrzeżenie" />}
          {serviceDate && assignmentRole && replacementId && (
            <SwapImpactPreview serviceDate={serviceDate} role={assignmentRole} replacementId={replacementId} />
          )}
          {create.error instanceof ApiError && create.error.violations.length > 0 ? (
            <>
              <ViolationList violations={create.error.violations} title={create.error.message} tone="bad" />
              {create.error.nextStep && <Box tone="sig" title={create.error.nextStep} />}
            </>
          ) : create.error && <Box tone="bad" role="alert" title={create.error.message} />}
          <div className="row">
            <Button type="submit" variant="primary" icon="send" disabled={submitDisabled} loading={create.isPending}>Wyślij prośbę</Button>
          </div>
        </form>
      )}
      {errors && <Box tone="bad" role="alert" title={errors.message} />}
      {swaps.isLoading && <LoadingBlock label="Wczytywanie zamian" />}
      {swaps.data && (
        <>
          <section className="stack-sm">
            <SectionHeading title="Wymaga Twojej decyzji" meta={groups.actionable.length > 0 ? `${groups.actionable.length} do decyzji` : undefined} />
            {groups.actionable.length === 0
              ? <EmptyState compact icon="check" title="Nic nie czeka na Twoją decyzję" description="Pojawią się tu wnioski, w których to Ty jesteś zastępcą albo które czekają na akceptację koordynatora." />
              : <List className="panel">{renderGroup(groups.actionable)}</List>}
          </section>
          <section className="stack-sm">
            <SectionHeading title="W toku" meta={`${groups.inProgress.length}`} />
            {groups.inProgress.length === 0
              ? <EmptyState compact icon="swap" title="Brak wniosków w toku" />
              : <List className="panel">{renderGroup(groups.inProgress)}</List>}
          </section>
          <section className="stack-sm">
            <SectionHeading
              title="Zakończone"
              meta={`${groups.resolved.length}`}
              controls={groups.resolved.length > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setShowResolved((open) => !open)} aria-expanded={showResolved}>
                  {showResolved ? 'Ukryj' : 'Pokaż'}
                </Button>
              )}
            />
            {showResolved && (groups.resolved.length === 0
              ? <p className="muted">Brak zakończonych wniosków.</p>
              : <List className="panel">{renderGroup(groups.resolved)}</List>)}
          </section>
        </>
      )}

      <Panel
        open={Boolean(openItem)}
        onOpenChange={(open) => { if (!open) setOpenId(null) }}
        title={openItem ? `${formatDay(openItem.service_date)} · ${roleLabels[openItem.role]}` : ''}
        meta={openItem && <StatusBadge tone={statusTone[openItem.status]}>{swapStatusLabels[openItem.status]}</StatusBadge>}
      >
        {openItem && <SwapDetails item={openItem} viewer={viewer} onAction={setPending} busy={busy} />}
      </Panel>

      <ConfirmDialog
        open={Boolean(pending)}
        pending={busy}
        onCancel={close}
        onConfirm={confirm}
        title={pending?.kind === 'reject'
          ? 'Odrzucić wniosek?'
          : pending?.kind === 'withdraw'
            ? 'Wycofać wniosek?'
            : pendingItem?.status === 'pending_replacement'
              ? 'Przyjąć ten dyżur?'
              : 'Zatwierdzić zamianę?'}
        description={pendingItem && (
          <>
            <div>
              {(pendingItem.slots?.length ?? 0) > 1
                ? slotSummary(pendingItem.slots ?? [])
                : `${formatDay(pendingItem.service_date)} · ${roleLabels[pendingItem.role]}`}
              {' · '}{pendingItem.requester_name} → {pendingItem.replacement_name}
            </div>
            {pendingItem.replacement_member_id && pending?.kind === 'approve' && (
              <SwapImpactPreview serviceDate={pendingItem.service_date} role={pendingItem.role} replacementId={pendingItem.replacement_member_id} />
            )}
            <ViolationList violations={pendingItem.warnings ?? []} title="Ostrzeżenia przed decyzją" />
          </>
        )}
        reasonLabel={pending?.kind === 'reject' ? 'Powód odrzucenia' : pending?.kind === 'withdraw' ? 'Powód wycofania' : undefined}
        confirmColor={pending?.kind === 'reject' ? 'error' : pending?.kind === 'withdraw' ? 'warning' : 'primary'}
        confirmLabel={pending?.kind === 'reject'
          ? 'Odrzuć'
          : pending?.kind === 'withdraw'
            ? 'Wycofaj'
            : pendingItem?.status === 'pending_replacement'
              ? 'Akceptuję'
              : 'Zatwierdź'}
      />
    </div>
  )
}
