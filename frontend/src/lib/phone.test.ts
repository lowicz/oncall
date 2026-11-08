import { describe, expect, it } from 'vitest'
import { isPolishPhone, phoneText, telHref } from './phone'

describe('isPolishPhone', () => {
  it.each(['600100200', '600 100 200', '600-100-200', '48600100200', '+48 600 100 200', ' +48600100200 '])(
    'accepts %s, which the API stores as +48600100200', (value) => {
      expect(isPolishPhone(value)).toBe(true)
    },
  )

  it.each(['', 'abc', '60010020', '6001002001', '+49 170 1234567', '0048600100200', '+48 (22) 123 45 67'])(
    'refuses %s like the API does', (value) => {
      expect(isPolishPhone(value)).toBe(false)
    },
  )
})

describe('a number as dialled and as printed', () => {
  it('dials only the digits and the plus', () => {
    expect(telHref('+48 602-345 678')).toBe('tel:+48602345678')
  })

  it.each(['+48602345678', ' +48 602  345 678 ', '602-345-678'])(
    'prints %s as +48 and three groups held by no-break spaces', (value) => {
      expect(phoneText(value)).toBe('+48\u00a0602\u00a0345\u00a0678')
    },
  )

  it('prints a number that is not Polish as written, its spaces held', () => {
    expect(phoneText(' +49 170  1234567 ')).toBe('+49\u00a0170\u00a01234567')
  })
})
