import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { renderScreen } from '../test/render'
import { DateField } from './DateField'

const shown = () => (document.querySelector('input') as HTMLInputElement | null)?.value

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
