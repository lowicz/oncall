import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expectNoAxeViolations } from '../test/axe'
import { Popover } from './Popover'

describe('Popover', () => {
  it('opens a dialog named by its h2 title and closes with Escape, focus back on the trigger', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(
      <Popover trigger={<button>Legenda</button>} title="Legenda" className="legend">
        <p>Dzień wolny</p>
      </Popover>,
    )
    const trigger = screen.getByRole('button', { name: 'Legenda' })
    await user.tab()
    await user.keyboard('{Enter}')
    const popup = await screen.findByRole('dialog', { name: 'Legenda' })
    const title = screen.getByRole('heading', { level: 2, name: 'Legenda' })
    expect(popup).toHaveAttribute('aria-labelledby', title.id)
    expect(popup).toHaveClass('pop', 'legend')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expectNoAxeViolations(popup)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })
})
