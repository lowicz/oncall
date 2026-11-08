import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { api } from '../api'
import { renderScreen } from '../test/render'
import { useUndoable } from './useUndoable'

function Saver({ undo }: { undo: () => Promise<void> }) {
  const undoable = useUndoable()
  return <button type="button" onClick={() => undoable({ execute: async () => 'saved', undo, message: () => ({ title: 'Zapisano' }) })}>save</button>
}

afterEach(() => vi.restoreAllMocks())

describe('useUndoable', () => {
  it('reports an inverse that failed without an error message', async () => {
    vi.spyOn(api, 'publicConfig').mockRejectedValue(new Error('offline'))
    const undo = vi.fn().mockRejectedValue('network down')
    renderScreen(<Saver undo={undo} />)

    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cofnij' }))

    expect(await screen.findByText('Nie udało się cofnąć')).toBeInTheDocument()
    expect(undo).toHaveBeenCalledWith('saved')
  })

  it('keeps Undo open for as long as the server holds the e-mails', async () => {
    vi.spyOn(api, 'publicConfig').mockResolvedValue({
      ldap_enabled: false, sso_enabled: false, app_name: 'On-call', app_subtitle: '', version: 'dev',
      audit_retention_days: 365, login_audit_retention_days: 90, undo_window_seconds: 30,
    })
    const { queryClient } = renderScreen(<Saver undo={vi.fn()} />)
    await vi.waitFor(() => expect(queryClient.getQueryData(['public-config'])).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    await screen.findByRole('button', { name: 'Cofnij' })
    await vi.advanceTimersByTimeAsync(20_000)

    expect(screen.getByRole('button', { name: 'Cofnij' })).toBeInTheDocument()
  })
})
