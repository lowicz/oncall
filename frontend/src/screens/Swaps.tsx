import { Fragment, useState } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { ApiError, AssignmentRole, RuleViolation, SwapImpact, SwapRequest, SwapStatus, UserRole, api } from '../api'
import { roleLabels, swapStatusLabels } from '../lib/labels'
import { pluralPl } from '../lib/plural'
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
  return slots.map((slot) => `${formatDayShort(slot.service_date)} · ${roleLabels[slot.role]}`).join(' + ')
}

/** Where a request stands: filed, replacement, coordinator, in the schedule. */
function SwapSteps({ status }: { status: SwapStatus }) {
  const done = status === 'approved'
  const stopped = status === 'rejected' || status === 'cancelled'
  return (
    <Steps
      label="Etap wniosku"
      steps={[
        { label: 'złożona', state: 'done' },
        { label: 'zastępca', state: status === 'pending_replacement' ? 'on' : stopped ? 'todo' : 'done' },
        { label: 'koordynator', state: status === 'pending_coordinator' ? 'on' : done ? 'done' : 'todo' },
        { label: stopped ? swapStatusLabels[status].toLowerCase() : 'w grafiku', state: done ? 'done' : 'todo' },
      ]}
    />
  )
}

const firstName = (name: string) => name.split(' ')[0]

/** Who acts next, under the status in the inbox table. */
function stageDetail(item: SwapRequest, viewer: SwapViewer): string {
  const me = (name: string) => name === viewer.displayName
  if (item.status === 'pending_replacement') return me(item.replacement_name) ? 'czeka na Ciebie' : `czeka na: ${item.replacement_name}`
  if (item.status === 'pending_coordinator') {
    return `${firstName(item.replacement_name)} zgodził(a) się · czeka na ${canCoordinate(viewer.role) ? 'Ciebie' : 'koordynatora'}`
  }
  if (item.status === 'approved') return 'wpisana do grafiku'
  return item.decision_note ? `powód: „${item.decision_note}”` : ''
}

/**
 * The "skutek" column: who gains the points once the swap is in the schedule.
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
    acceptLabel: item.status === 'pending_replacement' ? 'Akceptuję' : 'Zatwierdź i wpisz do grafiku',
  }
}

/**
 * The decision sheet: who gives, who takes, the requester's reason, the
 * stage, the effect on both balances, and the reason for a rejection or a
 * withdrawal, typed here and visible to both sides. The buttons sit in the
 * panel footer, rendered by the screen.
 */
function SwapSheet({ item, viewer, error, reason, onReason }: {
  item: SwapRequest
  viewer: SwapViewer
  error: Error | null
  reason: string
  onReason: (value: string) => void
}) {
  const { expired, pending, mustDecide, withdrawable } = decisionOf(item, viewer)
  const reasonLabel = mustDecide ? 'Powód odrzucenia · widoczny dla obu stron' : 'Powód wycofania'
  return (
    <>
      <SwapSteps status={item.status} />
      <div className="roles">
        <div className="role-row">
          <span className="role-r role-r-p">Oddaje</span>
          <span className="role-n">{item.requester_name}</span>
          <span className="role-x">{item.requester_name === viewer.displayName ? 'to Ty' : ''}</span>
        </div>
        <div className={cx('role-row', item.status === 'pending_coordinator' && 'role-row-sel')}>
          <span className="role-r role-r-s">Przejmuje</span>
          <span className="role-n">{item.replacement_name}</span>
          <span className="role-x">{item.status === 'pending_coordinator' ? 'zgodził(a) się' : item.replacement_name === viewer.displayName ? 'to Ty' : ''}</span>
        </div>
      </div>
      <dl className="kv">
        <div className="kv-row"><dt>Dyżur</dt><dd>{slotSummary(slotsOf(item))}</dd></div>
        <div className="kv-row"><dt>Złożona</dt><dd className="mono">{formatDayShort(item.created_at.slice(0, 10))}</dd></div>
      </dl>
      {item.note && <Box title={`Powód od: ${item.requester_name}`}>„{item.note}”</Box>}
      {item.decision_note && <Box tone={item.status === 'rejected' ? 'bad' : 'muted'} title="Powód decyzji">„{item.decision_note}”</Box>}
      <ViolationList violations={item.warnings ?? []} title="Ostrzeżenia" />
      {item.replacement_member_id && pending && (
        <SwapImpactPreview serviceDate={item.service_date} role={item.role} replacementId={item.replacement_member_id} />
      )}
      {expired && pending && <Box tone="warn" title="Termin dyżuru minął." />}
      {(mustDecide || withdrawable) && (
        <Field label={reasonLabel} id={`swap-reason-${item.id}`} hint={mustDecide ? 'Wymagany tylko przy odrzuceniu.' : 'Wymagany przy wycofaniu.'}>
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
  const queryClient = useQueryClient()
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const viewer = { displayName, role }
  const coordinator = canCoordinate(role)
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
      toast.success(name ? `Wysłano do: ${name}` : 'Wysłano prośbę o zamianę')
    },
  })
  const settle = (message: string) => ({
    onSuccess: () => {
      openSheet(null)
      refresh()
      toast.success(message)
    },
  })
  const accept = useMutation({ mutationFn: api.acceptSwap, ...settle('Przyjęto dyżur') })
  const approve = useMutation({ mutationFn: api.approveSwap, ...settle('Zamiana wpisana do grafiku') })
  const reject = useMutation({ mutationFn: api.rejectSwap, ...settle('Odrzucono zamianę') })
  const cancel = useMutation({ mutationFn: api.cancelSwap, ...settle('Wycofano zamianę') })
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
  // A coordinator's "Do zatwierdzenia" lists every open request of others, but
  // its badge counts only those waiting for approval, as the header does.
  const awaitingApproval = items.filter((item) => inboxOf(item, displayName) === 'w-toku' && needsMyDecision(item, viewer)).length
  const badges: Record<Inbox, number> = { ...counts, 'w-toku': coordinator ? awaitingApproval : counts['w-toku'] }
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
  // One projection per open row, for the "skutek" column.
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
    'do-mnie': 'Do mnie',
    moje: 'Moje',
    'w-toku': coordinator ? 'Do zatwierdzenia' : 'W toku',
    zamkniete: 'Zamknięte',
  }
  const openItem = openId ? items.find((entry) => entry.id === openId) : undefined
  const decision = openItem ? decisionOf(openItem, viewer) : null
  const submitDisabled = create.isPending || !schedule?.id || !serviceDate || !replacementId
    || (selectedOption?.blocking_violations?.length ?? 0) > 0
  const subtitle = swaps.data && [
    `${pluralPl(actionable, ['czeka', 'czekają', 'czeka'])} na Twoją decyzję`,
    `${pluralPl(otherOpen, ['czeka', 'czekają', 'czeka'])} na drugą stronę`,
    pluralPl(counts.zamkniete, ['zamknięta', 'zamknięte', 'zamkniętych']),
  ].join(' · ')

  return (
    <div className="page">
      <PageHeader
        title="Zamiany"
        sub={subtitle}
        actions={hasTeamMember && (
          <Button variant="primary" icon="plus" onClick={() => setComposing(true)}>Nowa zamiana</Button>
        )}
      />
      {swaps.error && <ErrorState error={swaps.error} onRetry={() => swaps.refetch()} />}
      {swaps.isLoading && <LoadingBlock label="Wczytywanie zamian" />}
      {swaps.data && (
        <>
          <SectionHeading
            title="Skrzynka"
            controls={INBOXES.map((value) => (
              <button
                key={value}
                type="button"
                className={cx('sech-link', inbox === value && 'on')}
                aria-pressed={inbox === value}
                // The badge would otherwise run into the label ("Do mnie0").
                aria-label={value === 'zamkniete' ? undefined : `${inboxLabels[value]}: ${pluralPl(badges[value], ['sprawa', 'sprawy', 'spraw'])}`}
                onClick={() => setInbox(value)}
              >
                {inboxLabels[value]}
                {value !== 'zamkniete' && (
                  <Tag tone={value === 'w-toku' && coordinator && badges[value] > 0 ? 'late' : undefined} className="tab-count">
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
                  title="Nikt Cię o nic nie prosi"
                  description="Gdy ktoś zaproponuje Ci zamianę, zobaczysz ją tutaj i w liczniku w szynie. Własną zaczniesz przyciskiem „Nowa zamiana” albo z ekranu Moje."
                  action={hasTeamMember && <LinkButton to="/moje" size="sm">Moje dyżury</LinkButton>}
                />
              ) : inbox === 'moje' ? (
                <EmptyState compact icon="swap" title="Nie masz otwartych próśb" description={hasTeamMember ? 'Nowa zamiana zaczyna się od Twojego dyżuru.' : undefined} />
              ) : inbox === 'w-toku' ? (
                <EmptyState compact icon="check" title={coordinator ? 'Nic nie czeka na zatwierdzenie' : 'Brak zamian w toku'} />
              ) : (
                <EmptyState compact icon="swap" title="Brak zamkniętych zamian" />
              )}
            </div>
          ) : (
            <div className="panel tbl-wrap">
              <table className="lg">
                <thead>
                  <tr>
                    <th scope="col">Dzień · rola</th>
                    <th scope="col">Oddaje</th>
                    <th scope="col">Przejmuje</th>
                    <th scope="col">Skutek pkt</th>
                    <th scope="col">Etap</th>
                    <th scope="col"><span className="sr-only">Akcje</span></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((item) => {
                    const expired = isExpired(item)
                    const pending = item.status.startsWith('pending_')
                    const decide = needsMyDecision(item, viewer) && !expired
                    return (
                      <tr key={item.id} className={openId === item.id ? 'on' : undefined}>
                        <th scope="row">
                          <b>{formatDayShort(item.service_date)}</b> {roleLabels[item.role]}
                          <small>
                            {relativeDay(item.service_date)}
                            {(item.slots?.length ?? 0) > 1 && ' · 2 sloty'}
                            {expired && pending && ' · termin minął'}
                          </small>
                        </th>
                        <td>{item.requester_name}</td>
                        <td>{item.replacement_name}</td>
                        <td><Effect impact={impactOfRow(item)} /></td>
                        <td>
                          <StatusBadge tone={statusTone[item.status]}>{swapStatusLabels[item.status]}</StatusBadge>
                          {stageDetail(item, viewer) && <small>{stageDetail(item, viewer)}</small>}
                        </td>
                        <td className="td-actions">
                          <Button size="sm" variant={decide ? 'primary' : 'ghost'} onClick={() => openSheet(item.id)} aria-label={`${decide ? 'Zdecyduj' : 'Podgląd'}: ${formatDayShort(item.service_date)} ${roleLabels[item.role]}`}>
                            {decide ? 'Zdecyduj' : 'Podgląd'}
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted small">Etap zamiany zawsze mówi, kto jest następny; kolumna „skutek” pokazuje osobę, która zyskuje punkty. Zatwierdzenie wpisuje zamianę do grafiku i do audytu w jednym kroku.</p>
        </>
      )}

      <Panel
        open={Boolean(openItem)}
        onOpenChange={(open) => { if (!open) openSheet(null) }}
        title={openItem ? `Zamiana · ${formatDayShort(openItem.service_date)} ${roleLabels[openItem.role]}` : ''}
        meta={openItem && <StatusBadge tone={statusTone[openItem.status]}>{swapStatusLabels[openItem.status]}</StatusBadge>}
        footer={openItem && decision && (
          <>
            <Button size="sm" variant="ghost" onClick={() => openSheet(null)}>Zamknij</Button>
            <span className="sp" />
            {decision.withdrawable && !decision.mustDecide && (
              <Button size="sm" disabled={busy || !reason.trim()} loading={busy} onClick={() => cancel.mutate({ id: openItem.id, reason: reason.trim() })}>Wycofaj</Button>
            )}
            {decision.mustDecide && (
              <>
                <Button size="sm" variant="danger" disabled={busy || !reason.trim()} onClick={() => reject.mutate({ id: openItem.id, reason: reason.trim() })}>Odrzuć</Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={busy}
                  loading={busy}
                  onClick={() => (openItem.status === 'pending_replacement' ? accept.mutate(openItem.id) : approve.mutate(openItem.id))}
                >
                  {decision.acceptLabel}
                </Button>
              </>
            )}
          </>
        )}
      >
        {openItem && (
          <SwapSheet item={openItem} viewer={viewer} error={decisionError} reason={reason} onReason={setReason} />
        )}
      </Panel>

      <Panel
        open={composing}
        onOpenChange={(open) => { if (!open) setComposing(false) }}
        title="Nowa zamiana"
        wide
        footer={(
          <>
            <Button variant="ghost" onClick={() => setComposing(false)}>Anuluj</Button>
            <span className="sp" />
            <Button type="submit" form="new-swap" variant="primary" icon="send" disabled={submitDisabled} loading={create.isPending}>Wyślij prośbę</Button>
          </>
        )}
      >
        <form
          id="new-swap"
          className="stack-sm"
          aria-label="Nowa prośba o zamianę"
          onSubmit={(event) => {
            event.preventDefault()
            if (schedule?.id && serviceDate && assignmentRole && replacementId) {
              create.mutate({ schedule_id: schedule.id, service_date: serviceDate, role: assignmentRole, replacement_member_id: replacementId, note })
            }
          }}
        >
          <Steps
            label="Krok"
            steps={[
              { label: '1 dyżur', state: slot ? 'done' : 'on' },
              { label: '2 kandydat', state: replacementId ? 'done' : slot ? 'on' : 'todo' },
              { label: '3 powód i wysłanie', state: replacementId ? 'on' : 'todo' },
            ]}
          />
          {serviceDate && assignmentRole && (
            <p className="muted small">Oddajesz: {formatDayShort(serviceDate)} · {roleLabels[assignmentRole]}</p>
          )}
          <Field label="Mój dyżur" id="swap-slot" required hint="Dzień i rola z opublikowanego grafiku.">
            {({ id }) => (
              <Select id={id} name="slot" value={slot} onChange={(event) => { setSlot(event.target.value); setReplacementId('') }} required>
                <option value="" disabled>{ownAssignments.length === 0 ? 'Brak nadchodzących dyżurów' : 'Wybierz dyżur'}</option>
                {ownAssignments.map((item) => (
                  <option key={`${item.service_date}-${item.role}`} value={`${item.service_date}|${item.role}`}>
                    {formatDayShort(item.service_date)} · {roleLabels[item.role]} ({relativeDay(item.service_date)}){isUnavailable(item.service_date) ? ' · kolizja: nie mogę' : ''}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {/* Availability, current balance and a duty marker travel with the
              name, so comparing two candidates no longer means selecting each
              one and reading the impact preview twice (MED5-09). */}
          <div className="stack-sm" role="radiogroup" aria-label="Zastępca">
            <SectionHeading as="h3" title="Kandydaci" meta="posortowani wg dopasowania" />
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
                      <span className="rank-no">{blocked ? '–' : index + 1}</span>
                      <span className="rank-nm">
                        {option.display_name}
                        <small>
                          {[
                            option.availability && <AvailabilityMark key="av" kind={option.availability} withLabel />,
                            option.on_duty_that_day && 'ma już dyżur tego dnia',
                            (option.slots?.length ?? 0) > 1 && 'obejmie oba sloty dnia',
                            !blocked && (option.warning_violations?.length ?? 0) > 0 && 'dzieli blok dni wolnych',
                          ].filter(Boolean).map((fact, index) => (
                            <Fragment key={index}>{index > 0 && ' · '}{fact}</Fragment>
                          ))}
                          {blocked && <span className="who-out"> nie można: {option.blocking_violations?.[0]?.message}</span>}
                        </small>
                      </span>
                      <span className="rank-facts">
                        {deviation !== null && (
                          <span className={cx(deviation > 0 ? 'rank-fact-warn' : 'rank-fact-ok')}>
                            {formatDecimal(Math.abs(deviation))} pkt {deviation > 0 ? 'powyżej' : 'poniżej'} udziału
                          </span>
                        )}
                        {!blocked && (benefit ?? 0) > 0 && <span className="rank-fact-ok">poprawia bilans</span>}
                        {blocked && <span className="rank-fact-bad">reguła twarda</span>}
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
          <Field label="Powód" id="swap-note" hint="Zobaczą zastępca i koordynator.">
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
