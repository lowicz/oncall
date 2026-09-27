import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { renderScreen } from '../test/render'
import { ConfirmDialog } from './ConfirmDialog'

describe('ConfirmDialog', () => {
  it('asks for a long enough reason and hands it over trimmed', () => {
    const onConfirm = vi.fn()
    renderScreen(
      <ConfirmDialog
        open
        title="Odrzucić prośbę?"
        confirmLabel="Odrzuć"
        confirmColor="error"
        reasonLabel="Powód"
        reasonMinLength={5}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    )
    const dialog = screen.getByRole('dialog', { name: 'Odrzucić prośbę?' })
    expect(dialog).toHaveClass('dialog-danger')
    const confirm = within(dialog).getByRole('button', { name: 'Odrzuć' })
    expect(confirm).toBeDisabled()

    const reason = within(dialog).getByRole('textbox', { name: /Powód/ })
    fireEvent.change(reason, { target: { value: ' ab ' } })
    expect(within(dialog).getByText('Wpisz co najmniej 5 znaków')).toBeInTheDocument()
    expect(confirm).toBeDisabled()

    fireEvent.change(reason, { target: { value: '  urlop  ' } })
    expect(within(dialog).queryByText('Wpisz co najmniej 5 znaków')).not.toBeInTheDocument()
    fireEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledWith('urlop')
  })

  it('shows the description and the failure, and cancels from the close button', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    renderScreen(
      <ConfirmDialog
        open
        title="Opublikować grafik?"
        description={<p>Zespół dostanie powiadomienia.</p>}
        confirmLabel="Publikuj"
        error="Grafik zmienił się w międzyczasie"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    )
    const dialog = screen.getByRole('dialog', { name: 'Opublikować grafik?' })
    expect(dialog).not.toHaveClass('dialog-danger')
    expect(within(dialog).getByText('Zespół dostanie powiadomienia.')).toBeInTheDocument()
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Grafik zmienił się w międzyczasie')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Publikuj' }))
    expect(onConfirm).toHaveBeenCalledWith('')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Zamknij' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('cannot be confirmed while something in the description is unanswered', () => {
    renderScreen(
      <ConfirmDialog open title="Usunąć?" confirmLabel="Usuń" confirmColor="warning" confirmDisabled onCancel={vi.fn()} onConfirm={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: 'Usuń' })).toBeDisabled()
  })

  it('keeps itself open and shows progress while the action runs', () => {
    const onCancel = vi.fn()
    renderScreen(
      <ConfirmDialog open pending title="Usunąć?" confirmLabel="Usuń" onCancel={onCancel} onConfirm={vi.fn()} />,
    )
    const dialog = screen.getByRole('dialog', { name: 'Usunąć?' })
    expect(within(dialog).getByRole('button', { name: /Zapisuję/ })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Anuluj' })).toBeDisabled()
    expect(within(dialog).queryByRole('button', { name: 'Zamknij' })).not.toBeInTheDocument()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('starts with an empty reason each time it opens', () => {
    const props = { title: 'Wycofać?', confirmLabel: 'Wycofaj', reasonLabel: 'Powód', onCancel: vi.fn(), onConfirm: vi.fn() }
    const view = renderScreen(<ConfirmDialog open {...props} />)
    fireEvent.change(screen.getByRole('textbox', { name: /Powód/ }), { target: { value: 'zmiana planów' } })

    view.rerender(<ConfirmDialog open={false} {...props} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    view.rerender(<ConfirmDialog open {...props} />)
    expect(screen.getByRole('textbox', { name: /Powód/ })).toHaveValue('')
  })
})
