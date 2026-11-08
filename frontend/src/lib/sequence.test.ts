import { describe, expect, it } from 'vitest'
import { inOrder } from './sequence'

describe('inOrder', () => {
  it('runs the steps one after another and stops at the first failure', async () => {
    const seen: string[] = []
    const step = async (item: number) => {
      seen.push(`start ${item}`)
      await Promise.resolve()
      if (item === 2) throw new Error('two')
      seen.push(`end ${item}`)
    }
    await expect(inOrder([1, 2, 3], step)).rejects.toThrow('two')
    expect(seen).toEqual(['start 1', 'end 1', 'start 2'])
  })
})
