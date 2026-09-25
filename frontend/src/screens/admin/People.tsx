import { FormEvent, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AdminUser, AdminUserInput, AdminUserUpdate, AssignmentRole, Eligibility, TeamMember, UserRole, api } from '../../api'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { CopyButton } from '../../components/CopyButton'
import { DateField } from '../../components/DateField'
import { OffboardingDialog } from '../../components/OffboardingDialog'
import { roleLabels as dutyRoleLabels, shortRoleLabels } from '../../lib/labels'
import { roleLabels as accountRoleLabels } from '../../lib/nav'
import { addDays, formatDate, formatMoment, formatShortDate, warsawDate } from '../../lib/dates'
import { locale, messages, useMessages } from '../../i18n'
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
  const t = useMessages().people.rotation
  const state = rotationState(member, today)
  if (state === 'outside') return <span className="muted">{t.outside}</span>
  const roles = heldRoles(member, today < member!.active_from ? member!.active_from : today)
  const qualifications = roles.length > 0 ? roles.map((role) => shortRoleLabels()[role]).join(' · ') : t.noQualifications
  if (state === 'entering') return <><StatusBadge tone="warn">{t.from(formatShortDate(member!.active_from))}</StatusBadge><small>{qualifications}</small></>
  if (state === 'ended') return <><StatusBadge tone="muted">{t.ended}</StatusBadge><small>{t.until(formatDate(member!.active_until!))}</small></>
  return (
    <>
      <StatusBadge tone="ok">{t.active}</StatusBadge>
      <small>{t.from(formatDate(member!.active_from))}{member!.active_until ? ` ${t.until(formatDate(member!.active_until))}` : ''} · {qualifications}</small>
    </>
  )
}

/**
 * Where a local account's activation stands: waiting while its newest link
 * still works, expired once no link works any more. Null once the account has
 * a password, and always for a directory account.
 */
type ActivationState = 'waiting' | 'expired'
function activationState(user: AdminUser, now: number): ActivationState | null {
  if (!user.pending_activation) return null
  const expiresAt = user.pending_activation.link_expires_at
  return expiresAt && Date.parse(expiresAt) > now ? 'waiting' : 'expired'
}

function activationLinkText(user: AdminUser, state: ActivationState) {
  const t = messages().people.activation
  const expiresAt = user.pending_activation?.link_expires_at
  if (state === 'waiting') return t.linkValidUntil(formatMoment(expiresAt!))
  return expiresAt ? t.linkExpired(formatMoment(expiresAt)) : t.noValidLink
}

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

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
  const t = useMessages().people.period
  return (
    <div className="frow" style={{ alignItems: 'end' }}>
      <DateField id={`eligibility-${item.id}-from`} label={t.from} value={value.starts_on} onChange={(starts_on) => onChange({ ...value, starts_on })} />
      <DateField id={`eligibility-${item.id}-until`} label={t.untilOptional} value={value.ends_on} onChange={(ends_on) => onChange({ ...value, ends_on })} />
      <div className="row">
        <Button size="sm" onClick={onDone}>{t.done}</Button>
        <Button size="sm" variant="ghost" icon="trash" disabled={pending} onClick={() => onDelete(item.id)}>{t.delete}</Button>
      </div>
    </div>
  )
}

function activationCsv(user: AdminUser, now: number) {
  const t = messages().people.csv
  const state = activationState(user, now)
  if (!state) return ''
  return state === 'waiting' ? t.pending : t.pendingExpired
}

function csvOf(rows: Row[], today: string, now: number) {
  const t = messages().people
  const columns = t.csv.columns
  const head = [
    columns.person, columns.username, columns.number, columns.email, columns.phone, columns.role, columns.signIn,
    columns.active, columns.activation, columns.rotation, columns.entry, columns.exit, columns.qualifications,
  ]
  const cell = (value: string | null | undefined) => `"${(value ?? '').replace(/"/g, '""')}"`
  const lines = rows.map(({ user, member }) => [
    user.display_name, user.username, user.personnel_number, user.email, user.phone, accountRoleLabels()[user.role],
    t.authSources[user.auth_source], user.is_active ? t.csv.yes : t.csv.no,
    activationCsv(user, now), rotationState(member, today),
    member?.active_from, member?.active_until, heldRoles(member, today).map((role) => dutyRoleLabels()[role]).join(' '),
  ].map(cell).join(';'))
  return [head.join(';'), ...lines].join('\n')
}

type Filter = 'all' | 'rotation' | 'outside' | 'inactive' | 'pending'
const FILTERS: Filter[] = ['all', 'rotation', 'outside', 'inactive', 'pending']
type DetailTab = 'account' | 'rotation' | 'access'

/**
 * One table with the columns an administrator reads, a panel with three
 * sections (account, rotation, access) and the offboarding as a red sheet
 * confirmed by typing the username. "Eligibility" is "duty qualifications"
 * here: chips on the rotation tab, with the periods under them.
 */
export function PeoplePanel() {
  const m = useMessages()
  const t = m.people
  const queryClient = useQueryClient()
  const today = warsawDate()
  const now = Date.now()
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
  const [reissuedUrl, setReissuedUrl] = useState('')
  const [confirmation, setConfirmation] = useState(false)
  const [resetConfirmation, setResetConfirmation] = useState(false)
  const [reissueConfirmation, setReissueConfirmation] = useState(false)
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
      .sort((a, b) => a.user.display_name.localeCompare(b.user.display_name, locale()))
  }, [users.data, team.data])
  const rows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase(locale())
    return allRows.filter(({ user, member }) => {
      const matchesSearch = !needle || [user.display_name, user.username, user.personnel_number, user.phone]
        .some((value) => value?.toLocaleLowerCase(locale()).includes(needle))
      const state = rotationState(member, today)
      const matchesFilter = filter === 'all'
        || (filter === 'rotation' && (state === 'active' || state === 'entering'))
        || (filter === 'outside' && (state === 'outside' || state === 'ended'))
        || (filter === 'inactive' && !user.is_active)
        || (filter === 'pending' && user.pending_activation !== null)
      return matchesSearch && matchesFilter
    })
  }, [allRows, search, filter, today])
  const selectedRow = allRows.find(({ user }) => user.id === selectedId)
  const counts = {
    accounts: allRows.length,
    rotation: allRows.filter(({ member }) => rotationState(member, today) === 'active').length,
    entering: allRows.filter(({ member }) => rotationState(member, today) === 'entering').map(({ member }) => member!.active_from).sort(),
    inactive: allRows.filter(({ user }) => !user.is_active).length,
    pending: allRows.filter(({ user }) => user.pending_activation !== null).length,
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
    setReissuedUrl('')
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
      if ((accountForm.first_name ?? '') !== user.first_name) changes.push(t.changes.firstName)
      if ((accountForm.last_name ?? '') !== user.last_name) changes.push(t.changes.lastName)
      if ((accountForm.personnel_number ?? null) !== user.personnel_number) changes.push(t.changes.personnelNumber)
      if ((accountForm.email ?? null) !== user.email) changes.push(t.changes.email)
    }
    // Not managed by LDAP even for a directory account (decision D8).
    if ((accountForm.phone ?? null) !== user.phone) changes.push(t.changes.phone)
    if ((accountForm.role ?? user.role) !== user.role) {
      changes.push(t.changes.role(accountRoleLabels()[user.role], accountRoleLabels()[accountForm.role ?? user.role]))
    }
    if ((accountForm.is_active ?? user.is_active) !== user.is_active) {
      changes.push(accountForm.is_active ? t.changes.enableAccount : t.changes.disableAccount)
    }
    return changes
  }, [selectedRow, accountForm, t])
  const rotationChanges = useMemo(() => {
    const member = selectedRow?.member
    if (!member) return [] as string[]
    const changes: string[] = []
    if (rotationFrom !== member.active_from) changes.push(t.changes.rotationFrom(formatDate(rotationFrom)))
    if ((rotationUntil || null) !== member.active_until) {
      changes.push(rotationUntil ? t.changes.rotationUntil(formatDate(rotationUntil)) : t.changes.removeRotationUntil)
    }
    return changes
  }, [selectedRow, rotationFrom, rotationUntil, t])
  const eligibilityChanges = useMemo(() => {
    const member = selectedRow?.member
    if (!member) return [] as string[]
    return member.eligibility.flatMap((item) => {
      const edit = eligibilityEdits[item.id]
      if (!edit) return []
      const changed = edit.starts_on !== item.starts_on || (edit.ends_on || null) !== item.ends_on
      return changed ? [t.changes.eligibilityPeriod(dutyRoleLabels()[item.role])] : []
    })
  }, [selectedRow, eligibilityEdits, t])
  const pendingChanges = [...accountChanges, ...rotationChanges, ...eligibilityChanges]
  const dirty = pendingChanges.length > 0

  const saveAll = useMutation({
    mutationFn: async () => {
      if (!selectedRow) throw new Error(t.errors.noAccountSelected)
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
        if (!edit.starts_on) throw new Error(t.errors.periodNeedsStart)
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
  const reissueActivation = useMutation({
    mutationFn: (id: string) => api.reissueActivation(id),
    onSuccess: ({ url }) => {
      setReissuedUrl(url)
      setReissueConfirmation(false)
      refresh()
    },
  })
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
  const selectedActivation = selectedRow ? activationState(selectedRow.user, now) : null
  const exportCsv = () => {
    const blob = new Blob([`\uFEFF${csvOf(rows, today, now)}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = t.csv.fileName(today)
    link.click()
    URL.revokeObjectURL(url)
  }
  const roleOptions = roles.map((role) => ({ value: role, label: accountRoleLabels()[role] }))
  const subtitle = users.data && team.data && [
    t.summary.accounts(counts.accounts),
    t.summary.inRotation(counts.rotation),
    counts.entering.length > 0 ? t.summary.entering(counts.entering.length, formatShortDate(counts.entering[0])) : null,
    counts.inactive > 0 ? t.summary.inactive(counts.inactive) : null,
    counts.pending > 0 ? t.summary.pending(counts.pending) : null,
  ].filter(Boolean).join(' · ')

  return (
    <div className="page">
      <PageHeader
        title={t.title}
        sub={subtitle ?? t.subtitle}
        actions={(
          <>
            <Button variant="ghost" icon="download" onClick={exportCsv} disabled={rows.length === 0}>{t.exportCsv}</Button>
            <Button variant="primary" icon="plus" onClick={openNew}>{t.newAccount}</Button>
          </>
        )}
      />
      {error && <Box tone="bad" role="alert" title={error.message} />}
      <SectionHeading
        title={t.accounts}
        controls={(
          <>
            <Input
              type="search"
              aria-label={t.searchPlaceholder}
              placeholder={t.searchPlaceholder}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="sech-search"
            />
            {FILTERS.map((item) => (
              <button
                key={item}
                type="button"
                className={cx('sech-link', filter === item && 'on')}
                aria-pressed={filter === item}
                onClick={() => setFilter(item)}
              >
                {t.filters[item]}
              </button>
            ))}
          </>
        )}
      />
      {(users.isLoading || team.isLoading) && <LoadingBlock label={t.loadingAccounts} />}
      {users.data && rows.length === 0 && (
        <div className="panel"><EmptyState compact icon="people" title={t.emptyFilter} /></div>
      )}
      {rows.length > 0 && (
        <div className="panel wide-scroll">
          <table className="lg" aria-label={t.accounts}>
            <caption className="sr-only">{t.tableCaption}</caption>
            <thead>
              <tr>
                <th scope="col">{t.columns.person}</th>
                <th scope="col">{t.columns.usernameNumber}</th>
                <th scope="col">{t.columns.accountRole}</th>
                <th scope="col">{t.columns.rotation}</th>
                <th scope="col">{t.columns.phone}</th>
                <th scope="col">{t.columns.signIn}</th>
                <th scope="col"><span className="sr-only">{t.columns.actions}</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const state = rotationState(row.member, today)
                const needsPhone = !row.user.phone && (state === 'active' || state === 'entering')
                const activation = activationState(row.user, now)
                return (
                  <tr key={row.user.id} className={cx(selectedId === row.user.id && 'on', !row.user.is_active && 'row-off')}>
                    <th scope="row">
                      <button type="button" className="link-btn" onClick={() => openDetails(row)}>
                        <b>{row.user.display_name}</b>
                        <small>{row.user.email ?? (row.user.is_active ? t.row.noEmail : t.row.accountDisabled)}</small>
                      </button>
                    </th>
                    <td className="mono">
                      {row.user.username}
                      <small>{row.user.personnel_number ?? '–'}</small>
                    </td>
                    <td><StatusBadge tone={roleTone[row.user.role]}>{accountRoleLabels()[row.user.role]}</StatusBadge></td>
                    <td>{row.user.role === 'viewer' && !row.member ? <span className="muted">{t.row.notApplicable}</span> : <RotationCell member={row.member} today={today} />}</td>
                    <td className={cx('mono', needsPhone && 'who-bad')}>
                      {row.user.phone ?? (needsPhone ? t.row.missing : <span className="muted">–</span>)}
                    </td>
                    <td>
                      <Tag>{t.authSources[row.user.auth_source]}</Tag>
                      {activation && <> <StatusBadge tone={activation === 'waiting' ? 'warn' : 'bad'}>{t.activation.pending}</StatusBadge></>}
                      <small>
                        {row.user.auth_source === 'ldap' ? t.row.firstSignIn(formatDate(row.user.created_at)) : t.row.accountSince(formatDate(row.user.created_at))}
                        {activation && ` · ${activationLinkText(row.user, activation)}`}
                      </small>
                    </td>
                    <td className="n"><Button size="sm" variant="ghost" onClick={() => openDetails(row)}>{t.row.open}</Button></td>
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
        title={t.newAccountPanel.title}
        meta={<StatusBadge tone={roleTone[newForm.role]}>{accountRoleLabels()[newForm.role]}</StatusBadge>}
        footer={(
          <>
            <Button onClick={() => setNewOpen(false)}>{activationUrl ? m.common.close : m.common.cancel}</Button>
            {!activationUrl && (
              <Button type="submit" form="new-account-form" variant="primary" loading={createAccount.isPending} disabled={!newForm.username.trim() || !newForm.first_name.trim()}>
                {t.newAccountPanel.create}
              </Button>
            )}
          </>
        )}
      >
        <form id="new-account-form" className="stack-sm" onSubmit={(event: FormEvent) => { event.preventDefault(); createAccount.mutate(newForm) }}>
          {createAccount.error && <Box tone="bad" role="alert" title={createAccount.error.message} />}
          {activationUrl && <LinkResult value={activationUrl} label={t.newAccountPanel.activationLink} />}
          {!activationUrl && (
            <>
              <div className="frow">
                <Field label={t.fields.firstName} id="new-first-name" required>
                  {({ id }) => <Input id={id} value={newForm.first_name} onChange={(e) => setNewForm({ ...newForm, first_name: e.target.value })} required />}
                </Field>
                <Field label={t.fields.lastName} id="new-last-name">
                  {({ id }) => <Input id={id} value={newForm.last_name} onChange={(e) => setNewForm({ ...newForm, last_name: e.target.value })} />}
                </Field>
              </div>
              <div className="frow">
                <Field label={t.fields.username} id="new-username" required hint={branding.ldapEnabled ? t.fields.usernameLdapHint : undefined}>
                  {({ id, describedBy }) => <Input id={id} mono autoComplete="off" value={newForm.username} aria-describedby={describedBy} onChange={(e) => setNewForm({ ...newForm, username: e.target.value })} required />}
                </Field>
                <Field label={t.fields.personnelNumber} id="new-personnel-number" hint={branding.ldapEnabled ? t.fields.personnelNumberLdapHint : undefined}>
                  {({ id, describedBy }) => <Input id={id} mono inputMode="numeric" pattern="[0-9]*" value={newForm.personnel_number ?? ''} aria-describedby={describedBy} onChange={(e) => setNewForm({ ...newForm, personnel_number: e.target.value || null })} />}
                </Field>
              </div>
              <div className="frow">
                <Field label={t.fields.email} id="new-email">
                  {({ id }) => <Input id={id} type="email" value={newForm.email ?? ''} onChange={(e) => setNewForm({ ...newForm, email: e.target.value || null })} />}
                </Field>
                <Field label={t.fields.phone} id="new-phone" hint={t.fields.phoneNewHint}>
                  {({ id, describedBy }) => <Input id={id} type="tel" mono value={newForm.phone ?? ''} aria-describedby={describedBy} onChange={(e) => setNewForm({ ...newForm, phone: e.target.value || null })} />}
                </Field>
              </div>
              <Field label={t.fields.accountRole} id="new-role" hint={t.fields.accountRoleHint}>
                {() => <Segmented<UserRole> label={t.fields.accountRole} value={newForm.role} onChange={(role) => setNewForm({ ...newForm, role })} options={roleOptions} />}
              </Field>
              <Box tone="sig" title={t.newAccountPanel.afterCreation}>
                {t.newAccountPanel.afterCreationText}
                {branding.ldapEnabled && ` ${t.newAccountPanel.afterCreationLdap}`}
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
            <StatusBadge tone={roleTone[selectedRow.user.role]}>{accountRoleLabels()[selectedRow.user.role]}</StatusBadge>
            <Tag>{t.authSources[selectedRow.user.auth_source]}</Tag>
            {!selectedRow.user.is_active && <StatusBadge tone="bad">{t.details.disabled}</StatusBadge>}
            {selectedActivation && <StatusBadge tone={selectedActivation === 'waiting' ? 'warn' : 'bad'}>{t.activation.pending}</StatusBadge>}
          </>
        )}
        footer={selectedRow && (
          <>
            <Button size="sm" variant="ghost" className="btn-bad" onClick={() => { setDeleteTyped(''); setDeleteOpen(true) }}>{t.details.deleteAccount}</Button>
            <span className="sp" />
            {dirty && <span className="small muted">{t.details.unsaved(pendingChanges.join(' · '))}</span>}
            <Button onClick={requestClose}>{dirty ? m.common.cancel : m.common.close}</Button>
            <Button type="submit" form="person-form" variant="primary" disabled={!dirty || saveAll.isPending} loading={saveAll.isPending}>
              {saveAll.isPending ? m.common.saving : dirty ? t.details.saveCount(pendingChanges.length) : t.details.save}
            </Button>
          </>
        )}
      >
        {selectedRow && (
          <form id="person-form" onSubmit={submitAll} className="stack-sm">
            {saveAll.error && <Box tone="bad" role="alert" title={saveAll.error.message} />}
            <Tabs<DetailTab>
              label={t.details.sections}
              value={tab}
              onChange={setTab}
              items={[
                { value: 'account', label: t.details.tabs.account },
                { value: 'rotation', label: t.details.tabs.rotation, count: selectedRow.member ? selectedRoles.length : undefined },
                { value: 'access', label: t.details.tabs.access },
              ]}
            >
              <TabPanel<DetailTab> value="account" className="stack-sm">
                {ldapFieldsLocked && <Box tone="muted">{t.details.ldapReadOnly}</Box>}
                {branding.ldapEnabled && selectedRow.user.auth_source === 'local' && (
                  <Box tone="muted">
                    {t.details.ldapLinkNote(selectedRow.user.personnel_number ? t.details.ldapCurrentNumber(selectedRow.user.personnel_number) : t.details.ldapNoNumber)}
                  </Box>
                )}
                <div className="frow">
                  <Field label={t.fields.firstName} id="acc-first-name" required>
                    {({ id }) => <Input id={id} disabled={ldapFieldsLocked} value={accountForm.first_name ?? ''} onChange={(e) => setAccountForm({ ...accountForm, first_name: e.target.value })} required />}
                  </Field>
                  <Field label={t.fields.lastName} id="acc-last-name">
                    {({ id }) => <Input id={id} disabled={ldapFieldsLocked} value={accountForm.last_name ?? ''} onChange={(e) => setAccountForm({ ...accountForm, last_name: e.target.value })} />}
                  </Field>
                </div>
                <div className="frow">
                  <Field label={t.fields.username} id="acc-username" hint={t.fields.usernameLocked}>
                    {({ id, describedBy }) => <Input id={id} mono disabled value={selectedRow.user.username} aria-describedby={describedBy} readOnly />}
                  </Field>
                  <Field label={t.fields.personnelNumber} id="acc-personnel-number">
                    {({ id }) => <Input id={id} mono disabled={ldapFieldsLocked} inputMode="numeric" pattern="[0-9]*" value={accountForm.personnel_number ?? ''} onChange={(e) => setAccountForm({ ...accountForm, personnel_number: e.target.value || null })} />}
                  </Field>
                </div>
                <div className="frow">
                  <Field label={t.fields.email} id="acc-email">
                    {({ id }) => <Input id={id} type="email" disabled={ldapFieldsLocked} value={accountForm.email ?? ''} onChange={(e) => setAccountForm({ ...accountForm, email: e.target.value || null })} />}
                  </Field>
                  <Field
                    label={t.fields.phone}
                    id="acc-phone"
                    hint={t.fields.phoneHint}
                    error={!accountForm.phone && (selectedState === 'active' || selectedState === 'entering') ? t.fields.phoneRequired : undefined}
                  >
                    {({ id, describedBy, invalid }) => <Input id={id} type="tel" mono invalid={invalid} value={accountForm.phone ?? ''} aria-describedby={describedBy} onChange={(e) => setAccountForm({ ...accountForm, phone: e.target.value || null })} />}
                  </Field>
                </div>
              </TabPanel>
              <TabPanel<DetailTab> value="rotation" className="stack-sm">
                {selectedRow.member ? (
                  <>
                    <Box tone={selectedState === 'active' ? 'ok' : selectedState === 'entering' ? 'warn' : 'muted'} title={
                      selectedState === 'active' ? t.rotationTab.activeSince(formatDate(selectedRow.member.active_from))
                        : selectedState === 'entering' ? t.rotationTab.entering(formatDate(selectedRow.member.active_from))
                          : t.rotationTab.ended(formatDate(selectedRow.member.active_until!))
                    }>
                      {selectedRow.member.active_until && selectedState !== 'ended' ? `${t.rotationTab.exitUntil(formatDate(selectedRow.member.active_until))} ` : selectedState !== 'ended' ? `${t.rotationTab.noExitDate} ` : ''}
                      {t.rotationTab.qualifications(selectedRoles.length > 0 ? selectedRoles.map((role) => dutyRoleLabels()[role]).join(', ') : t.rotationTab.noQualifications)}
                    </Box>
                    <Field label={t.rotationTab.dutyQualifications} id="qualifications" hint={t.rotationTab.dutyQualificationsHint}>
                      {() => (
                        <div className="filter-chips" role="group" aria-label={t.rotationTab.dutyQualifications}>
                          {dutyRoles.map((role) => {
                            const held = selectedRoles.includes(role)
                            return held ? (
                              <span key={role} className="filter-chip">
                                {dutyRoleLabels()[role]}
                                <button type="button" aria-label={t.rotationTab.dropQualification(dutyRoleLabels()[role])} disabled={dropQualification.isPending} onClick={() => dropQualification.mutate(role)}>×</button>
                              </span>
                            ) : (
                              <button
                                key={role}
                                type="button"
                                className="chip chip-btn"
                                aria-label={t.rotationTab.addQualification(dutyRoleLabels()[role])}
                                disabled={addEligibility.isPending}
                                onClick={() => addEligibility.mutate({ role, starts_on: today, ends_on: null })}
                              >
                                + {dutyRoleLabels()[role]}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </Field>
                    <div className="frow">
                      <DateField id="rotation-from" label={t.rotationTab.entryFrom} value={rotationFrom} onChange={setRotationFrom} />
                      <DateField id="rotation-until" label={t.rotationTab.exitUntilLabel} value={rotationUntil} onChange={setRotationUntil} hint={t.rotationTab.exitHint} />
                    </div>
                    <SectionHeading
                      as="h3"
                      title={t.rotationTab.periods}
                      meta={`${selectedRow.member.eligibility.length}`}
                      controls={<button type="button" className={cx('sech-link', addingPeriod && 'on')} aria-pressed={addingPeriod} onClick={() => setAddingPeriod((value) => !value)}>{t.rotationTab.addPeriod}</button>}
                    />
                    {addingPeriod && (
                      <div className="frow" style={{ alignItems: 'end' }}>
                        <Field label={t.rotationTab.dutyRole} id="new-eligibility-role">
                          {() => (
                            <Segmented<AssignmentRole>
                              label={t.rotationTab.dutyRole}
                              size="sm"
                              value={eligibilityRole}
                              onChange={setEligibilityRole}
                              options={dutyRoles.map((role) => ({ value: role, label: dutyRoleLabels()[role] }))}
                            />
                          )}
                        </Field>
                        <DateField id="new-eligibility-from" label={t.period.from} value={eligibilityFrom} onChange={setEligibilityFrom} />
                        <DateField id="new-eligibility-until" label={t.period.untilOptional} value={eligibilityUntil} onChange={setEligibilityUntil} />
                        <Button onClick={() => addEligibility.mutate({ role: eligibilityRole, starts_on: eligibilityFrom, ends_on: eligibilityUntil || null })} loading={addEligibility.isPending} icon="plus">{t.rotationTab.addPeriod}</Button>
                      </div>
                    )}
                    {selectedRow.member.eligibility.length === 0 && <p className="muted small">{t.rotationTab.noPeriods}</p>}
                    {selectedRow.member.eligibility.length > 0 && (
                      <List className="panel">
                        {[...selectedRow.member.eligibility].sort((a, b) => b.starts_on.localeCompare(a.starts_on)).map((item) => {
                          const value = eligibilityEdits[item.id] ?? { starts_on: item.starts_on, ends_on: item.ends_on ?? '' }
                          const historic = Boolean(item.ends_on && item.ends_on < today)
                          return editingPeriod === item.id ? (
                            <div key={item.id} className="list-row">
                              <div className="list-main stack-sm">
                                <b>{dutyRoleLabels()[item.role]}</b>
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
                                ? <span className="muted small">{t.rotationTab.historic}</span>
                                : <Button size="sm" variant="ghost" onClick={() => setEditingPeriod(item.id)}>{t.rotationTab.edit}</Button>}
                            >
                              <b>{formatDate(value.starts_on)} → {value.ends_on ? formatDate(value.ends_on) : '∞'}</b>
                              <small>{dutyRoleLabels()[item.role]}{eligibilityEdits[item.id] ? ` · ${t.rotationTab.changedUnsaved}` : ''}</small>
                            </ListRow>
                          )
                        })}
                      </List>
                    )}
                    {rotationUntil && (
                      <Box tone="warn" title={t.rotationTab.scheduleEffect}>
                        {t.rotationTab.scheduleEffectText(formatDate(rotationUntil))}
                        <div className="row" style={{ marginTop: 6 }}>
                          <Button size="sm" onClick={() => setOffboardingOpen(true)} icon="people">{t.rotationTab.rewriteAndEnd}</Button>
                        </div>
                      </Box>
                    )}
                  </>
                ) : (
                  <>
                    <Box tone="muted" title={t.rotationTab.outside}>{t.rotationTab.outsideText}</Box>
                    <div className="frow" style={{ alignItems: 'end' }}>
                      <DateField id="rotation-from" label={t.rotationTab.entryFrom} value={rotationFrom} onChange={setRotationFrom} />
                      <Button variant="primary" onClick={() => createRotation.mutate()} loading={createRotation.isPending}>{t.rotationTab.addToRotation}</Button>
                    </div>
                  </>
                )}
              </TabPanel>
              <TabPanel<DetailTab> value="access" className="stack-sm">
                <Field label={t.fields.accountRole} id="acc-role" hint={t.fields.accountRoleHint}>
                  {() => (
                    <Segmented<UserRole>
                      label={t.fields.accountRole}
                      value={accountForm.role ?? selectedRow.user.role}
                      onChange={(role) => setAccountForm({ ...accountForm, role })}
                      options={roleOptions}
                    />
                  )}
                </Field>
                <Checkbox label={t.accessTab.accountEnabled} hint={t.accessTab.accountEnabledHint} checked={accountForm.is_active ?? false} onChange={(e) => setAccountForm({ ...accountForm, is_active: e.target.checked })} />
                {selectedActivation && (
                  <Box tone={selectedActivation === 'waiting' ? 'warn' : 'bad'} title={t.activation.pendingTitle}>
                    {t.accessTab.noPasswordYet}
                    {` ${sentence(activationLinkText(selectedRow.user, selectedActivation))}. `}
                    {t.accessTab.newLinkInvalidates}
                    <div className="row" style={{ marginTop: 6 }}>
                      <Button size="sm" icon="send" disabled={!selectedRow.user.is_active} onClick={() => setReissueConfirmation(true)}>{t.accessTab.reissueActivation}</Button>
                      {!selectedRow.user.is_active && <span className="muted small">{t.accessTab.disabledNoLink}</span>}
                    </div>
                  </Box>
                )}
                {reissuedUrl && <LinkResult value={reissuedUrl} label={t.accessTab.newActivationLink} />}
                {selectedRow.user.auth_source === 'local' && !selectedActivation && (
                  <div className="row">
                    <Button size="sm" icon="lock" onClick={() => setResetConfirmation(true)}>{t.accessTab.issueReset}</Button>
                    <span className="muted small">{t.accessTab.resetHint}</span>
                  </div>
                )}
                {resetUrl && <LinkResult value={resetUrl} label={t.accessTab.resetLink} />}
              </TabPanel>
            </Tabs>
          </form>
        )}
      </Panel>

      <ConfirmDialog
        open={confirmation}
        title={t.confirmAccess.title}
        description={<>{t.confirmAccess.text}<br />{t.confirmAccess.toSave(pendingChanges.join(' · '))}</>}
        confirmLabel={t.confirmAccess.confirm}
        confirmColor={accountForm.is_active === false ? 'warning' : 'primary'}
        pending={saveAll.isPending}
        error={saveAll.error ? saveAll.error.message : null}
        onCancel={() => setConfirmation(false)}
        onConfirm={() => saveAll.mutate()}
      />
      <ConfirmDialog
        open={closeConfirmation && dirty}
        title={t.confirmClose.title}
        description={<>{t.confirmClose.unsaved(pendingChanges.join(' · '))}<br />{t.confirmClose.text}</>}
        confirmLabel={t.confirmClose.confirm}
        confirmColor="warning"
        onCancel={() => setCloseConfirmation(false)}
        onConfirm={() => { setCloseConfirmation(false); setSelectedId(null) }}
      />
      <Dialog
        open={deleteOpen && Boolean(selectedRow)}
        onOpenChange={(open) => { if (!open) setDeleteOpen(false) }}
        tone="danger"
        dismissible={!deleteAccount.isPending}
        title={selectedRow ? t.deleteDialog.title(selectedRow.user.display_name) : ''}
        actions={selectedRow && (
          <>
            <Button onClick={() => setDeleteOpen(false)} disabled={deleteAccount.isPending}>{m.common.cancel}</Button>
            <Button
              variant="danger"
              disabled={deleteTyped.trim() !== selectedRow.user.username || deleteAccount.isPending}
              loading={deleteAccount.isPending}
              onClick={() => deleteAccount.mutate(selectedRow.user.id)}
            >
              {t.deleteDialog.confirm}
            </Button>
          </>
        )}
      >
        {selectedRow && (
          <>
            <ul>
              <li>{t.deleteDialog.disabledNow}</li>
              <li>{t.deleteDialog.personalDataRemoved}</li>
              {selectedRow.member && (
                <li>{t.deleteDialog.pseudonymised}</li>
              )}
              {selectedRow.member && selectedState !== 'ended' && (
                <li><b className="who-bad">{t.deleteDialog.publishedDutiesBold}</b> {t.deleteDialog.publishedDutiesRest}</li>
              )}
              <li>{t.deleteDialog.irreversible}</li>
            </ul>
            {deleteAccount.error && <Box tone="bad" role="alert" title={deleteAccount.error.message} />}
            <Field label={t.deleteDialog.typeUsername} id="delete-confirm">
              {({ id }) => <Input id={id} mono autoComplete="off" value={deleteTyped} placeholder={selectedRow.user.username} onChange={(event) => setDeleteTyped(event.target.value)} />}
            </Field>
          </>
        )}
      </Dialog>
      <ConfirmDialog
        open={reissueConfirmation}
        title={t.confirmReissue.title}
        description={t.confirmReissue.text}
        confirmLabel={t.generateLink}
        pending={reissueActivation.isPending}
        error={reissueActivation.error ? reissueActivation.error.message : null}
        onCancel={() => setReissueConfirmation(false)}
        onConfirm={() => selectedRow && reissueActivation.mutate(selectedRow.user.id)}
      />
      <ConfirmDialog
        open={resetConfirmation}
        title={t.confirmReset.title}
        description={t.confirmReset.text}
        confirmLabel={t.generateLink}
        pending={resetPassword.isPending}
        error={resetPassword.error ? resetPassword.error.message : null}
        onCancel={() => setResetConfirmation(false)}
        onConfirm={() => selectedRow && resetPassword.mutate(selectedRow.user.id, { onSuccess: () => setResetConfirmation(false) })}
      />
    </div>
  )
}
