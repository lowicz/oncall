import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import DeleteOutline from '@mui/icons-material/DeleteOutline'
import { AssignmentRole, AvailabilityInput, AvailabilityKind, FeedTokenCreated, UserRole, api } from '../api'
import { availabilityLabels, roleLabels } from '../lib/labels'
import { formatDate, warsawDate } from '../lib/dates'
import { CopyButton } from '../components/CopyButton'
import { EmptyState } from '../components/EmptyState'
import { DateField } from '../components/DateField'

function addDays(iso: string, amount: number) {
  const value = new Date(`${iso}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + amount)
  return value.toISOString().slice(0, 10)
}

function MyDuties({ displayName }: { displayName: string }) {
  const today = warsawDate()
  const calendar = useQuery({
    queryKey: ['calendar', today, addDays(today, 59)],
    queryFn: () => api.calendar(today, addDays(today, 59)),
  })
  const duties = calendar.data?.assignments
    .filter((item) => item.assignee_name === displayName)
    .sort((a, b) => a.service_date.localeCompare(b.service_date)) ?? []
  const dayByDate = new Map(calendar.data?.days.map((day) => [day.service_date, day]) ?? [])
  const ownId = calendar.data?.members.find((member) => member.display_name === displayName)?.id
  const collision = (serviceDate: string) => calendar.data?.availability.some(
    (entry) => entry.member_id === ownId && entry.kind === 'unavailable'
      && entry.starts_on <= serviceDate && entry.ends_on >= serviceDate,
  )
  // Mirrors backend coverage.py (PLAN.md §3): the 11-19 shift is a fixed
  // daytime window, on-call cover runs overnight on working days and around
  // the clock on weekends and holidays (CalendarMatrix.tsx has the same rule).
  const dutyHours = (role: AssignmentRole, isDayOff: boolean | undefined) => {
    if (role === 'late_shift') return '11:00-19:00'
    return isDayOff ? 'całodobowo' : '19:00-09:00'
  }
  return (
    <Box className="mine-duties">
      <Box>
        <Typography className="eyebrow">[NAJBLIŻSZE 60 DNI]</Typography>
        <Typography variant="h1">Moje dyżury</Typography>
      </Box>
      {calendar.isLoading && <CircularProgress size={24} />}
      {calendar.error && <Alert severity="error">{calendar.error.message}</Alert>}
      {calendar.data && duties.length === 0 && (
        <EmptyState title="Brak nadchodzących dyżurów" description="W najbliższych 60 dniach nie masz przydzielonego dyżuru." />
      )}
      {duties.length > 0 && (
        <Paper variant="outlined" className="availability-list">
          {duties.map((duty) => (
            <Box className="availability-row" key={`${duty.service_date}-${duty.role}`}>
              <Box className="grow">
                <Typography>{formatDate(duty.service_date)} · {roleLabels[duty.role]}</Typography>
                <Typography color="text.secondary">
                  {dutyHours(duty.role, dayByDate.get(duty.service_date)?.is_day_off)}
                  {' · '}
                  {dayByDate.get(duty.service_date)?.is_day_off ? '2X' : '1X'}
                </Typography>
                {collision(duty.service_date) && <Alert severity="warning">Dyżur koliduje z Twoją niedostępnością.</Alert>}
              </Box>
              <Button component={Link} to={`/zamiany?date=${duty.service_date}&role=${duty.role}`}>
                Poproś o zamianę
              </Button>
            </Box>
          ))}
        </Paper>
      )}
    </Box>
  )
}

function AvailabilityPanel({
  role = 'member',
  hasTeamMember = true,
  displayName = '',
}: {
  role?: UserRole
  hasTeamMember?: boolean
  displayName?: string
}) {
  const queryClient = useQueryClient()
  const today = warsawDate()
  const canActOnBehalf = role === 'coordinator' || role === 'admin'
  const team = useQuery({ queryKey: ['team'], queryFn: api.team, enabled: canActOnBehalf })
  const ownMember = team.data?.find((member) => member.display_name === displayName)
  // '' means "myself"; a member id means "on behalf of that person".
  const [target, setTarget] = useState('')
  const onBehalf = target !== '' && target !== ownMember?.id
  const targetMember = team.data?.find((member) => member.id === target)
  // An admin who is not in the rotation has no availability of their own to show,
  // so the screen only works once a person is picked.
  const needsPick = canActOnBehalf && !hasTeamMember && !onBehalf

  const listKey = onBehalf ? ['availability', 'member', target] : ['availability', 'me']
  const entries = useQuery({
    queryKey: listKey,
    queryFn: onBehalf ? () => api.memberAvailability(target) : api.availability,
    enabled: onBehalf || hasTeamMember,
  })
  const invalidate = () => queryClient.invalidateQueries({ queryKey: listKey })

  const [form, setForm] = useState<AvailabilityInput>({
    kind: 'unavailable',
    starts_on: today,
    ends_on: today,
    note: '',
  })
  const create = useMutation({
    mutationFn: (input: AvailabilityInput) =>
      onBehalf ? api.createMemberAvailability(target, input) : api.createAvailability(input),
    onSuccess: () => {
      invalidate()
      setForm((previous) => ({ ...previous, note: '' }))
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) =>
      onBehalf ? api.deleteMemberAvailability(target, id) : api.deleteAvailability(id),
    onSuccess: invalidate,
  })

  return (
    <Box className="availability-section">
      <Box>
        <Typography className="eyebrow">[MOJA DOSTĘPNOŚĆ]</Typography>
        <Typography variant="h1">Moja dostępność</Typography>
        <Typography color="text.secondary">
          Powód zobaczą tylko koordynatorzy i administratorzy.
        </Typography>
      </Box>
      {canActOnBehalf && (
        <TextField
          select
          label="Osoba"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          helperText={
            onBehalf
              ? 'Wpisujesz w imieniu innej osoby. Dostanie o tym powiadomienie i może wpis usunąć.'
              : ownMember
                ? 'Domyślnie wpisujesz własną dostępność.'
                : 'Twoje konto nie jest w rotacji - wskaż osobę, w imieniu której wpisujesz.'
          }
          sx={{ maxWidth: 360 }}
        >
          {ownMember && <MenuItem value="">Ja ({displayName})</MenuItem>}
          {!ownMember && <MenuItem value="">— wybierz osobę —</MenuItem>}
          {team.data
            ?.filter((member) => member.id !== ownMember?.id)
            .map((member) => (
              <MenuItem key={member.id} value={member.id}>
                {member.display_name}
              </MenuItem>
            ))}
        </TextField>
      )}
      {needsPick ? (
        <EmptyState
          title="Wybierz osobę"
          description="Twoje konto nie jest w rotacji. Wskaż osobę, w imieniu której chcesz zgłosić dostępność."
        />
      ) : (
        <>
          <Paper
            component="form"
            variant="outlined"
            className="availability-form"
            onSubmit={(event) => {
              event.preventDefault()
              create.mutate(form)
            }}
          >
            <TextField
              select
              label="Typ"
              value={form.kind}
              onChange={(event) =>
                setForm({ ...form, kind: event.target.value as AvailabilityKind })
              }
            >
              {Object.entries(availabilityLabels).map(([value, label]) => (
                <MenuItem key={value} value={value}>{label}</MenuItem>
              ))}
            </TextField>
            <DateField
              id="availability-from"
              label="Od"
              value={form.starts_on}
              onChange={(value) => setForm({ ...form, starts_on: value })}
              required
            />
            <DateField
              id="availability-to"
              label="Do"
              value={form.ends_on}
              onChange={(value) => setForm({ ...form, ends_on: value })}
              required
            />
            <TextField
              label="Powód (widzą koordynatorzy)"
              value={form.note}
              onChange={(event) => setForm({ ...form, note: event.target.value })}
            />
            <Box className="availability-submit">
              {onBehalf && targetMember && (
                <Typography className="on-behalf-label" color="text.secondary">
                  Wpisujesz w imieniu: <strong>{targetMember.display_name}</strong>
                </Typography>
              )}
              <Button type="submit" variant="contained" disabled={create.isPending}>
                Dodaj
              </Button>
            </Box>
          </Paper>
          {create.error && <Alert severity="error">{create.error.message}</Alert>}
          {create.data?.warning && <Alert severity="warning">{create.data.warning}</Alert>}
          <Paper variant="outlined" className="availability-list">
            {entries.isLoading && <CircularProgress size={24} />}
            {entries.error && <Alert severity="error">{entries.error.message}</Alert>}
            {entries.data?.length === 0 && (
              <EmptyState
                title={
                  onBehalf
                    ? `${targetMember?.display_name ?? 'Ta osoba'} nie ma zgłoszonych terminów`
                    : 'Nie masz jeszcze zgłoszonych terminów'
                }
                description="Zgłoś dni, w których nie możesz dyżurować, albo takie, które chętnie weźmiesz. Generator uwzględni je przy układaniu grafiku."
              />
            )}
            {entries.data?.map((entry) => (
              <Box className="availability-row" key={entry.id}>
                <Box className="grow">
                  <Typography>{availabilityLabels[entry.kind]}</Typography>
                  <Typography className="date-code" color="text.secondary">
                    {formatDate(entry.starts_on)} → {formatDate(entry.ends_on)}
                  </Typography>
                  {entry.note && <Typography color="text.secondary">{entry.note}</Typography>}
                  {entry.created_by_name && (
                    <Typography variant="caption" color="text.secondary">
                      wpis dodał(a): {entry.created_by_name}
                    </Typography>
                  )}
                </Box>
                <IconButton
                  aria-label={`Usuń wpis od ${formatDate(entry.starts_on)}`}
                  onClick={() => remove.mutate(entry.id)}
                  disabled={remove.isPending}
                >
                  <DeleteOutline />
                </IconButton>
              </Box>
            ))}
          </Paper>
          {remove.error && <Alert severity="error">{remove.error.message}</Alert>}
        </>
      )}
    </Box>
  )
}

function CalendarFeedsPanel() {
  const queryClient = useQueryClient()
  const feeds = useQuery({ queryKey: ['feeds'], queryFn: api.feeds })
  const [label, setLabel] = useState('')
  const [created, setCreated] = useState<FeedTokenCreated | null>(null)
  const [showRevoked, setShowRevoked] = useState(false)
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['feeds'] })
  const create = useMutation({
    mutationFn: api.createFeed,
    onSuccess: (value) => {
      setCreated(value)
      setLabel('')
      invalidate()
    },
  })
  const revoke = useMutation({ mutationFn: api.revokeFeed, onSuccess: invalidate })

  return (
    <Box className="share-section" id="ics">
      <Box>
        <Typography className="eyebrow">[KANAŁ KALENDARZA]</Typography>
        <Typography variant="h1">Subskrypcja kalendarza (ICS)</Typography>
        <Typography color="text.secondary">
          Adres ICS pokazuje wyłącznie Twoje dyżury. Dodaj go w aplikacji kalendarza.
        </Typography>
      </Box>
      <Paper
        component="form"
        variant="outlined"
        className="share-form"
        onSubmit={(event) => {
          event.preventDefault()
          create.mutate(label.trim() || 'Mój kalendarz')
        }}
      >
        <TextField
          label="Nazwa subskrypcji"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
        <Button type="submit" variant="contained" disabled={create.isPending}>
          Utwórz adres ICS
        </Button>
      </Paper>
      {(create.error || revoke.error) && (
        <Alert severity="error">{create.error?.message ?? revoke.error?.message}</Alert>
      )}
      {created && (
        <Alert severity="success" action={<CopyButton value={created.url} />}>
          Nowy adres ICS (zapisz go, nie pokazujemy go ponownie): {created.url}
        </Alert>
      )}
      {(feeds.data?.some((feed) => feed.revoked_at)) && (
        <FormControlLabel
          control={<Switch size="small" checked={showRevoked} onChange={(event) => setShowRevoked(event.target.checked)} />}
          label="Pokaż odwołane"
        />
      )}
      <Paper variant="outlined" className="share-list">
        {feeds.isLoading && <CircularProgress size={24} />}
        {feeds.data?.filter((feed) => showRevoked || !feed.revoked_at).length === 0 && (
          <EmptyState
            title="Nie masz jeszcze subskrypcji"
            description="Adres ICS pokazuje wyłącznie Twoje dyżury i aktualizuje się po zamianach. Dodaj go w swojej aplikacji kalendarza."
          />
        )}
        {feeds.data?.filter((feed) => showRevoked || !feed.revoked_at).map((feed) => (
          <Box className="share-row" key={feed.id}>
            <Box className="grow">
              <Typography>{feed.label}</Typography>
              <Typography className="date-code" color="text.secondary">
                utworzono {formatDate(feed.created_at)}
                {feed.last_used_at ? ` · ostatnie użycie ${formatDate(feed.last_used_at)}` : ''}
              </Typography>
            </Box>
            {feed.revoked_at ? (
              <Chip label="Odwołana" color="error" size="small" variant="outlined" />
            ) : (
              <Button
                size="small"
                color="error"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(feed.id)}
              >
                Odwołaj
              </Button>
            )}
          </Box>
        ))}
      </Paper>
    </Box>
  )
}

export function MineScreen({
  role,
  hasTeamMember,
  displayName,
}: {
  role?: UserRole
  hasTeamMember?: boolean
  displayName?: string
} = {}) {
  return (
    <Stack spacing={3}>
      {hasTeamMember !== false && <MyDuties displayName={displayName ?? ''} />}
      <AvailabilityPanel role={role} hasTeamMember={hasTeamMember} displayName={displayName} />
      {hasTeamMember !== false && <CalendarFeedsPanel />}
    </Stack>
  )
}
