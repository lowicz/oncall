import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { loadRealStylesheet } from '../test/stylesheet'
import { AnchorButton, Button, IconButton, LinkButton } from './Button'

describe('Button', () => {
  it.each([
    ['primary', 'btn-pri'],
    ['ghost', 'btn-ghost'],
    ['danger', 'btn-danger'],
  ] as const)('paints the %s variant', (variant, className) => {
    render(<Button variant={variant}>Zapisz</Button>)
    expect(screen.getByRole('button', { name: 'Zapisz' })).toHaveClass('btn', className)
  })

  it('is a plain, medium, non-submitting button by default', () => {
    render(<Button>Anuluj</Button>)
    const button = screen.getByRole('button', { name: 'Anuluj' })
    expect(button.className).toBe('btn')
    expect(button).toHaveAttribute('type', 'button')
    expect(button).not.toHaveAttribute('aria-busy')
    expect(button.querySelector('svg, .spinner')).toBeNull()
  })

  it('shows its icon, is small and stretches when asked, and forwards the ref', () => {
    const ref = createRef<HTMLButtonElement>()
    const onClick = vi.fn()
    render(<Button ref={ref} icon="plus" size="sm" block type="submit" className="x" onClick={onClick}>Dodaj</Button>)
    const button = screen.getByRole('button', { name: 'Dodaj' })
    expect(button).toHaveClass('btn', 'btn-sm', 'btn-block', 'x')
    expect(button).toHaveAttribute('type', 'submit')
    expect(button.querySelector('svg.icon')).not.toBeNull()
    expect(ref.current).toBe(button)
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('spins and refuses clicks while its action is pending', () => {
    render(<Button loading icon="plus">Publikuj</Button>)
    const button = screen.getByRole('button', { name: 'Publikuj' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button.querySelector('.spinner')).not.toBeNull()
    expect(button.querySelector('svg')).toBeNull()
  })

  it('paints the pending spinner the size the real stylesheet gives it', () => {
    loadRealStylesheet()
    render(<Button loading>Publikuj</Button>)
    const spinner = screen.getByRole('button', { name: 'Publikuj' }).querySelector('.spinner')!
    const painted = getComputedStyle(spinner)
    expect([painted.width, painted.height, painted.display]).toEqual(['12px', '12px', 'inline-block'])
    expect(painted.animation).toContain('spin ')
  })

  it('can be disabled without spinning', () => {
    render(<Button disabled>Usuń</Button>)
    expect(screen.getByRole('button', { name: 'Usuń' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Usuń' })).not.toHaveAttribute('aria-busy')
  })
})

describe('IconButton', () => {
  it('is named by its label, which is also the tooltip', () => {
    const ref = createRef<HTMLButtonElement>()
    render(<IconButton ref={ref} label="Zamknij" icon="x" />)
    const button = screen.getByRole('button', { name: 'Zamknij' })
    expect(button).toHaveAttribute('title', 'Zamknij')
    expect(button).toHaveAttribute('type', 'button')
    expect(button.className).toBe('ib')
    expect(button).not.toHaveAttribute('aria-pressed')
    expect(ref.current).toBe(button)
  })

  it('shows a small pressed toggle', () => {
    render(<IconButton label="Filtr" icon="filter" size="sm" active className="f" type="submit" />)
    const button = screen.getByRole('button', { name: 'Filtr' })
    expect(button).toHaveClass('ib', 'ib-sm', 'ib-on', 'f')
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(button).toHaveAttribute('type', 'submit')
  })
})

describe('link buttons', () => {
  it('route inside the application', () => {
    render(<MemoryRouter><LinkButton to="/grafik" variant="primary" icon="calendar">Grafik</LinkButton></MemoryRouter>)
    const link = screen.getByRole('link', { name: 'Grafik' })
    expect(link).toHaveAttribute('href', '/grafik')
    expect(link).toHaveClass('btn', 'btn-pri')
    expect(link.querySelector('svg')).not.toBeNull()
  })

  it('route without an icon', () => {
    render(<MemoryRouter><LinkButton to="/" size="sm">Start</LinkButton></MemoryRouter>)
    const link = screen.getByRole('link', { name: 'Start' })
    expect(link).toHaveClass('btn-sm')
    expect(link.querySelector('svg')).toBeNull()
  })

  it('lead out of the application as a plain anchor', () => {
    const { rerender } = render(<AnchorButton href="/docs/" variant="ghost" icon="doc">Dokumentacja</AnchorButton>)
    const anchor = screen.getByRole('link', { name: 'Dokumentacja' })
    expect(anchor).toHaveAttribute('href', '/docs/')
    expect(anchor).toHaveClass('btn', 'btn-ghost')
    expect(anchor.querySelector('svg')).not.toBeNull()
    rerender(<AnchorButton href="/feed.ics">ICS</AnchorButton>)
    expect(screen.getByRole('link', { name: 'ICS' }).querySelector('svg')).toBeNull()
  })
})
