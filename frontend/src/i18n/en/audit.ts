import type { Messages } from '../pl'
import { pluralEn } from '../../lib/plural'

export const audit: Messages['audit'] = {
  title: 'Audit',
  subtitle: 'Significant operations recorded by the system, newest first. Times in the Europe/Warsaw zone.',
  exportCsv: 'Export CSV',
  csv: {
    fileName: 'audit.csv',
    columns: {
      occurredAt: 'time_utc',
      action: 'action',
      actor: 'actor',
      summary: 'summary',
      details: 'details',
    },
  },
  filters: {
    title: 'Audit filters',
    action: 'Action',
    allActions: 'All',
    person: 'Person',
    search: 'Search',
    from: 'From',
    to: 'To',
    showRoutineLogins: 'Show routine sign-ins',
  },
  routineLoginsHidden: 'Routine sign-ins are hidden in this view. Turn on “Show routine sign-ins” to include them in the results.',
  empty: 'No events for the selected filter',
  emptyLogins: (label: string) => `There are no “${label}” events in the selected range. Change the date range or the other filters.`,
  emptyHint: 'Change or clear the filters to see more events.',
  details: 'Details',
  loading: 'Loading events',
  loadMore: 'Load more',
  retention: (auditDays: number, loginDays: number) => {
    const entries = auditDays > 0
      ? `Entries older than ${pluralEn(auditDays, ['day', 'days'])} are removed automatically`
      : 'Entries are kept indefinitely'
    const logins = loginDays > 0
      ? `routine sign-ins are removed after ${pluralEn(loginDays, ['day', 'days'])}`
      : 'routine sign-ins are kept indefinitely'
    return `${entries}, ${logins}. Schedule corrections are kept indefinitely.`
  },
}
