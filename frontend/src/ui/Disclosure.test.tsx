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
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(container.firstElementChild).toHaveClass('panel', 'details', 'mine')

    fireEvent.click(summary)
    expect(summary).toHaveAttribute('aria-expanded', 'true')
    const body = screen.getByRole('textbox', { name: 'Waga' }).closest('.details-body')!
    expect(summary).toHaveAttribute('aria-controls', body.id)
    expect(container.firstElementChild).toHaveClass('details-open')

    fireEvent.click(summary)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})
