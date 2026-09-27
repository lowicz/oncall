import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { renderScreen } from '../test/render'
import { MatrixControls, MatrixView } from './MatrixControls'
import type { MatrixZoom } from './CalendarMatrix'

function setup(over: Partial<Parameters<typeof MatrixControls>[0]> = {}) {
  const props = {
    zoom: '4' as MatrixZoom,
    onZoom: vi.fn(),
    onShift: vi.fn(),
    onToday: vi.fn(),
    hideIdle: false,
    onHideIdle: vi.fn(),
    view: 'matrix' as MatrixView,
    onView: vi.fn(),
    showAvailability: false,
    ...over,
  }
  renderScreen(<MatrixControls {...props} />)
  return props
}

describe('MatrixControls', () => {
  it('zooms, moves a week either way and back to today', () => {
    const props = setup()
    fireEvent.click(screen.getByRole('radio', { name: '8 tyg.' }))
    expect(props.onZoom).toHaveBeenCalledWith('8')

    fireEvent.click(screen.getByRole('button', { name: 'Cofnij o tydzień' }))
    expect(props.onShift).toHaveBeenLastCalledWith(-7)
    fireEvent.click(screen.getByRole('button', { name: 'Do przodu o tydzień' }))
    expect(props.onShift).toHaveBeenLastCalledWith(7)
    fireEvent.click(screen.getByRole('button', { name: 'dziś' }))
    expect(props.onToday).toHaveBeenCalledTimes(1)
  })

  it('disables the arrow that would leave a bounded range and drops the range for a fixed one', () => {
    setup({ canShiftBack: false })
    expect(screen.getByRole('button', { name: 'Cofnij o tydzień' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Do przodu o tydzień' })).toBeEnabled()
  })

  it('shows no zoom or arrows when the range is fixed', () => {
    setup({ showRange: false })
    expect(screen.queryByRole('radiogroup', { name: 'Długość zakresu' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cofnij o tydzień' })).not.toBeInTheDocument()
  })

  it('toggles the idle rows and the day list', () => {
    const matrix = setup({ hideIdle: true })
    const onlyOnDuty = screen.getByRole('button', { name: 'Tylko z dyżurem' })
    expect(onlyOnDuty).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(onlyOnDuty)
    expect(matrix.onHideIdle).toHaveBeenCalledWith(false)

    const dayList = screen.getByRole('button', { name: 'Lista dni' })
    expect(dayList).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(dayList)
    expect(matrix.onView).toHaveBeenCalledWith('list')
  })

  it('goes back to the matrix from the day list', () => {
    const props = setup({ view: 'list' })
    const dayList = screen.getByRole('button', { name: 'Lista dni' })
    expect(dayList).toHaveAttribute('aria-pressed', 'true')
    expect(dayList).toHaveClass('on')
    fireEvent.click(dayList)
    expect(props.onView).toHaveBeenCalledWith('matrix')
  })

  it('opens the legend with the availability marks only where availability is shown', async () => {
    setup({ showAvailability: true })
    fireEvent.click(screen.getByRole('button', { name: 'Legenda' }))
    const legend = await screen.findByRole('dialog', { name: 'Legenda' })
    expect(within(legend).getByText('Dostępność')).toBeInTheDocument()
    expect(within(legend).getByText(/po zamianie/)).toBeInTheDocument()
  })

  it('leaves the availability marks out of the legend otherwise', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Legenda' }))
    const legend = await screen.findByRole('dialog', { name: 'Legenda' })
    expect(within(legend).queryByText('Dostępność')).not.toBeInTheDocument()
  })
})
