/**
 * The API stores a number as `+48` and nine digits and accepts it written
 * with spaces or dashes, bare or with `48` in front (`normalize_phone` in
 * `backend/src/oncall/domain/accounts.py`). The same rule here lets a screen
 * say "popraw numer" about a stored value or a draft; the API stays the judge.
 */
const POLISH_NUMBER = /^(\+?48)?[0-9]{9}$/

export function isPolishPhone(value: string): boolean {
  return POLISH_NUMBER.test(value.trim().replace(/[ -]/g, ''))
}
