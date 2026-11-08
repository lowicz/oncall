/**
 * The API stores a number as `+48` and nine digits and accepts it written
 * with spaces or dashes, bare or with `48` in front (`normalize_phone` in
 * `backend/src/oncall/domain/accounts.py`). The same rule here lets a screen
 * say "popraw numer" about a stored value or a draft; the API stays the judge.
 */
const POLISH_NUMBER = /^(\+?48)?\d{9}$/

export function isPolishPhone(value: string): boolean {
  return POLISH_NUMBER.test(value.trim().replace(/[ -]/g, ''))
}

/** The `tel:` address of a number as stored or typed: the digits and the plus. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`
}

/** A number as printed, its groups held by no-break spaces so it never wraps. */
export function phoneText(phone: string): string {
  return phone.trim().replace(/\s+/g, '\u00a0')
}
