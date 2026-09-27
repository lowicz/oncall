import { describe, expect, it } from 'vitest'
import { pluralEn, pluralFormEn, pluralFormPl, pluralPl } from './plural'

const entries: [string, string, string] = ['wpis', 'wpisy', 'wpisów']

describe('pluralPl', () => {
  it.each([
    [1, '1 wpis'],
    [2, '2 wpisy'],
    [4, '4 wpisy'],
    [5, '5 wpisów'],
    [12, '12 wpisów'],
    [22, '22 wpisy'],
    [0, '0 wpisów'],
  ])('writes %i as "%s"', (count, text) => {
    expect(pluralPl(count, entries)).toBe(text)
  })

  it('gives the verb that agrees with the same count', () => {
    const verb: [string, string, string] = ['zmienił', 'zmieniły', 'zmieniło']
    expect([1, 3, 5, 13, 23].map((count) => pluralFormPl(count, verb)))
      .toEqual(['zmienił', 'zmieniły', 'zmieniło', 'zmieniło', 'zmieniły'])
  })
})

describe('pluralEn', () => {
  it.each([
    [0, '0 weeks'],
    [1, '1 week'],
    [2, '2 weeks'],
    [21, '21 weeks'],
  ])('writes %i as "%s"', (count, text) => {
    expect(pluralEn(count, ['week', 'weeks'])).toBe(text)
  })

  it('gives the verb that agrees with the same count', () => {
    expect([1, 2].map((count) => pluralFormEn(count, ['was', 'were']))).toEqual(['was', 'were'])
  })
})
