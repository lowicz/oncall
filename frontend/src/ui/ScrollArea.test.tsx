import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ScrollArea } from './ScrollArea'

/** jsdom lays nothing out; these stand in for the widths a browser measures. */
const layout = { scrollWidth: 0, clientWidth: 0, scrollLeft: 0 }

beforeEach(() => {
  Object.assign(layout, { scrollWidth: 0, clientWidth: 0, scrollLeft: 0 })
  for (const key of ['scrollWidth', 'clientWidth', 'scrollLeft'] as const) {
    vi.spyOn(HTMLElement.prototype, key, 'get').mockImplementation(() => layout[key])
  }
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const HINT = 'Przewiń tabelę w bok.'

function renderArea() {
  render(
    <ScrollArea label="Raport za sierpień 2026" hint={HINT}>
      <table><tbody><tr><td>1</td></tr></tbody></table>
    </ScrollArea>,
  )
  const region = screen.getByRole('region', { name: 'Raport za sierpień 2026' })
  return { region, area: region.closest('.scroll-area') as HTMLElement }
}

describe('ScrollArea', () => {
  it('stays plain while everything fits', () => {
    Object.assign(layout, { scrollWidth: 800, clientWidth: 800 })
    const { region, area } = renderArea()

    expect(screen.queryByText(HINT)).not.toBeInTheDocument()
    expect(region).not.toHaveAttribute('tabindex')
    expect(area).not.toHaveClass('scroll-area-start')
    expect(area).not.toHaveClass('scroll-area-end')
  })

  it('says columns are out of view, fades that edge and takes focus for the arrow keys', () => {
    Object.assign(layout, { scrollWidth: 980, clientWidth: 360 })
    const { region, area } = renderArea()

    expect(screen.getByText(HINT)).toBeInTheDocument()
    expect(region).toHaveAttribute('tabindex', '0')
    expect(area).toHaveClass('scroll-area-end')
    expect(area).not.toHaveClass('scroll-area-start')

    layout.scrollLeft = 300
    fireEvent.scroll(region)
    expect(area).toHaveClass('scroll-area-start', 'scroll-area-end')

    layout.scrollLeft = 620
    fireEvent.scroll(region)
    expect(area).toHaveClass('scroll-area-start')
    expect(area).not.toHaveClass('scroll-area-end')
    // Scrolled to the end the columns on the left are hidden instead.
    expect(screen.getByText(HINT)).toBeInTheDocument()
  })

  it('measures again when the window is resized', () => {
    Object.assign(layout, { scrollWidth: 980, clientWidth: 360 })
    const { region } = renderArea()
    expect(screen.getByText(HINT)).toBeInTheDocument()

    layout.clientWidth = 1186
    layout.scrollWidth = 1186
    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(screen.queryByText(HINT)).not.toBeInTheDocument()
    expect(region).not.toHaveAttribute('tabindex')
  })

  it('follows the size of the region and of its content where the browser reports it', () => {
    const observed: Element[] = []
    let notify = () => {}
    const disconnect = vi.fn()
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { notify = callback }
      observe(element: Element) { observed.push(element) }
      disconnect = disconnect
    })
    Object.assign(layout, { scrollWidth: 800, clientWidth: 800 })
    const { region } = renderArea()
    expect(observed).toEqual([region, region.firstElementChild])
    expect(screen.queryByText(HINT)).not.toBeInTheDocument()

    layout.scrollWidth = 1229
    act(() => notify())
    expect(screen.getByText(HINT)).toBeInTheDocument()
  })
})
