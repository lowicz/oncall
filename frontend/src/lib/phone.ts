/**
 * The API stores a number as `+48` and nine digits and accepts it written
 * with spaces or dashes, bare or with `48` in front (`normalize_phone` in
 * `backend/src/oncall/domain/accounts.py`). The same rule here lets a screen
 * say "popraw numer" about a stored value or a draft; the API stays the judge.
 */
const POLISH_NUMBER = /^(?:\+?48)?(\d{3})(\d{3})(\d{3})$/

function polishGroups(value: string): RegExpMatchArray | null {
  return value.trim().replace(/[ -]/g, '').match(POLISH_NUMBER)
}

export function isPolishPhone(value: string): boolean {
  return polishGroups(value) !== null
}

/** The `tel:` address of a number as stored or typed: the digits and the plus. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`
}

/**
 * A number as printed, its groups held by no-break spaces so it never wraps:
 * a Polish one as `+48 602 345 678`, any other as written.
 */
export function phoneText(phone: string): string {
  const groups = polishGroups(phone)
  if (groups) return ['+48', ...groups.slice(1)].join('\u00a0')
  return phone.trim().replace(/\s+/g, '\u00a0')
}
