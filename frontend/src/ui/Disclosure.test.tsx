import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Disclosure } from './Disclosure'

describe('Disclosure', () => {
  it('keeps the body out of the page until opened, and closes again', () => {
    const { container } = render(
      <Disclosure title="Ustawienia zaawansowane" meta="3 opcje" className="mine">
        <label>Waga <input /></label>
      </Disclosure>,
    )
    const summary = screen.getByRole('button', { name: /Ustawienia zaawansowane/ })
    expect(summary).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('3 opcje')).toHaveClass('details-meta')
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

  it('can start open and has no meta unless given', () => {
    const { container } = render(<Disclosure title="Porównanie" defaultOpen>treść</Disclosure>)
    expect(screen.getByRole('button', { name: 'Porównanie' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('treść')).toBeInTheDocument()
    expect(container.querySelector('.details-meta')).toBeNull()
  })
})
