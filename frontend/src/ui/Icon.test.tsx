import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Icon, Mark } from './Icon'

describe('Icon', () => {
  it('is decorative by default', () => {
    const { container } = render(<Icon name="calendar" className="big" />)
    const svg = container.querySelector('svg')!
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).not.toHaveAttribute('role')
    expect(svg).toHaveAttribute('width', '20')
    expect(svg).toHaveClass('icon', 'big')
    expect(svg.querySelector('title')).toBeNull()
    expect(svg.querySelector('path')!.getAttribute('d')).toMatch(/^M5.75 4.75h12.5/)
  })

  it('is an image with a name when it carries meaning alone', () => {
    render(<Icon name="alert" size={20} title="Ostrzeżenie" />)
    const image = screen.getByRole('img', { name: 'Ostrzeżenie' })
    expect(image).not.toHaveAttribute('aria-hidden')
    expect(image).toHaveAttribute('height', '20')
  })
})

describe('Mark', () => {
  it('draws the product mark, hidden from assistive technology', () => {
    const { container } = render(<Mark size={40} className="rail" />)
    const svg = container.querySelector('svg')!
    expect(svg).toHaveClass('mark', 'rail')
    expect(svg).toHaveAttribute('width', '40')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })
})
