import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
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
    cell(0, 0).focus()
    fireEvent.keyDown(cell(0, 0), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(cell(0, 1))
    fireEvent.keyDown(cell(0, 1), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(cell(1, 1))
  })

  it('jumps a whole week with PageUp and PageDown', () => {
    render(<Grid rows={4} cols={30} />)
    cell(0, 0).focus()
    fireEvent.keyDown(cell(0, 0), { key: 'PageDown' })
    expect(document.activeElement).toBe(cell(0, 7))
    fireEvent.keyDown(cell(0, 7), { key: 'PageUp' })
    expect(document.activeElement).toBe(cell(0, 0))
  })

  it('clamps at the edges instead of wrapping', () => {
    render(<Grid rows={3} cols={5} />)
    cell(0, 0).focus()
    fireEvent.keyDown(cell(0, 0), { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(cell(0, 0))
    fireEvent.keyDown(cell(0, 0), { key: 'ArrowUp' })
    expect(document.activeElement).toBe(cell(0, 0))
  })

  it('sends Home and End to the ends of the row', () => {
    render(<Grid rows={3} cols={12} />)
    cell(1, 4).focus()
    fireEvent.keyDown(cell(1, 4), { key: 'End' })
    expect(document.activeElement).toBe(cell(1, 11))
    fireEvent.keyDown(cell(1, 11), { key: 'Home' })
    expect(document.activeElement).toBe(cell(1, 0))
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
    cell(0, 0).focus()
    fireEvent.keyDown(cell(0, 0), { key: 'End' })
    expect(document.activeElement).toBe(cell(0, 29))

    view.rerender(<Resizable cols={7} />)
    const tabbable = screen.getAllByRole('button').filter((b) => b.tabIndex === 0)
    expect(tabbable).toHaveLength(1)
    expect(tabbable[0]).toHaveAttribute('aria-label', '0-6')
  })

  it('survives the grid emptying entirely', () => {
    const view = render(<Resizable cols={5} />)
    cell(0, 0).focus()
    fireEvent.keyDown(cell(0, 0), { key: 'End' })
    expect(() => view.rerender(<Resizable cols={0} />)).not.toThrow()
  })
})
