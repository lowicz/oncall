/**
 * The Polish interface, locked screen by screen.
 *
 * Every case renders one screen in a representative state with the API
 * stubbed, waits for its data, and compares the whole document against a
 * committed HTML file under `__snapshots__/polish/`. The files were written
 * before the interface learned English, so a diff in one of them is a change
 * to what a Polish reader sees: every wording, label, hint and title has to
 * stay exactly as it was. A change that is intended (a new control, a new
 * wording) updates the file with `npx vitest -u` and shows up in review as
 * the diff of that file.
 *
 * The clock is the suite's fixed instant (src/test/setup.ts, 2026-09-10) and
 * every fixture is a concrete date, so the pages render the same bytes on
 * every run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderScreen } from './render'
import { api } from '../api'
import type {
  AdminUser,
  AuditEvent,
  AvailabilityEntry,
  CalendarData,
  DraftSchedule,
  FairnessMember,
  FairnessReport,
  PublishedSchedule,
  ScheduleSummary,
  SwapRequest,
  TeamMember,
} from '../api'
import { Login } from '../screens/Login'
import { SetPassword } from '../screens/SetPassword'
import { ShareExchange } from '../screens/ShareExchange'
import { AppShell } from '../components/AppShell'
import { DutyScreen } from '../screens/Duty'
import { ScheduleScreen } from '../screens/Schedule'
import { MineScreen } from '../screens/Mine'
import { SwapPanel } from '../screens/Swaps'
import { FairnessPanel } from '../screens/Fairness'
import { GeneratorPanel } from '../screens/Generator'
import { PeoplePanel } from '../screens/admin/People'
import { MonthlyReportsPanel } from '../screens/admin/Reports'
import { ShareLinksPanel } from '../screens/admin/ShareLinks'
import { CalendarEventsPanel } from '../screens/admin/CalendarEvents'
import { HistoryImportPanel } from '../screens/admin/HistoryImport'
import { AuditPanel } from '../screens/admin/Audit'
import { MoreScreen } from '../screens/More'
import { ErrorBoundary } from '../components/ErrorBoundary'

const TODAY = '2026-09-10'

/**
 * The document as rendered, including everything Base UI portals to <body>.
 * The generated element ids (`_r_2r_`) count up across the whole run, so they
 * are the one thing normalised away; what is left is the markup and the words.
 */
const snapshotOf = (name: string) =>
  expect(document.body.innerHTML.replace(/_r_[0-9a-z]+_/g, '_r_x_'))
    .toMatchFileSnapshot(`__snapshots__/polish/${name}.html`)

const balance = (actual: number, expected: number) => ({ actual, expected, deviation: actual - expected })

const member = (id: string, name: string, over: Partial<FairnessMember> = {}): FairnessMember => ({
  member_id: id,
  display_name: name,
  active_from: '2025-01-01',
  eligible_days: { primary: 40, secondary: 40, late_shift: 30, weekends: 12, holidays: 2 },
  primary: balance(4, 3.5),
  secondary: balance(3, 3),
  late_shift: balance(2, 2.5),
  weekends: balance(2, 1.5),
  holidays: balance(0, 0.5),
  total_points: 11,
  ...over,
})

const report = (over: Partial<FairnessReport> = {}): FairnessReport => ({
  as_of: TODAY,
  window_start: '2025-09-10',
  window_end: TODAY,
  totals: { primary_points: 14, secondary_points: 9, late_shift_count: 6, weekend_duties: 4, holiday_duties: 1 },
  members: [
    member('m1', 'Anna Kowalska'),
    member('m2', 'Marek Nowak', { primary: balance(2, 3.5), total_points: 7 }),
    member('m3', 'Ola Wiśniewska', { late_shift: balance(4, 2.5), total_points: 13 }),
  ],
  late_shift_balanced: true,
  criterion_points: 3,
  criterion_met: false,
  spreads: [
    { lens: 'primary', spread: 2, meets_criterion: true },
    { lens: 'secondary', spread: 0.5, meets_criterion: true },
    { lens: 'late_shift', spread: 3.5, meets_criterion: false },
    { lens: 'weekends', spread: 1, meets_criterion: true },
    { lens: 'holidays', spread: 0.5, meets_criterion: true },
  ],
  outliers: [
    {
      lens: 'late_shift',
      highest: { member_id: 'm3', display_name: 'Ola Wiśniewska', deviation: 1.5 },
      lowest: { member_id: 'm1', display_name: 'Anna Kowalska', deviation: -0.5 },
    },
  ],
  latest_publish_end: '2026-10-03',
  ...over,
})

const publication = (over: Partial<PublishedSchedule> = {}): PublishedSchedule => ({
  generated_at: '2026-09-01T10:00:00Z',
  is_published: true,
  id: 's1',
  version: 7,
  starts_on: '2026-09-01',
  ends_on: '2026-10-03',
  assignments: [
    { service_date: TODAY, role: 'primary', assignee_name: 'Anna Kowalska', is_override: false },
    { service_date: TODAY, role: 'secondary', assignee_name: 'Marek Nowak', is_override: true },
    { service_date: TODAY, role: 'late_shift', assignee_name: 'Marek Nowak', is_override: false },
    { service_date: '2026-09-12', role: 'primary', assignee_name: 'Ola Wiśniewska', is_override: false },
    { service_date: '2026-09-24', role: 'primary', assignee_name: 'Anna Kowalska', is_override: false },
  ],
  current: [
    {
      role: 'primary', service_date: TODAY, assignee_name: 'Anna Kowalska', member_id: 'm1',
      contact_email: 'anna@example.com', contact_phone: '+48 601 220 118',
      coverage_starts_at: '19:00', coverage_ends_at: '09:00', is_day_off: false, is_override: false,
      next_assignee_name: 'Marek Nowak', next_service_date: '2026-09-11',
    },
    {
      role: 'secondary', service_date: TODAY, assignee_name: 'Marek Nowak', member_id: 'm2',
      contact_email: 'marek@example.com', contact_phone: null,
      coverage_starts_at: '19:00', coverage_ends_at: '09:00', is_day_off: false, is_override: true,
      next_assignee_name: 'Ola Wiśniewska', next_service_date: '2026-09-11',
    },
    {
      role: 'late_shift', service_date: TODAY, assignee_name: 'Marek Nowak', member_id: 'm2',
      contact_email: 'marek@example.com', contact_phone: null,
      coverage_starts_at: '11:00', coverage_ends_at: '19:00', is_day_off: false, is_override: false,
      next_assignee_name: null, next_service_date: null,
    },
  ],
  today_is_day_off: false,
  today_holiday_name: null,
  ...over,
})

const calendarDays = (startsOn: string, endsOn: string): CalendarData['days'] => {
  const days: CalendarData['days'] = []
  for (let cursor = new Date(`${startsOn}T12:00:00Z`); cursor.toISOString().slice(0, 10) <= endsOn; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const serviceDate = cursor.toISOString().slice(0, 10)
    const weekday = ['niedz', 'pon', 'wt', 'śr', 'czw', 'pt', 'sob'][cursor.getUTCDay()]
    const holiday = serviceDate === '2026-11-11' ? 'Narodowe Święto Niepodległości' : null
    days.push({
      service_date: serviceDate,
      weekday,
      is_day_off: holiday !== null || cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6,
      holiday_name: holiday,
      published: serviceDate <= '2026-10-03',
      events: serviceDate === '2026-09-15' ? [{ id: 'e1', title: 'Szkolenie BHP', color: 'blue' }] : [],
    })
  }
  return days
}

const calendar = (startsOn: string, endsOn: string): CalendarData => ({
  starts_on: startsOn,
  ends_on: endsOn,
  days: calendarDays(startsOn, endsOn),
  members: [
    { id: 'm1', display_name: 'Anna Kowalska', active_from: '2025-01-01', active_until: null, eligibility: [{ role: 'primary', starts_on: '2025-01-01', ends_on: null }, { role: 'secondary', starts_on: '2025-01-01', ends_on: null }] },
    { id: 'm2', display_name: 'Marek Nowak', active_from: '2025-01-01', active_until: null, eligibility: [{ role: 'primary', starts_on: '2025-01-01', ends_on: null }, { role: 'late_shift', starts_on: '2025-01-01', ends_on: null }] },
    { id: 'm3', display_name: 'Ola Wiśniewska', active_from: '2025-01-01', active_until: '2026-12-31', eligibility: [{ role: 'secondary', starts_on: '2025-01-01', ends_on: null }] },
  ],
  team_has_members: true,
  assignments: [
    { service_date: TODAY, role: 'primary', assignee_name: 'Anna Kowalska', is_override: false, schedule_id: 's1', schedule_version: 7, member_id: 'm1', change_kind: null },
    { service_date: TODAY, role: 'secondary', assignee_name: 'Marek Nowak', is_override: true, schedule_id: 's1', schedule_version: 7, member_id: 'm2', change_kind: 'manual_override' },
    { service_date: TODAY, role: 'late_shift', assignee_name: 'Marek Nowak', is_override: false, schedule_id: 's1', schedule_version: 7, member_id: 'm2', change_kind: null },
    { service_date: '2026-09-11', role: 'primary', assignee_name: 'Ola Wiśniewska', is_override: true, schedule_id: 's1', schedule_version: 7, member_id: 'm3', change_kind: 'swap' },
    { service_date: '2026-09-11', role: 'secondary', assignee_name: 'Anna Kowalska', is_override: false, schedule_id: 's1', schedule_version: 7, member_id: 'm1', change_kind: null },
    { service_date: '2026-09-12', role: 'primary', assignee_name: 'Ola Wiśniewska', is_override: false, schedule_id: 's1', schedule_version: 7, member_id: 'm3', change_kind: null },
  ],
  availability: [
    { member_id: 'm3', kind: 'unavailable', starts_on: '2026-09-14', ends_on: '2026-09-16', note: 'urlop' },
    { member_id: 'm2', kind: 'prefer_not', starts_on: '2026-09-13', ends_on: '2026-09-13', note: null },
    { member_id: 'm1', kind: 'prefer', starts_on: '2026-09-19', ends_on: '2026-09-20', note: null },
  ],
})

const swap = (over: Partial<SwapRequest> & { id: string }): SwapRequest => ({
  schedule_id: 's1',
  service_date: '2026-09-28',
  role: 'primary',
  requester_name: 'Anna Kowalska',
  replacement_name: 'Marek Nowak',
  status: 'pending_replacement',
  note: null,
  decision_note: null,
  created_at: '2026-09-01T10:00:00Z',
  ...over,
})

const SWAPS: SwapRequest[] = [
  swap({ id: 'w1', note: 'Wesele siostry' }),
  swap({ id: 'w2', service_date: '2026-09-21', role: 'secondary', requester_name: 'Marek Nowak', replacement_name: 'Anna Kowalska', status: 'pending_coordinator' }),
  swap({ id: 'w3', service_date: '2026-09-05', role: 'late_shift', status: 'approved', decision_note: 'OK', requester_name: 'Ola Wiśniewska', replacement_name: 'Anna Kowalska' }),
  swap({ id: 'w4', service_date: '2026-09-03', status: 'rejected', decision_note: 'Za dużo dyżurów pod rząd', requester_name: 'Anna Kowalska', replacement_name: 'Ola Wiśniewska' }),
  swap({ id: 'w5', service_date: '2026-09-02', status: 'cancelled' }),
]

const AVAILABILITY: AvailabilityEntry[] = [
  { id: 'a1', kind: 'unavailable', starts_on: '2026-09-14', ends_on: '2026-09-16', note: 'urlop', created_at: '2026-09-01T10:00:00Z', warning: null, created_by_name: null },
  { id: 'a2', kind: 'prefer_not', starts_on: '2026-09-26', ends_on: '2026-09-27', note: null, created_at: '2026-09-02T10:00:00Z', warning: 'Masz w tym czasie dyżur. Zgłoszenie go nie zdejmuje, poproś o zamianę albo skontaktuj się z koordynatorem.', created_by_name: null },
  { id: 'a3', kind: 'prefer', starts_on: '2026-10-01', ends_on: '2026-10-02', note: null, created_at: '2026-09-03T10:00:00Z', warning: null, created_by_name: 'Ewa Maj' },
]

const TEAM: TeamMember[] = [
  { id: 'm1', user_id: 'u1', display_name: 'Anna Kowalska', active_from: '2025-01-01', active_until: null, eligibility: [{ id: 'e1', role: 'primary', starts_on: '2025-01-01', ends_on: null }, { id: 'e2', role: 'secondary', starts_on: '2025-01-01', ends_on: null }] },
  { id: 'm2', user_id: 'u2', display_name: 'Marek Nowak', active_from: '2025-01-01', active_until: null, eligibility: [{ id: 'e3', role: 'primary', starts_on: '2025-01-01', ends_on: null }, { id: 'e4', role: 'late_shift', starts_on: '2025-01-01', ends_on: null }] },
  { id: 'm3', user_id: 'u3', display_name: 'Ola Wiśniewska', active_from: '2025-01-01', active_until: '2026-12-31', eligibility: [{ id: 'e5', role: 'secondary', starts_on: '2025-01-01', ends_on: '2026-12-31' }] },
]

const user = (over: Partial<AdminUser> & { id: string }): AdminUser => ({
  username: 'anna', personnel_number: '004512', first_name: 'Anna', last_name: 'Kowalska',
  display_name: 'Anna Kowalska', auth_source: 'local', role: 'member',
  email: 'anna@example.com', phone: '+48 601 220 118', is_active: true, created_at: '2025-09-02T10:00:00Z',
  pending_activation: null, ...over,
})

const USERS: AdminUser[] = [
  user({ id: 'u1' }),
  user({ id: 'u2', username: 'marek', personnel_number: '004513', first_name: 'Marek', last_name: 'Nowak', display_name: 'Marek Nowak', email: 'marek@example.com', phone: null, auth_source: 'ldap', role: 'coordinator' }),
  user({ id: 'u3', username: 'ola', personnel_number: null, first_name: 'Ola', last_name: 'Wiśniewska', display_name: 'Ola Wiśniewska', email: null, phone: null, is_active: false }),
  user({ id: 'u4', username: 'admin', personnel_number: null, first_name: 'Ewa', last_name: 'Maj', display_name: 'Ewa Maj', email: 'ewa@example.com', role: 'admin', pending_activation: { link_expires_at: '2026-09-12T10:00:00Z' } }),
  user({ id: 'u5', username: 'dyspozytornia', personnel_number: null, first_name: 'Service', last_name: 'Desk', display_name: 'Service Desk', email: null, role: 'viewer' }),
]

const summary = (over: Partial<ScheduleSummary> & { id: string }): ScheduleSummary => ({
  name: 'Szkic 2026-10-04',
  starts_on: '2026-10-04',
  ends_on: '2026-10-31',
  status: 'draft',
  version: 1,
  rotation_mode: 'hybrid',
  solver_status: 'OPTIMAL',
  assignment_count: 84,
  created_at: '2026-09-09T09:12:00Z',
  ...over,
})

const DRAFT: DraftSchedule = {
  id: 'd1',
  name: 'Szkic 2026-10-04',
  starts_on: '2026-10-04',
  ends_on: '2026-10-10',
  status: 'draft',
  version: 1,
  rotation_mode: 'hybrid',
  solver_status: 'OPTIMAL',
  acceptance_floor: 3,
  fairness_proven: true,
  continuity_gap: 1,
  assignments: [
    { service_date: '2026-10-04', role: 'primary', assignee_name: 'Anna Kowalska', is_override: false },
    { service_date: '2026-10-04', role: 'secondary', assignee_name: 'Marek Nowak', is_override: false },
    { service_date: '2026-10-05', role: 'primary', assignee_name: 'Anna Kowalska', is_override: false },
    { service_date: '2026-10-05', role: 'secondary', assignee_name: 'Marek Nowak', is_override: true },
    { service_date: '2026-10-05', role: 'late_shift', assignee_name: 'Marek Nowak', is_override: false },
    { service_date: '2026-10-06', role: 'primary', assignee_name: 'Ola Wiśniewska', is_override: false, rule_violations: [{ rule: 'three_in_seven', message: 'Więcej niż 3 dyżury on-call w okresie 7 dni.', member_name: 'Ola Wiśniewska', days: ['2026-10-06'] }] },
    { service_date: '2026-10-06', role: 'secondary', assignee_name: 'Anna Kowalska', is_override: false },
  ],
  warnings: [
    { source: 'solver', message: 'Ola Wiśniewska: Więcej niż 3 dyżury on-call w okresie 7 dni. Dni: 06-10-2026.' },
    { source: 'rules', message: 'Marek Nowak: Mniej niż 2 dni przerwy po serii dyżurów on-call. Dni: 05-10-2026.' },
  ],
  unavailability_conflicts: [{ service_date: '2026-10-06', role: 'primary', assignee_name: 'Ola Wiśniewska' }],
  uncovered_before: ['2026-10-02', '2026-10-03'],
  stale_changes_count: 1,
}

const AUDIT: AuditEvent[] = [
  { id: 'a1', occurred_at: '2026-09-09T07:12:00Z', actor_label: 'Ewa Maj', action: 'schedule.published', entity_type: 'schedule', entity_id: 's1', summary: 'Opublikowano grafik 01-09-2026 – 03-10-2026', details: { version: 7 } },
  { id: 'a2', occurred_at: '2026-09-08T15:40:00Z', actor_label: 'Marek Nowak', action: 'schedule.override', entity_type: 'schedule', entity_id: 's1', summary: 'Override 2026-09-10 · secondary: Anna Kowalska -> Marek Nowak', details: { reason: 'choroba' } },
  { id: 'a3', occurred_at: '2026-09-08T09:00:00Z', actor_label: 'Anna Kowalska', action: 'swap.created', entity_type: 'swap', entity_id: 'w1', summary: 'Zgłoszono zamianę 28-09-2026 primary', details: null },
  { id: 'a4', occurred_at: '2026-09-07T09:00:00Z', actor_label: 'system', action: 'auth.throttled', entity_type: null, entity_id: null, summary: 'Ograniczono liczbę prób logowania', details: { login: 'anna' } },
]

const CONFIG = { ldap_enabled: true, app_name: 'On-call', app_subtitle: 'Zespół infrastruktury', version: '1.4.0' }

/** Every query any screen makes, answered with the fixtures above. */
function stubApi() {
  vi.spyOn(api, 'publicConfig').mockResolvedValue(CONFIG)
  vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication())
  vi.spyOn(api, 'calendar').mockImplementation(async (a, b) => calendar(a, b))
  vi.spyOn(api, 'calendarEvents').mockResolvedValue([
    { id: 'e1', title: 'Szkolenie BHP', color: 'blue', starts_on: '2026-09-15', ends_on: '2026-09-15', created_at: '2026-09-01T10:00:00Z' },
    { id: 'e2', title: 'Przegląd serwerowni', color: 'amber', starts_on: '2026-09-24', ends_on: '2026-09-26', created_at: '2026-09-02T10:00:00Z' },
  ])
  vi.spyOn(api, 'swaps').mockResolvedValue(SWAPS)
  vi.spyOn(api, 'swapPolicy').mockResolvedValue({ coordinator_approval_required: true })
  vi.spyOn(api, 'availability').mockResolvedValue(AVAILABILITY)
  vi.spyOn(api, 'memberAvailability').mockResolvedValue(AVAILABILITY)
  vi.spyOn(api, 'team').mockResolvedValue(TEAM)
  vi.spyOn(api, 'feeds').mockResolvedValue([
    { id: 'f1', label: 'Telefon', created_at: '2026-08-01T10:00:00Z', last_used_at: '2026-09-09T06:00:00Z', revoked_at: null },
    { id: 'f2', label: 'Laptop', created_at: '2026-07-01T10:00:00Z', last_used_at: null, revoked_at: '2026-08-15T10:00:00Z' },
  ])
  vi.spyOn(api, 'fairness').mockResolvedValue(report())
  vi.spyOn(api, 'fairnessDuties').mockResolvedValue([
    { service_date: '2026-09-05', role: 'primary', points: 2, is_day_off: true },
    { service_date: '2026-08-12', role: 'secondary', points: 1, is_day_off: false },
    { service_date: '2026-08-03', role: 'late_shift', points: 0, is_day_off: false },
  ])
  vi.spyOn(api, 'draftSchedules').mockResolvedValue([
    summary({ id: 'd1' }),
    summary({ id: 'd2', name: 'Propozycja 2026-11-01', starts_on: '2026-11-01', ends_on: '2026-11-28', status: 'proposed', version: 3, rotation_mode: 'weekly', assignment_count: 82 }),
  ])
  vi.spyOn(api, 'activeRuns').mockResolvedValue([])
  vi.spyOn(api, 'schedulingPolicy').mockResolvedValue({
    rotation_mode: 'hybrid', fairness_weight: 3, continuity_weight: 1, preference_weight: 2,
    late_shift_anchor: 'secondary', solve_seconds: 15, time_budget_seconds: 60,
    coordinator_swap_approval_required: true, updated_at: '2026-09-01T10:00:00Z',
  })
  vi.spyOn(api, 'suggestedScheduleRange').mockResolvedValue({ first_uncovered: '2026-10-04', starts_on: '2026-10-04', ends_on: '2026-10-31' })
  vi.spyOn(api, 'schedule').mockResolvedValue(DRAFT)
  vi.spyOn(api, 'draftFairnessImpact').mockResolvedValue({
    schedule_id: 'd1', schedule_version: 1, baseline_as_of: TODAY, projected_as_of: '2026-10-10',
    baseline_members: report().members, projected_members: report().members,
    late_shift_balanced: true, criterion_points: 3, criterion_met: false,
    spreads: [
      { lens: 'primary', before: 2, after: 1.5, meets_criterion: true },
      { lens: 'late_shift', before: 3.5, after: 3, meets_criterion: false },
    ],
    acceptance_floor: 3,
  })
  vi.spyOn(api, 'adminUsers').mockResolvedValue(USERS)
  vi.spyOn(api, 'monthlyReportPreview').mockResolvedValue({
    month: '2026-09',
    days_in_month: 30,
    staffed_days: 30,
    rows: [
      { name: 'Anna Kowalska', primary_workdays: 5, primary_weekends: 2, primary_holidays: 1, secondary_workdays: 6, secondary_weekends: 2, secondary_holidays: 0, oncall_workdays: 11, oncall_weekends: 4, oncall_holidays: 1, oncall_days_off: 5, oncall_total: 16, late_shifts: 5, primary_points: 9.5, secondary_points: 10, total_points: 19.5 },
      { name: 'Marek Nowak', primary_workdays: 6, primary_weekends: 2, primary_holidays: 0, secondary_workdays: 5, secondary_weekends: 2, secondary_holidays: 1, oncall_workdays: 11, oncall_weekends: 4, oncall_holidays: 1, oncall_days_off: 5, oncall_total: 16, late_shifts: 4, primary_points: 11, secondary_points: 8.5, total_points: 19.5 },
    ],
  })
  vi.spyOn(api, 'shareLinks').mockResolvedValue([
    { id: 'l1', label: 'dyspozytornia', starts_on: '2026-09-14', ends_on: '2026-09-27', expires_at: '2026-12-31T00:00:00Z', created_at: '2026-09-01T10:00:00Z', used_at: '2026-09-02T08:00:00Z', revoked_at: null },
    { id: 'l2', label: 'audyt zewnętrzny', starts_on: '2026-08-01', ends_on: '2026-08-31', expires_at: '2026-09-01T00:00:00Z', created_at: '2026-07-20T10:00:00Z', used_at: null, revoked_at: '2026-08-10T10:00:00Z' },
  ])
  vi.spyOn(api, 'historyImports').mockResolvedValue([
    { id: 'h1', name: 'historia-2025.csv', starts_on: '2025-01-01', ends_on: '2025-12-31', rows: 1095, created_at: '2026-01-05T10:00:00Z' },
  ])
  vi.spyOn(api, 'previewHistory').mockResolvedValue({
    filename: 'historia.csv',
    valid: false,
    rows: [{ row_number: 2, service_date: '2026-01-02', role: 'primary', assignee_name: 'Anna Kowalska' }],
    errors: [
      { row_number: 3, field: 'assignee_name', message: 'Osoby nie ma w zespole' },
      { row_number: 4, field: 'role', message: 'Zmiana 11–19 może występować tylko w dni robocze' },
    ],
  })
  vi.spyOn(api, 'auditEvents').mockResolvedValue(AUDIT)
  vi.spyOn(api, 'passwordTokenInfo').mockResolvedValue({ username: 'marek', display_name: 'Marek Nowak' })
  vi.spyOn(api, 'exchangeShare').mockRejectedValue(new Error('Link wygasł lub został odwołany'))
}

const shell = (access: Parameters<typeof AppShell>[0]['access'], share: Parameters<typeof AppShell>[0]['share'] = null, route = '/') =>
  renderScreen(
    <Routes>
      <Route element={<AppShell displayName="Ewa Maj" access={access} share={share} />}>
        <Route path="*" element={<div>treść ekranu</div>} />
      </Route>
    </Routes>,
    { route },
  )

function pretendNarrow() {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: query.includes('max-width: 900px'),
    media: query, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }))
}

beforeEach(stubApi)
afterEach(() => vi.restoreAllMocks())

describe('the Polish interface', () => {
  it('login', async () => {
    renderScreen(<Login />)
    await screen.findByText(/Masz konto firmowe/)
    snapshotOf('login')
  })

  it('login after the session ended', async () => {
    renderScreen(<Login expired />)
    await screen.findByText(/Masz konto firmowe/)
    snapshotOf('login-expired')
  })

  it('account activation', async () => {
    renderScreen(<SetPassword mode="activate" />, { route: '/activate?token=one-time-token-value' })
    await screen.findByText(/Ustawiasz hasło dla/)
    snapshotOf('set-password-activate')
  })

  it('password reset', async () => {
    renderScreen(<SetPassword mode="reset" />, { route: '/reset?token=one-time-token-value' })
    await screen.findByText(/Ustawiasz hasło dla/)
    snapshotOf('set-password-reset')
  })

  it('a share link that no longer works', async () => {
    renderScreen(
      <Routes><Route path="/share/:token" element={<ShareExchange />} /></Routes>,
      { route: '/share/expired-token' },
    )
    await screen.findByText(/Link mógł wygasnąć/)
    snapshotOf('share-exchange-failed')
  })

  it('shell of an administrator with the account menu open', async () => {
    shell({ role: 'admin', hasTeamMember: true })
    await screen.findByText('Wersja 1.4.0')
    await screen.findByText('Anna Kowalska', { exact: false })
    fireEvent.click(screen.getByRole('button', { name: 'Konto: Ewa Maj' }))
    await screen.findByRole('menu')
    snapshotOf('shell-admin-account-menu')
  })

  it('shell of a coordinator with the command palette open', async () => {
    shell({ role: 'coordinator', hasTeamMember: true })
    await screen.findByText('Wersja 1.4.0')
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    await screen.findByRole('dialog')
    snapshotOf('shell-coordinator-command-palette')
  })

  it('shell of a member on a phone', async () => {
    pretendNarrow()
    shell({ role: 'member', hasTeamMember: true })
    await screen.findByText('Więcej')
    snapshotOf('shell-member-phone')
  })

  it('shell of a share-link session', async () => {
    shell({ role: 'viewer', hasTeamMember: false }, { label: 'dyspozytornia', starts_on: '2026-09-14', ends_on: '2026-09-27', expires_at: '2026-12-31T00:00:00Z' })
    await screen.findByText('Podgląd')
    snapshotOf('shell-share-session')
  })

  it('dashboard of a viewer', async () => {
    renderScreen(<DutyScreen role="viewer" displayName="Service Desk" hasTeamMember={false} />)
    await screen.findByRole('heading', { level: 1, name: 'Czwartek, 10 września' })
    await screen.findByText('Anna Kowalska', { exact: false })
    snapshotOf('duty-viewer')
  })

  it('dashboard of a coordinator on a day off', async () => {
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication({ today_is_day_off: true, today_holiday_name: 'Narodowe Święto Niepodległości' }))
    renderScreen(<DutyScreen role="coordinator" displayName="Ewa Maj" hasTeamMember />)
    await screen.findByRole('heading', { level: 1, name: 'Czwartek, 10 września' })
    await screen.findByText('Anna Kowalska', { exact: false })
    await waitFor(() => expect(api.fairness).toHaveBeenCalled())
    snapshotOf('duty-coordinator-day-off')
  })

  it('schedule of a coordinator', async () => {
    renderScreen(
      <Routes><Route path="/grafik" element={<ScheduleScreen role="coordinator" displayName="Ewa Maj" hasTeamMember />} /></Routes>,
      { route: '/grafik' },
    )
    await screen.findByText('Ola Wiśniewska', { exact: false })
    await waitFor(() => expect(api.draftSchedules).toHaveBeenCalled())
    snapshotOf('schedule-coordinator')
  })

  it('schedule of a member as a list', async () => {
    pretendNarrow()
    renderScreen(
      <Routes><Route path="/grafik" element={<ScheduleScreen role="member" displayName="Anna Kowalska" hasTeamMember />} /></Routes>,
      { route: '/grafik' },
    )
    await screen.findAllByText('Ola Wiśniewska', { exact: false })
    snapshotOf('schedule-member-phone')
  })

  it('my duties and availability of a member', async () => {
    renderScreen(<MineScreen role="member" hasTeamMember displayName="Anna Kowalska" />)
    await screen.findByText('Najbliższe dyżury')
    for (const call of [api.availability, api.fairnessDuties, api.calendar, api.swaps]) {
      await waitFor(() => expect(call).toHaveBeenCalled())
    }
    snapshotOf('mine-member')
  })

  it('availability filed by a coordinator on behalf of someone', async () => {
    renderScreen(<MineScreen role="coordinator" hasTeamMember displayName="Ewa Maj" />)
    await screen.findByText('Najbliższe dyżury')
    for (const call of [api.team, api.availability, api.calendar, api.swaps]) {
      await waitFor(() => expect(call).toHaveBeenCalled())
    }
    snapshotOf('mine-coordinator')
  })

  it('swaps of a member', async () => {
    renderScreen(<SwapPanel displayName="Marek Nowak" role="member" hasTeamMember />)
    await screen.findAllByText(/Anna Kowalska/)
    await waitFor(() => expect(api.swapPolicy).toHaveBeenCalled())
    snapshotOf('swaps-member')
  })

  it('swaps of a coordinator', async () => {
    renderScreen(<SwapPanel displayName="Ewa Maj" role="coordinator" hasTeamMember />)
    await screen.findAllByText(/Anna Kowalska/)
    await waitFor(() => expect(api.swapPolicy).toHaveBeenCalled())
    snapshotOf('swaps-coordinator')
  })

  it('fairness', async () => {
    renderScreen(<FairnessPanel />)
    // The screen moves its "as of" date to the end of the publication and
    // reads the report again, so the settled state is the second answer.
    await waitFor(() => expect(api.fairness).toHaveBeenCalledWith('2026-10-03'))
    await screen.findByText('niespełnione')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Eksport CSV' })).toBeEnabled())
    snapshotOf('fairness')
  })

  it('generator with the list of drafts', async () => {
    renderScreen(<GeneratorPanel />)
    await screen.findByText('Propozycja 2026-11-01', { exact: false })
    await waitFor(() => expect(document.querySelector('#generator-from')).toHaveValue('2026-10-04'))
    snapshotOf('generator-list')
  })

  it('generator with no drafts', async () => {
    vi.spyOn(api, 'draftSchedules').mockResolvedValue([])
    renderScreen(<GeneratorPanel />)
    await screen.findByText(/Brak szkiców/)
    await waitFor(() => expect(document.querySelector('#generator-from')).toHaveValue('2026-10-04'))
    snapshotOf('generator-empty')
  })

  it('generator with an open draft', async () => {
    renderScreen(<GeneratorPanel />, { route: '/generator?szkic=d1' })
    await screen.findByText('CP-SAT: OPTIMAL')
    await screen.findAllByText('Ola Wiśniewska', { exact: false })
    await waitFor(() => expect(api.draftFairnessImpact).toHaveBeenCalled())
    snapshotOf('generator-draft')
  })

  it('people', async () => {
    renderScreen(<PeoplePanel />)
    await screen.findByText('dyspozytornia', { selector: 'td' })
    snapshotOf('people')
  })

  it('monthly report', async () => {
    renderScreen(<MonthlyReportsPanel />)
    await screen.findByRole('table', { name: 'Raport za wrzesień 2026' })
    snapshotOf('reports')
  })

  it('share links', async () => {
    renderScreen(<ShareLinksPanel />)
    await screen.findByText('dyspozytornia', { exact: false })
    snapshotOf('share-links')
  })

  it('calendar events', async () => {
    renderScreen(<CalendarEventsPanel />)
    await screen.findByText('Przegląd serwerowni', { exact: false })
    snapshotOf('calendar-events')
  })

  it('history import with a rejected file', async () => {
    const { container } = renderScreen(<HistoryImportPanel />)
    await screen.findByText('historia-2025.csv', { exact: false })
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['service_date,role,assignee_name'], 'historia.csv', { type: 'text/csv' })] } })
    await screen.findByText(/popraw plik i wgraj go ponownie/)
    snapshotOf('history-import')
  })

  it('audit', async () => {
    renderScreen(<AuditPanel />)
    await screen.findByText('Ograniczono liczbę prób logowania', { exact: false })
    snapshotOf('audit')
  })

  it('more, on a phone', async () => {
    renderScreen(<MoreScreen displayName="Ewa Maj" access={{ role: 'admin', hasTeamMember: true }} />)
    await screen.findByText('1.4.0')
    snapshotOf('more-admin')
  })

  it('a screen that crashed', () => {
    const Broken = () => {
      throw new Error('boom')
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    renderScreen(<ErrorBoundary><Broken /></ErrorBoundary>)
    snapshotOf('error-boundary')
  })
})
