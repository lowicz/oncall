import { describe, expect, it } from 'vitest'
import { isPolishPhone } from './phone'

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
