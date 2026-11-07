import { afterEach, describe, expect, it, vi } from 'vitest'
import { preferredScrollBehavior } from './motion'

function preferReducedMotion(matches: boolean) {
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches } as MediaQueryList)
}

afterEach(() => vi.restoreAllMocks())

describe('preferredScrollBehavior', () => {
  it('uses smooth scrolling by default', () => {
    preferReducedMotion(false)
    expect(preferredScrollBehavior()).toBe('smooth')
  })

  it('uses immediate scrolling when reduced motion is preferred', () => {
    preferReducedMotion(true)
    expect(preferredScrollBehavior()).toBe('auto')
  })
})
