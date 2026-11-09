import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Disclosure } from './Disclosure'

describe('Disclosure', () => {
  it('keeps the body out of the page until opened, and closes again', () => {
    const { container } = render(
      <Disclosure title="Ustawienia zaawansowane" className="mine">
        <label>Waga <input /></label>
      </Disclosure>,
    )
    const summary = screen.getByRole('button', { name: /Ustawienia zaawansowane/ })
    expect(summary).toHaveAttribute('aria-expanded', 'false')
    // It names the body it controls only while the body exists.
    expect(summary).not.toHaveAttribute('aria-controls')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(container.firstElementChild).toHaveClass('panel', 'details', 'mine')

    fireEvent.click(summary)
    expect(summary).toHaveAttribute('aria-expanded', 'true')
    const body = screen.getByRole('textbox', { name: 'Waga' }).closest('.details-body')!
    expect(summary).toHaveAttribute('aria-controls', body.id)
    expect(container.firstElementChild).toHaveClass('details-open')

    fireEvent.click(summary)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(container.querySelector('.details-meta')).toBeNull()
  })

  it('sums the folded body up on the summary line', () => {
    render(<Disclosure title="Wpływ na bilans" meta="Ty -1 · Anna +1"><p>Treść</p></Disclosure>)
    expect(screen.getByRole('button', { name: 'Wpływ na bilans Ty -1 · Anna +1' })).toHaveAttribute('aria-expanded', 'false')
  })
})
