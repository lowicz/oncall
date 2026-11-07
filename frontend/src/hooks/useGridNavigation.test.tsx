import { describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useGridNavigation } from './useGridNavigation'

function Grid({ rows, cols }: { rows: number; cols: number }) {
  const grid = useGridNavigation(rows, cols)
  return (
    <table>
      <tbody>
        {Array.from({ length: rows }, (_, r) => (
          <tr key={r}>
            {Array.from({ length: cols }, (_, c) => (
              <td key={c}>
                <button type="button" aria-label={`${r}-${c}`} {...grid.cellProps(r, c)} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const cell = (r: number, c: number) => screen.getByLabelText(`${r}-${c}`)

describe('useGridNavigation', () => {
  it('keeps exactly one cell in the tab order', () => {
    render(<Grid rows={4} cols={10} />)
    const tabbable = screen.getAllByRole('button').filter((b) => b.tabIndex === 0)
    expect(tabbable).toHaveLength(1)
    expect(tabbable[0]).toHaveAttribute('aria-label', '0-0')
  })

  it('moves with the arrow keys', () => {
    render(<Grid rows={4} cols={10} />)
    act(() => cell(0, 0).focus())
    fireEvent.keyDown(cell(0, 0), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(cell(0, 1))
    fireEvent.keyDown(cell(0, 1), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(cell(1, 1))
  })

  it('jumps a whole week with PageUp and PageDown', () => {
    render(<Grid rows={4} cols={30} />)
    act(() => cell(0, 0).focus())
    fireEvent.keyDown(cell(0, 0), { key: 'PageDown' })
    expect(document.activeElement).toBe(cell(0, 7))
    fireEvent.keyDown(cell(0, 7), { key: 'PageUp' })
    expect(document.activeElement).toBe(cell(0, 0))
  })

  it('clamps at the edges instead of wrapping', () => {
    render(<Grid rows={3} cols={5} />)
    act(() => cell(0, 0).focus())
    fireEvent.keyDown(cell(0, 0), { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(cell(0, 0))
    fireEvent.keyDown(cell(0, 0), { key: 'ArrowUp' })
    expect(document.activeElement).toBe(cell(0, 0))
  })

  it('sends Home and End to the ends of the row', () => {
    render(<Grid rows={3} cols={12} />)
    act(() => cell(1, 4).focus())
    fireEvent.keyDown(cell(1, 4), { key: 'End' })
    expect(document.activeElement).toBe(cell(1, 11))
    fireEvent.keyDown(cell(1, 11), { key: 'Home' })
    expect(document.activeElement).toBe(cell(1, 0))
  })

  it('sends Ctrl+Home and Ctrl+End to the corners of the grid', () => {
    render(<Grid rows={3} cols={12} />)
    act(() => cell(1, 4).focus())
    fireEvent.keyDown(cell(1, 4), { key: 'End', ctrlKey: true })
    expect(document.activeElement).toBe(cell(2, 11))
    fireEvent.keyDown(cell(2, 11), { key: 'Home', ctrlKey: true })
    expect(document.activeElement).toBe(cell(0, 0))
  })

  it('leaves other keys to the cell, so Enter and Space still press it', () => {
    render(<Grid rows={2} cols={4} />)
    act(() => cell(1, 2).focus())
    const handled = fireEvent.keyDown(cell(1, 2), { key: 'Enter' })
    // Not prevented: the browser's default (pressing the button) still happens.
    expect(handled).toBe(true)
    expect(document.activeElement).toBe(cell(1, 2))
    expect(cell(1, 2).tabIndex).toBe(0)
  })

  it('skips disabled and missing cells and starts at the first available one', () => {
    const disabled = new Set(['0:0', '0:2', '1:1'])
    function SparseGrid() {
      const grid = useGridNavigation(2, 4, { isCellDisabled: (row, col) => disabled.has(`${row}:${col}`) })
      return (
        <table>
          <tbody>
            {[0, 1].map((row) => (
              <tr key={row}>
                {Array.from({ length: 4 }, (_, col) => (
                  <td key={col}>
                    <button disabled={disabled.has(`${row}:${col}`)} type="button" aria-label={`${row}-${col}`} {...grid.cellProps(row, col)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )
    }
    render(<SparseGrid />)
    expect(cell(0, 1).tabIndex).toBe(0)
    act(() => cell(0, 1).focus())
    fireEvent.keyDown(cell(0, 1), { key: 'ArrowRight' })
    expect(cell(0, 3)).toHaveFocus()
    fireEvent.keyDown(cell(0, 3), { key: 'ArrowLeft' })
    expect(cell(0, 1)).toHaveFocus()
    fireEvent.keyDown(cell(0, 1), { key: 'ArrowLeft' })
    expect(cell(0, 1)).toHaveFocus()
    fireEvent.keyDown(cell(0, 1), { key: 'End', ctrlKey: true })
    expect(cell(1, 3)).toHaveFocus()
    fireEvent.keyDown(cell(1, 3), { key: 'Home', ctrlKey: true })
    expect(cell(0, 1)).toHaveFocus()
  })

  it('runs the left and right arrows on across rows with wrap, as a calendar does', () => {
    function Calendar() {
      const grid = useGridNavigation(2, 3, { wrap: true, isCellDisabled: (row, col) => row === 1 && col === 0 })
      return (
        <>
          {[0, 1].flatMap((row) => [0, 1, 2].map((col) => (
            <button type="button" aria-label={`${row}-${col}`} key={`${row}${col}`} {...grid.cellProps(row, col)} />
          )))}
        </>
      )
    }
    render(<Calendar />)
    act(() => cell(0, 2).focus())
    fireEvent.keyDown(cell(0, 2), { key: 'ArrowRight' })
    expect(cell(1, 1)).toHaveFocus()
    fireEvent.keyDown(cell(1, 1), { key: 'ArrowLeft' })
    expect(cell(0, 2)).toHaveFocus()
    fireEvent.keyDown(cell(0, 2), { key: 'ArrowDown' })
    expect(cell(1, 2)).toHaveFocus()
  })

  it('leaves no tab stop or movement target when every cell is disabled', () => {
    function DisabledGrid() {
      const grid = useGridNavigation(1, 2, { isCellDisabled: () => true })
      return (
        <>
          <button type="button" onClick={() => grid.focusCell(0, 0)}>jump</button>
          {[0, 1].map((col) => <button disabled type="button" aria-label={`0-${col}`} key={col} {...grid.cellProps(0, col)} />)}
        </>
      )
    }
    render(<DisabledGrid />)
    const cells = [cell(0, 0), cell(0, 1)]
    expect(cells.every((button) => button.tabIndex === -1)).toBe(true)
    act(() => screen.getByText('jump').focus())
    fireEvent.click(screen.getByText('jump'))
    fireEvent.keyDown(cell(0, 0), { key: 'Home' })
    expect(screen.getByText('jump')).toHaveFocus()
  })

  it('focusCell moves focus programmatically, for the jump-to-gap action', () => {
    function Harness() {
      const grid = useGridNavigation(2, 8)
      return (
        <>
          <button type="button" onClick={() => grid.focusCell(0, 5)}>jump</button>
          <table>
            <tbody>
              {[0, 1].map((r) => (
                <tr key={r}>
                  {Array.from({ length: 8 }, (_, c) => (
                    <td key={c}>
                      <button type="button" aria-label={`${r}-${c}`} {...grid.cellProps(r, c)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )
    }
    render(<Harness />)
    fireEvent.click(screen.getByText('jump'))
    expect(document.activeElement).toBe(cell(0, 5))
  })
})

describe('useGridNavigation when the grid shrinks', () => {
  function Resizable({ cols }: { cols: number }) {
    const grid = useGridNavigation(2, cols)
    return (
      <table>
        <tbody>
          {[0, 1].map((r) => (
            <tr key={r}>
              {Array.from({ length: cols }, (_, c) => (
                <td key={c}>
                  <button type="button" aria-label={`${r}-${c}`} {...grid.cellProps(r, c)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  it('keeps a reachable cell when the range narrows under the active column', () => {
    // Reproduces: press End on a 30-day range, then shorten the range to a week.
    const view = render(<Resizable cols={30} />)
    act(() => cell(0, 0).focus())
    fireEvent.keyDown(cell(0, 0), { key: 'End' })
    expect(document.activeElement).toBe(cell(0, 29))

    view.rerender(<Resizable cols={7} />)
    const tabbable = screen.getAllByRole('button').filter((b) => b.tabIndex === 0)
    expect(tabbable).toHaveLength(1)
    expect(tabbable[0]).toHaveAttribute('aria-label', '0-6')
  })

  it('survives the grid emptying entirely', () => {
    const view = render(<Resizable cols={5} />)
    act(() => cell(0, 0).focus())
    fireEvent.keyDown(cell(0, 0), { key: 'End' })
    expect(() => view.rerender(<Resizable cols={0} />)).not.toThrow()
  })
})
