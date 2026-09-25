import type { Messages } from '../pl'

export const reports: Messages['reports'] = {
  title: 'Monthly report',
  subtitle: 'A CSV for HR: each person\'s duty days (primary and secondary together) on workdays and on weekends and holidays, with the split by role and the points (1X/2X). 11-19 shifts are not duty days; a holiday on a Saturday or Sunday counts as a weekend.',
  month: 'Report month',
  preparing: 'Preparing…',
  downloadCsv: 'Download CSV',
  downloaded: 'The report has been downloaded.',
  fileName: (month: string) => `oncall-${month}.csv`,
  loadingPreview: 'Loading preview',
  noPublishedDuties: 'The selected month has no published duties.',
  partialCoverage: (staffedDays: number, daysInMonth: number) =>
    `The published schedule covers ${staffedDays} of the ${daysInMonth} days of this month.`,
  partialCoverageNote: 'The report counts only fully staffed days.',
  tableName: (month: string) => `Report for ${month}`,
  scrollHint: 'The table is wider than the screen - scroll it sideways to see all the columns, including the points.',
  columns: {
    person: 'Person',
    dutyDays: 'Duty days',
    dutyDaysNote: 'primary + secondary',
    daysOff: 'weekends and holidays',
    dutyTotal: 'total',
    points: 'Points',
    workdays: 'workdays',
    weekends: 'weekends',
    holidays: 'holidays',
    pointsPrimary: 'primary',
    pointsSecondary: 'secondary',
    pointsTotal: 'total',
    total: 'Total',
  },
}
