import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderScreen } from '../../test/render'
import { CalendarEventsPanel } from './CalendarEvents'
import { api } from '../../api'

afterEach(() => vi.restoreAllMocks())

const EVENT = {
  id: 'e1', title: 'Szkolenie BHP', color: 'blue' as const,
  starts_on: '2026-09-24', ends_on: '2026-09-26', created_at: '2026-09-01T10:00:00Z',
}

const openDeletion = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Usuń' }))
  return screen.findByRole('dialog', { name: 'Usunąć wydarzenie?' })
}

describe('CalendarEventsPanel deletion', () => {
  it('keeps the event when the confirmation is cancelled', async () => {
    vi.spyOn(api, 'calendarEvents').mockResolvedValue([EVENT])
    const remove = vi.spyOn(api, 'deleteCalendarEvent').mockResolvedValue(undefined)
    renderScreen(<CalendarEventsPanel />)

    const confirm = await openDeletion()
    expect(within(confirm).getByText(/Szkolenie BHP \(24-09-2026 – 26-09-2026\)\. Tej operacji nie da się cofnąć\./)).toBeInTheDocument()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Anuluj' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(remove).not.toHaveBeenCalled()
  })

  it('deletes the event once confirmed', async () => {
    vi.spyOn(api, 'calendarEvents').mockResolvedValue([EVENT])
    const remove = vi.spyOn(api, 'deleteCalendarEvent').mockResolvedValue(undefined)
    renderScreen(<CalendarEventsPanel />)

    const confirm = await openDeletion()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Usuń' }))

    await waitFor(() => expect(remove).toHaveBeenCalled())
    expect(remove.mock.calls[0][0]).toBe('e1')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
