import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { messages } from '../i18n'
import { Dialog } from './Dialog'

function Harness({ dismissible, onClose }: { dismissible?: boolean; onClose?: () => void }) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <button onClick={() => setOpen(true)}>Otwórz</button>
      <Dialog
        open={open}
        onClose={() => { setOpen(false); onClose?.() }}
        title="Opublikować grafik?"
        description="Członkowie zespołu zobaczą go od razu."
        actions={<button>Publikuj</button>}
        size="lg"
        tone="danger"
        className="publish"
        dismissible={dismissible}
      >
        <p>Wersja 3</p>
      </Dialog>
    </>
  )
}

describe('Dialog', () => {
  it('is a modal named by its title, with the description, body and actions', async () => {
    render(<Harness />)
    const dialog = await screen.findByRole('dialog', { name: 'Opublikować grafik?' })
    expect(dialog).toHaveAccessibleDescription('Członkowie zespołu zobaczą go od razu.')
    expect(dialog).toHaveClass('dialog-popup', 'dialog-lg', 'dialog-danger', 'publish')
    expect(screen.getByText('Wersja 3').parentElement).toHaveClass('dialog-body')
    expect(screen.getByRole('button', { name: 'Publikuj' }).parentElement).toHaveClass('dialog-actions')
  })

  it('closes with its close button and with Escape', async () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    fireEvent.click(await screen.findByRole('button', { name: messages().common.close }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(onClose).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Otwórz' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('cannot be dismissed while its action runs', async () => {
    const onClose = vi.fn()
    render(<Harness dismissible={false} onClose={onClose} />)
    const dialog = await screen.findByRole('dialog')
    expect(screen.queryByRole('button', { name: messages().common.close })).not.toBeInTheDocument()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('is medium and neutral with only a title', async () => {
    render(<Dialog open onClose={() => {}} title="Informacja" />)
    const dialog = await screen.findByRole('dialog', { name: 'Informacja' })
    expect(dialog).toHaveClass('dialog-md')
    expect(dialog).not.toHaveClass('dialog-danger')
    expect(dialog.querySelector('.dialog-desc, .dialog-body, .dialog-actions')).toBeNull()
  })
})
