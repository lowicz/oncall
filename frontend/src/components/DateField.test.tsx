import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderScreen } from '../test/render'
import { DateField } from './DateField'

const shown = () => (document.querySelector('input') as HTMLInputElement | null)?.value

const openCalendar = () => fireEvent.click(screen.getByRole('button', { name: 'Wybierz datę' }))

/** The day cells of the open month grid, by their visible number. */
const day = (number: string) => screen.findByRole('gridcell', { name: number })

describe('DateField', () => {
  it('renders an ISO value as DD-MM-YYYY', () => {
    renderScreen(<DateField id="d" label="Od" value="2026-09-14" onChange={() => {}} />)
    expect(shown()).toBe('14-09-2026')
  })

  it('does not swap day and month for an ambiguous date', () => {
    // 2026-03-04 would read as 03-04 in either order if the order were wrong.
    renderScreen(<DateField id="d" label="Od" value="2026-03-04" onChange={() => {}} />)
    expect(shown()).toBe('04-03-2026')
  })

  it('hands a valid typed date back as ISO without shifting its sections', () => {
    const onChange = vi.fn()
    renderScreen(<DateField id="d" label="Od" value="2026-09-14" onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Od'), { target: { value: '31082026' } })
    expect(onChange).toHaveBeenCalledWith('2026-08-31')
  })

  it('shows an error and preserves the form value for an impossible date', () => {
    const onChange = vi.fn()
    renderScreen(<DateField id="d" label="Od" value="2026-09-12" onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Od'), { target: { value: '31092026' } })
    expect(screen.getByText('Nieprawidłowa data')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('accepts an empty value without crashing', () => {
    renderScreen(<DateField id="d" label="Od" value="" onChange={() => {}} />)
    expect(shown()).toBe('')
  })
})

describe('DateField calendar', () => {
  it('picks the date of the day cell that was clicked', async () => {
    const onChange = vi.fn()
    renderScreen(<DateField id="d" label="Od" value="2026-09-14" onChange={onChange} />)
    openCalendar()
    fireEvent.click(await day('22'))
    expect(onChange).toHaveBeenCalledWith('2026-09-22')
  })

  it('opens on the month of the value, so the first click is not a month away', async () => {
    renderScreen(<DateField id="d" label="Od" value="2026-03-04" onChange={() => {}} />)
    openCalendar()
    // Polish month names confirm the locale reached the calendar as well.
    expect(await screen.findByText(/marzec 2026/i)).toBeInTheDocument()
  })

  it('closes the calendar once a day has been chosen', async () => {
    renderScreen(<DateField id="d" label="Od" value="2026-09-14" onChange={() => {}} />)
    openCalendar()
    fireEvent.click(await day('22'))
    await waitFor(() => expect(screen.queryByRole('gridcell', { name: '22' })).toBeNull())
  })

  it('shows the picked day back in the field in DD-MM-YYYY', async () => {
    function Controlled() {
      const [value, setValue] = useState('2026-09-14')
      return <DateField id="d" label="Od" value={value} onChange={setValue} />
    }
    renderScreen(<Controlled />)
    openCalendar()
    fireEvent.click(await day('22'))
    await waitFor(() => expect(shown()).toBe('22-09-2026'))
  })

  it('offers no day outside the allowed range', async () => {
    const onChange = vi.fn()
    renderScreen(
      <DateField
        id="d"
        label="Od"
        value="2026-09-14"
        onChange={onChange}
        minDate="2026-09-10"
        maxDate="2026-09-20"
      />,
    )
    openCalendar()
    expect(await day('22')).toBeDisabled()
    fireEvent.click(await day('22'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not open the calendar of a disabled field', () => {
    renderScreen(<DateField id="d" label="Od" value="2026-09-14" onChange={() => {}} disabled />)
    expect(screen.getByRole('button', { name: 'Wybierz datę' })).toBeDisabled()
  })
})
