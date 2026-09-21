import { FormEvent, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AdminUser, AdminUserInput, AdminUserUpdate, AssignmentRole, Eligibility, TeamMember, UserRole, api } from '../../api'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { CopyButton } from '../../components/CopyButton'
import { DateField } from '../../components/DateField'
import { OffboardingDialog } from '../../components/OffboardingDialog'
import { roleLabels as dutyRoleLabels, shortRoleLabels } from '../../lib/labels'
import { roleLabels as accountRoleLabels } from '../../lib/nav'
import { pluralPl } from '../../lib/plural'
import { addDays, formatDate, formatShortDate, warsawDate } from '../../lib/dates'
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
  List,
  ListRow,
  LoadingBlock,
  PageHeader,
  Panel,
  SectionHeading,
  Segmented,
  StatusBadge,
  StatusTone,
  TabPanel,
  Tabs,
  Tag,
  cx,
} from '../../ui'

const authSourceLabels = { local: 'lokalne', ldap: 'LDAP / AD' } as const
const roles: UserRole[] = ['viewer', 'member', 'coordinator', 'admin']
const roleTone: Record<UserRole, StatusTone> = { viewer: 'muted', member: 'draft', coordinator: 'prop', admin: 'prop' }
const dutyRoles: AssignmentRole[] = ['primary', 'secondary', 'late_shift']

interface Row {
  user: AdminUser
  member?: TeamMember
}

const emptyAccount: AdminUserInput = {
  username: '', personnel_number: null, first_name: '', last_name: '', email: null, phone: null, role: 'member',
}

/** Where a person stands in the rotation, as the table and the panel say it. */
type RotationState = 'active' | 'entering' | 'ended' | 'outside'
function rotationState(member: TeamMember | undefined, today: string): RotationState {
  if (!member) return 'outside'
  if (member.active_until && member.active_until < today) return 'ended'
  if (member.active_from > today) return 'entering'
  return 'active'
}

/** The roles a member may be given on a day: an open period that covers it. */
function heldRoles(member: TeamMember | undefined, day: string): AssignmentRole[] {
  if (!member) return []
  return dutyRoles.filter((role) => member.eligibility.some((item) => item.role === role && item.starts_on <= day && (!item.ends_on || item.ends_on >= day)))
}

function RotationCell({ member, today }: { member?: TeamMember; today: string }) {
  const state = rotationState(member, today)
  if (state === 'outside') return <span className="muted">poza rotacją</span>
  const roles = heldRoles(member, today < member!.active_from ? member!.active_from : today)
  const qualifications = roles.length > 0 ? roles.map((role) => shortRoleLabels[role]).join(' · ') : 'bez kwalifikacji'
  if (state === 'entering') return <><StatusBadge tone="warn">od {formatShortDate(member!.active_from)}</StatusBadge><small>{qualifications}</small></>
  if (state === 'ended') return <><StatusBadge tone="muted">zakończona</StatusBadge><small>do {formatDate(member!.active_until!)}</small></>
  return (
    <>
      <StatusBadge tone="ok">w rotacji</StatusBadge>
      <small>od {formatDate(member!.active_from)}{member!.active_until ? ` do ${formatDate(member!.active_until)}` : ''} · {qualifications}</small>
    </>
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

function EligibilityPeriodEditor({ item, value, pending, onChange, onDelete, onDone }: {
  item: Eligibility
  value: PeriodValue
  pending: boolean
  onChange: (next: PeriodValue) => void
  onDelete: (id: string) => void
  onDone: () => void
}) {
  return (
    <div className="frow" style={{ alignItems: 'end' }}>
      <DateField id={`eligibility-${item.id}-from`} label="Od" value={value.starts_on} onChange={(starts_on) => onChange({ ...value, starts_on })} />
      <DateField id={`eligibility-${item.id}-until`} label="Do (opcjonalnie)" value={value.ends_on} onChange={(ends_on) => onChange({ ...value, ends_on })} />
      <div className="row">
        <Button size="sm" onClick={onDone}>Gotowe</Button>
        <Button size="sm" variant="ghost" icon="trash" disabled={pending} onClick={() => onDelete(item.id)}>Usuń</Button>
      </div>
    </div>
  )
}

function csvOf(rows: Row[], today: string) {
  const head = ['osoba', 'login', 'numer', 'email', 'telefon', 'rola', 'logowanie', 'aktywne', 'rotacja', 'wejscie', 'wyjscie', 'kwalifikacje']
  const cell = (value: string | null | undefined) => `"${(value ?? '').replace(/"/g, '""')}"`
  const lines = rows.map(({ user, member }) => [
    user.display_name, user.username, user.personnel_number, user.email, user.phone, accountRoleLabels[user.role],
    authSourceLabels[user.auth_source], user.is_active ? 'tak' : 'nie', rotationState(member, today),
    member?.active_from, member?.active_until, heldRoles(member, today).map((role) => dutyRoleLabels[role]).join(' '),
  ].map(cell).join(';'))
  return [head.join(';'), ...lines].join('\n')
}

type Filter = 'all' | 'rotation' | 'outside' | 'inactive'
const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'Wszystkie' },
  { value: 'rotation', label: 'W rotacji' },
  { value: 'outside', label: 'Poza rotacją' },
  { value: 'inactive', label: 'Wyłączone' },
]
type DetailTab = 'account' | 'rotation' | 'access'

/**
 * One table with the columns an administrator reads, a panel with three
 * sections (konto, rotacja, dostęp) and the offboarding as a red sheet
 * confirmed by typing the login. "Eligibility" is "kwalifikacje dyżurowe"
 * here: chips on the rotation tab, with the periods under them.
 */
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
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteTyped, setDeleteTyped] = useState('')
  const [closeConfirmation, setCloseConfirmation] = useState(false)
  const [rotationFrom, setRotationFrom] = useState(today)
  const [rotationUntil, setRotationUntil] = useState('')
  const [offboardingOpen, setOffboardingOpen] = useState(false)
  const [eligibilityEdits, setEligibilityEdits] = useState<Record<string, PeriodValue>>({})
  const [editingPeriod, setEditingPeriod] = useState<string | null>(null)
  const [addingPeriod, setAddingPeriod] = useState(false)
  const [eligibilityRole, setEligibilityRole] = useState<AssignmentRole>('primary')
  const [eligibilityFrom, setEligibilityFrom] = useState(today)
  const [eligibilityUntil, setEligibilityUntil] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const allRows = useMemo<Row[]>(() => {
    const byUser = new Map((team.data ?? []).map((member) => [member.user_id, member]))
    return (users.data ?? [])
      .map((user) => ({ user, member: byUser.get(user.id) }))
      .sort((a, b) => a.user.display_name.localeCompare(b.user.display_name, 'pl'))
  }, [users.data, team.data])
  const rows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('pl')
    return allRows.filter(({ user, member }) => {
      const matchesSearch = !needle || [user.display_name, user.username, user.personnel_number, user.phone]
        .some((value) => value?.toLocaleLowerCase('pl').includes(needle))
      const state = rotationState(member, today)
      const matchesFilter = filter === 'all'
        || (filter === 'rotation' && (state === 'active' || state === 'entering'))
        || (filter === 'outside' && (state === 'outside' || state === 'ended'))
        || (filter === 'inactive' && !user.is_active)
      return matchesSearch && matchesFilter
    })
  }, [allRows, search, filter, today])
  const selectedRow = allRows.find(({ user }) => user.id === selectedId)
  const counts = {
    accounts: allRows.length,
    rotation: allRows.filter(({ member }) => rotationState(member, today) === 'active').length,
    entering: allRows.filter(({ member }) => rotationState(member, today) === 'entering').map(({ member }) => member!.active_from).sort(),
    inactive: allRows.filter(({ user }) => !user.is_active).length,
  }

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    queryClient.invalidateQueries({ queryKey: ['team'] })
  }
  const openDetails = ({ user, member }: Row, section: DetailTab = 'account') => {
    setSelectedId(user.id)
    setTab(section)
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
    setEditingPeriod(null)
    setAddingPeriod(false)
    setCloseConfirmation(false)
    setResetUrl('')
  }
  const openNew = () => {
    setNewForm(emptyAccount)
    setActivationUrl('')
    setNewOpen(true)
  }

  const createAccount = useMutation({
    mutationFn: (input: AdminUserInput) => api.createAdminUser(input),
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
        if (!edit.starts_on) throw new Error('Każdy okres kwalifikacji musi mieć datę początku')
        tasks.push(api.updateEligibility({ id: item.id, input: { starts_on: edit.starts_on, ends_on: edit.ends_on || null } }))
      }
      await Promise.all(tasks)
    },
    onSuccess: () => {
      setConfirmation(false)
      setEligibilityEdits({})
      setEditingPeriod(null)
      refresh()
    },
  })
  const resetPassword = useMutation({ mutationFn: (id: string) => api.issuePasswordReset(id), onSuccess: ({ url }) => setResetUrl(url) })
  const deleteAccount = useMutation({
    mutationFn: (id: string) => api.deleteAdminUser(id),
    onSuccess: () => { setDeleteOpen(false); setSelectedId(null); refresh() },
  })
  const createRotation = useMutation({
    mutationFn: () => api.createTeamMember({ user_id: selectedId!, active_from: rotationFrom }),
    onSuccess: refresh,
  })
  const addEligibility = useMutation({
    mutationFn: (input: { role: AssignmentRole; starts_on: string; ends_on: string | null }) =>
      api.createEligibility({ memberId: selectedRow!.member!.id, input }),
    onSuccess: () => {
      setEligibilityUntil('')
      setAddingPeriod(false)
      refresh()
    },
  })
  const deleteEligibility = useMutation({ mutationFn: (id: string) => api.deleteEligibility(id), onSuccess: refresh })
  // Taking a chip off ends the open period today (a period that has not
  // started yet is dropped); the published schedule is not touched.
  const dropQualification = useMutation({
    mutationFn: async (role: AssignmentRole) => {
      const member = selectedRow!.member!
      const open = member.eligibility.filter((item) => item.role === role && (!item.ends_on || item.ends_on >= today))
      for (const item of open) {
        if (item.starts_on >= today) await api.deleteEligibility(item.id)
        else await api.updateEligibility({ id: item.id, input: { ends_on: addDays(today, -1) } })
      }
    },
    onSuccess: refresh,
  })

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
  const error = users.error || team.error || createRotation.error || addEligibility.error || deleteEligibility.error || dropQualification.error
  const ldapFieldsLocked = selectedRow?.user.auth_source === 'ldap'
  const selectedState = rotationState(selectedRow?.member, today)
  const selectedRoles = heldRoles(selectedRow?.member, today)
  const exportCsv = () => {
    const blob = new Blob([`\uFEFF${csvOf(rows, today)}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `osoby-${today}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }
  const roleOptions = roles.map((role) => ({ value: role, label: accountRoleLabels[role] }))
  const subtitle = users.data && team.data && [
    pluralPl(counts.accounts, ['konto', 'konta', 'kont']),
    `${counts.rotation} w rotacji`,
    counts.entering.length > 0 ? `${counts.entering.length === 1 ? '1 wchodzi' : `${counts.entering.length} wchodzi`} ${formatShortDate(counts.entering[0])}` : null,
    counts.inactive > 0 ? `${pluralPl(counts.inactive, ['wyłączone', 'wyłączone', 'wyłączonych'])}` : null,
  ].filter(Boolean).join(' · ')

  return (
    <div className="page">
      <PageHeader
        title="Osoby"
        sub={subtitle ?? 'Konta, dostęp do systemu i okresy uczestnictwa w rotacji.'}
        actions={(
          <>
            <Button variant="ghost" icon="download" onClick={exportCsv} disabled={rows.length === 0}>Eksport CSV</Button>
            <Button variant="primary" icon="plus" onClick={openNew}>Nowe konto</Button>
          </>
        )}
      />
      {error && <Box tone="bad" role="alert" title={error.message} />}
      <SectionHeading
        title="Konta"
        controls={(
          <>
            <Input
              type="search"
              aria-label="Szukaj osoby, loginu lub numeru"
              placeholder="Szukaj osoby, loginu lub numeru"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="sech-search"
            />
            {FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                className={cx('sech-link', filter === item.value && 'on')}
                aria-pressed={filter === item.value}
                onClick={() => setFilter(item.value)}
              >
                {item.label}
              </button>
            ))}
          </>
        )}
      />
      {(users.isLoading || team.isLoading) && <LoadingBlock label="Wczytywanie kont" />}
      {users.data && rows.length === 0 && (
        <div className="panel"><EmptyState compact icon="people" title="Brak kont dla wybranego filtra" /></div>
      )}
      {rows.length > 0 && (
        <div className="panel wide-scroll">
          <table className="lg" aria-label="Konta">
            <caption className="sr-only">Konta systemu i ich status w rotacji.</caption>
            <thead>
              <tr>
                <th scope="col">Osoba</th>
                <th scope="col">Login · numer</th>
                <th scope="col">Rola konta</th>
                <th scope="col">Rotacja</th>
                <th scope="col">Telefon</th>
                <th scope="col">Logowanie</th>
                <th scope="col"><span className="sr-only">Akcje</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const state = rotationState(row.member, today)
                const needsPhone = !row.user.phone && (state === 'active' || state === 'entering')
                return (
                  <tr key={row.user.id} className={cx(selectedId === row.user.id && 'on', !row.user.is_active && 'row-off')}>
                    <th scope="row">
                      <button type="button" className="link-btn" onClick={() => openDetails(row)}>
                        <b>{row.user.display_name}</b>
                        <small>{row.user.email ?? (row.user.is_active ? 'bez e-maila' : 'konto wyłączone')}</small>
                      </button>
                    </th>
                    <td className="mono">
                      {row.user.username}
                      <small>{row.user.personnel_number ?? '–'}</small>
                    </td>
                    <td><StatusBadge tone={roleTone[row.user.role]}>{accountRoleLabels[row.user.role]}</StatusBadge></td>
                    <td>{row.user.role === 'viewer' && !row.member ? <span className="muted">nie dotyczy</span> : <RotationCell member={row.member} today={today} />}</td>
                    <td className={cx('mono', needsPhone && 'who-bad')}>
                      {row.user.phone ?? (needsPhone ? 'brak' : <span className="muted">–</span>)}
                    </td>
                    <td>
                      <Tag>{authSourceLabels[row.user.auth_source]}</Tag>
                      <small>{row.user.auth_source === 'ldap' ? `pierwszy login ${formatDate(row.user.created_at)}` : `konto od ${formatDate(row.user.created_at)}`}</small>
                    </td>
                    <td className="n"><Button size="sm" variant="ghost" onClick={() => openDetails(row)}>Otwórz</Button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Panel
        open={newOpen}
        onOpenChange={setNewOpen}
        wide
        title="Nowe konto lokalne"
        meta={<StatusBadge tone={roleTone[newForm.role]}>{accountRoleLabels[newForm.role]}</StatusBadge>}
        footer={(
          <>
            <Button onClick={() => setNewOpen(false)}>{activationUrl ? 'Zamknij' : 'Anuluj'}</Button>
            {!activationUrl && (
              <Button type="submit" form="new-account-form" variant="primary" loading={createAccount.isPending} disabled={!newForm.username.trim() || !newForm.first_name.trim()}>
                Utwórz konto
              </Button>
            )}
          </>
        )}
      >
        <form id="new-account-form" className="stack-sm" onSubmit={(event: FormEvent) => { event.preventDefault(); createAccount.mutate(newForm) }}>
          {createAccount.error && <Box tone="bad" role="alert" title={createAccount.error.message} />}
          {activationUrl && <LinkResult value={activationUrl} label="Link aktywacyjny (ważny 24 godziny)" />}
          {!activationUrl && (
            <>
              <div className="frow">
                <Field label="Imię" id="new-first-name" required>
                  {({ id }) => <Input id={id} value={newForm.first_name} onChange={(e) => setNewForm({ ...newForm, first_name: e.target.value })} required />}
                </Field>
                <Field label="Nazwisko" id="new-last-name">
                  {({ id }) => <Input id={id} value={newForm.last_name} onChange={(e) => setNewForm({ ...newForm, last_name: e.target.value })} />}
                </Field>
              </div>
              <div className="frow">
                <Field label="Login" id="new-username" required hint={branding.ldapEnabled ? 'Konta AD logują się loginem domenowym.' : undefined}>
                  {({ id, describedBy }) => <Input id={id} mono autoComplete="off" value={newForm.username} aria-describedby={describedBy} onChange={(e) => setNewForm({ ...newForm, username: e.target.value })} required />}
                </Field>
                <Field label="Numer pracownika" id="new-personnel-number" hint={branding.ldapEnabled ? 'Klucz dowiązania z AD: zgodny z employeeNumber.' : undefined}>
                  {({ id, describedBy }) => <Input id={id} mono inputMode="numeric" pattern="[0-9]*" value={newForm.personnel_number ?? ''} aria-describedby={describedBy} onChange={(e) => setNewForm({ ...newForm, personnel_number: e.target.value || null })} />}
                </Field>
              </div>
              <div className="frow">
                <Field label="E-mail" id="new-email">
                  {({ id }) => <Input id={id} type="email" value={newForm.email ?? ''} onChange={(e) => setNewForm({ ...newForm, email: e.target.value || null })} />}
                </Field>
                <Field label="Telefon · na pasku „Teraz”" id="new-phone" hint="Wymagany dla osób w rotacji; widzą go zalogowane osoby.">
                  {({ id, describedBy }) => <Input id={id} type="tel" mono value={newForm.phone ?? ''} aria-describedby={describedBy} onChange={(e) => setNewForm({ ...newForm, phone: e.target.value || null })} />}
                </Field>
              </div>
              <Field label="Rola konta" id="new-role" hint="Członek zespołu: własne dyżury, dostępność, zamiany. Koordynator: także generator, korekty, raporty. Administrator: także osoby i audyt.">
                {() => <Segmented<UserRole> label="Rola konta" value={newForm.role} onChange={(role) => setNewForm({ ...newForm, role })} options={roleOptions} />}
              </Field>
              <Box tone="sig" title="Po utworzeniu">
                Dostaniesz link aktywacyjny ważny 24 godziny do przekazania; konto jest nieaktywne do ustawienia hasła.
                {branding.ldapEnabled && ' Przy pierwszym logowaniu LDAP z tym numerem pracownika konto dowiąże się do AD, a hasło lokalne przestanie działać.'}
              </Box>
            </>
          )}
        </form>
      </Panel>

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
        title={selectedRow ? <span className="row"><Avatar name={selectedRow.user.display_name} size={30} />{selectedRow.user.display_name}</span> : ''}
        meta={selectedRow && (
          <>
            <StatusBadge tone={roleTone[selectedRow.user.role]}>{accountRoleLabels[selectedRow.user.role]}</StatusBadge>
            <Tag>{authSourceLabels[selectedRow.user.auth_source]}</Tag>
            {!selectedRow.user.is_active && <StatusBadge tone="bad">wyłączone</StatusBadge>}
          </>
        )}
        footer={selectedRow && (
          <>
            <Button size="sm" variant="ghost" className="btn-bad" onClick={() => { setDeleteTyped(''); setDeleteOpen(true) }}>Usuń konto…</Button>
            <span className="sp" />
            {dirty && <span className="small muted">Niezapisane: {pendingChanges.join(' · ')}</span>}
            <Button onClick={requestClose}>{dirty ? 'Anuluj' : 'Zamknij'}</Button>
            <Button type="submit" form="person-form" variant="primary" disabled={!dirty || saveAll.isPending} loading={saveAll.isPending}>
              {saveAll.isPending ? 'Zapisuję…' : dirty ? `Zapisz (${pendingChanges.length})` : 'Zapisz'}
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
                { value: 'rotation', label: 'Rotacja', count: selectedRow.member ? selectedRoles.length : undefined },
                { value: 'access', label: 'Dostęp' },
              ]}
            >
              <TabPanel<DetailTab> value="account" className="stack-sm">
                {ldapFieldsLocked && <Box tone="muted">Dane osobowe pochodzą z AD i są tylko do odczytu; telefon ustawia się tutaj.</Box>}
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
                  <Field label="Login" id="acc-username" hint="Loginu nie da się zmienić.">
                    {({ id, describedBy }) => <Input id={id} mono disabled value={selectedRow.user.username} aria-describedby={describedBy} readOnly />}
                  </Field>
                  <Field label="Numer pracownika" id="acc-personnel-number">
                    {({ id }) => <Input id={id} mono disabled={ldapFieldsLocked} inputMode="numeric" pattern="[0-9]*" value={accountForm.personnel_number ?? ''} onChange={(e) => setAccountForm({ ...accountForm, personnel_number: e.target.value || null })} />}
                  </Field>
                </div>
                <div className="frow">
                  <Field label="E-mail" id="acc-email">
                    {({ id }) => <Input id={id} type="email" disabled={ldapFieldsLocked} value={accountForm.email ?? ''} onChange={(e) => setAccountForm({ ...accountForm, email: e.target.value || null })} />}
                  </Field>
                  <Field
                    label="Telefon · na pasku „Teraz”"
                    id="acc-phone"
                    hint="Widzą go zalogowane osoby na pasku „Teraz” i na karcie dyżurnego."
                    error={!accountForm.phone && (selectedState === 'active' || selectedState === 'entering') ? 'Wymagany dla osób w rotacji.' : undefined}
                  >
                    {({ id, describedBy, invalid }) => <Input id={id} type="tel" mono invalid={invalid} value={accountForm.phone ?? ''} aria-describedby={describedBy} onChange={(e) => setAccountForm({ ...accountForm, phone: e.target.value || null })} />}
                  </Field>
                </div>
              </TabPanel>
              <TabPanel<DetailTab> value="rotation" className="stack-sm">
                {selectedRow.member ? (
                  <>
                    <Box tone={selectedState === 'active' ? 'ok' : selectedState === 'entering' ? 'warn' : 'muted'} title={
                      selectedState === 'active' ? `W rotacji od ${formatDate(selectedRow.member.active_from)}`
                        : selectedState === 'entering' ? `Wchodzi do rotacji ${formatDate(selectedRow.member.active_from)}`
                          : `Rotacja zakończona ${formatDate(selectedRow.member.active_until!)}`
                    }>
                      {selectedRow.member.active_until && selectedState !== 'ended' ? `Wyjście do ${formatDate(selectedRow.member.active_until)}. ` : selectedState !== 'ended' ? 'Bez daty wyjścia. ' : ''}
                      Kwalifikacje: {selectedRoles.length > 0 ? selectedRoles.map((role) => dutyRoleLabels[role]).join(', ') : 'brak - generator nie przydzieli tej osobie żadnej roli'}.
                    </Box>
                    <Field label="Kwalifikacje dyżurowe" id="qualifications" hint="Zdejmij chip, żeby wykluczyć rolę od następnej generacji; opublikowany grafik zostaje. Dodaj chip, żeby rola liczyła się od dziś.">
                      {() => (
                        <div className="filter-chips" role="group" aria-label="Kwalifikacje dyżurowe">
                          {dutyRoles.map((role) => {
                            const held = selectedRoles.includes(role)
                            return held ? (
                              <span key={role} className="filter-chip">
                                {dutyRoleLabels[role]}
                                <button type="button" aria-label={`Zdejmij kwalifikację ${dutyRoleLabels[role]}`} disabled={dropQualification.isPending} onClick={() => dropQualification.mutate(role)}>×</button>
                              </span>
                            ) : (
                              <button
                                key={role}
                                type="button"
                                className="chip chip-btn"
                                aria-label={`Dodaj kwalifikację ${dutyRoleLabels[role]}`}
                                disabled={addEligibility.isPending}
                                onClick={() => addEligibility.mutate({ role, starts_on: today, ends_on: null })}
                              >
                                + {dutyRoleLabels[role]}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </Field>
                    <div className="frow">
                      <DateField id="rotation-from" label="Wejście od" value={rotationFrom} onChange={setRotationFrom} />
                      <DateField id="rotation-until" label="Wyjście do" value={rotationUntil} onChange={setRotationUntil} hint="Puste: bez daty końca." />
                    </div>
                    <SectionHeading
                      as="h3"
                      title="Okresy kwalifikacji"
                      meta={`${selectedRow.member.eligibility.length}`}
                      controls={<button type="button" className={cx('sech-link', addingPeriod && 'on')} aria-pressed={addingPeriod} onClick={() => setAddingPeriod((value) => !value)}>Dodaj okres</button>}
                    />
                    {addingPeriod && (
                      <div className="frow" style={{ alignItems: 'end' }}>
                        <Field label="Rola dyżurowa" id="new-eligibility-role">
                          {() => (
                            <Segmented<AssignmentRole>
                              label="Rola dyżurowa"
                              size="sm"
                              value={eligibilityRole}
                              onChange={setEligibilityRole}
                              options={dutyRoles.map((role) => ({ value: role, label: dutyRoleLabels[role] }))}
                            />
                          )}
                        </Field>
                        <DateField id="new-eligibility-from" label="Od" value={eligibilityFrom} onChange={setEligibilityFrom} />
                        <DateField id="new-eligibility-until" label="Do (opcjonalnie)" value={eligibilityUntil} onChange={setEligibilityUntil} />
                        <Button onClick={() => addEligibility.mutate({ role: eligibilityRole, starts_on: eligibilityFrom, ends_on: eligibilityUntil || null })} loading={addEligibility.isPending} icon="plus">Dodaj okres</Button>
                      </div>
                    )}
                    {selectedRow.member.eligibility.length === 0 && <p className="muted small">Brak okresów; generator nie przydzieli tej osobie żadnej roli.</p>}
                    {selectedRow.member.eligibility.length > 0 && (
                      <List className="panel">
                        {[...selectedRow.member.eligibility].sort((a, b) => b.starts_on.localeCompare(a.starts_on)).map((item) => {
                          const value = eligibilityEdits[item.id] ?? { starts_on: item.starts_on, ends_on: item.ends_on ?? '' }
                          const historic = Boolean(item.ends_on && item.ends_on < today)
                          return editingPeriod === item.id ? (
                            <div key={item.id} className="list-row">
                              <div className="list-main stack-sm">
                                <b>{dutyRoleLabels[item.role]}</b>
                                <EligibilityPeriodEditor
                                  item={item}
                                  value={value}
                                  pending={saveAll.isPending}
                                  onChange={(next) => setEligibilityEdits((current) => {
                                    const unchanged = next.starts_on === item.starts_on && (next.ends_on || null) === item.ends_on
                                    const copy = { ...current }
                                    if (unchanged) delete copy[item.id]
                                    else copy[item.id] = next
                                    return copy
                                  })}
                                  onDelete={(id) => deleteEligibility.mutate(id)}
                                  onDone={() => setEditingPeriod(null)}
                                />
                              </div>
                            </div>
                          ) : (
                            <ListRow
                              key={item.id}
                              aside={historic
                                ? <span className="muted small">historia</span>
                                : <Button size="sm" variant="ghost" onClick={() => setEditingPeriod(item.id)}>Edytuj</Button>}
                            >
                              <b>{formatDate(value.starts_on)} → {value.ends_on ? formatDate(value.ends_on) : '∞'}</b>
                              <small>{dutyRoleLabels[item.role]}{eligibilityEdits[item.id] ? ' · zmieniony, niezapisany' : ''}</small>
                            </ListRow>
                          )
                        })}
                      </List>
                    )}
                    {rotationUntil && (
                      <Box tone="warn" title="Skutek dla grafiku">
                        Dyżury opublikowane po {formatDate(rotationUntil)} zostaną bez obsady i pojawią się w ryzykach, dopóki ich nie przepiszesz.
                        <div className="row" style={{ marginTop: 6 }}>
                          <Button size="sm" onClick={() => setOffboardingOpen(true)} icon="people">Przepisz przyszłe dyżury i zakończ rotację…</Button>
                        </div>
                      </Box>
                    )}
                  </>
                ) : (
                  <>
                    <Box tone="muted" title="Poza rotacją">Rola konta nie dodaje automatycznie do rotacji; osoba w rotacji dostaje dyżury od daty wejścia.</Box>
                    <div className="frow" style={{ alignItems: 'end' }}>
                      <DateField id="rotation-from" label="Wejście od" value={rotationFrom} onChange={setRotationFrom} />
                      <Button variant="primary" onClick={() => createRotation.mutate()} loading={createRotation.isPending}>Dodaj do rotacji</Button>
                    </div>
                  </>
                )}
              </TabPanel>
              <TabPanel<DetailTab> value="access" className="stack-sm">
                <Field label="Rola konta" id="acc-role" hint="Członek zespołu: własne dyżury, dostępność, zamiany. Koordynator: także generator, korekty, raporty. Administrator: także osoby i audyt.">
                  {() => (
                    <Segmented<UserRole>
                      label="Rola konta"
                      value={accountForm.role ?? selectedRow.user.role}
                      onChange={(role) => setAccountForm({ ...accountForm, role })}
                      options={roleOptions}
                    />
                  )}
                </Field>
                <Checkbox label="Konto aktywne" hint="Wyłączone konto nie może się zalogować; historia dyżurów zostaje." checked={accountForm.is_active ?? false} onChange={(e) => setAccountForm({ ...accountForm, is_active: e.target.checked })} />
                {selectedRow.user.auth_source === 'local' && (
                  <div className="row">
                    <Button size="sm" icon="lock" onClick={() => setResetConfirmation(true)}>Wygeneruj reset hasła</Button>
                    <span className="muted small">Jednorazowy link ważny godzinę; przekaż go bezpiecznym kanałem.</span>
                  </div>
                )}
                {resetUrl && <LinkResult value={resetUrl} label="Link resetu hasła (ważny godzinę)" />}
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
      <Dialog
        open={deleteOpen && Boolean(selectedRow)}
        onOpenChange={(open) => { if (!open) setDeleteOpen(false) }}
        tone="danger"
        dismissible={!deleteAccount.isPending}
        title={selectedRow ? `Usuwam konto ${selectedRow.user.display_name} i jego dane osobowe` : ''}
        actions={selectedRow && (
          <>
            <Button onClick={() => setDeleteOpen(false)} disabled={deleteAccount.isPending}>Anuluj</Button>
            <Button
              variant="danger"
              disabled={deleteTyped.trim() !== selectedRow.user.username || deleteAccount.isPending}
              loading={deleteAccount.isPending}
              onClick={() => deleteAccount.mutate(selectedRow.user.id)}
            >
              Usuń konto i dane
            </Button>
          </>
        )}
      >
        {selectedRow && (
          <>
            <ul>
              <li>Konto zostanie wyłączone natychmiast; sesje wygasną.</li>
              <li>Imię, nazwisko, e-mail, telefon i numer pracownika zostaną usunięte. Historia dyżurów i punkty zostają dla sprawiedliwości.</li>
              {selectedRow.member && selectedState !== 'ended' && (
                <li><b className="who-bad">Opublikowane dyżury tej osoby po dziś</b> pozostaną bez obsady i pojawią się w ryzykach. Zalecane: najpierw ustaw „wyjście do” i przepisz dyżury.</li>
              )}
              <li>Operacji nie da się cofnąć. Audyt: „Usunięcie konta i danych”.</li>
            </ul>
            {deleteAccount.error && <Box tone="bad" role="alert" title={deleteAccount.error.message} />}
            <Field label="Wpisz login, żeby potwierdzić" id="delete-confirm">
              {({ id }) => <Input id={id} mono autoComplete="off" value={deleteTyped} placeholder={selectedRow.user.username} onChange={(event) => setDeleteTyped(event.target.value)} />}
            </Field>
          </>
        )}
      </Dialog>
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
