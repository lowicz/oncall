import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderScreen } from '../test/render'
import { chooseFromMenu, openMenu } from '../test/menu'
import { LegendPopover, MatrixControls, MatrixView } from './MatrixControls'
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

  it('keeps the filter, the day list and the legend in one "more" menu', async () => {
    const matrix = setup({ hideIdle: true })
    const menu = await openMenu('Więcej')
    expect(within(menu).getByRole('menuitemcheckbox', { name: 'Tylko z dyżurem' })).toHaveAttribute('aria-checked', 'true')
    expect(within(menu).getByRole('menuitemcheckbox', { name: 'Lista dni' })).toHaveAttribute('aria-checked', 'false')
    // The ICS export belongs to a member of the rotation only.
    expect(within(menu).queryByRole('menuitem', { name: 'Eksport ICS' })).not.toBeInTheDocument()
    fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'Tylko z dyżurem' }))
    expect(matrix.onHideIdle).toHaveBeenCalledWith(false)
    fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name: 'Lista dni' }))
    expect(matrix.onView).toHaveBeenCalledWith('list')
  })

  it('goes back to the matrix from the day list', async () => {
    const props = setup({ view: 'list' })
    const menu = await openMenu('Więcej')
    const dayList = within(menu).getByRole('menuitemcheckbox', { name: 'Lista dni' })
    expect(dayList).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(dayList)
    expect(props.onView).toHaveBeenCalledWith('matrix')
  })

  it('offers a member of the rotation the ICS export, which lives on "Moje"', async () => {
    setup({ icsExport: true })
    const menu = await openMenu('Więcej')
    expect(within(menu).getByRole('menuitem', { name: 'Eksport ICS' })).toHaveAttribute('href', '/moje#ics')
  })

  it('opens the legend with the availability marks only where availability is shown', async () => {
    setup({ showAvailability: true })
    await chooseFromMenu('Więcej', 'Legenda')
    const legend = await screen.findByRole('dialog', { name: 'Legenda' })
    expect(within(legend).getByText('Dostępność')).toBeInTheDocument()
    expect(within(legend).getByText(/po zamianie/)).toBeInTheDocument()
  })

  it('hangs the legend off the "more" button and gives the focus back to it', async () => {
    setup()
    await chooseFromMenu('Więcej', 'Legenda')
    const legend = await screen.findByRole('dialog', { name: 'Legenda' })
    fireEvent.keyDown(legend, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Legenda' })).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Więcej' })).toHaveFocus())
  })

  it('leaves the availability marks out of the legend otherwise', async () => {
    setup()
    await chooseFromMenu('Więcej', 'Legenda')
    const legend = await screen.findByRole('dialog', { name: 'Legenda' })
    expect(within(legend).queryByText('Dostępność')).not.toBeInTheDocument()
  })

  it('names the grid keys in the matrix legend', async () => {
    setup()
    await chooseFromMenu('Więcej', 'Legenda')
    const legend = await screen.findByRole('dialog', { name: 'Legenda' })
    expect(within(legend).getByText('Klawisze')).toBeInTheDocument()
    expect(within(legend).getByText(/PageUp i PageDown/)).toBeInTheDocument()
  })

  it('leaves the grid keys out of the legend over the day list', async () => {
    setup({ view: 'list' })
    await chooseFromMenu('Więcej', 'Legenda')
    const legend = await screen.findByRole('dialog', { name: 'Legenda' })
    expect(within(legend).queryByText('Klawisze')).not.toBeInTheDocument()
  })

  it('leaves the grid keys out of a legend over a grid without key navigation', async () => {
    renderScreen(<LegendPopover showAvailability trigger={<button type="button">Legenda</button>} />)
    fireEvent.click(screen.getByRole('button', { name: 'Legenda' }))
    const legend = await screen.findByRole('dialog', { name: 'Legenda' })
    expect(within(legend).queryByText('Klawisze')).not.toBeInTheDocument()
  })
})
