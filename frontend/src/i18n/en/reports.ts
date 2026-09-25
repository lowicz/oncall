import type { Messages } from '../pl'

export const reports: Messages['reports'] = {
  title: 'Monthly report',
  subtitle: 'A CSV for HR: ordinary workdays, weekends and holidays separately for each person, with points (1X/2X). A holiday on a Saturday or Sunday counts as a weekend.',
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
    oncallTotal: 'On-call total',
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
