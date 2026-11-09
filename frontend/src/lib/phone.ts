/**
 * The API stores a number as `+48` and nine digits and accepts it written
 * with spaces or dashes, bare or with `48` in front (`normalize_phone` in
 * `backend/src/oncall/domain/accounts.py`). The same rule here lets a screen
 * say "popraw numer" about a stored value or a draft; the API stays the judge.
 */
const POLISH_NUMBER = /^(?:\+?48)?(\d{3})(\d{3})(\d{3})$/

function polishGroups(value: string): RegExpExecArray | null {
  return POLISH_NUMBER.exec(value.trim().replace(/[ -]/g, ''))
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

/**
 * The same without the country code of a Polish number (`602 345 678`), for
 * the "Teraz" strip: with it the number no longer fits beside the name and the
 * strip grows a row. The `tel:` address keeps the code.
 */
export function phoneTextNational(phone: string): string {
  return phoneText(phone).replace(/^\+48\u00a0/, '')
}
