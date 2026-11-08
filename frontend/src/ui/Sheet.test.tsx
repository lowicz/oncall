import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expectNoAxeViolations } from '../test/axe'
import { loadRealStylesheet } from '../test/stylesheet'
import { Sheet } from './Sheet'

function Handover({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>Przekaż numer…</button>
      <Sheet open={open} onClose={() => { setOpen(false); onClose?.() }} title="Przekaż numer on-call" className="handover">
        <p>Odbierze Marek Nowak (SECONDARY)</p>
        <button className="btn btn-pri">Przekaż numer</button>
      </Sheet>
    </>
  )
}

async function openSheet() {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  const onClose = vi.fn()
  render(<Handover onClose={onClose} />)
  const opener = screen.getByRole('button', { name: 'Przekaż numer…' })
  await user.click(opener)
  const sheet = await screen.findByRole('dialog', { name: 'Przekaż numer on-call' })
  return { user, onClose, opener, sheet }
}

describe('Sheet', () => {
  it('is a modal named by its h2 title, with a close button', async () => {
    const { sheet } = await openSheet()
    const title = screen.getByRole('heading', { level: 2, name: 'Przekaż numer on-call' })
    expect(sheet).toHaveAttribute('aria-labelledby', title.id)
    // Modal: the page behind it is out of reach while it is open.
    expect(screen.queryByRole('button', { name: 'Przekaż numer…' })).not.toBeInTheDocument()
    expect(sheet).toHaveClass('sheet', 'handover')
    expect(screen.getByRole('button', { name: 'Zamknij' })).toBeInTheDocument()
    await expectNoAxeViolations(sheet)
  })

  it('keeps Tab inside and closes with its button, focus back on the opener', async () => {
    const { user, onClose, opener } = await openSheet()
    const close = screen.getByRole('button', { name: 'Zamknij' })
    const submit = screen.getByRole('button', { name: 'Przekaż numer' })
    await waitFor(() => expect(close).toHaveFocus())
    await user.tab()
    expect(submit).toHaveFocus()
    await user.tab()
    expect(close).toHaveFocus()
    await user.click(close)
    expect(onClose).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(opener).toHaveFocus()
  })

  it('closes with Escape', async () => {
    const { user, onClose, opener } = await openSheet()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(opener).toHaveFocus()
  })

  it('closes with a tap on the backdrop', async () => {
    const { user, onClose } = await openSheet()
    await user.click(document.querySelector('.dialog-backdrop')!)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('sits above the home bar, keeps its scroll and gives every control 44 px', async () => {
    loadRealStylesheet()
    const { sheet } = await openSheet()
    const style = getComputedStyle(sheet)
    expect(style.paddingBottom).toBe('calc(20px + env(safe-area-inset-bottom))')
    expect(style.getPropertyValue('overscroll-behavior')).toBe('contain')
    for (const button of screen.getAllByRole('button')) {
      if (sheet.contains(button)) expect(getComputedStyle(button).minHeight).toBe('44px')
    }
    expect(getComputedStyle(screen.getByRole('button', { name: 'Zamknij' })).minWidth).toBe('44px')
  })
})
