import { FormEvent, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import {
  AdminUser,
  AdminUserInput,
  AdminUserUpdate,
  AssignmentRole,
  Eligibility,
  TeamMember,
  UserRole,
  api,
} from '../../api'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { CopyButton } from '../../components/CopyButton'
import { DateField } from '../../components/DateField'
import { OffboardingDialog } from '../../components/OffboardingDialog'
import { roleLabels as dutyRoleLabels } from '../../lib/labels'
import { roleLabels as accountRoleLabels } from '../../lib/nav'
import { formatDate } from '../../lib/dates'

const authSourceLabels = { local: 'Lokalne', ldap: 'LDAP / AD' } as const
const roles: UserRole[] = ['viewer', 'member', 'coordinator', 'admin']
const dutyRoles: AssignmentRole[] = ['primary', 'secondary', 'late_shift']
const today = new Date().toISOString().slice(0, 10)

interface Row {
  user: AdminUser
  member?: TeamMember
}

const emptyAccount: AdminUserInput = {
  username: '', personnel_number: null, first_name: '', last_name: '', email: null, phone: null, role: 'viewer',
}

function EligibilitySummary({ member }: { member?: TeamMember }) {
  if (!member) return <Typography color="text.secondary">Poza rotacją</Typography>
  if (member.eligibility.length === 0) {
    return <Typography color="text.secondary">Brak uprawnień do żadnej roli</Typography>
  }
  return (
    <Box className="people-eligibility">
      {member.eligibility.map((item) => (
        <Chip
          key={item.id}
          size="small"
          variant="outlined"
          label={`${dutyRoleLabels[item.role]} od ${formatDate(item.starts_on)}${item.ends_on ? ` do ${formatDate(item.ends_on)}` : ''}`}
        />
      ))}
    </Box>
  )
}

function LinkResult({ value, label }: { value: string; label: string }) {
  return (
    <Alert severity="success">
      <Typography>{label}</Typography>
      <Box className="people-link-result">
        <Typography className="date-code">{value}</Typography>
        <CopyButton value={value} />
      </Box>
    </Alert>
  )
}

interface PeriodValue {
  starts_on: string
  ends_on: string
}

function EligibilityPeriodEditor({
  item,
  value,
  pending,
  onChange,
  onDelete,
}: {
  item: Eligibility
  value: PeriodValue
  pending: boolean
  onChange: (next: PeriodValue) => void
  onDelete: (id: string) => void
}) {
  return (
    <Box className="people-period-row">
      <Typography>{dutyRoleLabels[item.role]}</Typography>
      <DateField
        id={`eligibility-${item.id}-from`}
        label="Od"
        value={value.starts_on}
        onChange={(starts_on) => onChange({ ...value, starts_on })}
      />
      <DateField
        id={`eligibility-${item.id}-until`}
        label="Do (opcjonalnie)"
        value={value.ends_on}
        onChange={(ends_on) => onChange({ ...value, ends_on })}
      />
      <Button color="error" size="small" disabled={pending} onClick={() => onDelete(item.id)}>
        Usuń
      </Button>
    </Box>
  )
}

export function PeoplePanel() {
  const queryClient = useQueryClient()
  const users = useQuery({ queryKey: ['admin-users'], queryFn: api.adminUsers })
  const team = useQuery({ queryKey: ['team'], queryFn: api.team })
  const config = useQuery({ queryKey: ['public-config'], queryFn: api.publicConfig })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [accountForm, setAccountForm] = useState<AdminUserUpdate>({})
  const [newOpen, setNewOpen] = useState(false)
  const [newForm, setNewForm] = useState<AdminUserInput>(emptyAccount)
  const [activationUrl, setActivationUrl] = useState('')
  const [resetUrl, setResetUrl] = useState('')
  const [confirmation, setConfirmation] = useState(false)
  const [resetConfirmation, setResetConfirmation] = useState(false)
  const [deleteConfirmation, setDeleteConfirmation] = useState(false)
  const [closeConfirmation, setCloseConfirmation] = useState(false)
  const [rotationFrom, setRotationFrom] = useState(today)
  const [rotationUntil, setRotationUntil] = useState('')
  const [offboardingOpen, setOffboardingOpen] = useState(false)
  const [eligibilityEdits, setEligibilityEdits] = useState<Record<string, PeriodValue>>({})
  const [eligibilityRole, setEligibilityRole] = useState<AssignmentRole>('primary')
  const [eligibilityFrom, setEligibilityFrom] = useState(today)
  const [eligibilityUntil, setEligibilityUntil] = useState('')
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<UserRole | ''>('')
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | ''>('')

  const rows = useMemo<Row[]>(() => {
    const byUser = new Map((team.data ?? []).map((member) => [member.user_id, member]))
    return (users.data ?? [])
      .map((user) => ({ user, member: byUser.get(user.id) }))
      .filter(({ user }) => {
        const needle = search.trim().toLocaleLowerCase('pl')
        const matchesSearch = !needle || [user.display_name, user.username, user.personnel_number]
          .some((value) => value?.toLocaleLowerCase('pl').includes(needle))
        return matchesSearch
          && (!roleFilter || user.role === roleFilter)
          && (!statusFilter || user.is_active === (statusFilter === 'active'))
      })
      .sort((a, b) => a.user.display_name.localeCompare(b.user.display_name, 'pl'))
  }, [users.data, team.data, search, roleFilter, statusFilter])
  const selectedRow = rows.find(({ user }) => user.id === selectedId)

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    queryClient.invalidateQueries({ queryKey: ['team'] })
  }
  const openDetails = ({ user, member }: Row) => {
    setSelectedId(user.id)
    setAccountForm({
      personnel_number: user.personnel_number,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      is_active: user.is_active,
    })
    setRotationFrom(member?.active_from ?? today)
    setRotationUntil(member?.active_until ?? '')
    setEligibilityEdits({})
    setCloseConfirmation(false)
    setResetUrl('')
  }

  const createAccount = useMutation({
    mutationFn: api.createAdminUser,
    onSuccess: ({ activation_url }) => {
      setActivationUrl(activation_url)
      refresh()
    },
  })
  const accountChanges = useMemo(() => {
    if (!selectedRow) return [] as string[]
    const user = selectedRow.user
    const changes: string[] = []
    if (user.auth_source !== 'ldap') {
      if ((accountForm.first_name ?? '') !== user.first_name) changes.push('imię')
      if ((accountForm.last_name ?? '') !== user.last_name) changes.push('nazwisko')
      if ((accountForm.personnel_number ?? null) !== user.personnel_number) {
        changes.push('numer pracownika')
      }
      if ((accountForm.email ?? null) !== user.email) changes.push('e-mail')
    }
    // Not managed by LDAP even for a directory account (decision D8).
    if ((accountForm.phone ?? null) !== user.phone) changes.push('telefon')
    if ((accountForm.role ?? user.role) !== user.role) {
      changes.push(`rola: ${accountRoleLabels[user.role]} → ${accountRoleLabels[accountForm.role ?? user.role]}`)
    }
    if ((accountForm.is_active ?? user.is_active) !== user.is_active) {
      changes.push(accountForm.is_active ? 'włączenie konta' : 'wyłączenie konta')
    }
    return changes
  }, [selectedRow, accountForm])
  const rotationChanges = useMemo(() => {
    const member = selectedRow?.member
    if (!member) return [] as string[]
    const changes: string[] = []
    if (rotationFrom !== member.active_from) {
      changes.push(`wejście do rotacji: ${formatDate(rotationFrom)}`)
    }
    if ((rotationUntil || null) !== member.active_until) {
      changes.push(rotationUntil ? `wyjście z rotacji: ${formatDate(rotationUntil)}` : 'usunięcie daty wyjścia z rotacji')
    }
    return changes
  }, [selectedRow, rotationFrom, rotationUntil])
  const eligibilityChanges = useMemo(() => {
    const member = selectedRow?.member
    if (!member) return [] as string[]
    return member.eligibility.flatMap((item) => {
      const edit = eligibilityEdits[item.id]
      if (!edit) return []
      const changed = edit.starts_on !== item.starts_on || (edit.ends_on || null) !== item.ends_on
      return changed ? [`okres ${dutyRoleLabels[item.role]}`] : []
    })
  }, [selectedRow, eligibilityEdits])
  const pendingChanges = [...accountChanges, ...rotationChanges, ...eligibilityChanges]
  const dirty = pendingChanges.length > 0

  const saveAll = useMutation({
    mutationFn: async () => {
      if (!selectedRow) throw new Error('Nie wybrano konta')
      const tasks: Array<Promise<unknown>> = []
      if (accountChanges.length > 0) {
        // Phone travels even for an LDAP account: unlike name/email it is not
        // an AD-managed identity field (decision D8).
        const input: AdminUserUpdate = selectedRow.user.auth_source === 'ldap'
          ? { role: accountForm.role, is_active: accountForm.is_active, phone: accountForm.phone }
          : accountForm
        tasks.push(api.updateAdminUser({ id: selectedRow.user.id, input }))
      }
      if (rotationChanges.length > 0 && selectedRow.member) {
        tasks.push(api.updateTeamMember({
          id: selectedRow.member.id,
          input: { active_from: rotationFrom, active_until: rotationUntil || null },
        }))
      }
      for (const item of selectedRow.member?.eligibility ?? []) {
        const edit = eligibilityEdits[item.id]
        if (!edit) continue
        if (edit.starts_on === item.starts_on && (edit.ends_on || null) === item.ends_on) continue
        if (!edit.starts_on) throw new Error('Każdy okres eligibility musi mieć datę początku')
        tasks.push(api.updateEligibility({
          id: item.id,
          input: { starts_on: edit.starts_on, ends_on: edit.ends_on || null },
        }))
      }
      await Promise.all(tasks)
    },
    onSuccess: () => {
      setConfirmation(false)
      setEligibilityEdits({})
      refresh()
    },
  })
  const resetPassword = useMutation({
    mutationFn: api.issuePasswordReset,
    onSuccess: ({ url }) => setResetUrl(url),
  })
  const deleteAccount = useMutation({
    mutationFn: api.deleteAdminUser,
    onSuccess: () => { setDeleteConfirmation(false); setSelectedId(null); refresh() },
  })
  const createRotation = useMutation({
    mutationFn: () => api.createTeamMember({ user_id: selectedId!, active_from: rotationFrom }),
    onSuccess: refresh,
  })
  const addEligibility = useMutation({
    mutationFn: () => api.createEligibility({
      memberId: selectedRow!.member!.id,
      input: {
        role: eligibilityRole,
        starts_on: eligibilityFrom,
        ends_on: eligibilityUntil || null,
      },
    }),
    onSuccess: () => {
      setEligibilityUntil('')
      refresh()
    },
  })
  const deleteEligibility = useMutation({ mutationFn: api.deleteEligibility, onSuccess: refresh })

  // Role change and deactivation get a confirmation; everything else saves at once.
  const dangerous = Boolean(selectedRow)
    && ((accountForm.role ?? selectedRow!.user.role) !== selectedRow!.user.role
      || (selectedRow!.user.is_active && accountForm.is_active === false))
  const submitAll = (event: FormEvent) => {
    event.preventDefault()
    if (!selectedRow || !dirty) return
    if (dangerous) setConfirmation(true)
    else saveAll.mutate()
  }
  const requestClose = () => {
    if (dirty) setCloseConfirmation(true)
    else setSelectedId(null)
  }

  const error = users.error || team.error || createAccount.error || saveAll.error
    || resetPassword.error || createRotation.error
    || addEligibility.error || deleteEligibility.error || deleteAccount.error

  return (
    <Box className="share-section" id="osoby">
      <Box className="section-heading-row">
        <Box>
          <Typography className="eyebrow">[KONTA I ROTACJA]</Typography>
          <Typography variant="h1">Osoby</Typography>
          <Typography color="text.secondary">
            Konta, dostęp do systemu i okresy uczestnictwa w rotacji.
          </Typography>
        </Box>
        <Button variant="contained" onClick={() => {
          setNewForm(emptyAccount); setActivationUrl(''); setNewOpen(true)
        }}>
          Nowe konto
        </Button>
      </Box>
      {error && <Alert severity="error">{error.message}</Alert>}
      <Paper variant="outlined" className="form-row calendar-controls">
        <TextField
          label="Szukaj osoby, loginu lub numeru"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          sx={{ minWidth: 320 }}
        />
        <TextField select label="Rola" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as UserRole | '')} sx={{ minWidth: 160 }}>
          <MenuItem value="">Wszystkie</MenuItem>
          {roles.map((item) => <MenuItem key={item} value={item}>{accountRoleLabels[item]}</MenuItem>)}
        </TextField>
        <TextField select label="Status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} sx={{ minWidth: 160 }}>
          <MenuItem value="">Wszystkie</MenuItem>
          <MenuItem value="active">Aktywne</MenuItem><MenuItem value="inactive">Wyłączone</MenuItem>
        </TextField>
      </Paper>
      {(users.isLoading || team.isLoading) && (
        <CircularProgress size={24} aria-label="Ładowanie kont" />
      )}
      {rows.length > 0 && (
        <Paper variant="outlined" className="calendar-scroll">
          <table className="calendar-matrix people-table">
            <caption className="visually-hidden">Konta systemu i ich status w rotacji.</caption>
            <thead><tr>
              <th scope="col">Numer</th>
              {/* Same vertical padding as the rest of this header row - the
                  shared `.member-column` class is tuned for the calendar's
                  sticky column and left this one sitting lower (QA7-L16). */}
              <th scope="col" className="member-column" style={{ padding: '12px 10px' }}>Osoba</th>
              <th scope="col">Logowanie</th><th scope="col">Rola</th><th scope="col">Status</th>
              <th scope="col">Rotacja i eligibility</th><th scope="col">Akcje</th>
            </tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.user.id}>
                  <td className="date-code">{row.user.personnel_number ?? '-'}</td>
                  <th scope="row" className="member-column">
                    <Typography variant="body2">{row.user.first_name} {row.user.last_name}</Typography>
                    <Typography className="date-code" color="text.secondary">{row.user.username}</Typography>
                  </th>
                  <td>
                    <Chip size="small" variant="outlined" label={authSourceLabels[row.user.auth_source]} />
                    {row.user.auth_source === 'ldap' && (
                      <Typography className="date-code" color="text.secondary">
                        pierwszy login {formatDate(row.user.created_at)}
                      </Typography>
                    )}
                  </td>
                  <td><Typography variant="body2">{accountRoleLabels[row.user.role]}</Typography></td>
                  <td><Chip size="small" variant="outlined" color={row.user.is_active ? 'success' : 'default'} label={row.user.is_active ? 'Aktywne' : 'Wyłączone'} /></td>
                  <td><EligibilitySummary member={row.member} /></td>
                  <td><Button size="small" onClick={() => openDetails(row)}>Szczegóły</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Paper>
      )}

      <Dialog open={newOpen} onClose={() => setNewOpen(false)} fullWidth maxWidth="sm">
        <Box component="form" onSubmit={(event: FormEvent) => {
          event.preventDefault(); createAccount.mutate(newForm)
        }}>
          <DialogTitle>Nowe konto lokalne</DialogTitle>
          <DialogContent className="people-form">
            <Typography color="text.secondary">
              Administrator nie ustawia hasła. Po utworzeniu przekaż osobie jednorazowy link.
            </Typography>
            {config.data?.ldap_enabled && (
              <Alert severity="info">
                Jeśli konto ma się później dowiązać z AD, wpisz numer pracownika zgodny
                z atrybutem employeeNumber w AD. Przy pierwszym logowaniu LDAP osoba
                zostanie dowiązana do tego konta, zachowując rolę i rotację, a hasło
                lokalne przestanie działać.
              </Alert>
            )}
            {createAccount.error && <Alert severity="error">{createAccount.error.message}</Alert>}
            {activationUrl && <LinkResult value={activationUrl} label="Link aktywacyjny (ważny 24 godziny)" />}
            {!activationUrl && <>
              <TextField label="Login" value={newForm.username} onChange={(e) => setNewForm({ ...newForm, username: e.target.value })} required />
              <Box className="people-two-columns">
                <TextField label="Imię" value={newForm.first_name} onChange={(e) => setNewForm({ ...newForm, first_name: e.target.value })} required />
                <TextField label="Nazwisko" value={newForm.last_name} onChange={(e) => setNewForm({ ...newForm, last_name: e.target.value })} />
              </Box>
              <Box className="people-two-columns">
                <TextField
                  label={config.data?.ldap_enabled ? 'Numer pracownika (klucz dowiązania z AD)' : 'Numer pracownika'}
                  value={newForm.personnel_number ?? ''}
                  inputProps={{ inputMode: 'numeric', pattern: '[0-9]*' }}
                  onChange={(e) => setNewForm({ ...newForm, personnel_number: e.target.value || null })}
                />
                <TextField label="E-mail" type="email" value={newForm.email ?? ''} onChange={(e) => setNewForm({ ...newForm, email: e.target.value || null })} />
              </Box>
              <TextField
                label="Telefon"
                helperText="Opcjonalny, widoczny dla zalogowanych osób na karcie dyżurnego"
                value={newForm.phone ?? ''}
                onChange={(e) => setNewForm({ ...newForm, phone: e.target.value || null })}
              />
              <TextField select label="Rola konta" value={newForm.role} onChange={(e) => setNewForm({ ...newForm, role: e.target.value as UserRole })}>
                {roles.map((role) => <MenuItem key={role} value={role}>{accountRoleLabels[role]}</MenuItem>)}
              </TextField>
            </>}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setNewOpen(false)}>Zamknij</Button>
            {!activationUrl && <Button type="submit" variant="contained" disabled={createAccount.isPending}>Utwórz konto</Button>}
          </DialogActions>
        </Box>
      </Dialog>
      {selectedRow?.member && (
        <OffboardingDialog
          open={offboardingOpen}
          member={selectedRow.member}
          activeUntil={rotationUntil}
          onClose={() => setOffboardingOpen(false)}
          onDone={() => { setOffboardingOpen(false); setSelectedId(null); refresh() }}
        />
      )}

      <Dialog open={Boolean(selectedRow)} onClose={requestClose} fullWidth maxWidth="md">
        {selectedRow && <>
          <DialogTitle>{selectedRow.user.display_name}</DialogTitle>
          <DialogContent className="people-detail">
            <Box component="form" id="person-form" onSubmit={submitAll} className="people-detail-form">
            {saveAll.error && <Alert severity="error">{saveAll.error.message}</Alert>}
            <Box className="people-form">
              <Box>
                <Typography variant="h2">Konto</Typography>
                <Typography color="text.secondary">
                  {selectedRow.user.auth_source === 'ldap'
                    ? 'Dane osobowe pochodzą z AD i są tylko do odczytu.'
                    : 'Dane lokalne można zmieniać w tym panelu.'}
                </Typography>
              </Box>
              {config.data?.ldap_enabled && selectedRow.user.auth_source === 'local' && (
                <Alert severity="info">
                  Konto dowiąże się z AD automatycznie przy pierwszym logowaniu LDAP
                  tej osoby, o ile numer pracownika zgadza się z employeeNumber w AD
                  {selectedRow.user.personnel_number
                    ? ` (obecnie: ${selectedRow.user.personnel_number})`
                    : ' (obecnie brak - bez numeru dowiązanie nie nastąpi)'}.
                  Po dowiązaniu hasło lokalne przestaje działać.
                </Alert>
              )}
              <Box className="people-two-columns">
                <TextField label="Imię" disabled={selectedRow.user.auth_source === 'ldap'} value={accountForm.first_name ?? ''} onChange={(e) => setAccountForm({ ...accountForm, first_name: e.target.value })} required />
                <TextField label="Nazwisko" disabled={selectedRow.user.auth_source === 'ldap'} value={accountForm.last_name ?? ''} onChange={(e) => setAccountForm({ ...accountForm, last_name: e.target.value })} />
                <TextField label="Numer pracownika" disabled={selectedRow.user.auth_source === 'ldap'} value={accountForm.personnel_number ?? ''} inputProps={{ inputMode: 'numeric', pattern: '[0-9]*' }} onChange={(e) => setAccountForm({ ...accountForm, personnel_number: e.target.value || null })} />
                <TextField label="E-mail" type="email" disabled={selectedRow.user.auth_source === 'ldap'} value={accountForm.email ?? ''} onChange={(e) => setAccountForm({ ...accountForm, email: e.target.value || null })} />
                <TextField label="Telefon" value={accountForm.phone ?? ''} onChange={(e) => setAccountForm({ ...accountForm, phone: e.target.value || null })} />
                <TextField select label="Rola konta" value={accountForm.role ?? selectedRow.user.role} onChange={(e) => setAccountForm({ ...accountForm, role: e.target.value as UserRole })}>
                  {roles.map((role) => <MenuItem key={role} value={role}>{accountRoleLabels[role]}</MenuItem>)}
                </TextField>
                <FormControlLabel control={<Switch checked={accountForm.is_active ?? false} onChange={(e) => setAccountForm({ ...accountForm, is_active: e.target.checked })} />} label="Konto aktywne" />
              </Box>
              <Stack direction="row" spacing={1} flexWrap="wrap">
                {selectedRow.user.auth_source === 'local' && <Button onClick={() => setResetConfirmation(true)}>Wygeneruj reset hasła</Button>}
                <Button color="error" onClick={() => setDeleteConfirmation(true)}>Usuń konto i dane osobowe</Button>
              </Stack>
              {resetUrl && <LinkResult value={resetUrl} label="Link resetu hasła (ważny godzinę)" />}
            </Box>
            <Divider />
            <Box className="people-form">
              <Box><Typography variant="h2">Rotacja</Typography><Typography color="text.secondary">Rola konta nie dodaje automatycznie do rotacji.</Typography></Box>
              <Box className="people-two-columns">
                <DateField id="rotation-from" label="Wejście od" value={rotationFrom} onChange={setRotationFrom} />
                {selectedRow.member && <DateField id="rotation-until" label="Wyjście do" value={rotationUntil} onChange={setRotationUntil} />}
              </Box>
              {selectedRow.member && rotationUntil && (
                <Button variant="outlined" onClick={() => setOffboardingOpen(true)}>
                  Przepisz przyszłe dyżury i zakończ rotację
                </Button>
              )}
              {!selectedRow.member && (
                <Button variant="outlined" onClick={() => createRotation.mutate()}>Dodaj do rotacji</Button>
              )}
            </Box>
            {selectedRow.member && <>
              <Divider />
              <Box className="people-form">
                <Typography variant="h2">Eligibility</Typography>
                {selectedRow.member.eligibility.map((item) => (
                  <EligibilityPeriodEditor
                    key={item.id}
                    item={item}
                    value={eligibilityEdits[item.id] ?? {
                      starts_on: item.starts_on,
                      ends_on: item.ends_on ?? '',
                    }}
                    pending={saveAll.isPending}
                    onChange={(next) => setEligibilityEdits((current) => {
                      const unchanged = next.starts_on === item.starts_on
                        && (next.ends_on || null) === item.ends_on
                      const copy = { ...current }
                      if (unchanged) delete copy[item.id]
                      else copy[item.id] = next
                      return copy
                    })}
                    onDelete={(id) => deleteEligibility.mutate(id)}
                  />
                ))}
                <Box className="form-row people-period-form">
                  <TextField select label="Rola dyżurowa" value={eligibilityRole} onChange={(e) => setEligibilityRole(e.target.value as AssignmentRole)}>
                    {dutyRoles.map((role) => <MenuItem key={role} value={role}>{dutyRoleLabels[role]}</MenuItem>)}
                  </TextField>
                  <DateField id="new-eligibility-from" label="Od" value={eligibilityFrom} onChange={setEligibilityFrom} />
                  <DateField id="new-eligibility-until" label="Do (opcjonalnie)" value={eligibilityUntil} onChange={setEligibilityUntil} />
                  <Button variant="outlined" onClick={() => addEligibility.mutate()}>Dodaj okres</Button>
                </Box>
              </Box>
            </>}
            </Box>
          </DialogContent>
          <DialogActions className="people-actions">
            {dirty && (
              <Typography color="text.secondary" className="grow">
                Niezapisane: {pendingChanges.join(' · ')}
              </Typography>
            )}
            <Button onClick={requestClose}>Zamknij</Button>
            <Button
              type="submit"
              form="person-form"
              variant="contained"
              disabled={!dirty || saveAll.isPending}
            >
              {saveAll.isPending
                ? 'Zapisuję…'
                : dirty ? `Zapisz zmiany (${pendingChanges.length})` : 'Brak zmian'}
            </Button>
          </DialogActions>
        </>}
      </Dialog>

      <ConfirmDialog
        open={confirmation}
        title="Potwierdź zmianę dostępu"
        description={(
          <>
            Zmiana roli lub wyłączenie konta wpływa na dostęp użytkownika do systemu.<br />
            Do zapisania: {pendingChanges.join(' · ')}
          </>
        )}
        confirmLabel="Potwierdź i zapisz"
        confirmColor={accountForm.is_active === false ? 'warning' : 'primary'}
        pending={saveAll.isPending}
        error={saveAll.error ? saveAll.error.message : null}
        onCancel={() => setConfirmation(false)}
        onConfirm={() => saveAll.mutate()}
      />
      <ConfirmDialog
        open={closeConfirmation && dirty}
        title="Zamknąć bez zapisywania?"
        description={(
          <>
            Masz niezapisane zmiany: {pendingChanges.join(' · ')}.<br />
            Zamknięcie okna je wyrzuci.
          </>
        )}
        confirmLabel="Zamknij bez zapisywania"
        confirmColor="warning"
        onCancel={() => setCloseConfirmation(false)}
        onConfirm={() => {
          setCloseConfirmation(false)
          setSelectedId(null)
        }}
      />
      <ConfirmDialog
        open={deleteConfirmation}
        title="Usunąć konto?"
        description="Konto, sesje i dane osobowe zostaną trwale usunięte. Historyczne dyżury pozostaną jako zapis operacyjny."
        confirmLabel="Usuń konto"
        confirmColor="error"
        pending={deleteAccount.isPending}
        onCancel={() => setDeleteConfirmation(false)}
        onConfirm={() => selectedRow && deleteAccount.mutate(selectedRow.user.id)}
      />
      <ConfirmDialog
        open={resetConfirmation}
        title="Wygenerować reset hasła?"
        description="Istniejące sesje użytkownika zostaną unieważnione po ustawieniu nowego hasła."
        confirmLabel="Wygeneruj link"
        pending={resetPassword.isPending}
        onCancel={() => setResetConfirmation(false)}
        onConfirm={() => selectedRow && resetPassword.mutate(selectedRow.user.id, {
          onSuccess: () => setResetConfirmation(false),
        })}
      />
    </Box>
  )
}
