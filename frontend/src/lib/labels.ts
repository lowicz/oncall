import { AssignmentRole, AvailabilityKind, DraftSchedule, LateShiftAnchor, RotationMode, SwapStatus } from '../api'
import { messages } from '../i18n/messages'
import { formatDay } from './dates'

/**
 * Names of the domain's codes in the current language. Each helper reads the
 * catalog when called, so a screen that re-renders on a language change
 * gets the new words without holding on to a stale table.
 */
export const roleLabels = (): Record<AssignmentRole, string> => messages().labels.roles

/** Labels of the fairness lenses, including the two non-role ones. */
export const lensLabels = (): Record<string, string> => messages().labels.lenses

export const availabilityLabels = (): Record<AvailabilityKind, string> => messages().labels.availability

export const rotationLabels = (): Record<RotationMode, string> => messages().labels.rotation

export const lateShiftAnchorLabels = (): Record<LateShiftAnchor, string> => messages().labels.lateShiftAnchor

export const swapStatusLabels = (): Record<SwapStatus, string> => messages().labels.swapStatus

export const shortRoleLabels = (): Record<AssignmentRole, string> => messages().labels.shortRoles

export function cellLabel(
  memberName: string,
  day: {
    service_date: string
    is_day_off: boolean
    holiday_name: string | null
    events?: Array<{ title: string }>
  },
  duties: string[],
  availability?: AvailabilityKind,
) {
  const t = messages().labels
  const parts = [memberName, formatDay(day.service_date)]
  if (day.is_day_off) parts.push(day.holiday_name ?? t.cell.dayOffRate)
  if (day.events?.length) parts.push(t.cell.events(day.events.map((event) => event.title).join(', ')))
  parts.push(duties.length > 0 ? duties.join(', ') : t.cell.noDuty)
  if (availability) parts.push(t.availability[availability])
  return parts.join(', ')
}

export const scheduleStatusLabels = (): Record<DraftSchedule['status'], string> => messages().labels.scheduleStatus

/** Readable names for the audit trail's action codes. An action outside the
 *  map still shows its raw code rather than nothing. */
export const auditActionLabel = (action: string): string =>
  (messages().labels.auditActions as Record<string, string>)[action] ?? action

/** The audit trail persists a few summaries with an English word or a raw role
 *  code baked in (`schedule.override`'s "Override …: primary" style text);
 *  this only cleans up what is rendered, the stored history is unchanged. */
export function humanizeAuditSummary(summary: string): string {
  const t = messages().labels
  return summary
    .replace(/\bOverride\b/g, t.overrideWord)
    .replace(/\bprimary\b/g, t.roles.primary)
    .replace(/\bsecondary\b/g, t.roles.secondary)
    .replace(/\blate_shift\b/g, t.roles.late_shift)
}
