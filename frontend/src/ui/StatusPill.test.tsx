import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expectNoAxeViolations } from '../test/axe'
import { Popover } from './Popover'
import { StatusPill } from './StatusPill'

describe('StatusPill', () => {
  it('is a button with its words visible that opens a dialog, read out politely', async () => {
    const { container } = render(
      <StatusPill detail=", u Anny Kowalskiej, potwierdzone 09:00" className="now-pill">numer on-call</StatusPill>,
    )
    const pill = screen.getByRole('button', { name: 'numer on-call, u Anny Kowalskiej, potwierdzone 09:00' })
    expect(pill).toHaveAttribute('type', 'button')
    expect(pill).toHaveAttribute('aria-haspopup', 'dialog')
    expect(pill).not.toHaveAttribute('title')
    expect(pill).toHaveClass('pill', 'pill-ok', 'now-pill')
    expect(pill.parentElement).toHaveAttribute('aria-live', 'polite')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await expectNoAxeViolations(container)
  })

  it('announces a state change in place and a failure as an alert', async () => {
    const { rerender, container } = render(<StatusPill state="pending">numer on-call · przełączam na Marka · do 13:40</StatusPill>)
    const region = screen.getByRole('button').parentElement!
    expect(screen.getByRole('button')).toHaveClass('pill-pending')
    rerender(<StatusPill>numer on-call u Marka · do 13:40</StatusPill>)
    expect(screen.getByRole('button').parentElement).toBe(region)
    expect(region).toHaveAttribute('aria-live', 'polite')
    rerender(<StatusPill state="failed">numer on-call nadal u Anny · nie przełączono</StatusPill>)
    expect(screen.getByRole('alert')).toBe(region)
    expect(region).not.toHaveAttribute('aria-live')
    expect(screen.getByRole('alert')).toHaveTextContent('numer on-call nadal u Anny · nie przełączono')
    expect(screen.getByRole('button')).toHaveClass('pill-failed')
    await expectNoAxeViolations(container)
  })

  it('opens the details as a popover from the keyboard, focus back on the pill', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(
      <Popover trigger={<StatusPill>numer on-call · do 13:40</StatusPill>} title="Numer on-call">
        <p>U Marka Nowaka od 11:40, WCO potwierdziło.</p>
      </Popover>,
    )
    const pill = screen.getByRole('button', { name: 'numer on-call · do 13:40' })
    await user.tab()
    expect(pill).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('dialog', { name: 'Numer on-call' })).toBeInTheDocument()
    expect(pill).toHaveAttribute('aria-expanded', 'true')
    expect(pill).toHaveAttribute('aria-haspopup', 'dialog')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(pill).toHaveFocus()
  })
})
