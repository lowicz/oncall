import { describe, expect, it } from 'vitest'
import { formatDecimal, formatPoints, signed, signedPoints } from './numbers'

describe('numbers in Polish', () => {
  it('writes decimals with a comma and only the digits they carry', () => {
    expect(formatDecimal(14.01)).toBe('14,01')
    expect(formatDecimal(58.7)).toBe('58,7')
    expect(formatDecimal(2)).toBe('2')
    expect(formatDecimal(0.125)).toBe('0,13')
  })

  it('signs a deviation, leaving zero unsigned', () => {
    expect(signed(15.01)).toBe('+15,01')
    expect(signed(-1.5)).toBe('-1,5')
    expect(signed(0)).toBe('0')
  })

  it('writes points in running text with a fixed number of decimals', () => {
    expect(formatPoints(3)).toBe('3,0')
    expect(formatPoints(58.66, 1)).toBe('58,7')
    expect(signedPoints(32.84)).toBe('+32,8')
    expect(signedPoints(-0.25, 2)).toBe('-0,25')
  })
})
