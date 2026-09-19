import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { renderScreen } from '../test/render'
import { MonthField } from './MonthField'

const segments = () =>
  [...document.querySelectorAll('[role=spinbutton]')].map((e) => e.getAttribute('aria-label'))

const shown = () => (document.querySelector('input') as HTMLInputElement | null)?.value

describe('MonthField', () => {
  it('shows a billing month as MM-YYYY, not an English month name', () => {
    renderScreen(<MonthField id="m" label="Miesiąc" value="2026-09" onChange={() => {}} />)
    expect(shown()).toBe('09-2026')
    expect(segments()).toEqual(['Month', 'Year'])
  })

  it('reports the month in the format the report endpoint expects', async () => {
    const onChange = vi.fn()
    renderScreen(<MonthField id="m" label="Miesiąc" value="2026-09" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Choose date|Wybierz datę/ }))
    const dialog = await screen.findByRole('dialog')
    // Polish month abbreviations confirm the locale reached the picker.
    fireEvent.click(within(dialog).getByText('lis'))
    expect(onChange).toHaveBeenCalledWith('2026-11')
  })
})
