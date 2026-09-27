import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { loadRealStylesheet } from '../test/stylesheet'
import { Panel } from './Panel'

const viewport = vi.hoisted(() => ({ narrow: true }))
vi.mock('../hooks/useMediaQuery', () => ({ useNarrow: () => viewport.narrow }))

describe('Panel stacking', () => {
  it.each([true, false])('keeps the sheet usable when narrow=%s', (narrow) => {
    viewport.narrow = narrow
    loadRealStylesheet()
    render(<Panel open onClose={vi.fn()} title="Details"><button>Select candidate</button></Panel>)
    const panel = screen.getByRole('dialog', { name: 'Details' })
    const backdrop = document.querySelector('.dialog-backdrop')
    if (narrow) {
      expect(backdrop).not.toBeNull()
      expect(Number(getComputedStyle(panel).zIndex)).toBeGreaterThan(Number(getComputedStyle(backdrop!).zIndex))
    } else {
      expect(backdrop).toBeNull()
      expect(getComputedStyle(panel).zIndex).toBe('30')
    }
    expect(screen.getByRole('button', { name: 'Select candidate' })).toBeVisible()
  })
})
