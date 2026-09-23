import { AssignmentRole, AvailabilityKind, DraftSchedule, LateShiftAnchor, RotationMode } from '../api'
import { formatDay } from './dates'

export const roleLabels: Record<AssignmentRole, string> = {
  primary: 'PRIMARY',
  secondary: 'SECONDARY',
  late_shift: '11–19',
}

/** Polish labels of the fairness lenses, including the two non-role ones. */
export const lensLabels: Record<string, string> = {
  primary: 'PRIMARY',
  secondary: 'SECONDARY',
  late_shift: '11–19',
  weekends: 'Weekendy',
  holidays: 'Święta',
}

export const availabilityLabels: Record<AvailabilityKind, string> = {
  unavailable: 'Nie mogę',
  prefer_not: 'Wolę nie',
  prefer: 'Chętnie wezmę',
}

export const rotationLabels: Record<RotationMode, string> = {
  hybrid: 'Hybrydowy',
  daily: 'Dzienny',
  weekly: 'Tygodniowy',
}

export const lateShiftAnchorLabels: Record<LateShiftAnchor, string> = {
  secondary: 'Ta sama osoba co SECONDARY',
  primary: 'Ta sama osoba co PRIMARY',
  independent: 'Niezależnie od on-call',
}

export const swapStatusLabels = {
  pending_replacement: 'Oczekuje na zastępcę',
  pending_coordinator: 'Oczekuje na koordynatora',
  approved: 'Zatwierdzona',
  rejected: 'Odrzucona',
  cancelled: 'Wycofana',
}

export const shortRoleLabels: Record<AssignmentRole, string> = {
  primary: 'P',
  secondary: 'S',
  late_shift: '11–19',
}

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
  const parts = [memberName, formatDay(day.service_date)]
  if (day.is_day_off) parts.push(day.holiday_name ?? 'dzień wolny, stawka 2X')
  if (day.events?.length) parts.push(`wydarzenia: ${day.events.map((event) => event.title).join(', ')}`)
  parts.push(duties.length > 0 ? duties.join(', ') : 'brak dyżuru')
  if (availability) parts.push(availabilityLabels[availability])
  return parts.join(', ')
}

export const scheduleStatusLabels: Record<DraftSchedule['status'], string> = {
  draft: 'Szkic',
  proposed: 'Do akceptacji',
  published: 'Opublikowany',
  superseded: 'Zastąpiony',
}

/** Readable names for the audit trail's action codes (QA7-L16). An action
 *  outside this map still shows its raw code rather than nothing. */
export const auditActionLabels: Record<string, string> = {
  'auth.login': 'Logowanie',
  'auth.login_failed': 'Nieudane logowanie',
  'availability.created': 'Zgłoszono dostępność',
  'availability.deleted': 'Usunięto dostępność',
  'swap.created': 'Zgłoszono zamianę',
  'swap.accepted': 'Zaakceptowano zamianę',
  'swap.rejected': 'Odrzucono zamianę',
  'swap.cancelled': 'Wycofano zamianę',
  'swap.approved': 'Zatwierdzono zamianę',
  'schedule.generated': 'Wygenerowano szkic',
  'schedule.proposed': 'Przekazano do akceptacji',
  'schedule.published': 'Opublikowano grafik',
  'schedule.override': 'Korekta grafiku',
  'schedule.deleted': 'Usunięto grafik',
  'policy.updated': 'Zmieniono politykę',
  'history.imported': 'Zaimportowano historię',
  'share_link.created': 'Utworzono link udostępnienia',
  'share_link.revoked': 'Odwołano link udostępnienia',
  'share_link.exchanged': 'Wymieniono link udostępnienia',
  'feed.created': 'Utworzono kanał',
  'feed.revoked': 'Odwołano kanał',
  'admin.user_created': 'Utworzono konto',
  'admin.user_updated': 'Zmieniono konto',
  'admin.user_deleted': 'Usunięto konto',
  'admin.password_reset_issued': 'Wygenerowano reset hasła',
  'admin.activation_link_issued': 'Wygenerowano link aktywacyjny',
  'admin.team_member_created': 'Dodano do rotacji',
  'admin.team_member_updated': 'Zmieniono rotację',
  'admin.eligibility_created': 'Dodano eligibility',
  'admin.eligibility_updated': 'Zmieniono eligibility',
  'admin.eligibility_deleted': 'Usunięto eligibility',
  'auth.login_attempt': 'Próba logowania',
  'auth.throttled': 'Zablokowano logowanie (zbyt wiele prób)',
  'auth.ldap_linked': 'Powiązano z LDAP',
  'auth.ldap_provisioned': 'Utworzono konto z LDAP',
  'auth.ldap_synced': 'Zsynchronizowano z LDAP',
  'auth.ldap_unavailable': 'LDAP niedostępny',
  'auth.ldap_identity_conflict': 'Konflikt tożsamości LDAP',
  'availability.created_on_behalf': 'Zgłoszono dostępność (w imieniu)',
  'availability.deleted_on_behalf': 'Usunięto dostępność (w imieniu)',
  'calendar.event_created': 'Utworzono wydarzenie',
  'calendar.event_updated': 'Zmieniono wydarzenie',
  'calendar.event_deleted': 'Usunięto wydarzenie',
  'schedule.draft_override': 'Korekta szkicu',
  'schedule.override_batch': 'Wsadowa korekta grafiku',
  'schedule.override_carried': 'Przeniesiono korektę',
  'schedule.withdrawn': 'Cofnięto do szkicu',
}

/** The audit trail persists a few summaries with an English word or a raw role
 *  code baked in (`schedule.override`'s "Override …: primary" style text);
 *  this only cleans up what is rendered, the stored history is unchanged. */
export function humanizeAuditSummary(summary: string): string {
  return summary
    .replace(/\bOverride\b/g, 'Korekta')
    .replace(/\bprimary\b/g, roleLabels.primary)
    .replace(/\bsecondary\b/g, roleLabels.secondary)
    .replace(/\blate_shift\b/g, roleLabels.late_shift)
}
