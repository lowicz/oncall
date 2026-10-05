export type UserRole = 'viewer' | 'member' | 'coordinator' | 'admin'
export type AuthSource = 'local' | 'ldap'
export type AssignmentRole = 'primary' | 'secondary' | 'late_shift'
export type RotationMode = 'hybrid' | 'daily' | 'weekly'
export type LateShiftAnchor = 'secondary' | 'primary' | 'independent'

/** Instance settings the interface reads before anyone is logged in. */
export interface PublicConfig {
  ldap_enabled: boolean
  /** Product name shown in the rail, on the login screen and in the tab title. */
  app_name: string
  /** Optional second line under the name; empty hides it. */
  app_subtitle: string
  /** The release running, as its image was built: `1.2.0`, `1.3.0-rc.1`, or
   *  `dev` for a build from a checkout. */
  version: string
  /** How long the worker keeps audit entries, in days: business events and
   *  routine sign-ins separately; 0 keeps them for ever. The Audit screen
   *  states it so a reader knows where the trail ends. */
  audit_retention_days: number
  login_audit_retention_days: number
}

export interface ShareSession {
  label: string
  starts_on: string
  ends_on: string
  expires_at: string
}

export interface CurrentUser {
  username: string
  display_name: string
  role: UserRole
  has_team_member: boolean
  email: string | null
  share: ShareSession | null
  /** Where this person's own photo is served when the directory may hold
   *  one; null for a local account, a share link or a deployment that reads
   *  no photos. Whether there is one is only known once it is fetched. */
  avatar_url: string | null
}

export interface AccountTokenInfo {
  username: string
  display_name: string
}

export interface RuleViolation {
  rule: string
  message: string
  member_name: string
  days: string[]
}

export interface Assignment {
  service_date: string
  role: AssignmentRole
  assignee_name: string
  is_override: boolean
  rule_violations?: RuleViolation[]
}

export interface CurrentDuty {
  role: AssignmentRole
  service_date: string
  assignee_name: string
  member_id: string | null
  contact_email: string | null
  contact_phone: string | null
  coverage_starts_at: string
  coverage_ends_at: string
  is_day_off: boolean
  is_override: boolean
  next_assignee_name: string | null
  next_service_date: string | null
}

export interface PublishedSchedule {
  generated_at: string
  /** At least one visible day comes from a real publication. A non-empty `id`
   *  is not the same thing: imported history fills it too. */
  is_published: boolean
  id: string | null
  version: number | null
  starts_on: string | null
  ends_on: string | null
  assignments: Assignment[]
  current: CurrentDuty[]
  today_is_day_off: boolean
  today_holiday_name: string | null
}

export type SwapStatus =
  | 'pending_replacement'
  | 'pending_coordinator'
  | 'approved'
  | 'rejected'
  | 'cancelled'

export interface SwapSlot {
  service_date: string
  role: AssignmentRole
}

export interface SwapOption {
  member_id: string
  display_name: string
  /** Soft preference reported for that day; hard 'unavailable' never appears. */
  availability: AvailabilityKind | null
  /** Already holds some role that day. */
  on_duty_that_day: boolean
  /** Slots the request would move - two when the 11-19 anchor couples them. */
  slots?: SwapSlot[]
  /** Rules that rule this candidate out; when set, it is not selectable. */
  blocking_violations?: RuleViolation[]
  /** Hard rules a request to this candidate breaks: it stays selectable, and
   *  the request has to acknowledge them and say why. */
  rule_violations?: RuleViolation[]
  /** Rules the swap bends but does not break; the candidate stays selectable. */
  warning_violations?: RuleViolation[]
  /** What to do instead, set when blocking_violations is non-empty. */
  next_step?: string | null
}

/** A duty of the replacement the requester could take in exchange. The three
 *  lists judge the whole exchange, both directions as one move. */
export interface SwapReturnOption extends SwapSlot {
  /** The slots that come back - two when the 11-19 anchor couples them. */
  slots: SwapSlot[]
  blocking_violations: RuleViolation[]
  rule_violations: RuleViolation[]
  warning_violations: RuleViolation[]
}

export interface SwapRequest {
  id: string
  schedule_id: string
  service_date: string
  role: AssignmentRole
  requester_name: string
  replacement_name: string
  requester_member_id?: string
  replacement_member_id?: string
  status: SwapStatus
  note: string | null
  decision_note: string | null
  created_at: string
  slots?: SwapSlot[]
  /** What the requester takes in exchange, its headline slot first; empty
   *  for a one-way hand-over. */
  return_slots?: SwapSlot[]
  /** Rules the swap bends: at creation, and while the request is open. */
  warnings?: RuleViolation[]
  /** Hard rules the swap breaks: on the roster as it is now while the request
   *  is open, as last acknowledged once it is decided. */
  rule_violations?: RuleViolation[]
}

export type AvailabilityKind = 'unavailable' | 'prefer_not' | 'prefer'

export interface AvailabilityEntry {
  id: string
  kind: AvailabilityKind
  starts_on: string
  ends_on: string
  note: string | null
  created_at: string
  warning?: string | null
  created_by_name?: string | null
}

export interface AvailabilityInput {
  kind: AvailabilityKind
  starts_on: string
  ends_on: string
  note?: string
}

export interface HistoryImportRow {
  row_number?: number | null
  service_date: string
  role: AssignmentRole
  assignee_name: string
}

export interface HistoryImportError {
  row_number: number | null
  field: string | null
  message: string
}

export interface HistoryImportPreview {
  filename: string
  valid: boolean
  rows: HistoryImportRow[]
  errors: HistoryImportError[]
}

export interface HistoryImportRecord {
  id: string
  name: string
  starts_on: string
  ends_on: string
  rows: number
  created_at: string
}

export interface SchedulingPolicy {
  rotation_mode: RotationMode
  fairness_weight: number
  continuity_weight: number
  preference_weight: number
  late_shift_anchor: LateShiftAnchor
  /** Budget of one solver pass, in seconds (5-300). */
  solve_seconds: number
  /** Hard wall-clock ceiling for a whole generation (several passes). */
  time_budget_seconds: number
  /** Whether a swap the replacement accepted still waits for a coordinator. */
  coordinator_swap_approval_required: boolean
  updated_at: string
}

/** How far a swap request travels once the replacement agrees; every member may read it. */
export interface SwapPolicy {
  coordinator_approval_required: boolean
}

export interface DraftSchedule {
  id: string
  name: string
  starts_on: string
  ends_on: string
  status: 'draft' | 'proposed' | 'published' | 'superseded'
  version: number
  rotation_mode: RotationMode
  solver_status: string
  /** Lowest deviation spread the solver proved reachable, or null if it never
   *  got past a feasible answer (LOW6-07). */
  acceptance_floor: number | null
  fairness_proven?: boolean
  continuity_gap?: number | null
  assignments: Assignment[]
  warnings?: ScheduleWarning[]
  /** Assignments landing on a hard „nie mogę"; the draft matrix banners them. */
  unavailability_conflicts?: UnavailabilityConflict[]
  uncovered_before?: string[]
  stale_changes_count?: number
}

export interface ScheduleWarning {
  /** 'solver' - what CP-SAT gave up; 'rules' - a hard rule the schedule breaks. */
  source: 'solver' | 'rules'
  message: string
}

export interface UnavailabilityConflict {
  service_date: string
  role: AssignmentRole
  assignee_name: string
}

export interface PublishChange {
  service_date: string
  role: AssignmentRole
  previous_assignee_name: string
  new_assignee_name: string
  source: 'override' | 'approved_swap'
  original_assignee_name: string | null
  reason: string | null
}

export interface PublishPendingSwap {
  id: string
  service_date: string
  role: AssignmentRole
  requester_name: string
  replacement_name: string
  status: 'pending_replacement' | 'pending_coordinator'
}

export interface PublishPreview {
  lost_changes: PublishChange[]
  carried_changes: PublishChange[]
  pending_swaps: PublishPendingSwap[]
  uncovered_before: string[]
  stale_changes_count: number
  rest_violations: RuleViolation[]
}

export interface Eligibility {
  id: string
  role: AssignmentRole
  starts_on: string
  ends_on: string | null
}

export interface TeamMember {
  id: string
  user_id: string | null
  display_name: string
  active_from: string
  active_until: string | null
  eligibility: Eligibility[]
}

export interface AdminUser {
  id: string
  username: string
  personnel_number: string | null
  first_name: string
  last_name: string
  display_name: string
  auth_source: AuthSource
  role: UserRole
  email: string | null
  phone: string | null
  is_active: boolean
  created_at: string
  /**
   * Set while a local account still waits for its first password, whether or
   * not it is enabled; null once activated and for a directory account.
   * `link_expires_at` is in the past once the newest link has expired, and
   * null when no unused link is left.
   */
  pending_activation: { link_expires_at: string | null } | null
}

export interface AdminUserInput {
  username: string
  personnel_number: string | null
  first_name: string
  last_name: string
  email: string | null
  phone: string | null
  role: UserRole
}

export type AdminUserUpdate = Partial<Omit<AdminUserInput, 'username'>> & {
  is_active?: boolean
}

export interface ScheduleSummary {
  id: string
  name: string
  starts_on: string
  ends_on: string
  status: DraftSchedule['status']
  version: number
  rotation_mode: RotationMode
  solver_status: string
  assignment_count: number
  created_at: string | null
}

export interface ScheduleRun {
  id: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  progress: number
  schedule_id: string | null
  error: string | null
  conflicts: string[] | null
  created_at: string
  /** Solver time budget for this run, in seconds. */
  solve_seconds: number
  /** Active runs claimed before this one; 0 once running, null once finished. */
  queue_position: number | null
  /** Rough wall-clock until this run starts, in seconds; null unless queued. */
  estimated_start_seconds: number | null
  uncovered_before?: string[]
}

export interface SuggestedScheduleRange {
  first_uncovered: string
  starts_on: string
  ends_on: string
}

export interface ScheduleComparison {
  starts_on: string
  ends_on: string
  variants: Array<{
    id: string
    name: string
    rotation_mode: RotationMode
    assignment_count: number
    handovers: number
    max_consecutive_days: number
    load_spread: number
    override_count: number
  }>
}

export interface CalendarData {
  starts_on: string
  ends_on: string
  days: Array<{
    service_date: string
    weekday: string
    is_day_off: boolean
    holiday_name: string | null
    published: boolean
    events: CalendarEventRef[]
  }>
  members: Array<{
    id: string
    display_name: string
    active_from?: string
    active_until?: string | null
    eligibility?: Array<{ role: AssignmentRole; starts_on: string; ends_on: string | null }>
  }>
  team_has_members: boolean
  assignments: Array<Assignment & {
    schedule_id: string
    schedule_version: number
    member_id?: string | null
    change_kind: 'swap' | 'manual_override' | null
  }>
  availability: Array<{
    member_id: string
    kind: AvailabilityKind
    starts_on: string
    ends_on: string
    note: string | null
  }>
}

export type CalendarEventColor = 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'teal'

export interface CalendarEventRef {
  id: string
  title: string
  color: CalendarEventColor
}

export interface CalendarEvent extends CalendarEventRef {
  starts_on: string
  ends_on: string
  created_at: string
}

export interface CalendarEventInput {
  starts_on: string
  ends_on: string
  title: string
  color: CalendarEventColor
}

export interface MonthlyReportPreview {
  month: string
  days_in_month: number
  staffed_days: number
  rows: Array<{
    /** The row's identity: two members may share a name. */
    member_id: string
    name: string
    primary_workdays: number
    primary_weekends: number
    primary_holidays: number
    secondary_workdays: number
    secondary_weekends: number
    secondary_holidays: number
    oncall_workdays: number
    oncall_weekends: number
    oncall_holidays: number
    /** Primary and secondary duty days on weekends and holidays together. */
    oncall_days_off: number
    /** Every primary and secondary duty day; 11-19 shifts are not duty days. */
    oncall_total: number
    late_shifts: number
    primary_points: number
    secondary_points: number
    total_points: number
  }>
}

export interface ShareLink {
  id: string
  label: string
  starts_on: string
  ends_on: string
  expires_at: string
  created_at: string
  used_at: string | null
  revoked_at: string | null
}

export interface ShareLinkCreated {
  id: string
  url: string
  expires_at: string
}

export interface ShareExchangeResult {
  display_name: string
  role: UserRole
  starts_on: string
  ends_on: string
  expires_at: string
}

export interface FeedToken {
  id: string
  label: string
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

export interface FeedTokenCreated {
  id: string
  url: string
}

export interface FairnessCategory {
  actual: number
  expected: number
  deviation: number
}

export interface FairnessMember {
  member_id: string
  display_name: string
  /** Rotation join date (ISO). Explains a low absolute total that still meets the fair share. */
  active_from: string
  eligible_days: Record<string, number>
  primary: FairnessCategory
  secondary: FairnessCategory
  late_shift: FairnessCategory
  weekends: FairnessCategory
  holidays: FairnessCategory
  total_points: number
  in_criterion?: boolean
}

export interface FairnessOutlier {
  member_id: string
  display_name: string
  deviation: number
}

export interface FairnessLensOutliers {
  lens: string
  highest: FairnessOutlier | null
  lowest: FairnessOutlier | null
}

export interface LensSpread {
  lens: string
  spread: number
  meets_criterion: boolean
}

export interface DraftLensSpread {
  lens: string
  before: number
  after: number
  meets_criterion: boolean
}

export interface FairnessReport {
  as_of: string
  window_start: string
  window_end: string
  totals: Record<string, number>
  members: FairnessMember[]
  late_shift_balanced: boolean
  criterion_points: number
  criterion_met: boolean
  spreads: LensSpread[]
  outliers?: FairnessLensOutliers[]
  latest_publish_end: string | null
}

export interface DraftFairnessImpact {
  schedule_id: string
  schedule_version: number
  baseline_as_of: string
  projected_as_of: string
  baseline_members: FairnessMember[]
  projected_members: FairnessMember[]
  late_shift_balanced: boolean
  criterion_points: number
  criterion_met: boolean
  spreads: DraftLensSpread[]
  acceptance_floor: number | null
}

export interface SwapImpactMember {
  member_id: string
  display_name: string
  before: FairnessMember
  after: FairnessMember
}

export interface SwapImpact {
  service_date: string
  role: AssignmentRole
  points: number
  window_start: string
  window_end: string
  requester: SwapImpactMember
  replacement: SwapImpactMember
  /** The day that comes back in an exchange, and what it is worth. */
  return_date?: string | null
  return_points?: number | null
}

export interface FairnessDuty {
  service_date: string
  role: AssignmentRole
  points: number
  is_day_off: boolean
}

export interface AuditEvent {
  id: string
  occurred_at: string
  actor_label: string
  action: string
  entity_type: string | null
  entity_id: string | null
  summary: string
  details: Record<string, unknown> | null
}

/** An error carrying the structured `detail` a hard-rule rejection returns, so
 *  a screen can list the rule, the person and the days instead of only the
 *  one-line message (BLK6-01). */
import { messages, readLanguage } from './i18n'

export class ApiError extends Error {
  status: number
  violations: RuleViolation[]
  nextStep: string | null
  constructor(
    message: string,
    status: number,
    violations: RuleViolation[] = [],
    nextStep: string | null = null,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.violations = violations
    this.nextStep = nextStep
  }
}

/** The messages of a field validation error, whose `detail` is a list of
 *  `{loc, msg}`: the first message for each field, each message once, as one
 *  line of sentences. Null when the list carries no message. */
function fieldMessages(detail: unknown[]): string | null {
  const byField = new Map<string, string>()
  for (const item of detail) {
    if (typeof item !== 'object' || item === null) continue
    const { loc, msg } = item as { loc?: unknown; msg?: unknown }
    if (typeof msg !== 'string' || msg.trim() === '') continue
    const field = Array.isArray(loc) ? loc.join('.') : ''
    if (!byField.has(field)) byField.set(field, msg.trim())
  }
  const messages = [...new Set(byField.values())]
  if (messages.length === 0) return null
  if (messages.length === 1) return messages[0]
  return messages.map((message) => (/[.!?]$/.test(message) ? message : `${message}.`)).join(' ')
}

function parseError(body: unknown, status: number): ApiError {
  if (typeof body === 'object' && body !== null && 'detail' in body) {
    const detail = (body as { detail: unknown }).detail
    if (typeof detail === 'string') return new ApiError(detail, status)
    if (Array.isArray(detail)) {
      return new ApiError(fieldMessages(detail) ?? messages().common.httpError(status), status)
    }
    if (typeof detail === 'object' && detail !== null) {
      const record = detail as Record<string, unknown>
      const message = typeof record.message === 'string' ? record.message : messages().common.httpError(status)
      const violations = Array.isArray(record.violations)
        ? (record.violations as RuleViolation[])
        : []
      const nextStep = typeof record.next_step === 'string' ? record.next_step : null
      return new ApiError(message, status, violations, nextStep)
    }
  }
  return new ApiError(messages().common.httpError(status), status)
}

/** The file's bytes as a `data:` URL, which an `<img>` shows with no object
 *  URL to revoke and which the strict CSP allows. */
function asDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error(messages().common.imageReadFailed))
    reader.readAsDataURL(blob)
  })
}

/**
 * The interface language travels with every call as `Accept-Language`, so a
 * refusal, a validation message or a holiday name comes back in the words the
 * screen is showing.
 */
const languageHeader = () => ({ 'Accept-Language': readLanguage() })

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...languageHeader(), ...init?.headers },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw parseError(body, response.status)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

/** A state-changing call: a fresh CSRF token first, then the JSON request. */
async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { csrf_token } = await request<{ csrf_token: string }>('/api/v1/auth/csrf')
  return request<T>(path, {
    method,
    headers: { 'X-CSRF-Token': csrf_token },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

/** Polls one generation run to its end and returns the finished draft.
 *  Shared by starting a generation and by rejoining one after a reload. */
async function followRun(
  runId: string,
  onProgress?: (run: ScheduleRun) => void,
): Promise<DraftSchedule> {
  for (;;) {
    const current = await request<ScheduleRun>(`/api/v1/scheduling/runs/${runId}`)
    onProgress?.(current)
    if (current.status === 'failed') {
      throw new Error(current.error ?? messages().common.generatorFailed)
    }
    if (current.status === 'completed' && current.schedule_id) {
      return request<DraftSchedule>(`/api/v1/scheduling/${current.schedule_id}`)
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1000))
  }
}

export const api = {
  me: () => request<CurrentUser>('/api/v1/auth/me'),
  /** The person's own photo from the directory as a data URL, or null when
   *  the directory holds none for them. A directory that cannot answer is an
   *  error, so the caller keeps its fallback either way. */
  ownAvatar: async (url: string): Promise<string | null> => {
    const response = await fetch(url, { credentials: 'include', headers: languageHeader() })
    if (response.status === 404) return null
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      throw parseError(body, response.status)
    }
    return asDataUrl(await response.blob())
  },
  publicConfig: () => request<PublicConfig>('/api/v1/config'),
  login: (username: string, password: string) =>
    request<CurrentUser>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: async () => {
    const { csrf_token } = await request<{ csrf_token: string }>('/api/v1/auth/csrf')
    const response = await fetch('/api/v1/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-CSRF-Token': csrf_token, ...languageHeader() },
    })
    if (!response.ok) throw new Error(messages().common.logoutFailed(response.status))
  },
  publishedSchedule: () => request<PublishedSchedule>('/api/v1/schedules/published'),
  calendar: (startsOn: string, endsOn: string) =>
    request<CalendarData>(
      `/api/v1/calendar?starts_on=${encodeURIComponent(startsOn)}&ends_on=${encodeURIComponent(endsOn)}`,
    ),
  batchOverride: (input: {
    schedule_id: string
    expected_version: number
    assignments: Array<{
      service_date: string
      role: AssignmentRole
      replacement_member_id: string
    }>
    reason: string
    /** Required when the batch breaks a hard rule (409 with the violations otherwise). */
    acknowledge_rule_violations?: boolean
  }) => send<Assignment[]>('POST', '/api/v1/calendar/override/batch', input),
  calendarEvents: (startsOn: string, endsOn: string) =>
    request<CalendarEvent[]>(
      `/api/v1/calendar/events?starts_on=${encodeURIComponent(startsOn)}&ends_on=${encodeURIComponent(endsOn)}`,
    ),
  createCalendarEvent: (input: CalendarEventInput) =>
    send<CalendarEvent>('POST', '/api/v1/calendar/events', input),
  updateCalendarEvent: ({ id, ...input }: { id: string } & Partial<CalendarEventInput>) =>
    send<CalendarEvent>('PATCH', `/api/v1/calendar/events/${id}`, input),
  deleteCalendarEvent: (id: string) => send<void>('DELETE', `/api/v1/calendar/events/${id}`),
  directOverride: (input: {
    schedule_id?: string
    expected_version: number
    service_date: string
    role: AssignmentRole
    replacement_member_id: string
    reason?: string
    /** Required when the override breaks a hard rule (409 with the violations otherwise). */
    acknowledge_rule_violations?: boolean
  }) => send<Assignment>('POST', '/api/v1/calendar/override', input),
  directOverrideCheck: (input: {
    service_date: string
    role: AssignmentRole
    replacement_member_id: string
  }) => send<RuleViolation[]>('POST', '/api/v1/calendar/override/check', input),
  availability: () => request<AvailabilityEntry[]>('/api/v1/availability/me'),
  createAvailability: (input: AvailabilityInput) =>
    send<AvailabilityEntry>('POST', '/api/v1/availability/me', input),
  deleteAvailability: (id: string) => send<void>('DELETE', `/api/v1/availability/me/${id}`),
  memberAvailability: (memberId: string) =>
    request<AvailabilityEntry[]>(`/api/v1/availability/members/${memberId}`),
  createMemberAvailability: (memberId: string, input: AvailabilityInput) =>
    send<AvailabilityEntry>('POST', `/api/v1/availability/members/${memberId}`, input),
  deleteMemberAvailability: (memberId: string, id: string) =>
    send<void>('DELETE', `/api/v1/availability/members/${memberId}/${id}`),
  previewHistory: async (file: File) => {
    const { csrf_token } = await request<{ csrf_token: string }>('/api/v1/auth/csrf')
    const form = new FormData()
    form.append('file', file)
    const response = await fetch('/api/v1/history/preview', {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-CSRF-Token': csrf_token, ...languageHeader() },
      body: form,
    })
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null)
      throw parseError(body, response.status)
    }
    return response.json() as Promise<HistoryImportPreview>
  },
  commitHistory: (preview: HistoryImportPreview) =>
    send<{ schedule_id: string; imported_rows: number }>('POST', '/api/v1/history/commit', {
      filename: preview.filename,
      rows: preview.rows,
    }),
  historyImports: () => request<HistoryImportRecord[]>('/api/v1/history/imports'),
  schedulingPolicy: () => request<SchedulingPolicy>('/api/v1/scheduling/policy'),
  suggestedScheduleRange: () =>
    request<SuggestedScheduleRange>('/api/v1/scheduling/suggested-range'),
  updateSchedulingPolicy: (input: {
    rotation_mode: RotationMode
    fairness_weight?: number
    continuity_weight?: number
    preference_weight?: number
    late_shift_anchor?: LateShiftAnchor
    solve_seconds?: number
    coordinator_swap_approval_required?: boolean
  }) => send<SchedulingPolicy>('PUT', '/api/v1/scheduling/policy', input),
  generateSchedule: async (
    input: { starts_on: string; ends_on: string },
    onProgress?: (run: ScheduleRun) => void,
  ) => {
    const run = await send<ScheduleRun>('POST', '/api/v1/scheduling/runs', input)
    onProgress?.(run)
    return followRun(run.id, onProgress)
  },
  /** Runs of this coordinator still in flight, so a reload can rejoin one. */
  activeRuns: () => request<ScheduleRun[]>('/api/v1/scheduling/runs'),
  followRun,
  draftSchedules: () => request<ScheduleSummary[]>('/api/v1/scheduling/drafts'),
  compareSchedules: (leftId: string, rightId: string) =>
    request<ScheduleComparison>(
      `/api/v1/scheduling/compare?left_id=${encodeURIComponent(leftId)}&right_id=${encodeURIComponent(rightId)}`,
    ),
  schedule: (id: string) => request<DraftSchedule>(`/api/v1/scheduling/${id}`),
  deleteSchedule: (id: string) => send<void>('DELETE', `/api/v1/scheduling/${id}`),
  overrideDraft: async (input: {
    id: string
    expected_version: number
    service_date: string
    role: AssignmentRole
    replacement_member_id: string
  }) => {
    const { id, ...body } = input
    return send<DraftSchedule>('POST', `/api/v1/scheduling/${id}/override`, body)
  },
  draftFairnessImpact: (id: string, version: number) =>
    request<DraftFairnessImpact>(
      `/api/v1/scheduling/${id}/fairness-impact?version=${version}`,
    ),
  proposeSchedule: ({ id, expectedVersion }: { id: string; expectedVersion: number }) =>
    send<DraftSchedule>('POST', `/api/v1/scheduling/${id}/propose`, { expected_version: expectedVersion }),
  withdrawSchedule: ({ id, expectedVersion }: { id: string; expectedVersion: number }) =>
    send<DraftSchedule>('POST', `/api/v1/scheduling/${id}/withdraw`, { expected_version: expectedVersion }),
  publishPreview: (id: string) =>
    request<PublishPreview>(`/api/v1/scheduling/${id}/publish-preview`),
  publishSchedule: ({
    id,
    expectedVersion,
    acknowledgeLostChanges = false,
    acknowledgeGap = false,
    acknowledgeRestViolations = false,
    changeResolutions = {},
  }: {
    id: string
    expectedVersion: number
    acknowledgeLostChanges?: boolean
    acknowledgeGap?: boolean
    acknowledgeRestViolations?: boolean
    changeResolutions?: Record<string, 'draft' | 'change'>
  }) =>
    send<DraftSchedule>('POST', `/api/v1/scheduling/${id}/publish`, {
      expected_version: expectedVersion,
      acknowledge_lost_changes: acknowledgeLostChanges,
      acknowledge_gap: acknowledgeGap,
      acknowledge_rest_violations: acknowledgeRestViolations,
      change_resolutions: changeResolutions,
    }),
  swaps: (params: { status?: SwapStatus[]; limit?: number } = {}) => {
    const search = new URLSearchParams()
    params.status?.forEach((value) => search.append('status', value))
    if (params.limit) search.set('limit', String(params.limit))
    const query = search.toString()
    return request<SwapRequest[]>(`/api/v1/swaps${query ? `?${query}` : ''}`)
  },
  swapPolicy: () => request<SwapPolicy>('/api/v1/swaps/policy'),
  /** `inReturn` projects an exchange; `correction` a coordinator's correction,
   *  which moves 11-19 with its anchor role only. */
  swapImpact: (
    serviceDate: string,
    role: AssignmentRole,
    replacementMemberId: string,
    { inReturn, correction }: { inReturn?: SwapSlot; correction?: boolean } = {},
  ) =>
    request<SwapImpact>(
      `/api/v1/swaps/impact?service_date=${encodeURIComponent(serviceDate)}`
      + `&role=${role}&replacement_member_id=${encodeURIComponent(replacementMemberId)}`
      + (inReturn ? `&return_date=${encodeURIComponent(inReturn.service_date)}&return_role=${inReturn.role}` : '')
      + (correction ? '&correction=true' : ''),
    ),
  swapOptions: (serviceDate: string, role: AssignmentRole) =>
    request<SwapOption[]>(
      `/api/v1/swaps/options?service_date=${encodeURIComponent(serviceDate)}&role=${role}`,
    ),
  swapReturnOptions: (serviceDate: string, role: AssignmentRole, replacementMemberId: string) =>
    request<SwapReturnOption[]>(
      `/api/v1/swaps/return-options?service_date=${encodeURIComponent(serviceDate)}`
      + `&role=${role}&replacement_member_id=${encodeURIComponent(replacementMemberId)}`,
    ),
  createSwap: (input: {
    schedule_id: string
    service_date: string
    role: AssignmentRole
    replacement_member_id: string
    note?: string
    acknowledge_rule_violations?: boolean
    /** The duty of the replacement taken in exchange. */
    in_return?: SwapSlot
  }) => send<SwapRequest>('POST', '/api/v1/swaps', input),
  /** `acknowledge`: the person deciding has seen the hard rules the swap breaks. */
  acceptSwap: ({ id, acknowledge }: { id: string; acknowledge: boolean }) =>
    send<SwapRequest>('POST', `/api/v1/swaps/${id}/accept`, { acknowledge_rule_violations: acknowledge }),
  approveSwap: ({ id, acknowledge }: { id: string; acknowledge: boolean }) =>
    send<SwapRequest>('POST', `/api/v1/swaps/${id}/approve`, { acknowledge_rule_violations: acknowledge }),
  rejectSwap: ({ id, reason }: { id: string; reason: string }) =>
    send<SwapRequest>('POST', `/api/v1/swaps/${id}/reject`, { reason }),
  cancelSwap: ({ id, reason }: { id: string; reason: string }) =>
    send<SwapRequest>('POST', `/api/v1/swaps/${id}/cancel`, { reason }),
  createShareLink: (input: {
    label: string
    starts_on: string
    ends_on: string
    expires_days: number
  }) => send<ShareLinkCreated>('POST', '/api/v1/admin/share-links', input),
  shareLinks: () => request<ShareLink[]>('/api/v1/admin/share-links'),
  revokeShareLink: (id: string) => send<void>('DELETE', `/api/v1/admin/share-links/${id}`),
  createShareLinkFeed: (linkId: string) =>
    send<FeedTokenCreated>('POST', `/api/v1/admin/share-links/${linkId}/feed`),
  exchangeShare: (token: string) =>
    request<ShareExchangeResult>('/api/v1/share/exchange', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),
  createFeed: (label: string) => send<FeedTokenCreated>('POST', '/api/v1/calendar/feeds', { label }),
  feeds: () => request<FeedToken[]>('/api/v1/calendar/feeds'),
  revokeFeed: (id: string) => send<void>('DELETE', `/api/v1/calendar/feeds/${id}`),
  fairness: (asOf?: string) =>
    request<FairnessReport>(`/api/v1/fairness${asOf ? `?as_of=${asOf}` : ''}`),
  fairnessDuties: (memberId: string, asOf?: string) =>
    request<FairnessDuty[]>(
      `/api/v1/fairness/duties?member_id=${encodeURIComponent(memberId)}${asOf ? `&as_of=${asOf}` : ''}`,
    ),
  monthlyReport: async (month: string) => {
    const response = await fetch(
      `/api/v1/reports/monthly.csv?month=${encodeURIComponent(month)}`,
      { credentials: 'include', headers: languageHeader() },
    )
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null)
      throw parseError(body, response.status)
    }
    return response.blob()
  },
  monthlyReportPreview: (month: string) =>
    request<MonthlyReportPreview>(
      `/api/v1/reports/monthly?month=${encodeURIComponent(month)}`,
    ),
  adminUsers: () => request<AdminUser[]>('/api/v1/admin/users'),
  team: () => request<TeamMember[]>('/api/v1/team'),
  createAdminUser: (input: AdminUserInput) =>
    send<{ user: AdminUser; activation_url: string }>('POST', '/api/v1/admin/users', input),
  updateAdminUser: ({ id, input }: { id: string; input: AdminUserUpdate }) =>
    send<AdminUser>('PATCH', `/api/v1/admin/users/${id}`, input),
  deleteAdminUser: (id: string) => send<void>('DELETE', `/api/v1/admin/users/${id}`),
  issuePasswordReset: (id: string) =>
    send<{ url: string; expires_at: string }>('POST', `/api/v1/admin/users/${id}/reset`),
  reissueActivation: (id: string) =>
    send<{ url: string; expires_at: string }>('POST', `/api/v1/admin/users/${id}/activation`),
  createTeamMember: (input: { user_id: string; active_from: string }) =>
    send<TeamMember>('POST', '/api/v1/admin/team-members', input),
  updateTeamMember: ({ id, input }: {
    id: string; input: { active_from?: string; active_until?: string | null }
  }) => send<TeamMember>('PATCH', `/api/v1/admin/team-members/${id}`, input),
  createEligibility: ({ memberId, input }: {
    memberId: string
    input: { role: AssignmentRole; starts_on: string; ends_on: string | null }
  }) => send<Eligibility>('POST', `/api/v1/admin/team-members/${memberId}/eligibility`, input),
  updateEligibility: ({ id, input }: {
    id: string; input: { starts_on?: string; ends_on?: string | null }
  }) => send<Eligibility>('PATCH', `/api/v1/admin/eligibility/${id}`, input),
  deleteEligibility: (id: string) => send<void>('DELETE', `/api/v1/admin/eligibility/${id}`),
  activateAccount: (token: string, password: string) =>
    request<void>('/api/v1/auth/activate', {
      method: 'POST', body: JSON.stringify({ token, password }),
    }),
  resetPassword: (token: string, password: string) =>
    request<void>('/api/v1/auth/reset', {
      method: 'POST', body: JSON.stringify({ token, password }),
    }),
  passwordTokenInfo: (token: string, kind: 'activation' | 'password_reset') =>
    request<AccountTokenInfo>(
      `/api/v1/auth/password-token?token=${encodeURIComponent(token)}&kind=${kind}`,
    ),
  auditEvents: (params: {
    action?: string; actor?: string; q?: string; starts_on?: string; ends_on?: string
    include_logins?: boolean; limit?: number; offset?: number
  }) => {
    const search = new URLSearchParams()
    if (params.action) search.set('action', params.action)
    if (params.actor) search.set('actor', params.actor)
    if (params.q) search.set('q', params.q)
    if (params.starts_on) search.set('starts_on', params.starts_on)
    if (params.ends_on) search.set('ends_on', params.ends_on)
    if (params.include_logins) search.set('include_logins', 'true')
    search.set('limit', String(params.limit ?? 100))
    search.set('offset', String(params.offset ?? 0))
    return request<AuditEvent[]>(`/api/v1/admin/audit?${search}`)
  },
}
