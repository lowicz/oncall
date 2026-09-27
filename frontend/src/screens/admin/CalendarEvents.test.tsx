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

const SINGLE_DAY = { ...EVENT, id: 'e2', title: 'Audyt ISO', color: 'green' as const, starts_on: '2026-10-05', ends_on: '2026-10-05' }

describe('CalendarEventsPanel list', () => {
  it('lists the next 90 days, a one-day event with a single date', async () => {
    const list = vi.spyOn(api, 'calendarEvents').mockResolvedValue([EVENT, SINGLE_DAY])
    renderScreen(<CalendarEventsPanel />)

    expect(await screen.findByText('Audyt ISO')).toBeInTheDocument()
    expect(screen.getByText('05-10-2026')).toBeInTheDocument()
    expect(screen.getByText('24-09-2026 – 26-09-2026')).toBeInTheDocument()
    expect(screen.getByText('10-09-2026 – 08-12-2026')).toBeInTheDocument()
    expect(list).toHaveBeenCalledWith('2026-09-10', '2026-12-08')
  })

  it('reloads for a new range and ignores a cleared date', async () => {
    const list = vi.spyOn(api, 'calendarEvents').mockResolvedValue([])
    renderScreen(<CalendarEventsPanel />)
    expect(await screen.findByText('Brak wydarzeń w wybranym zakresie')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Pokaż od'), { target: { value: '2026-11-01' } })
    fireEvent.change(screen.getByLabelText('Pokaż do'), { target: { value: '2026-11-30' } })
    await waitFor(() => expect(list).toHaveBeenLastCalledWith('2026-11-01', '2026-11-30'))

    fireEvent.change(screen.getByLabelText('Pokaż od'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Pokaż do'), { target: { value: '' } })
    expect(screen.getByText('01-11-2026 – 30-11-2026')).toBeInTheDocument()
    expect(list).toHaveBeenCalledTimes(3)
    expect(fireEvent.submit(screen.getByRole('form', { name: 'Zakres listy' }))).toBe(false)
  })

  it('offers a retry when the list fails to load', async () => {
    const list = vi.spyOn(api, 'calendarEvents')
      .mockRejectedValueOnce(new Error('Serwer niedostępny'))
      .mockResolvedValue([EVENT])
    renderScreen(<CalendarEventsPanel />)

    expect(await screen.findByText('Nie udało się pobrać danych')).toBeInTheDocument()
    expect(screen.getAllByText('Serwer niedostępny').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }))

    expect(await screen.findByText('Szkolenie BHP')).toBeInTheDocument()
    expect(list).toHaveBeenCalledTimes(2)
  })
})

describe('CalendarEventsPanel form', () => {
  it('adds an event, keeping the end on or after the start, then clears the form', async () => {
    vi.spyOn(api, 'calendarEvents').mockResolvedValue([])
    const create = vi.spyOn(api, 'createCalendarEvent').mockResolvedValue({ ...EVENT, id: 'new' })
    renderScreen(<CalendarEventsPanel />)
    const form = await screen.findByRole('form', { name: 'Nowe wydarzenie' })
    const add = within(form).getByRole('button', { name: 'Dodaj' })
    expect(add).toBeDisabled()

    fireEvent.submit(form)
    expect(create).not.toHaveBeenCalled()

    fireEvent.change(within(form).getByLabelText(/Nazwa/), { target: { value: 'Przegląd serwerowni' } })
    fireEvent.change(within(form).getByLabelText(/^Od/), { target: { value: '2026-09-20' } })
    expect(within(form).getByLabelText(/^Do/)).toHaveValue('2026-09-20')
    fireEvent.change(within(form).getByLabelText(/^Do/), { target: { value: '2026-09-22' } })
    fireEvent.change(within(form).getByLabelText(/^Od/), { target: { value: '2026-09-21' } })
    expect(within(form).getByLabelText(/^Do/)).toHaveValue('2026-09-22')
    const red = within(form).getByRole('radio', { name: 'Czerwony' })
    fireEvent.click(red)
    expect(red).toHaveAttribute('aria-checked', 'true')
    expect(within(form).getByRole('radio', { name: 'Niebieski' })).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(add)

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0][0]).toEqual({
      title: 'Przegląd serwerowni', starts_on: '2026-09-21', ends_on: '2026-09-22', color: 'red',
    })
    await waitFor(() => expect(within(form).getByLabelText(/Nazwa/)).toHaveValue(''))
    expect(within(form).getByLabelText(/^Od/)).toHaveValue('2026-09-10')
  })

  it('edits an event in place and can be cancelled back to a new one', async () => {
    vi.spyOn(api, 'calendarEvents').mockResolvedValue([EVENT, SINGLE_DAY])
    const update = vi.spyOn(api, 'updateCalendarEvent').mockResolvedValue({ ...EVENT, title: 'Szkolenie BHP II' })
    renderScreen(<CalendarEventsPanel />)

    fireEvent.click((await screen.findAllByRole('button', { name: 'Edytuj' }))[0])
    const form = screen.getByRole('form', { name: 'Edycja wydarzenia' })
    expect(within(form).getByRole('heading', { name: 'Edytuj wydarzenie' })).toBeInTheDocument()
    expect(within(form).getByLabelText(/Nazwa/)).toHaveValue('Szkolenie BHP')
    expect(within(form).getByLabelText(/^Do/)).toHaveValue('2026-09-26')
    fireEvent.change(within(form).getByLabelText(/Nazwa/), { target: { value: 'Szkolenie BHP II' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Zapisz' }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0][0]).toEqual({
      id: 'e1', title: 'Szkolenie BHP II', starts_on: '2026-09-24', ends_on: '2026-09-26', color: 'blue',
    })
    expect(await screen.findByRole('form', { name: 'Nowe wydarzenie' })).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Edytuj' })[1])
    fireEvent.click(screen.getByRole('button', { name: 'Anuluj' }))
    const fresh = screen.getByRole('form', { name: 'Nowe wydarzenie' })
    expect(within(fresh).getByLabelText(/Nazwa/)).toHaveValue('')
  })

  it('shows why a save was refused', async () => {
    vi.spyOn(api, 'calendarEvents').mockResolvedValue([])
    vi.spyOn(api, 'createCalendarEvent').mockRejectedValue(new Error('Data końcowa przed początkową'))
    renderScreen(<CalendarEventsPanel />)
    const form = await screen.findByRole('form', { name: 'Nowe wydarzenie' })

    fireEvent.change(within(form).getByLabelText(/Nazwa/), { target: { value: 'Szkolenie' } })
    fireEvent.submit(form)

    expect(await within(form).findByRole('alert')).toHaveTextContent('Data końcowa przed początkową')
  })

  it('shows a refused deletion inside the still-open confirmation', async () => {
    vi.spyOn(api, 'calendarEvents').mockResolvedValue([EVENT])
    vi.spyOn(api, 'deleteCalendarEvent').mockRejectedValue(new Error('Wydarzenie już usunięto'))
    renderScreen(<CalendarEventsPanel />)

    const confirm = await openDeletion()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Usuń' }))

    expect(await within(confirm).findByText('Wydarzenie już usunięto')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Usunąć wydarzenie?' })).toBeInTheDocument()
  })
})
