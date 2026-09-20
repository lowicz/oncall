import { FormEvent, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AdminUser, AdminUserInput, AdminUserUpdate, AssignmentRole, Eligibility, TeamMember, UserRole, api } from '../../api'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { CopyButton } from '../../components/CopyButton'
import { DateField } from '../../components/DateField'
import { OffboardingDialog } from '../../components/OffboardingDialog'
import { roleLabels as dutyRoleLabels } from '../../lib/labels'
import { roleLabels as accountRoleLabels } from '../../lib/nav'
import { formatDate, warsawDate } from '../../lib/dates'
import { useBranding } from '../../hooks/useBranding'
import {
  Avatar,
  Box,
  Button,
  Checkbox,
  Dialog,
  EmptyState,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Panel,
  RoleMark,
  SectionHeading,
  Select,
  StatusBadge,
  TabPanel,
  Tabs,
  Tag,
} from '../../ui'

const authSourceLabels = { local: 'lokalne', ldap: 'LDAP / AD' } as const
const roles: UserRole[] = ['viewer', 'member', 'coordinator', 'admin']
const dutyRoles: AssignmentRole[] = ['primary', 'secondary', 'late_shift']

interface Row {
  user: AdminUser
  member?: TeamMember
}

const emptyAccount: AdminUserInput = {
  username: '', personnel_number: null, first_name: '', last_name: '', email: null, phone: null, role: 'viewer',
}

function EligibilitySummary({ member }: { member?: TeamMember }) {
  if (!member) return <span className="muted small">poza rotacją</span>
  if (member.eligibility.length === 0) return <span className="muted small">brak uprawnień do żadnej roli</span>
  return (
    <span className="row" style={{ gap: 4 }}>
      {member.eligibility.map((item) => (
        <span key={item.id} title={`${dutyRoleLabels[item.role]} od ${formatDate(item.starts_on)}${item.ends_on ? ` do ${formatDate(item.ends_on)}` : ''}`}>
          <RoleMark role={item.role} size="sm" />
          <span className="sr-only">{dutyRoleLabels[item.role]} od {formatDate(item.starts_on)}{item.ends_on ? ` do ${formatDate(item.ends_on)}` : ''}</span>
        </span>
      ))}
    </span>
  )
}

function LinkResult({ value, label }: { value: string; label: string }) {
  return (
    <Box tone="ok" role="status" title={label}>
      <div className="token-once"><code>{value}</code><CopyButton value={value} /></div>
    </Box>
  )
}

interface PeriodValue { starts_on: string; ends_on: string }

function EligibilityPeriodEditor({ item, value, pending, onChange, onDelete }: {
  item: Eligibility
  value: PeriodValue
  pending: boolean
  onChange: (next: PeriodValue) => void
  onDelete: (id: string) => void
}) {
  return (
    <div className="frow" style={{ alignItems: 'end' }}>
      <div className="row" style={{ minHeight: 32 }}><RoleMark role={item.role} /><b>{dutyRoleLabels[item.role]}</b></div>
      <DateField id={`eligibility-${item.id}-from`} label="Od" value={value.starts_on} onChange={(starts_on) => onChange({ ...value, starts_on })} />
      <DateField id={`eligibility-${item.id}-until`} label="Do (opcjonalnie)" value={value.ends_on} onChange={(ends_on) => onChange({ ...value, ends_on })} />
      <Button size="sm" variant="ghost" icon="trash" disabled={pending} onClick={() => onDelete(item.id)}>Usuń</Button>
    </div>
  )
}

type DetailTab = 'account' | 'rotation' | 'eligibility'

export function PeoplePanel() {
  const queryClient = useQueryClient()
  const today = warsawDate()
  const users = useQuery({ queryKey: ['admin-users'], queryFn: api.adminUsers })
  const team = useQuery({ queryKey: ['team'], queryFn: api.team })
  const branding = useBranding()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<DetailTab>('account')
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
        return matchesSearch && (!roleFilter || user.role === roleFilter) && (!statusFilter || user.is_active === (statusFilter === 'active'))
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
    setTab('account')
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
      if ((accountForm.personnel_number ?? null) !== user.personnel_number) changes.push('numer pracownika')
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
    if (rotationFrom !== member.active_from) changes.push(`wejście do rotacji: ${formatDate(rotationFrom)}`)
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
        tasks.push(api.updateTeamMember({ id: selectedRow.member.id, input: { active_from: rotationFrom, active_until: rotationUntil || null } }))
      }
      for (const item of selectedRow.member?.eligibility ?? []) {
        const edit = eligibilityEdits[item.id]
        if (!edit) continue
        if (edit.starts_on === item.starts_on && (edit.ends_on || null) === item.ends_on) continue
        if (!edit.starts_on) throw new Error('Każdy okres eligibility musi mieć datę początku')
        tasks.push(api.updateEligibility({ id: item.id, input: { starts_on: edit.starts_on, ends_on: edit.ends_on || null } }))
      }
      await Promise.all(tasks)
    },
    onSuccess: () => {
      setConfirmation(false)
      setEligibilityEdits({})
      refresh()
    },
  })
  const resetPassword = useMutation({ mutationFn: api.issuePasswordReset, onSuccess: ({ url }) => setResetUrl(url) })
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
      input: { role: eligibilityRole, starts_on: eligibilityFrom, ends_on: eligibilityUntil || null },
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
  const error = users.error || team.error || createRotation.error || addEligibility.error || deleteEligibility.error || deleteAccount.error
  const ldapFieldsLocked = selectedRow?.user.auth_source === 'ldap'
  const counts = {
    active: users.data?.filter((user) => user.is_active).length ?? 0,
    rotation: team.data?.filter((member) => !member.active_until || member.active_until >= today).length ?? 0,
  }

  return (
    <div className="page">
      <PageHeader
        title="Osoby"
        sub="Konta, dostęp do systemu i okresy uczestnictwa w rotacji."
        actions={<Button variant="primary" icon="plus" onClick={() => { setNewForm(emptyAccount); setActivationUrl(''); setNewOpen(true) }}>Nowe konto</Button>}
      />
      {error && <Box tone="bad" role="alert" title={error.message} />}
      <form className="toolbar panel" onSubmit={(event) => event.preventDefault()} aria-label="Filtry">
        <Field label="Szukaj" id="people-search" className="field-grow">
          {({ id }) => <Input id={id} type="search" placeholder="osoba, login lub numer" value={search} onChange={(event) => setSearch(event.target.value)} />}
        </Field>
        <Field label="Rola" id="people-role">
          {({ id }) => (
            <Select id={id} value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as UserRole | '')}>
              <option value="">Wszystkie</option>
              {roles.map((item) => <option key={item} value={item}>{accountRoleLabels[item]}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Status" id="people-status">
          {({ id }) => (
            <Select id={id} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
              <option value="">Wszystkie</option>
              <option value="active">Aktywne</option>
              <option value="inactive">Wyłączone</option>
            </Select>
          )}
        </Field>
        <span className="muted small mono" style={{ alignSelf: 'end', paddingBottom: 8 }}>{counts.active} aktywnych · {counts.rotation} w rotacji</span>
      </form>
      {(users.isLoading || team.isLoading) && <LoadingBlock label="Wczytywanie kont" />}
      {users.data && rows.length === 0 && <EmptyState compact icon="people" title="Brak kont dla wybranego filtra" />}
      {rows.length > 0 && (
        <div className="panel wide-scroll">
          <table className="lg" aria-label="Konta">
            <caption className="sr-only">Konta systemu i ich status w rotacji.</caption>
            <thead>
              <tr>
                <th scope="col">Osoba</th>
                <th scope="col">Numer</th>
                <th scope="col">Logowanie</th>
                <th scope="col">Rola</th>
                <th scope="col">Status</th>
                <th scope="col">Rotacja</th>
                <th scope="col"><span className="sr-only">Akcje</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.user.id} className={selectedId === row.user.id ? 'on' : undefined}>
                  <th scope="row">
                    <button type="button" className="link-btn row" onClick={() => openDetails(row)}>
                      <Avatar name={row.user.display_name} size={22} />
                      <span>
                        <b>{row.user.first_name} {row.user.last_name}</b>
                        <small className="mono">{row.user.username}</small>
                      </span>
                    </button>
                  </th>
                  <td className="mono">{row.user.personnel_number ?? '-'}</td>
                  <td>
                    <Tag>{authSourceLabels[row.user.auth_source]}</Tag>
                    {row.user.auth_source === 'ldap' && <small>pierwszy login {formatDate(row.user.created_at)}</small>}
                  </td>
                  <td>{accountRoleLabels[row.user.role]}</td>
                  <td><StatusBadge tone={row.user.is_active ? 'ok' : 'muted'}>{row.user.is_active ? 'aktywne' : 'wyłączone'}</StatusBadge></td>
                  <td>
                    <EligibilitySummary member={row.member} />
                    {row.member?.active_until && <small>do {formatDate(row.member.active_until)}</small>}
                  </td>
                  <td className="n"><Button size="sm" onClick={() => openDetails(row)}>Szczegóły</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={newOpen}
        onOpenChange={setNewOpen}
        title="Nowe konto lokalne"
        description="Administrator nie ustawia hasła. Po utworzeniu przekaż osobie jednorazowy link aktywacyjny."
        actions={(
          <>
            <Button onClick={() => setNewOpen(false)}>Zamknij</Button>
            {!activationUrl && <Button type="submit" form="new-account-form" variant="primary" loading={createAccount.isPending}>Utwórz konto</Button>}
          </>
        )}
      >
        <form id="new-account-form" className="stack-sm" onSubmit={(event: FormEvent) => { event.preventDefault(); createAccount.mutate(newForm) }}>
          {branding.ldapEnabled && (
            <Box tone="muted">
              Jeśli konto ma się później dowiązać z AD, wpisz numer pracownika zgodny z atrybutem employeeNumber w AD. Przy pierwszym logowaniu LDAP osoba zostanie dowiązana do tego konta, zachowując rolę i rotację, a hasło lokalne przestanie działać.
            </Box>
          )}
          {createAccount.error && <Box tone="bad" role="alert" title={createAccount.error.message} />}
          {activationUrl && <LinkResult value={activationUrl} label="Link aktywacyjny (ważny 24 godziny)" />}
          {!activationUrl && (
            <>
              <Field label="Login" id="new-username" required>
                {({ id }) => <Input id={id} mono autoComplete="off" value={newForm.username} onChange={(e) => setNewForm({ ...newForm, username: e.target.value })} required />}
              </Field>
              <div className="frow">
                <Field label="Imię" id="new-first-name" required>
                  {({ id }) => <Input id={id} value={newForm.first_name} onChange={(e) => setNewForm({ ...newForm, first_name: e.target.value })} required />}
                </Field>
                <Field label="Nazwisko" id="new-last-name">
                  {({ id }) => <Input id={id} value={newForm.last_name} onChange={(e) => setNewForm({ ...newForm, last_name: e.target.value })} />}
                </Field>
              </div>
              <div className="frow">
                <Field label={branding.ldapEnabled ? 'Numer pracownika (klucz dowiązania z AD)' : 'Numer pracownika'} id="new-personnel-number">
                  {({ id }) => <Input id={id} mono inputMode="numeric" pattern="[0-9]*" value={newForm.personnel_number ?? ''} onChange={(e) => setNewForm({ ...newForm, personnel_number: e.target.value || null })} />}
                </Field>
                <Field label="E-mail" id="new-email">
                  {({ id }) => <Input id={id} type="email" value={newForm.email ?? ''} onChange={(e) => setNewForm({ ...newForm, email: e.target.value || null })} />}
                </Field>
              </div>
              <div className="frow">
                <Field label="Telefon" id="new-phone" hint="Opcjonalny, widoczny dla zalogowanych osób na karcie dyżurnego">
                  {({ id, describedBy }) => <Input id={id} type="tel" mono value={newForm.phone ?? ''} aria-describedby={describedBy} onChange={(e) => setNewForm({ ...newForm, phone: e.target.value || null })} />}
                </Field>
                <Field label="Rola konta" id="new-role">
                  {({ id }) => (
                    <Select id={id} value={newForm.role} onChange={(e) => setNewForm({ ...newForm, role: e.target.value as UserRole })}>
                      {roles.map((role) => <option key={role} value={role}>{accountRoleLabels[role]}</option>)}
                    </Select>
                  )}
                </Field>
              </div>
            </>
          )}
        </form>
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

      <Panel
        open={Boolean(selectedRow)}
        onOpenChange={(open) => { if (!open) requestClose() }}
        wide
        title={selectedRow?.user.display_name ?? ''}
        meta={selectedRow && (
          <>
            <Tag>{accountRoleLabels[selectedRow.user.role]}</Tag>
            <Tag>{authSourceLabels[selectedRow.user.auth_source]}</Tag>
            {!selectedRow.user.is_active && <StatusBadge tone="muted">wyłączone</StatusBadge>}
          </>
        )}
        footer={selectedRow && (
          <>
            {dirty && <span className="small muted">Niezapisane: {pendingChanges.join(' · ')}</span>}
            <span className="sp" />
            <Button onClick={requestClose}>Zamknij</Button>
            <Button type="submit" form="person-form" variant="primary" disabled={!dirty || saveAll.isPending} loading={saveAll.isPending}>
              {saveAll.isPending ? 'Zapisuję…' : dirty ? `Zapisz zmiany (${pendingChanges.length})` : 'Brak zmian'}
            </Button>
          </>
        )}
      >
        {selectedRow && (
          <form id="person-form" onSubmit={submitAll} className="stack-sm">
            {saveAll.error && <Box tone="bad" role="alert" title={saveAll.error.message} />}
            <Tabs<DetailTab>
              label="Sekcje konta"
              value={tab}
              onChange={setTab}
              items={[
                { value: 'account', label: 'Konto' },
                { value: 'rotation', label: 'Rotacja' },
                { value: 'eligibility', label: 'Eligibility', count: selectedRow.member?.eligibility.length, disabled: !selectedRow.member },
              ]}
            >
              <TabPanel<DetailTab> value="account" className="stack-sm">
                <p className="muted small">
                  {ldapFieldsLocked ? 'Dane osobowe pochodzą z AD i są tylko do odczytu.' : 'Dane lokalne można zmieniać w tym panelu.'}
                </p>
                {branding.ldapEnabled && selectedRow.user.auth_source === 'local' && (
                  <Box tone="muted">
                    Konto dowiąże się z AD automatycznie przy pierwszym logowaniu LDAP tej osoby, o ile numer pracownika zgadza się z employeeNumber w AD
                    {selectedRow.user.personnel_number ? ` (obecnie: ${selectedRow.user.personnel_number})` : ' (obecnie brak - bez numeru dowiązanie nie nastąpi)'}. Po dowiązaniu hasło lokalne przestaje działać.
                  </Box>
                )}
                <div className="frow">
                  <Field label="Imię" id="acc-first-name" required>
                    {({ id }) => <Input id={id} disabled={ldapFieldsLocked} value={accountForm.first_name ?? ''} onChange={(e) => setAccountForm({ ...accountForm, first_name: e.target.value })} required />}
                  </Field>
                  <Field label="Nazwisko" id="acc-last-name">
                    {({ id }) => <Input id={id} disabled={ldapFieldsLocked} value={accountForm.last_name ?? ''} onChange={(e) => setAccountForm({ ...accountForm, last_name: e.target.value })} />}
                  </Field>
                </div>
                <div className="frow">
                  <Field label="Numer pracownika" id="acc-personnel-number">
                    {({ id }) => <Input id={id} mono disabled={ldapFieldsLocked} inputMode="numeric" pattern="[0-9]*" value={accountForm.personnel_number ?? ''} onChange={(e) => setAccountForm({ ...accountForm, personnel_number: e.target.value || null })} />}
                  </Field>
                  <Field label="E-mail" id="acc-email">
                    {({ id }) => <Input id={id} type="email" disabled={ldapFieldsLocked} value={accountForm.email ?? ''} onChange={(e) => setAccountForm({ ...accountForm, email: e.target.value || null })} />}
                  </Field>
                </div>
                <div className="frow">
                  <Field label="Telefon" id="acc-phone" hint="Widoczny dla zalogowanych osób na karcie dyżurnego">
                    {({ id, describedBy }) => <Input id={id} type="tel" mono value={accountForm.phone ?? ''} aria-describedby={describedBy} onChange={(e) => setAccountForm({ ...accountForm, phone: e.target.value || null })} />}
                  </Field>
                  <Field label="Rola konta" id="acc-role">
                    {({ id }) => (
                      <Select id={id} value={accountForm.role ?? selectedRow.user.role} onChange={(e) => setAccountForm({ ...accountForm, role: e.target.value as UserRole })}>
                        {roles.map((role) => <option key={role} value={role}>{accountRoleLabels[role]}</option>)}
                      </Select>
                    )}
                  </Field>
                </div>
                <Checkbox label="Konto aktywne" hint="Wyłączone konto nie może się zalogować; historia dyżurów zostaje." checked={accountForm.is_active ?? false} onChange={(e) => setAccountForm({ ...accountForm, is_active: e.target.checked })} />
                <div className="row">
                  {selectedRow.user.auth_source === 'local' && <Button size="sm" icon="lock" onClick={() => setResetConfirmation(true)}>Wygeneruj reset hasła</Button>}
                  <Button size="sm" variant="ghost" icon="trash" onClick={() => setDeleteConfirmation(true)}>Usuń konto i dane osobowe</Button>
                </div>
                {resetUrl && <LinkResult value={resetUrl} label="Link resetu hasła (ważny godzinę)" />}
              </TabPanel>
              <TabPanel<DetailTab> value="rotation" className="stack-sm">
                <p className="muted small">Rola konta nie dodaje automatycznie do rotacji.</p>
                <div className="frow">
                  <DateField id="rotation-from" label="Wejście od" value={rotationFrom} onChange={setRotationFrom} />
                  {selectedRow.member && <DateField id="rotation-until" label="Wyjście do" value={rotationUntil} onChange={setRotationUntil} hint="Puste: bez daty końca" />}
                </div>
                {selectedRow.member && rotationUntil && (
                  <Button onClick={() => setOffboardingOpen(true)} icon="people">Przepisz przyszłe dyżury i zakończ rotację…</Button>
                )}
                {!selectedRow.member && (
                  <div className="row">
                    <Button variant="primary" onClick={() => createRotation.mutate()} loading={createRotation.isPending}>Dodaj do rotacji</Button>
                    <span className="muted small">od {formatDate(rotationFrom)}</span>
                  </div>
                )}
              </TabPanel>
              <TabPanel<DetailTab> value="eligibility" className="stack-sm">
                {selectedRow.member && (
                  <>
                    {selectedRow.member.eligibility.length === 0 && <p className="muted small">Brak okresów; generator nie przydzieli tej osobie żadnej roli.</p>}
                    {selectedRow.member.eligibility.map((item) => (
                      <EligibilityPeriodEditor
                        key={item.id}
                        item={item}
                        value={eligibilityEdits[item.id] ?? { starts_on: item.starts_on, ends_on: item.ends_on ?? '' }}
                        pending={saveAll.isPending}
                        onChange={(next) => setEligibilityEdits((current) => {
                          const unchanged = next.starts_on === item.starts_on && (next.ends_on || null) === item.ends_on
                          const copy = { ...current }
                          if (unchanged) delete copy[item.id]
                          else copy[item.id] = next
                          return copy
                        })}
                        onDelete={(id) => deleteEligibility.mutate(id)}
                      />
                    ))}
                    <SectionHeading as="h3" title="Nowy okres" />
                    <div className="frow" style={{ alignItems: 'end' }}>
                      <Field label="Rola dyżurowa" id="new-eligibility-role">
                        {({ id }) => (
                          <Select id={id} value={eligibilityRole} onChange={(e) => setEligibilityRole(e.target.value as AssignmentRole)}>
                            {dutyRoles.map((role) => <option key={role} value={role}>{dutyRoleLabels[role]}</option>)}
                          </Select>
                        )}
                      </Field>
                      <DateField id="new-eligibility-from" label="Od" value={eligibilityFrom} onChange={setEligibilityFrom} />
                      <DateField id="new-eligibility-until" label="Do (opcjonalnie)" value={eligibilityUntil} onChange={setEligibilityUntil} />
                      <Button onClick={() => addEligibility.mutate()} loading={addEligibility.isPending} icon="plus">Dodaj okres</Button>
                    </div>
                  </>
                )}
              </TabPanel>
            </Tabs>
          </form>
        )}
      </Panel>

      <ConfirmDialog
        open={confirmation}
        title="Potwierdź zmianę dostępu"
        description={<>Zmiana roli lub wyłączenie konta wpływa na dostęp użytkownika do systemu.<br />Do zapisania: {pendingChanges.join(' · ')}</>}
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
        description={<>Masz niezapisane zmiany: {pendingChanges.join(' · ')}.<br />Zamknięcie panelu je wyrzuci.</>}
        confirmLabel="Zamknij bez zapisywania"
        confirmColor="warning"
        onCancel={() => setCloseConfirmation(false)}
        onConfirm={() => { setCloseConfirmation(false); setSelectedId(null) }}
      />
      <ConfirmDialog
        open={deleteConfirmation}
        title="Usunąć konto?"
        description="Konto, sesje i dane osobowe zostaną trwale usunięte. Historyczne dyżury pozostaną jako zapis operacyjny."
        confirmLabel="Usuń konto"
        confirmColor="error"
        pending={deleteAccount.isPending}
        error={deleteAccount.error ? deleteAccount.error.message : null}
        onCancel={() => setDeleteConfirmation(false)}
        onConfirm={() => selectedRow && deleteAccount.mutate(selectedRow.user.id)}
      />
      <ConfirmDialog
        open={resetConfirmation}
        title="Wygenerować reset hasła?"
        description="Istniejące sesje użytkownika zostaną unieważnione po ustawieniu nowego hasła."
        confirmLabel="Wygeneruj link"
        pending={resetPassword.isPending}
        error={resetPassword.error ? resetPassword.error.message : null}
        onCancel={() => setResetConfirmation(false)}
        onConfirm={() => selectedRow && resetPassword.mutate(selectedRow.user.id, { onSuccess: () => setResetConfirmation(false) })}
      />
    </div>
  )
}
