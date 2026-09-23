/**
 * The Polish form that agrees with `count`: singular, paucal (2-4 outside
 * 12-14) or the rest. `pluralFormPl(3, ['zostanie', 'zostaną', 'zostanie'])`
 * gives "zostaną", so a verb can agree with the noun `pluralPl` wrote.
 */
export function pluralFormPl(count: number, forms: [string, string, string]) {
  const [one, few, many] = forms
  if (count === 1) return one
  const rest = count % 10
  const teens = count % 100
  if (rest >= 2 && rest <= 4 && (teens < 12 || teens > 14)) return few
  return many
}

/**
 * Polish plural: `pluralPl(4, ['tydzień', 'tygodnie', 'tygodni'])` gives
 * "4 tygodnie". The count is always written out in front.
 */
export function pluralPl(count: number, forms: [string, string, string]) {
  return `${count} ${pluralFormPl(count, forms)}`
}
