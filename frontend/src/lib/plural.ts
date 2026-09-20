/**
 * Polish plural: `pluralPl(4, ['tydzień', 'tygodnie', 'tygodni'])` gives
 * "4 tygodnie". The forms are singular, paucal (2-4 outside 12-14) and the
 * rest; the count is always written out in front.
 */
export function pluralPl(count: number, forms: [string, string, string]) {
  const [one, few, many] = forms
  if (count === 1) return `1 ${one}`
  const rest = count % 10
  const teens = count % 100
  if (rest >= 2 && rest <= 4 && (teens < 12 || teens > 14)) return `${count} ${few}`
  return `${count} ${many}`
}
