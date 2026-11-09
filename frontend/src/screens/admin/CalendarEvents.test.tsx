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

describe('CalendarEventsPanel deletion', () => {
  it('deletes at once and brings the event back with Undo', async () => {
    const list = vi.spyOn(api, 'calendarEvents').mockResolvedValue([EVENT])
    const remove = vi.spyOn(api, 'deleteCalendarEvent').mockResolvedValue(undefined)
    const create = vi.spyOn(api, 'createCalendarEvent').mockResolvedValue({ ...EVENT, id: 'e9' })
    renderScreen(<CalendarEventsPanel />)

    fireEvent.click(await screen.findByRole('button', { name: 'Usuń „Szkolenie BHP”' }))

    await waitFor(() => expect(remove).toHaveBeenCalledWith('e1'))
    expect(screen.queryByRole('dialog', { name: 'Usunąć wydarzenie?' })).not.toBeInTheDocument()
    expect(await screen.findByText('Usunięto „Szkolenie BHP”')).toBeInTheDocument()
    expect(screen.getByText('24-09-2026 – 26-09-2026', { selector: '.toast-desc' })).toBeInTheDocument()
    const calls = list.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Cofnij' }))

    await waitFor(() => expect(create).toHaveBeenCalledWith({ starts_on: '2026-09-24', ends_on: '2026-09-26', title: 'Szkolenie BHP', color: 'blue' }))
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(calls))
  })

  it('reports an Undo that failed and leaves it to try again', async () => {
    vi.spyOn(api, 'calendarEvents').mockResolvedValue([EVENT])
    vi.spyOn(api, 'deleteCalendarEvent').mockResolvedValue(undefined)
    const create = vi.spyOn(api, 'createCalendarEvent').mockRejectedValue(new Error('Serwer niedostępny'))
    renderScreen(<CalendarEventsPanel />)

    fireEvent.click(await screen.findByRole('button', { name: 'Usuń „Szkolenie BHP”' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cofnij' }))

    expect(await screen.findByText('Nie udało się cofnąć')).toBeInTheDocument()
    expect(screen.getByText('Serwer niedostępny')).toBeInTheDocument()
    expect(create).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Cofnij' })).toBeInTheDocument()
  })

  it('clears the form when the event being edited is deleted', async () => {
    vi.spyOn(api, 'calendarEvents').mockResolvedValue([EVENT])
    vi.spyOn(api, 'deleteCalendarEvent').mockResolvedValue(undefined)
    renderScreen(<CalendarEventsPanel />)

    fireEvent.click(await screen.findByRole('button', { name: 'Edytuj „Szkolenie BHP”' }))
    expect(screen.getByLabelText(/Nazwa/)).toHaveValue('Szkolenie BHP')
    fireEvent.click(screen.getByRole('button', { name: 'Usuń „Szkolenie BHP”' }))

    await waitFor(() => expect(screen.getByLabelText(/Nazwa/)).toHaveValue(''))
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

    expect(await screen.findByText('Nie udało się pobrać danych. Sprawdź połączenie i spróbuj ponownie.')).toBeInTheDocument()
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
    // The toast names what was added, with its dates, and takes it back.
    const toast = (await screen.findByText('Dodano „Szkolenie BHP”')).closest('.toast') as HTMLElement
    expect(toast).toHaveTextContent('24-09-2026 – 26-09-2026')
    const remove = vi.spyOn(api, 'deleteCalendarEvent').mockResolvedValue(undefined)
    fireEvent.click(within(toast).getByRole('button', { name: 'Cofnij' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith('new'))
  })

  it('edits an event in place and can be cancelled back to a new one', async () => {
    vi.spyOn(api, 'calendarEvents').mockResolvedValue([EVENT, SINGLE_DAY])
    const update = vi.spyOn(api, 'updateCalendarEvent').mockResolvedValue({ ...EVENT, title: 'Szkolenie BHP II' })
    renderScreen(<CalendarEventsPanel />)

    fireEvent.click(await screen.findByRole('button', { name: 'Edytuj „Szkolenie BHP”' }))
    const form = screen.getByRole('form', { name: 'Edycja wydarzenia' })
    expect(within(form).getByRole('heading', { name: 'Edytuj wydarzenie' })).toBeInTheDocument()
    // The edit starts in the name field, not on the button left behind.
    expect(within(form).getByLabelText(/Nazwa/)).toHaveFocus()
    expect(within(form).getByLabelText(/Nazwa/)).toHaveValue('Szkolenie BHP')
    expect(within(form).getByRole('radiogroup', { name: 'Kolor' })).toBeInTheDocument()
    expect(within(form).getByLabelText(/^Do/)).toHaveValue('2026-09-26')
    fireEvent.change(within(form).getByLabelText(/Nazwa/), { target: { value: 'Szkolenie BHP II' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Zapisz' }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0][0]).toEqual({
      id: 'e1', title: 'Szkolenie BHP II', starts_on: '2026-09-24', ends_on: '2026-09-26', color: 'blue',
    })
    expect(await screen.findByRole('form', { name: 'Nowe wydarzenie' })).toBeInTheDocument()
    expect(await screen.findByText('Zapisano „Szkolenie BHP II”')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cofnij' }))
    await waitFor(() => expect(update).toHaveBeenLastCalledWith({
      id: 'e1', title: 'Szkolenie BHP', starts_on: '2026-09-24', ends_on: '2026-09-26', color: 'blue',
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Edytuj „Audyt ISO”' }))
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

  it('shows a refused deletion beside the form', async () => {
    vi.spyOn(api, 'calendarEvents').mockResolvedValue([EVENT])
    vi.spyOn(api, 'deleteCalendarEvent').mockRejectedValue(new Error('Wydarzenie już usunięto'))
    renderScreen(<CalendarEventsPanel />)

    fireEvent.click(await screen.findByRole('button', { name: 'Usuń „Szkolenie BHP”' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Wydarzenie już usunięto')
    expect(screen.queryByText(/Usunięto „/)).not.toBeInTheDocument()
  })
})
