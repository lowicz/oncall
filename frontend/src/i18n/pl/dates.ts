import { pluralPl } from '../../lib/plural'

/** Names of days and months, and the few words `src/lib/dates.ts` needs. */
export const dates = {
  /** Sunday first, like `Date.getDay()`; the same words the API sends as a day's `weekday`. */
  weekdaysShort: ['niedz', 'pon', 'wt', 'śr', 'czw', 'pt', 'sob'],
  weekdaysLong: ['Niedziela', 'Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota'],
  months: ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'],
  monthsShort: ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'],
  /** The form after a day number: "20 września". */
  monthsInDate: ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'],
  today: 'dziś',
  tomorrow: 'jutro',
  yesterday: 'wczoraj',
  inDays: (days: number) => `za ${days} dni`,
  daysAgo: (days: number) => `${days} dni temu`,
  /** "4 tygodnie", "8 tygodni", "1 tydzień". */
  weeks: (count: number) => pluralPl(count, ['tydzień', 'tygodnie', 'tygodni']),
}
