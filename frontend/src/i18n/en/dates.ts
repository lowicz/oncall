import type { Messages } from '../pl'
import { pluralEn } from '../../lib/plural'

export const dates: Messages['dates'] = {
  weekdaysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  weekdaysLong: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  monthsShort: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  monthsInDate: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  today: 'today',
  tomorrow: 'tomorrow',
  yesterday: 'yesterday',
  inDays: (days: number) => `in ${days} days`,
  daysAgo: (days: number) => `${days} days ago`,
  weeks: (count: number) => pluralEn(count, ['week', 'weeks']),
}
