/**
 * The one place numbers become text. Every screen writes them the way the
 * current language does (a decimal comma in Polish, a point in English), so a
 * balance never reads "14.01" on one sheet and "58,7" on the next.
 */
import { locale } from '../i18n/messages'

/** "0,5", "58,45", "1" - a value with only the decimals it carries. */
export const formatDecimal = (value: number) => value.toLocaleString(locale(), { maximumFractionDigits: 2 })

/** "+0,5", "-1,9", "0" - a deviation with its sign, as the report prints it. */
export const signed = (value: number) => `${value > 0 ? '+' : ''}${formatDecimal(value)}`

/** "0,5" - a point value the way the screens write numbers in running text. */
export const formatPoints = (value: number, digits = 1) =>
  value.toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits })

/** "+0,5", "-1,9", "0,0" - a deviation with its sign in running text. */
export const signedPoints = (value: number, digits = 1) => `${value > 0 ? '+' : ''}${formatPoints(value, digits)}`
