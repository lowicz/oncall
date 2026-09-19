import { useState } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Badge,
  Box,
  Button,
  Chip,
  CircularProgress,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import ExpandMore from '@mui/icons-material/ExpandMore'
import HourglassEmpty from '@mui/icons-material/HourglassEmpty'
import PendingActions from '@mui/icons-material/PendingActions'
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline'
import HighlightOff from '@mui/icons-material/HighlightOff'
import UndoOutlined from '@mui/icons-material/UndoOutlined'
import { ApiError, AssignmentRole, RuleViolation, SwapOption, SwapRequest, SwapStatus, UserRole, api } from '../api'
import { availabilityLabels, roleLabels, swapStatusLabels } from '../lib/labels'
import { formatDay, relativeDay, warsawDate } from '../lib/dates'
import { canCoordinate, canWithdraw, groupSwaps, needsMyDecision } from '../lib/swaps'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { EmptyState } from '../components/EmptyState'
import { SwapImpactPreview } from '../components/SwapImpactPreview'

const statusVisuals: Record<SwapStatus, {
  color: 'warning' | 'info' | 'success' | 'error' | 'default'
  icon: React.ReactElement
}> = {
  pending_replacement: { color: 'warning', icon: <HourglassEmpty /> },
  pending_coordinator: { color: 'info', icon: <PendingActions /> },
  approved: { color: 'success', icon: <CheckCircleOutline /> },
  rejected: { color: 'error', icon: <HighlightOff /> },
  cancelled: { color: 'default', icon: <UndoOutlined /> },
}

function StatusChip({ status }: { status: SwapStatus }) {
  const visual = statusVisuals[status]
  return (
    <Chip
      size="small"
      color={visual.color}
      icon={visual.icon}
      label={swapStatusLabels[status]}
      variant={visual.color === 'default' ? 'outlined' : 'filled'}
    />
  )
}

type PendingAction =
  | { kind: 'reject'; id: string }
  | { kind: 'withdraw'; id: string }
  | { kind: 'approve'; id: string }
  | null

function ViolationList({
  violations,
  title,
  severity = 'warning',
}: {
  violations: RuleViolation[]
  title: string
  severity?: 'warning' | 'error'
}) {
  if (violations.length === 0) return null
  return (
    <Alert severity={severity} className="swap-violations" icon={false}>
      <Typography variant="subtitle2">{title}</Typography>
      <ul>
        {violations.map((violation, index) => (
          <li key={`${violation.rule}-${index}`}>
            <strong>{violation.member_name}</strong>: {violation.message}
            {violation.days.length > 0 && (
              <span className="date-code"> ({violation.days.map(formatDay).join(', ')})</span>
            )}
          </li>
        ))}
      </ul>
    </Alert>
  )
}

function slotSummary(slots: { service_date: string; role: AssignmentRole }[]): string {
  return slots
    .map((slot) => `${formatDay(slot.service_date)} · ${roleLabels[slot.role]}`)
    .join(' + ')
}

function SwapRow({ item, viewer, onAction, busy }: {
  item: SwapRequest
  viewer: { displayName: string; role: UserRole }
  onAction: (action: NonNullable<PendingAction>) => void
  busy: boolean
}) {
  const mustDecide = needsMyDecision(item, viewer)
  const withdrawable = canWithdraw(item, viewer)
  const expired = (item.slots?.length ? item.slots : [item]).some(
    (slot) => slot.service_date < warsawDate(),
  )
  return (
    <Box className="swap-row">
      <Box className="grow">
        <Typography className="date-code">
          {formatDay(item.service_date)} · {roleLabels[item.role]}
          <span className="swap-relative"> ({relativeDay(item.service_date)})</span>
        </Typography>
        <Typography>{item.requester_name} → {item.replacement_name}</Typography>
        {(item.slots?.length ?? 0) > 1 && (
          <Typography variant="caption" color="text.secondary">
            Obejmuje: {slotSummary(item.slots ?? [])}
          </Typography>
        )}
        {item.note && <Typography color="text.secondary">Notatka: {item.note}</Typography>}
        {item.decision_note && (
          <Typography color="text.secondary">Powód: {item.decision_note}</Typography>
        )}
        <ViolationList violations={item.warnings ?? []} title="Ostrzeżenia" />
        {expired && item.status.startsWith('pending_') && (
          <Typography color="warning.main">Termin minął</Typography>
        )}
      </Box>
      <StatusChip status={item.status} />
      <Box className="swap-actions">
        {!expired && item.status === 'pending_replacement' && item.replacement_name === viewer.displayName && (
          <Button
            variant="contained"
            size="small"
            disabled={busy}
            onClick={() => onAction({ kind: 'approve', id: item.id })}
          >
            Akceptuję
          </Button>
        )}
        {!expired && item.status === 'pending_coordinator' && canCoordinate(viewer.role) && (
          <Button
            variant="contained"
            size="small"
            disabled={busy}
            onClick={() => onAction({ kind: 'approve', id: item.id })}
          >
            Zatwierdź
          </Button>
        )}
        {mustDecide && (
          <Button
            color="error"
            size="small"
            disabled={busy}
            onClick={() => onAction({ kind: 'reject', id: item.id })}
          >
            Odrzuć
          </Button>
        )}
        {withdrawable && (
          <Button
            color="warning"
            size="small"
            disabled={busy}
            onClick={() => onAction({ kind: 'withdraw', id: item.id })}
          >
            Wycofaj
          </Button>
        )}
      </Box>
    </Box>
  )
}

export function SwapPanel({
  displayName,
  role,
  hasTeamMember,
}: {
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
  const [serviceDate, assignmentRole] = slot.split('|') as [string, AssignmentRole]
  const swaps = useQuery({ queryKey: ['swaps'], queryFn: () => api.swaps() })
  const publishedSchedule = useQuery({
    queryKey: ['published-schedule'],
    queryFn: api.publishedSchedule,
  })
  const schedule = publishedSchedule.data
  const availability = useQuery({
    queryKey: ['availability'],
    queryFn: api.availability,
    enabled: hasTeamMember,
  })
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
  // fetches for every option, not from a second fairness computation on the
  // options endpoint (MED5-09).
  const optionDeviation = (memberId: string) => {
    const index = options.data?.findIndex((option) => option.member_id === memberId) ?? -1
    const impact = index >= 0 ? optionImpacts[index]?.data : undefined
    if (!impact || !assignmentRole) return null
    return impact.replacement.before[assignmentRole].deviation
  }
  const optionBenefit = (memberId: string) => {
    const index = options.data?.findIndex((option) => option.member_id === memberId) ?? -1
    const impact = index >= 0 ? optionImpacts[index]?.data : undefined
    if (!impact || !assignmentRole) return null
    const category = impact.replacement.after[assignmentRole]
    const before = impact.replacement.before[assignmentRole]
    return Math.abs(before.deviation) - Math.abs(category.deviation)
  }
  const orderedOptions = [...(options.data ?? [])].sort((left, right) => {
    // Candidates the backend would refuse sink to the bottom - they are shown
    // with a reason, not hidden (BLK6-01), but they are not the ones to pick.
    const blockedDelta =
      Number((left.blocking_violations?.length ?? 0) > 0)
      - Number((right.blocking_violations?.length ?? 0) > 0)
    if (blockedDelta !== 0) return blockedDelta
    const leftBenefit = optionBenefit(left.member_id)
    const rightBenefit = optionBenefit(right.member_id)
    if (leftBenefit === null && rightBenefit === null) return left.display_name.localeCompare(right.display_name, 'pl')
    if (leftBenefit === null) return 1
    if (rightBenefit === null) return -1
    return rightBenefit - leftBenefit || left.display_name.localeCompare(right.display_name, 'pl')
  })
  const selectedOption = options.data?.find((option) => option.member_id === replacementId)
  // Same facts the open dropdown shows next to a candidate's name (QA7-L11),
  // but as the closed field's second line instead of inside it (QA7-L12).
  const replacementSummary = (option: SwapOption | undefined): string => {
    if (!option) return ''
    const blocked = (option.blocking_violations?.length ?? 0) > 0
    const deviation = optionDeviation(option.member_id)
    const parts = [
      deviation !== null
        ? `${Math.abs(deviation).toLocaleString('pl-PL')} pkt ${deviation > 0 ? 'powyżej' : 'poniżej'} udziału`
        : null,
      option.availability ? availabilityLabels[option.availability] : null,
      option.on_duty_that_day ? 'ma już dyżur tego dnia' : null,
      blocked
        ? `nie można: ${option.blocking_violations?.[0]?.message}`
        : (option.warning_violations?.length ?? 0) > 0
          ? 'dzieli blok dni wolnych'
          : null,
    ]
    return parts.filter(Boolean).join(' · ')
  }
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['swaps'] })
    queryClient.invalidateQueries({ queryKey: ['published-schedule'] })
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

  const isUnavailable = (serviceDate: string) => availability.data?.some(
    (item) => item.kind === 'unavailable'
      && item.starts_on <= serviceDate && item.ends_on >= serviceDate,
  ) ?? false
  const ownAssignments = (schedule?.assignments.filter(
    (item) => item.assignee_name === displayName && item.service_date >= warsawDate(),
  ) ?? []).sort((left, right) => {
    const conflict = Number(isUnavailable(right.service_date)) - Number(isUnavailable(left.service_date))
    return conflict || left.service_date.localeCompare(right.service_date)
  })
  const groups = groupSwaps(swaps.data ?? [], viewer)
  const errors = [swaps.error, create.error, accept.error, approve.error, reject.error, cancel.error]
    .find(Boolean)

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

  const renderGroup = (items: SwapRequest[]) => items.map((item) => (
    <SwapRow key={item.id} item={item} viewer={viewer} onAction={setPending} busy={busy} />
  ))

  return (
    <Box className="swaps-section" id="zamiany">
      <Box>
        <Typography className="eyebrow">[ZAMIANA DYŻURU]</Typography>
        <Typography variant="h1">Zamiany</Typography>
        <Typography color="text.secondary">
          Zamiana obejmuje wskazany dzień i rolę. Gdy polityka wiąże zmianę 11-19 z rolą
          dyżurną, prośba obejmuje oba sloty tego dnia jako jedną decyzję.
        </Typography>
      </Box>
      {hasTeamMember && (
        <Paper
          component="form"
          variant="outlined"
          className="swap-form"
          onSubmit={(event) => {
            event.preventDefault()
            if (schedule?.id && serviceDate && assignmentRole && replacementId) {
              create.mutate({
                schedule_id: schedule.id,
                service_date: serviceDate,
                role: assignmentRole,
                replacement_member_id: replacementId,
                note,
              })
            }
          }}
        >
          <TextField
            select
            id="swap-slot"
            name="slot"
            label="Mój dyżur"
            value={slot}
            onChange={(event) => { setSlot(event.target.value); setReplacementId('') }}
            required
          >
            {ownAssignments.length === 0 && (
              <MenuItem value="" disabled>Brak nadchodzących dyżurów</MenuItem>
            )}
            {ownAssignments.map((item) => (
              <MenuItem key={`${item.service_date}-${item.role}`} value={`${item.service_date}|${item.role}`}>
                {formatDay(item.service_date)} · {roleLabels[item.role]} ({relativeDay(item.service_date)})
                {isUnavailable(item.service_date) && (
                  <Chip label="kolizja: nie mogę" size="small" color="error" sx={{ ml: 1 }} />
                )}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            id="swap-replacement"
            name="replacement"
            label="Zastępca"
            value={replacementId}
            onChange={(event) => setReplacementId(event.target.value)}
            disabled={!slot || options.isLoading}
            required
            // Closed, the field shows only the name - the facts that used to be
            // packed alongside it made this field taller than its neighbours
            // (QA7-L12). They still show, as a second line below the field.
            slotProps={{
              select: {
                renderValue: (value) =>
                  orderedOptions.find((option) => option.member_id === value)?.display_name ?? '',
              },
            }}
            helperText={replacementId ? replacementSummary(selectedOption) : ' '}
          >
            {(options.data?.length ?? 0) === 0 && (
              <MenuItem value="" disabled>
                {!slot
                  ? 'Najpierw wybierz swój dyżur'
                  : options.isLoading
                    ? 'Szukam dostępnych osób…'
                    : 'Brak dostępnych zastępców'}
              </MenuItem>
            )}
            {/* Availability, current balance and a duty marker travel with the
                name, so comparing two candidates no longer means selecting each
                one and reading the impact preview twice (MED5-09). */}
            {orderedOptions.map((option) => {
              const blocked = (option.blocking_violations?.length ?? 0) > 0
              return (
                <MenuItem key={option.member_id} value={option.member_id} disabled={blocked}>
                  <span className="swap-option">
                    <span>{option.display_name}</span>
                    <span className="swap-option-facts">
                      {optionDeviation(option.member_id) !== null && (
                        <span>
                          {Math.abs(optionDeviation(option.member_id)!).toLocaleString('pl-PL')} pkt{' '}
                          {optionDeviation(option.member_id)! > 0 ? 'powyżej' : 'poniżej'} udziału
                        </span>
                      )}
                      {option.availability && <span>{availabilityLabels[option.availability]}</span>}
                      {option.on_duty_that_day && <span>ma już dyżur tego dnia</span>}
                      {blocked && (
                        <span className="swap-option-blocked">
                          nie można: {option.blocking_violations?.[0]?.message}
                        </span>
                      )}
                      {!blocked && (option.warning_violations?.length ?? 0) > 0 && (
                        <span>dzieli blok dni wolnych</span>
                      )}
                    </span>
                  </span>
                  {!blocked && (optionBenefit(option.member_id) ?? 0) > 0 && (
                    <Chip
                      label="poprawia bilans"
                      size="small"
                      color="success"
                      sx={{ ml: 1 }}
                      aria-hidden="true"
                    />
                  )}
                </MenuItem>
              )
            })}
          </TextField>
          <TextField
            id="swap-note"
            name="note"
            label="Notatka"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          {(selectedOption?.slots?.length ?? 0) > 1 && (
            <Alert severity="info" className="swap-coupled-note">
              Prośba obejmie oba sloty tego dnia:{' '}
              <strong>{slotSummary(selectedOption?.slots ?? [])}</strong>. Jedna akceptacja
              zastępcy, jedno zatwierdzenie koordynatora.
            </Alert>
          )}
          {selectedOption && (
            <ViolationList
              violations={selectedOption.warning_violations ?? []}
              title="Wyślesz mimo to - koordynator zobaczy ostrzeżenie"
            />
          )}
          <Button type="submit" variant="contained" disabled={create.isPending || !schedule?.id}>
            Wyślij prośbę
          </Button>
          {serviceDate && assignmentRole && replacementId && (
            <Box className="swap-impact-slot">
              <SwapImpactPreview
                serviceDate={serviceDate}
                role={assignmentRole}
                replacementId={replacementId}
              />
            </Box>
          )}
        </Paper>
      )}
      {create.error instanceof ApiError && create.error.violations.length > 0 ? (
        <Box>
          <ViolationList
            violations={create.error.violations}
            title={create.error.message}
            severity="error"
          />
          {create.error.nextStep && <Alert severity="info">{create.error.nextStep}</Alert>}
        </Box>
      ) : (
        errors && <Alert severity="error">{errors.message}</Alert>
      )}
      {swaps.isLoading && <CircularProgress size={24} />}

      {swaps.data && (
        <Stack spacing={2}>
          <Box>
            <Stack direction="row" alignItems="center" gap={1.5}>
              <Typography variant="h2">Wymaga Twojej akcji</Typography>
              {/* A zero badge reads as "Wymaga Twojej akcji 0" to screen readers
                  while saying the opposite, so it is not rendered at all. */}
              {groups.actionable.length > 0 && (
                <Badge badgeContent={groups.actionable.length} color="warning" />
              )}
            </Stack>
            <Paper variant="outlined" className="swap-list">
              {groups.actionable.length === 0
                ? <EmptyState
                    title="Nic nie czeka na Twoją decyzję"
                    description="Pojawią się tu wnioski, w których to Ty jesteś zastępcą albo które czekają na akceptację koordynatora."
                  />
                : renderGroup(groups.actionable)}
            </Paper>
          </Box>

          <Box>
            <Typography variant="h2">W toku ({groups.inProgress.length})</Typography>
            <Paper variant="outlined" className="swap-list">
              {groups.inProgress.length === 0
                ? <EmptyState title="Brak wniosków w toku" />
                : renderGroup(groups.inProgress)}
            </Paper>
          </Box>

          <Accordion variant="outlined" disableGutters className="swap-resolved">
            <AccordionSummary expandIcon={<ExpandMore />}>
              <Typography variant="h2">Zakończone ({groups.resolved.length})</Typography>
            </AccordionSummary>
            <AccordionDetails>
              {groups.resolved.length === 0
                ? <Typography color="text.secondary">Brak zakończonych wniosków.</Typography>
                : renderGroup(groups.resolved)}
            </AccordionDetails>
          </Accordion>
        </Stack>
      )}

      <ConfirmDialog
        open={Boolean(pending)}
        pending={busy}
        onCancel={close}
        onConfirm={confirm}
        title={
          pending?.kind === 'reject'
            ? 'Odrzucić wniosek?'
            : pending?.kind === 'withdraw'
              ? 'Wycofać wniosek?'
              : pendingItem?.status === 'pending_replacement'
                ? 'Przyjąć ten dyżur?'
                : 'Zatwierdzić zamianę?'
        }
        description={pendingItem && (
          <Stack spacing={2}>
            <span>
            {(pendingItem.slots?.length ?? 0) > 1
              ? slotSummary(pendingItem.slots ?? [])
              : `${formatDay(pendingItem.service_date)} · ${roleLabels[pendingItem.role]}`}
            {' · '}{pendingItem.requester_name} → {pendingItem.replacement_name}
            </span>
            {pendingItem.replacement_member_id && (
              <SwapImpactPreview serviceDate={pendingItem.service_date} role={pendingItem.role} replacementId={pendingItem.replacement_member_id} />
            )}
            <ViolationList violations={pendingItem.warnings ?? []} title="Ostrzeżenia przed decyzją" />
          </Stack>
        )}
        reasonLabel={
          pending?.kind === 'reject'
            ? 'Powód odrzucenia'
            : pending?.kind === 'withdraw'
              ? 'Powód wycofania'
              : undefined
        }
        confirmColor={pending?.kind === 'reject' ? 'error' : pending?.kind === 'withdraw' ? 'warning' : 'primary'}
        confirmLabel={
          pending?.kind === 'reject'
            ? 'Odrzuć'
            : pending?.kind === 'withdraw'
              ? 'Wycofaj'
              : pendingItem?.status === 'pending_replacement'
                ? 'Akceptuję'
                : 'Zatwierdź'
        }
      />
    </Box>
  )
}
