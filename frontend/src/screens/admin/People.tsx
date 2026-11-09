import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigationType } from 'react-router-dom'
import { AdminUser, AdminUserInput, AdminUserUpdate, AssignmentRole, Eligibility, TeamMember, UserRole, api } from '../../api'
import { CopyButton } from '../../components/CopyButton'
import { DateField } from '../../components/DateField'
import { OffboardingDialog } from '../../components/OffboardingDialog'
import { roleLabels as dutyRoleLabels, shortRoleLabels } from '../../lib/labels'
import { roleLabels as accountRoleLabels } from '../../lib/nav'
import { addDays, formatDate, formatMoment, formatShortDate, warsawDate } from '../../lib/dates'
import { csvCell, downloadBlob } from '../../lib/download'
import { isPolishPhone } from '../../lib/phone'
import { useUrlParams } from '../../hooks/useUrlParams'
import { locale, messages, useMessages } from '../../i18n'
import { useBranding } from '../../hooks/useBranding'
import { useDutiesAfterExit } from '../../hooks/useDutiesAfterExit'
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges'
import { UnsavedChangesDialog } from '../../components/UnsavedChangesDialog'
import { useUndoable } from '../../hooks/useUndoable'
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
  ScrollArea,
  Segmented,
  StatusBadge,
  StatusTone,
  TabPanel,
  Tabs,
  Tag,
  cx,
  useToast,
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

/** The account tab's form: every field, filled from the account when it opens. */
type AccountForm = Required<AdminUserUpdate>
const emptyAccountForm: AccountForm = {
  personnel_number: null, first_name: '', last_name: '', email: null, phone: null, role: 'member', is_active: true,
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
      <div className="token-once"><code translate="no">{value}</code><CopyButton value={value} /></div>
    </Box>
  )
}

interface PeriodValue { starts_on: string; ends_on: string }
/** A qualification period added on the rotation tab, created on "Zapisz". */
interface NewPeriod extends PeriodValue { role: AssignmentRole }
/** A pending change of a saved period: new dates, or null to delete it. */
type PeriodEdit = PeriodValue | null

/** The rotation a new account joins from the same panel, when it does. */
interface NewRotation { on: boolean; from: string; roles: AssignmentRole[] }
/**
 * What the new account panel created: the account and its one-time link
 * always, the rotation and the qualifications saved for it, and why the rest
 * of the rotation is missing when that failed.
 */
interface Created { user: AdminUser; url: string; member?: TeamMember; roles: AssignmentRole[]; missing?: AssignmentRole[]; rotationError?: string }

const inRoleOrder = (picked: AssignmentRole[]) => dutyRoles.filter((role) => picked.includes(role))
const roleList = (picked: AssignmentRole[]) =>
  new Intl.ListFormat(locale(), { type: 'conjunction' }).format(inRoleOrder(picked).map((role) => dutyRoleLabels()[role]))

function periodText(value: PeriodValue) {
  const t = messages().people.rotationTab
  return value.ends_on ? t.periodSpan(formatDate(value.starts_on), formatDate(value.ends_on)) : t.periodOpen(formatDate(value.starts_on))
}

function EligibilityPeriodEditor({ item, value, onChange, onDone }: {
  item: Eligibility
  value: PeriodValue
  onChange: (next: PeriodValue) => void
  onDone: () => void
}) {
  const t = useMessages().people.period
  return (
    <div className="frow frow-end">
      <DateField id={`eligibility-${item.id}-from`} label={t.from} value={value.starts_on} onChange={(starts_on) => onChange({ ...value, starts_on })} />
      <DateField id={`eligibility-${item.id}-until`} label={t.untilOptional} value={value.ends_on} onChange={(ends_on) => onChange({ ...value, ends_on })} />
      <Button size="sm" onClick={onDone}>{t.done}</Button>
    </div>
  )
}

/**
 * One list for the duty qualifications: per role its current and future
 * periods, the ones added and not saved yet, or a line saying the role is
 * missing; past periods last, as history. Every action here only changes
 * what "Zapisz" will send.
 */
function QualificationList({ member, today, edits, newPeriods, editing, onEdit, onEditChange, onAdd, onDropNew }: {
  member: TeamMember
  today: string
  edits: Record<string, PeriodEdit>
  newPeriods: NewPeriod[]
  editing: string | null
  onEdit: (id: string | null) => void
  /** Undefined drops the pending change of that period. */
  onEditChange: (item: Eligibility, edit: PeriodEdit | undefined) => void
  onAdd: (period: NewPeriod) => void
  onDropNew: (period: NewPeriod) => void
}) {
  const t = useMessages().people.rotationTab
  const historic = (item: Eligibility) => Boolean(item.ends_on && item.ends_on < today)
  const byStart = (a: { starts_on: string }, b: { starts_on: string }) => a.starts_on.localeCompare(b.starts_on)
  const action = (verb: string, role: AssignmentRole) => t.rowAction(verb, dutyRoleLabels()[role])
  const savedRow = (item: Eligibility) => {
    const edit = edits[item.id]
    const value = edit ?? { starts_on: item.starts_on, ends_on: item.ends_on ?? '' }
    const role = dutyRoleLabels()[item.role]
    if (editing === item.id) {
      return (
        <div key={item.id} className="list-row">
          <div className="list-main stack-sm">
            <b>{role}</b>
            <EligibilityPeriodEditor
              item={item}
              value={value}
              onChange={(next) => onEditChange(item, next.starts_on === item.starts_on && (next.ends_on || null) === item.ends_on ? undefined : next)}
              onDone={() => onEdit(null)}
            />
          </div>
        </div>
      )
    }
    // A period that has not started is deleted; a running one ends yesterday.
    const notStarted = item.starts_on >= today
    return (
      <ListRow
        key={item.id}
        aside={(
          <>
            {edit !== null && <Button size="sm" variant="ghost" aria-label={action(t.edit, item.role)} onClick={() => onEdit(item.id)}>{t.edit}</Button>}
            {edit === undefined ? (
              <Button
                size="sm"
                variant="ghost"
                aria-label={action(notStarted ? t.delete : t.endToday, item.role)}
                onClick={() => onEditChange(item, notStarted ? null : { starts_on: item.starts_on, ends_on: addDays(today, -1) })}
              >
                {notStarted ? t.delete : t.endToday}
              </Button>
            ) : (
              <Button size="sm" variant="ghost" aria-label={action(t.restore, item.role)} onClick={() => onEditChange(item, undefined)}>{t.restore}</Button>
            )}
          </>
        )}
      >
        <b>{role}</b>
        <small>
          {periodText(value)}
          {edit !== undefined && <> · <Tag tone="sig">{edit ? t.changedUnsaved : t.deletedUnsaved}</Tag></>}
        </small>
      </ListRow>
    )
  }
  const current = member.eligibility.filter((item) => !historic(item)).sort(byStart)
  const past = member.eligibility.filter(historic).sort((a, b) => byStart(b, a))
  const none = current.length === 0 && newPeriods.length === 0
  return (
    <>
      {none && <p className="muted small">{t.noPeriods}</p>}
      <List className="panel">
        {dutyRoles.flatMap((role) => {
          const saved = current.filter((item) => item.role === role)
          const added = newPeriods.filter((period) => period.role === role)
          if (saved.length === 0 && added.length === 0) {
            return [(
              <ListRow key={role} aside={<Button size="sm" variant="ghost" onClick={() => onAdd({ role, starts_on: today, ends_on: '' })}>{t.addRole(dutyRoleLabels()[role])}</Button>}>
                <span className="muted small">{t.noRole(dutyRoleLabels()[role])}</span>
              </ListRow>
            )]
          }
          return [
            ...saved.map(savedRow),
            ...added.map((period, index) => (
              <ListRow
                key={`${role}-new-${index}`}
                aside={<Button size="sm" variant="ghost" aria-label={action(t.delete, role)} onClick={() => onDropNew(period)}>{t.delete}</Button>}
              >
                <b>{dutyRoleLabels()[role]}</b>
                <small>{periodText(period)} · <Tag tone="sig">{t.newUnsaved}</Tag></small>
              </ListRow>
            )),
          ]
        })}
        {past.map((item) => (
          <ListRow key={item.id} aside={<span className="muted small">{t.historic}</span>}>
            <b>{dutyRoleLabels()[item.role]}</b>
            <small>{periodText({ starts_on: item.starts_on, ends_on: item.ends_on! })}</small>
          </ListRow>
        ))}
      </List>
    </>
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
  const lines = rows.map(({ user, member }) => [
    user.display_name, user.username, user.personnel_number, user.email, user.phone, accountRoleLabels()[user.role],
    t.authSources[user.auth_source], user.is_active ? t.csv.yes : t.csv.no,
    activationCsv(user, now), rotationState(member, today),
    member?.active_from, member?.active_until, heldRoles(member, today).map((role) => dutyRoleLabels()[role]).join(' '),
  ].map(csvCell).join(';'))
  return [head.join(';'), ...lines].join('\n')
}

type Filter = 'all' | 'rotation' | 'outside' | 'inactive' | 'pending'
const FILTERS: Filter[] = ['all', 'rotation', 'outside', 'inactive', 'pending']
/** The filter as the URL names it: `osoby?filtr=w-rotacji`; none is all. */
const FILTER_SLUGS: Record<Exclude<Filter, 'all'>, string> = { rotation: 'w-rotacji', outside: 'poza-rotacja', inactive: 'wylaczone', pending: 'oczekujace' }
const filterOf = (slug: string | null): Filter =>
  (Object.keys(FILTER_SLUGS) as Exclude<Filter, 'all'>[]).find((item) => FILTER_SLUGS[item] === slug) ?? 'all'
type DetailTab = 'account' | 'rotation' | 'access'
/** The open tab as the URL names it: `osoby?osoba=<id>&karta=rotacja`. */
const TAB_SLUGS: Record<DetailTab, string> = { account: 'konto', rotation: 'rotacja', access: 'dostep' }
const tabOf = (slug: string | null): DetailTab =>
  (Object.keys(TAB_SLUGS) as DetailTab[]).find((item) => TAB_SLUGS[item] === slug) ?? 'account'

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
  const toast = useToast()
  const undoable = useUndoable()
  // The open person and tab, the search and the filter live in the URL, so a
  // refresh keeps the panel open and the list as it was, and a link opens it.
  const [params, setParams] = useUrlParams()
  const selectedId = params.get('osoba')
  const tab = tabOf(params.get('karta'))
  const filter = filterOf(params.get('filtr'))
  const searchParam = params.get('szukaj') ?? ''
  // Typed into its own state, which a router update lags behind; the URL
  // takes it back only after a navigation the screen did not make itself. The
  // screen only ever replaces its address, while a link pushes one and Back
  // or Forward pops one.
  const [search, setSearch] = useState(searchParam)
  const { key: locationKey } = useLocation()
  const navigationType = useNavigationType()
  useEffect(() => {
    if (navigationType !== 'REPLACE') setSearch(searchParam)
  }, [locationKey, navigationType, searchParam])
  // Whose details the forms hold, so a person named by the URL gets them once.
  const filledFor = useRef<string | null>(null)
  // Undo runs after the save, when another person may be open in the panel.
  const openedId = useRef<string | null>(null)
  useEffect(() => { openedId.current = selectedId }, [selectedId])
  const [accountForm, setAccountForm] = useState<AccountForm>(emptyAccountForm)
  // The phone is judged once the field is left or the form saved, not while it is typed or as the panel opens.
  const [phoneChecked, setPhoneChecked] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [newForm, setNewForm] = useState<AdminUserInput>(emptyAccount)
  const [newRotation, setNewRotation] = useState<NewRotation>({ on: false, from: today, roles: [] })
  const [created, setCreated] = useState<Created | null>(null)
  const [resetUrl, setResetUrl] = useState('')
  const [reissuedUrl, setReissuedUrl] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteTyped, setDeleteTyped] = useState('')
  const [rotationFrom, setRotationFrom] = useState(today)
  const [rotationUntil, setRotationUntil] = useState('')
  const [offboardingOpen, setOffboardingOpen] = useState(false)
  const [offboardingDate, setOffboardingDate] = useState('')
  const [eligibilityEdits, setEligibilityEdits] = useState<Record<string, PeriodEdit>>({})
  const [newPeriods, setNewPeriods] = useState<NewPeriod[]>([])
  const [editingPeriod, setEditingPeriod] = useState<string | null>(null)
  const [addingPeriod, setAddingPeriod] = useState(false)
  const [eligibilityRole, setEligibilityRole] = useState<AssignmentRole>('primary')
  const [eligibilityFrom, setEligibilityFrom] = useState(today)
  const [eligibilityUntil, setEligibilityUntil] = useState('')

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
    queryClient.invalidateQueries({ queryKey: ['offboarding'] })
  }
  const openNew = () => {
    setNewForm(emptyAccount)
    setNewRotation({ on: false, from: today, roles: [] })
    setCreated(null)
    setNewOpen(true)
  }

  const createAccount = useMutation({
    mutationFn: async ({ input, rotation }: { input: AdminUserInput; rotation: NewRotation }): Promise<Created> => {
      const { user, activation_url: url } = await api.createAdminUser(input)
      if (!rotation.on) return { user, url, roles: [] }
      // The account exists by now and its link is shown only once, so a
      // refused rotation is reported beside the link, to finish on the tab.
      let member: TeamMember
      try {
        member = await api.createTeamMember({ user_id: user.id, active_from: rotation.from })
      } catch (error) {
        return { user, url, roles: [], rotationError: (error as Error).message }
      }
      // Each role is its own period, so they are created side by side.
      const picked = inRoleOrder(rotation.roles)
      const results = await Promise.allSettled(picked.map((role) =>
        api.createEligibility({ memberId: member.id, input: { role, starts_on: rotation.from, ends_on: null } })))
      const roles = picked.filter((_, index) => results[index].status === 'fulfilled')
      const refused = results.find((result) => result.status === 'rejected')
      if (!refused) return { user, url, member, roles }
      const missing = picked.filter((_, index) => results[index].status === 'rejected')
      return { user, url, member, roles, missing, rotationError: (refused.reason as Error).message }
    },
    onSuccess: (result, { input }) => {
      setCreated(result)
      toast.success(t.toast.created([input.first_name, input.last_name].filter(Boolean).join(' ')))
      refresh()
    },
  })
  const accountChanges = useMemo(() => {
    if (!selectedRow) return [] as string[]
    const user = selectedRow.user
    const changes: string[] = []
    if (user.auth_source !== 'ldap') {
      if (accountForm.first_name !== user.first_name) changes.push(t.changes.firstName)
      if (accountForm.last_name !== user.last_name) changes.push(t.changes.lastName)
      if (accountForm.personnel_number !== user.personnel_number) changes.push(t.changes.personnelNumber)
      if (accountForm.email !== user.email) changes.push(t.changes.email)
    }
    // Not managed by LDAP even for a directory account (decision D8).
    if (accountForm.phone !== user.phone) changes.push(t.changes.phone)
    return changes
  }, [selectedRow, accountForm, t])
  const accessChanges = useMemo(() => {
    if (!selectedRow) return [] as string[]
    const user = selectedRow.user
    const changes: string[] = []
    if (accountForm.role !== user.role) {
      changes.push(t.changes.role(accountRoleLabels()[user.role], accountRoleLabels()[accountForm.role]))
    }
    if (accountForm.is_active !== user.is_active) {
      changes.push(accountForm.is_active ? t.changes.enableAccount : t.changes.disableAccount)
    }
    return changes
  }, [selectedRow, accountForm, t])
  const [entryChanges, exitChanges] = useMemo(() => {
    const member = selectedRow?.member
    if (!member) return [[], []] as string[][]
    return [
      rotationFrom !== member.active_from ? [t.changes.rotationFrom(formatDate(rotationFrom))] : [],
      (rotationUntil || null) !== member.active_until
        ? [rotationUntil ? t.changes.rotationUntil(formatDate(rotationUntil)) : t.changes.removeRotationUntil]
        : [],
    ]
  }, [selectedRow, rotationFrom, rotationUntil, t])
  const rotationChanges = [...entryChanges, ...exitChanges]
  // The saved periods whose pending edit still differs from what the server holds.
  const periodEdits = useMemo(() => (selectedRow?.member?.eligibility ?? []).flatMap((item) => {
    const edit = eligibilityEdits[item.id]
    if (edit === undefined) return []
    if (edit && edit.starts_on === item.starts_on && (edit.ends_on || null) === item.ends_on) return []
    return [{ item, edit }]
  }), [selectedRow, eligibilityEdits])
  // Ending or deleting a period is saved first and offered back in a toast.
  const isRemoval = ({ edit }: { edit: PeriodEdit }) => !edit || Boolean(edit.ends_on && edit.ends_on < today)
  const periodChange = ({ item, edit }: { item: Eligibility; edit: PeriodEdit }) =>
    (edit ? t.changes.eligibilityPeriod : t.changes.deletePeriod)(dutyRoleLabels()[item.role])
  const newPeriodChange = (period: NewPeriod) => t.changes.newPeriod(dutyRoleLabels()[period.role])
  const eligibilityChanges = [...periodEdits.map(periodChange), ...newPeriods.map(newPeriodChange)]
  const pendingChanges = [...accountChanges, ...accessChanges, ...rotationChanges, ...eligibilityChanges]
  const dirty = pendingChanges.length > 0
  // An exit date with published duties after it, or one a saved period
  // outlives, is saved through the offboarding dialog, which picks the
  // replacements and closes the periods first.
  const exitPending = Boolean(selectedRow?.member) && Boolean(rotationUntil) && rotationUntil !== selectedRow!.member!.active_until
  const exitDuties = useDutiesAfterExit(selectedRow?.member, rotationUntil, exitPending)
  const exitChecking = exitPending && exitDuties.calendar.isLoading
  const exitCutsPeriods = exitPending && selectedRow!.member!.eligibility
    .some((period) => !period.ends_on || period.ends_on > rotationUntil)
  const needsOffboarding = exitPending && (exitCutsPeriods || exitDuties.duties.length > 0 || exitDuties.calendar.isError)
  // The server keeps every period inside the rotation, so a later entry date
  // is saved on its own, with only the deletions of periods that end before
  // it; every other rotation change waits for a save of its own.
  const entryLater = Boolean(selectedRow?.member) && rotationFrom > selectedRow!.member!.active_from
  const entryDeletions = periodEdits.filter(({ item, edit }) => edit === null && item.ends_on !== null && item.ends_on < rotationFrom)
  const entryBlockers = entryLater ? [
    ...exitChanges,
    ...periodEdits.filter((entry) => !entryDeletions.includes(entry)).map(periodChange),
    ...newPeriods.map(newPeriodChange),
  ] : []
  // A saved period starting before the new date keeps it from being saved;
  // one deleted in this save is named by the note above instead.
  const earlyRoles = entryLater
    ? inRoleOrder(selectedRow!.member!.eligibility
      .filter((item) => item.starts_on < rotationFrom && eligibilityEdits[item.id] !== null)
      .map((item) => item.role))
    : []
  const unsavedChanges = useUnsavedChanges(dirty)
  // The panel's own moves in the URL leave nothing unsaved behind: the
  // guard asks before the panel changes person, not on every tab.
  const setDetails = (changes: Record<string, string | null>) => unsavedChanges.bypass(() => setParams(changes))
  const setTab = (value: DetailTab) => setDetails({ karta: TAB_SLUGS[value] })
  const closeDetails = () => {
    filledFor.current = null
    setDetails({ osoba: null, karta: null })
  }
  const applyDetails = ({ user, member }: Row, section: DetailTab = 'account') => {
    filledFor.current = user.id
    setDetails({ osoba: user.id, karta: TAB_SLUGS[section] })
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
    setNewPeriods([])
    setPhoneChecked(false)
    setEditingPeriod(null)
    setAddingPeriod(false)
    setResetUrl('')
    setReissuedUrl('')
  }
  useEffect(() => {
    if (!selectedId) {
      filledFor.current = null
      return
    }
    if (filledFor.current === selectedId) return
    const row = allRows.find(({ user }) => user.id === selectedId)
    if (row) applyDetails(row, tab)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, allRows])
  const openDetails = (row: Row, section: DetailTab = 'account') => {
    unsavedChanges.requestAction(() => applyDetails(row, section))
  }

  // The inverse of a removal puts back the dates the period had, or creates it again.
  const removalTitle = ({ item, edit }: { item: Eligibility; edit: PeriodEdit }) => {
    const role = dutyRoleLabels()[item.role]
    if (!edit) return t.undo.periodDeleted(role)
    return edit.ends_on === addDays(today, -1) ? t.undo.endedToday(role) : t.undo.endedOn(role, formatDate(edit.ends_on))
  }
  const saveEligibility = async (member: TeamMember, narrowsEntry: boolean, edits: typeof periodEdits, additions: NewPeriod[]) => {
    const removals = edits.filter(isRemoval)
    // One role's periods may not overlap, so what ends goes first.
    if (removals.length > 0) {
      await undoable({
        // Each removal touches its own period, so they run side by side.
        execute: () => Promise.all(removals.map(({ item, edit }) => (edit
          ? api.updateEligibility({ id: item.id, input: { starts_on: edit.starts_on, ends_on: edit.ends_on } })
          : api.deleteEligibility(item.id)))),
        undo: async () => {
          // A period put back may start before the later entry date this save
          // set, so the saved entry date comes back first.
          if (narrowsEntry) await api.updateTeamMember({ id: member.id, input: { active_from: member.active_from } })
          // An exit date saved since then caps what comes back.
          const until = queryClient.getQueryData<TeamMember[]>(['team'])!.find((entry) => entry.id === member.id)!.active_until
          const end = (value: string | null) => (until !== null && (value === null || value > until) ? until : value)
          await Promise.all(removals.map(({ item, edit }) => (edit
            ? api.updateEligibility({ id: item.id, input: { starts_on: item.starts_on, ends_on: end(item.ends_on) } })
            : api.createEligibility({ memberId: member.id, input: { role: item.role, starts_on: item.starts_on, ends_on: end(item.ends_on) } }))))
          if (narrowsEntry && openedId.current === member.user_id) setRotationFrom(member.active_from)
          refresh()
        },
        message: () => ({ title: removals.map(removalTitle).join(' · ') }),
      })
    }
    await Promise.all(edits.filter((entry) => !isRemoval(entry)).map(({ item, edit }) =>
      api.updateEligibility({ id: item.id, input: { starts_on: edit!.starts_on, ends_on: edit!.ends_on || null } })))
    const results = await Promise.allSettled(additions.map((period) =>
      api.createEligibility({ memberId: member.id, input: { role: period.role, starts_on: period.starts_on, ends_on: period.ends_on || null } })))
    // A retry after a refusal must not create the saved ones again.
    const saved = new Set(additions.filter((_, index) => results[index].status === 'fulfilled'))
    setNewPeriods((current) => current.filter((entry) => !saved.has(entry)))
    const refused = results.find((result) => result.status === 'rejected')
    if (refused) throw refused.reason
  }
  const saveRotation = async (member: TeamMember, offboard: boolean) => {
    if (entryLater) {
      await saveEligibility(member, true, entryDeletions, [])
      await api.updateTeamMember({ id: member.id, input: { active_from: rotationFrom } })
      return
    }
    // An earlier entry date or a later exit date makes room for the periods,
    // and an earlier exit date leaves them inside, so the rotation goes
    // first. The dialog saves the exit date itself once the duties are
    // rewritten.
    const input = {
      ...(entryChanges.length > 0 && { active_from: rotationFrom }),
      ...(!offboard && exitChanges.length > 0 && { active_until: rotationUntil || null }),
    }
    if (Object.keys(input).length > 0) await api.updateTeamMember({ id: member.id, input })
    // The server refuses to end a qualification its published duties still
    // need, so with the dialog ahead the qualification changes wait: the
    // dialog closes the periods at the exit date, and what is left stays
    // listed for the next save.
    if (!offboard) await saveEligibility(member, false, periodEdits, newPeriods)
  }
  const saveChanges = async ({ user, member }: Row, offboard: boolean) => {
    if (member && periodEdits.some(({ edit }) => edit && !edit.starts_on)) throw new Error(t.errors.periodNeedsStart)
    const tasks: Array<Promise<unknown>> = []
    let updated: AdminUser | undefined
    if (accountChanges.length > 0 || accessChanges.length > 0) {
      // Phone travels even for an LDAP account: unlike name/email it is not
      // an AD-managed identity field (decision D8). An untouched number stays
      // home, so a legacy value the stricter rule refuses blocks no other edit.
      const { phone, ...rest } = user.auth_source === 'ldap'
        ? { role: accountForm.role, is_active: accountForm.is_active, phone: accountForm.phone }
        : accountForm
      const input: AdminUserUpdate = phone === user.phone ? rest : { ...rest, phone }
      tasks.push(api.updateAdminUser({ id: user.id, input }).then((saved) => { updated = saved }))
    }
    if (member) tasks.push(saveRotation(member, offboard))
    // A refusal is reported once every write has settled, so the refresh
    // after it sees all that was saved.
    const refused = (await Promise.allSettled(tasks)).find((result) => result.status === 'rejected')
    if (refused) throw refused.reason
    return updated
  }
  // A role change and switching the account off or on save at once like
  // everything else; the toast offers to put the access back.
  const saveAll = useMutation({
    mutationFn: async (row: Row) => {
      const before = row.user
      const offboard = needsOffboarding
      // What the dialog saves, or a removal's own Undo toast names, is not listed here.
      const others = offboard
        ? [...accountChanges, ...entryChanges]
        : [...accountChanges, ...rotationChanges, ...periodEdits.filter((entry) => !isRemoval(entry)).map(periodChange), ...newPeriods.map(newPeriodChange)]
      if (accessChanges.length === 0) {
        const updated = await saveChanges(row, offboard)
        if (others.length > 0) toast.success(t.toast.saved(others.join(', ')))
        return { updated, offboard }
      }
      const role = accountForm.role
      const active = accountForm.is_active
      const updated = await undoable({
        execute: () => saveChanges(row, offboard),
        undo: async () => {
          await api.updateAdminUser({ id: before.id, input: { role: before.role, is_active: before.is_active } })
          if (openedId.current === before.id) setAccountForm((form) => ({ ...form, role: before.role, is_active: before.is_active }))
          refresh()
        },
        message: () => ({
          title: role !== before.role
            ? t.toast.roleChanged(before.display_name, accountRoleLabels()[role])
            : active ? t.toast.enabled(before.display_name) : t.toast.disabled(before.display_name),
          description: others.length > 0 ? t.toast.alsoSaved(others.join(', ')) : undefined,
        }),
      })
      return { updated, offboard }
    },
    onSuccess: ({ updated, offboard }) => {
      // The API stores the number in its +48 form, so the form follows it.
      if (updated) setAccountForm((form) => ({ ...form, phone: updated.phone }))
      refresh()
      if (offboard) openOffboarding(rotationUntil)
      else {
        setEligibilityEdits({})
        setEditingPeriod(null)
      }
    },
    // What was saved before a refusal drops off the unsaved list.
    onError: refresh,
  })
  // Both links are shown beside their button; issuing one changes nothing
  // until it is used, so neither asks first.
  const resetPassword = useMutation({ mutationFn: (id: string) => api.issuePasswordReset(id), onSuccess: ({ url }) => setResetUrl(url) })
  const reissueActivation = useMutation({
    mutationFn: (id: string) => api.reissueActivation(id),
    onSuccess: ({ url }) => {
      setReissuedUrl(url)
      refresh()
    },
  })
  // The API answers 204; the pseudonym the member keeps in the schedule is
  // read back from the team list by the member's id.
  const deleteAccount = useMutation({
    mutationFn: async (row: Row) => {
      await api.deleteAdminUser(row.user.id)
      return row.member ? (await api.team().catch(() => [])).find((item) => item.id === row.member!.id)?.display_name : undefined
    },
    onSuccess: (pseudonym, row) => {
      setDeleteOpen(false)
      closeDetails()
      toast.success(t.toast.deleted(row.user.display_name), { description: pseudonym ? t.toast.deletedPseudonym(pseudonym) : undefined })
      refresh()
    },
  })
  const createRotation = useMutation({
    mutationFn: () => api.createTeamMember({ user_id: selectedId!, active_from: rotationFrom }),
    onSuccess: () => {
      toast.success(t.toast.addedToRotation(selectedRow!.user.display_name, formatDate(rotationFrom)))
      refresh()
    },
  })
  const openOffboarding = (date: string) => {
    setOffboardingDate(date)
    setOffboardingOpen(true)
  }
  // The dialog closed every period at the exit date, so what is still pending
  // ends there too, and what would start after it is dropped.
  const finishOffboarding = () => {
    const date = offboardingDate
    const clamp = <T extends PeriodValue>(value: T): T => (!value.ends_on || value.ends_on > date ? { ...value, ends_on: date } : value)
    setOffboardingOpen(false)
    setRotationUntil(date)
    setEligibilityEdits((current) => Object.fromEntries(Object.entries(current)
      .filter(([, edit]) => !edit || edit.starts_on <= date)
      .map(([id, edit]) => [id, edit && clamp(edit)])))
    setNewPeriods((current) => current.filter((period) => period.starts_on <= date).map(clamp))
    refresh()
  }
  const setPeriodEdit = (item: Eligibility, edit: PeriodEdit | undefined) => setEligibilityEdits((current) => {
    const copy = { ...current }
    if (edit === undefined) delete copy[item.id]
    else copy[item.id] = edit
    return copy
  })
  const addPeriod = (period: NewPeriod) => setNewPeriods((current) => [...current, period])

  const submitAll = (event: FormEvent) => {
    event.preventDefault()
    setPhoneChecked(true)
    if (!selectedRow || !dirty) return
    saveAll.mutate(selectedRow)
  }
  const requestClose = () => unsavedChanges.requestAction(closeDetails)
  // Back to what is saved, in the same panel; the link goes with the
  // changes, so focus goes to the panel's title.
  const panelTitle = useRef<HTMLHeadingElement>(null)
  const discardChanges = (row: Row) => {
    applyDetails(row, tab)
    panelTitle.current?.focus()
  }
  const error = users.error || team.error || createRotation.error
  const ldapFieldsLocked = selectedRow?.user.auth_source === 'ldap'
  const selectedState = rotationState(selectedRow?.member, today)
  const selectedRoles = heldRoles(selectedRow?.member, today)
  const selectedActivation = selectedRow ? activationState(selectedRow.user, now) : null
  const exportCsv = () => {
    downloadBlob(t.csv.fileName(today), new Blob([`\uFEFF${csvOf(rows, today, now)}`], { type: 'text/csv;charset=utf-8' }))
  }
  const roleOptions = roles.map((role) => ({ value: role, label: accountRoleLabels()[role] }))
  // Digits only, as the server requires; said under the field in the
  // interface language rather than by the browser's own bubble.
  const personnelError = (value: string | null | undefined) => (value && !/^\d+$/.test(value) ? t.fields.personnelNumberFix : undefined)
  const personnelHint = branding.ldapEnabled ? `${t.fields.personnelNumberHint} ${t.fields.personnelNumberLdapHint}` : t.fields.personnelNumberHint
  const newName = newForm.first_name.trim() || t.newAccountPanel.thisPerson
  // The phone sits beside the e-mail, or with the entry date once the person
  // joins the rotation, where the strip "Teraz" needs it.
  const newPhone = (
    <Field label={t.fields.phone} id="new-phone" hint={t.fields.phoneNewHint} required={newRotation.on}>
      {({ id, describedBy }) => <Input id={id} name="phone" autoComplete="off" autoCapitalize="off" spellCheck={false} type="tel" mono value={newForm.phone ?? ''} aria-describedby={describedBy} required={newRotation.on} onChange={(e) => setNewForm({ ...newForm, phone: e.target.value || null })} />}
    </Field>
  )
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
              onChange={(event) => {
                setSearch(event.target.value)
                setDetails({ szukaj: event.target.value || null })
              }}
              className="sech-search"
            />
            <Segmented
              size="sm"
              wrap
              label={t.accounts}
              value={filter}
              onChange={(value) => setDetails({ filtr: value === 'all' ? null : FILTER_SLUGS[value] })}
              options={FILTERS.map((item) => ({ value: item, label: t.filters[item] }))}
            />
          </>
        )}
      />
      {(users.isLoading || team.isLoading) && <LoadingBlock label={t.loadingAccounts} />}
      {users.data && rows.length === 0 && (
        <div className="panel"><EmptyState compact icon="people" title={t.emptyFilter} /></div>
      )}
      {rows.length > 0 && (
        <ScrollArea label={t.accounts} hint={m.common.scrollHint}>
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
                const phoneToFix = row.user.phone !== null && !isPolishPhone(row.user.phone)
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
                    <td className={cx('mono', (needsPhone || phoneToFix) && 'who-bad')}>
                      {row.user.phone ?? (needsPhone ? t.row.missing : <span className="muted">–</span>)}
                      {phoneToFix && <small>{t.row.fixPhone}</small>}
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
        </ScrollArea>
      )}

      <Panel
        open={newOpen}
        onClose={() => setNewOpen(false)}
        wide
        title={created ? created.user.display_name : t.newAccountPanel.title}
        meta={created ? (
          <>
            <StatusBadge tone="warn">{t.activation.pending}</StatusBadge>
            {created.member && <StatusBadge tone="ok">{t.newAccountPanel.inRotationFrom(formatDate(created.member.active_from))}</StatusBadge>}
          </>
        ) : <StatusBadge tone={roleTone[newForm.role]}>{accountRoleLabels()[newForm.role]}</StatusBadge>}
        footer={!created && (
          <>
            <Button onClick={() => setNewOpen(false)}>{m.common.cancel}</Button>
            <Button
              type="submit"
              form="new-account-form"
              variant="primary"
              loading={createAccount.isPending}
              disabled={!newForm.username.trim() || !newForm.first_name.trim() || Boolean(personnelError(newForm.personnel_number)) || (newRotation.on && (!newForm.phone || !newRotation.from))}
            >
              {t.newAccountPanel.create}
            </Button>
          </>
        )}
      >
        {created ? (
          <div className="stack-sm">
            <Box tone="ok" role="status" title={[
              t.newAccountPanel.created,
              created.member && t.newAccountPanel.inRotationFrom(formatDate(created.member.active_from)),
              created.member && (created.roles.length > 0 ? inRoleOrder(created.roles).map((role) => dutyRoleLabels()[role]).join(', ') : t.newAccountPanel.noQualifications),
            ].filter(Boolean).join(' · ')}>
              <div className="token-once"><code translate="no">{created.url}</code><CopyButton value={created.url} /></div>
              <div className="box-next">{t.newAccountPanel.linkNext}</div>
            </Box>
            {created.rotationError && (
              <Box tone="bad" role="alert" title={created.member ? t.newAccountPanel.qualificationsFailed(roleList(created.missing!), created.missing!.length) : t.newAccountPanel.rotationFailed}>{created.rotationError}</Box>
            )}
            <div className="row">
              <Button size="sm" onClick={() => { setNewOpen(false); openDetails({ user: created.user, member: created.member }, 'rotation') }}>
                {created.member ? t.newAccountPanel.openRotation : t.rotationTab.addToRotation}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setNewOpen(false)}>{m.common.close}</Button>
            </div>
          </div>
        ) : (
          <form id="new-account-form" className="stack-sm" onSubmit={(event: FormEvent) => { event.preventDefault(); createAccount.mutate({ input: newForm, rotation: newRotation }) }}>
            {createAccount.error && <Box tone="bad" role="alert" focus title={createAccount.error.message} />}
            <div className="frow">
              <Field label={t.fields.firstName} id="new-first-name" required>
                {({ id }) => <Input id={id} name="first_name" autoComplete="off" autoCapitalize="words" value={newForm.first_name} onChange={(e) => setNewForm({ ...newForm, first_name: e.target.value })} required />}
              </Field>
              <Field label={t.fields.lastName} id="new-last-name">
                {({ id }) => <Input id={id} name="last_name" autoComplete="off" autoCapitalize="words" value={newForm.last_name} onChange={(e) => setNewForm({ ...newForm, last_name: e.target.value })} />}
              </Field>
            </div>
            <div className="frow">
              <Field label={t.fields.username} id="new-username" required hint={branding.ldapEnabled ? t.fields.usernameLdapHint : undefined}>
                {({ id, describedBy }) => <Input id={id} name="username" mono autoComplete="off" autoCapitalize="none" spellCheck={false} value={newForm.username} aria-describedby={describedBy} onChange={(e) => setNewForm({ ...newForm, username: e.target.value })} required />}
              </Field>
              <Field label={t.fields.personnelNumber} id="new-personnel-number" hint={personnelHint} error={personnelError(newForm.personnel_number)}>
                {({ id, describedBy, invalid }) => <Input id={id} name="personnel_number" mono autoComplete="off" autoCapitalize="none" spellCheck={false} inputMode="numeric" invalid={invalid} value={newForm.personnel_number ?? ''} aria-describedby={describedBy} onChange={(e) => setNewForm({ ...newForm, personnel_number: e.target.value || null })} />}
              </Field>
            </div>
            <div className="frow">
              <Field label={t.fields.email} id="new-email">
                {({ id }) => <Input id={id} name="email" autoComplete="off" type="email" value={newForm.email ?? ''} onChange={(e) => setNewForm({ ...newForm, email: e.target.value || null })} />}
              </Field>
              {!newRotation.on && newPhone}
            </div>
            <Field label={t.fields.accountRole} id="new-role" hint={t.fields.accountRoleHint}>
              {({ labelId }) => <Segmented<UserRole> wrap label={t.fields.accountRole} labelId={labelId} value={newForm.role} onChange={(role) => setNewForm({ ...newForm, role })} options={roleOptions} />}
            </Field>
            <div className="panel panel-padded stack-sm">
              <Checkbox
                label={t.newAccountPanel.inRotation}
                hint={t.newAccountPanel.inRotationHint}
                checked={newRotation.on}
                onChange={(e) => setNewRotation({ ...newRotation, on: e.target.checked })}
              />
              {newRotation.on && (
                <>
                  <div className="frow">
                    <DateField id="new-rotation-from" label={t.rotationTab.entryFrom} value={newRotation.from} onChange={(from) => setNewRotation({ ...newRotation, from })} />
                    {newPhone}
                  </div>
                  <Field label={t.rotationTab.dutyQualifications} id="new-qualifications">
                    {({ labelId }) => (
                      <div className="filter-chips" role="group" aria-labelledby={labelId}>
                        {dutyRoles.map((role) => {
                          const picked = newRotation.roles.includes(role)
                          return (
                            <button
                              key={role}
                              type="button"
                              className={cx('chip chip-btn', picked && 'chip-sig')}
                              aria-pressed={picked}
                              onClick={() => setNewRotation({ ...newRotation, roles: picked ? newRotation.roles.filter((item) => item !== role) : [...newRotation.roles, role] })}
                            >
                              {picked && <span className="chip-dot" aria-hidden="true" />}
                              {dutyRoleLabels()[role]}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </Field>
                </>
              )}
            </div>
            <Box tone="sig" title={t.newAccountPanel.afterCreation}>
              {!newRotation.on && t.newAccountPanel.afterCreationText}
              {newRotation.on && (newRotation.roles.length > 0
                ? t.newAccountPanel.afterCreationRotation(newName, formatDate(newRotation.from), roleList(newRotation.roles), newRotation.roles.length)
                : t.newAccountPanel.afterCreationNoRoles(newName, formatDate(newRotation.from)))}
              {branding.ldapEnabled && ` ${t.newAccountPanel.afterCreationLdap}`}
            </Box>
          </form>
        )}
      </Panel>

      {selectedRow?.member && (
        <OffboardingDialog
          key={`${selectedRow.member.id}:${offboardingDate}`}
          open={offboardingOpen}
          member={selectedRow.member}
          activeUntil={offboardingDate}
          onClose={() => setOffboardingOpen(false)}
          onDone={finishOffboarding}
          onChanged={refresh}
        />
      )}

      <Panel
        open={Boolean(selectedRow)}
        onClose={requestClose}
        titleRef={panelTitle}
        wide
        title={selectedRow ? (
          <span className="row">
            <Avatar name={selectedRow.user.display_name} size={30} />
            {selectedRow.user.display_name}
            {!selectedRow.user.is_active && <span className="sr-only"> · {t.details.disabled}</span>}
          </span>
        ) : ''}
        meta={selectedRow && (
          <>
            <StatusBadge tone={roleTone[selectedRow.user.role]}>{accountRoleLabels()[selectedRow.user.role]}</StatusBadge>
            <Tag>{t.authSources[selectedRow.user.auth_source]}</Tag>
            {!selectedRow.user.is_active && <StatusBadge tone="bad">{t.details.disabled}</StatusBadge>}
            {selectedRow.member && (
              <StatusBadge tone={selectedState === 'active' ? 'ok' : selectedState === 'entering' ? 'warn' : 'muted'}>
                {selectedState === 'active' ? t.rotation.active
                  : selectedState === 'entering' ? t.newAccountPanel.inRotationFrom(formatDate(selectedRow.member.active_from))
                    : t.rotationTab.ended(formatDate(selectedRow.member.active_until!))}
              </StatusBadge>
            )}
            {selectedActivation && <StatusBadge tone={selectedActivation === 'waiting' ? 'warn' : 'bad'}>{t.activation.pending}</StatusBadge>}
          </>
        )}
        footer={selectedRow && (
          <>
            <Button size="sm" variant="ghost" className="btn-bad" onClick={() => { setDeleteTyped(''); setDeleteOpen(true) }}>{t.details.deleteAccount}</Button>
            {dirty ? (
              <span className="panel-foot-note small muted">
                {t.details.unsaved(pendingChanges.join(' · '))}
                {/* Named for its effect, so it needs no dialog; closing by Escape or the corner button still asks. */}
                <button type="button" className="link-btn" onClick={() => discardChanges(selectedRow)}>{t.details.discard}</button>
              </span>
            ) : (
              <>
                <span className="sp" />
                <Button size="sm" onClick={requestClose}>{m.common.close}</Button>
              </>
            )}
            <Button size="sm" type="submit" form="person-form" variant="primary" disabled={!dirty || saveAll.isPending || exitChecking || earlyRoles.length > 0 || entryBlockers.length > 0 || Boolean(personnelError(accountForm.personnel_number))} loading={saveAll.isPending}>
              {saveAll.isPending ? m.common.saving : dirty ? t.details.saveCount(pendingChanges.length) : t.details.save}
            </Button>
          </>
        )}
      >
        {selectedRow && (
          <form id="person-form" onSubmit={submitAll} className="stack-sm">
            {saveAll.error && <Box tone="bad" role="alert" focus title={saveAll.error.message} />}
            <Tabs<DetailTab>
              label={t.details.sections}
              value={tab}
              onChange={setTab}
              items={[
                { value: 'account', label: t.details.tabs.account },
                { value: 'rotation', label: selectedRoles.length > 0 ? t.rotationTab.tabWithRoles(selectedRoles.map((role) => shortRoleLabels()[role]).join(', ')) : t.details.tabs.rotation },
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
                    {({ id }) => <Input id={id} name="first_name" autoComplete="off" autoCapitalize="words" disabled={ldapFieldsLocked} value={accountForm.first_name} onChange={(e) => setAccountForm({ ...accountForm, first_name: e.target.value })} required />}
                  </Field>
                  <Field label={t.fields.lastName} id="acc-last-name">
                    {({ id }) => <Input id={id} name="last_name" autoComplete="off" autoCapitalize="words" disabled={ldapFieldsLocked} value={accountForm.last_name} onChange={(e) => setAccountForm({ ...accountForm, last_name: e.target.value })} />}
                  </Field>
                </div>
                <div className="frow">
                  <Field label={t.fields.username} id="acc-username" hint={t.fields.usernameLocked}>
                    {({ id, describedBy }) => <Input id={id} name="username" mono autoComplete="off" autoCapitalize="none" spellCheck={false} disabled value={selectedRow.user.username} aria-describedby={describedBy} readOnly />}
                  </Field>
                  <Field label={t.fields.personnelNumber} id="acc-personnel-number" hint={t.fields.personnelNumberHint} error={personnelError(accountForm.personnel_number)}>
                    {({ id, describedBy, invalid }) => <Input id={id} name="personnel_number" mono autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={ldapFieldsLocked} inputMode="numeric" invalid={invalid} value={accountForm.personnel_number ?? ''} aria-describedby={describedBy} onChange={(e) => setAccountForm({ ...accountForm, personnel_number: e.target.value || null })} />}
                  </Field>
                </div>
                <div className="frow">
                  <Field label={t.fields.email} id="acc-email">
                    {({ id }) => <Input id={id} name="email" autoComplete="off" type="email" disabled={ldapFieldsLocked} value={accountForm.email ?? ''} onChange={(e) => setAccountForm({ ...accountForm, email: e.target.value || null })} />}
                  </Field>
                  <Field
                    label={t.fields.phone}
                    id="acc-phone"
                    hint={t.fields.phoneHint}
                    error={!phoneChecked ? undefined : !accountForm.phone
                      ? (selectedState === 'active' || selectedState === 'entering' ? t.fields.phoneRequired : undefined)
                      : (isPolishPhone(accountForm.phone) ? undefined : t.fields.phoneFix)}
                  >
                    {({ id, describedBy, invalid }) => <Input id={id} name="phone" autoComplete="off" autoCapitalize="off" spellCheck={false} type="tel" mono invalid={invalid} value={accountForm.phone ?? ''} aria-describedby={describedBy} onBlur={() => setPhoneChecked(true)} onChange={(e) => { setPhoneChecked(false); setAccountForm({ ...accountForm, phone: e.target.value || null }) }} />}
                  </Field>
                </div>
              </TabPanel>
              <TabPanel<DetailTab> value="rotation" className="stack-sm">
                {selectedRow.member ? (
                  <>
                    <div className="frow">
                      <DateField
                        id="rotation-from"
                        label={t.rotationTab.entryFrom}
                        value={rotationFrom}
                        onChange={setRotationFrom}
                        error={earlyRoles.length > 0 ? t.rotationTab.periodsBeforeEntry(roleList(earlyRoles), earlyRoles.length) : undefined}
                      />
                      <DateField
                        id="rotation-until"
                        label={t.rotationTab.exitUntilLabel}
                        value={rotationUntil}
                        onChange={setRotationUntil}
                        hint={exitDuties.calendar.isLoading ? t.rotationTab.checkingDuties
                          : exitDuties.duties.length > 0 ? t.rotationTab.dutiesAfterExit(exitDuties.duties.length)
                            : exitCutsPeriods ? t.rotationTab.periodsAfterExit : t.rotationTab.exitHint}
                      />
                    </div>
                    {entryBlockers.length > 0 && <Box tone="warn" role="status" title={t.rotationTab.entrySavedAlone(entryBlockers.join(', '))} />}
                    <SectionHeading
                      as="h3"
                      className="sech-sub"
                      title={t.rotationTab.qualificationsTitle}
                      meta={t.rotationTab.savedWithSave}
                      controls={<button type="button" className={cx('sech-link', addingPeriod && 'on')} aria-pressed={addingPeriod} onClick={() => setAddingPeriod((value) => !value)}>{t.rotationTab.addPeriod}</button>}
                    />
                    {addingPeriod && (
                      <div className="frow frow-end">
                        <Field label={t.rotationTab.dutyRole} id="new-eligibility-role">
                          {({ labelId }) => (
                            <Segmented<AssignmentRole>
                              label={t.rotationTab.dutyRole}
                              labelId={labelId}
                              size="sm"
                              value={eligibilityRole}
                              onChange={setEligibilityRole}
                              options={dutyRoles.map((role) => ({ value: role, label: dutyRoleLabels()[role] }))}
                            />
                          )}
                        </Field>
                        <DateField id="new-eligibility-from" label={t.period.from} value={eligibilityFrom} onChange={setEligibilityFrom} />
                        <DateField id="new-eligibility-until" label={t.period.untilOptional} value={eligibilityUntil} onChange={setEligibilityUntil} />
                        <Button
                          icon="plus"
                          disabled={!eligibilityFrom}
                          onClick={() => {
                            addPeriod({ role: eligibilityRole, starts_on: eligibilityFrom, ends_on: eligibilityUntil })
                            setEligibilityUntil('')
                            setAddingPeriod(false)
                          }}
                        >
                          {t.rotationTab.addPeriod}
                        </Button>
                      </div>
                    )}
                    <QualificationList
                      member={selectedRow.member}
                      today={today}
                      edits={eligibilityEdits}
                      newPeriods={newPeriods}
                      editing={editingPeriod}
                      onEdit={setEditingPeriod}
                      onEditChange={setPeriodEdit}
                      onAdd={addPeriod}
                      onDropNew={(period) => setNewPeriods((current) => current.filter((entry) => entry !== period))}
                    />
                    {selectedState === 'active' && (
                      <div className="row">
                        <Button onClick={() => openOffboarding(rotationUntil || today)}>{t.rotationTab.endRotation}</Button>
                        <span className="muted small">{t.rotationTab.endRotationHint}</span>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <Box tone="muted" title={t.rotationTab.outside}>{t.rotationTab.outsideText}</Box>
                    <div className="frow frow-end">
                      <DateField id="rotation-from" label={t.rotationTab.entryFrom} value={rotationFrom} onChange={setRotationFrom} />
                      <Button variant="primary" onClick={() => createRotation.mutate()} loading={createRotation.isPending}>{t.rotationTab.addToRotation}</Button>
                    </div>
                  </>
                )}
              </TabPanel>
              <TabPanel<DetailTab> value="access" className="stack-sm">
                <Field label={t.fields.accountRole} id="acc-role" hint={t.fields.accountRoleHint}>
                  {({ labelId }) => (
                    <Segmented<UserRole>
                      wrap
                      label={t.fields.accountRole}
                      labelId={labelId}
                      value={accountForm.role}
                      onChange={(role) => setAccountForm({ ...accountForm, role })}
                      options={roleOptions}
                    />
                  )}
                </Field>
                <Checkbox label={t.accessTab.accountEnabled} hint={t.accessTab.accountEnabledHint} checked={accountForm.is_active} onChange={(e) => setAccountForm({ ...accountForm, is_active: e.target.checked })} />
                {selectedActivation && (
                  <Box tone={selectedActivation === 'waiting' ? 'warn' : 'bad'} title={t.activation.pendingTitle}>
                    {t.accessTab.noPasswordYet}
                    {` ${sentence(activationLinkText(selectedRow.user, selectedActivation))}. `}
                    {t.accessTab.newLinkInvalidates}
                    <div className="row mt-6">
                      <Button size="sm" icon="send" disabled={!selectedRow.user.is_active || reissueActivation.isPending} loading={reissueActivation.isPending} onClick={() => reissueActivation.mutate(selectedRow.user.id)}>{t.accessTab.reissueActivation}</Button>
                      {!selectedRow.user.is_active && <span className="muted small">{t.accessTab.disabledNoLink}</span>}
                    </div>
                  </Box>
                )}
                {reissueActivation.error && <Box tone="bad" role="alert" title={reissueActivation.error.message} />}
                {reissuedUrl && <LinkResult value={reissuedUrl} label={t.accessTab.newActivationLink} />}
                {selectedRow.user.auth_source === 'local' && !selectedActivation && (
                  <div className="row">
                    <Button size="sm" icon="lock" disabled={resetPassword.isPending} loading={resetPassword.isPending} onClick={() => resetPassword.mutate(selectedRow.user.id)}>{t.accessTab.issueReset}</Button>
                    <span className="muted small">{t.accessTab.resetHint}</span>
                  </div>
                )}
                {resetPassword.error && <Box tone="bad" role="alert" title={resetPassword.error.message} />}
                {resetUrl && <LinkResult value={resetUrl} label={t.accessTab.resetLink} />}
              </TabPanel>
            </Tabs>
          </form>
        )}
      </Panel>

      <UnsavedChangesDialog guard={unsavedChanges} detail={t.details.unsaved(pendingChanges.join(' · '))} />
      <Dialog
        open={deleteOpen && Boolean(selectedRow)}
        onClose={() => setDeleteOpen(false)}
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
              onClick={() => deleteAccount.mutate(selectedRow)}
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
              {({ id }) => <Input id={id} name="username-confirmation" mono autoComplete="off" autoCapitalize="none" spellCheck={false} value={deleteTyped} placeholder={t.deleteDialog.typeUsernamePlaceholder} onChange={(event) => setDeleteTyped(event.target.value)} />}
            </Field>
          </>
        )}
      </Dialog>
    </div>
  )
}
