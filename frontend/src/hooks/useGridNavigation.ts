import { useCallback, useRef, useState } from 'react'

interface Cell { row: number; col: number }
type IsCellDisabled = (row: number, col: number) => boolean
const noDisabledCells: IsCellDisabled = () => false

/** The cells of the given rows in reading order. */
const cellsOf = (rows: number[], cols: number): Cell[] =>
  rows.flatMap((row) => Array.from({ length: cols }, (_, col) => ({ row, col })))
const upTo = (count: number) => Array.from({ length: count }, (_, index) => index)

/**
 * Roving tabindex for a two-dimensional grid of buttons.
 *
 * Without it every cell is a tab stop: a 4-person / 30-day matrix put 120 stops
 * between the calendar and the rest of the page, and a real team makes that
 * several hundred. Here the grid is a single stop and the arrow keys move
 * inside it, which is the pattern screen-reader and keyboard users expect.
 * A calendar disables past days and the blanks around the month: the keys
 * step over those, so they never land where focus cannot go. With `wrap` the
 * left and right arrows run on across rows, as a calendar's days do.
 */
export function useGridNavigation(rows: number, cols: number, { isCellDisabled = noDisabledCells, wrap = false }: {
  isCellDisabled?: IsCellDisabled
  wrap?: boolean
} = {}) {
  const [active, setActive] = useState<Cell>({ row: 0, col: 0 })
  const refs = useRef(new Map<string, HTMLButtonElement | null>())
  const key = (row: number, col: number) => `${row}:${col}`
  const firstEnabled = useCallback(
    (cells: Cell[]) => cells.find((cell) => !isCellDisabled(cell.row, cell.col)),
    [isCellDisabled],
  )

  const focusCell = useCallback((row: number, col: number) => {
    const clamped = {
      row: Math.max(0, Math.min(row, rows - 1)),
      col: Math.max(0, Math.min(col, cols - 1)),
    }
    if (isCellDisabled(clamped.row, clamped.col)) return
    setActive(clamped)
    refs.current.get(key(clamped.row, clamped.col))?.focus()
  }, [rows, cols, isCellDisabled])

  const onKeyDown = useCallback((event: React.KeyboardEvent, row: number, col: number) => {
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      // The row's first or last cell; with Ctrl, the grid's.
      const cells = cellsOf(event.ctrlKey ? upTo(rows) : [row], cols)
      const target = firstEnabled(event.key === 'End' ? cells.reverse() : cells)
      if (target) focusCell(target.row, target.col)
      return
    }
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault()
      // A week at a time, which is how rotations are actually read.
      focusCell(row, col + (event.key === 'PageUp' ? -7 : 7))
      return
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    // The nearest enabled cell that way, along the column or the row (the
    // whole grid in reading order with `wrap`); at the edge the focus stays.
    const line = event.key === 'ArrowUp' || event.key === 'ArrowDown'
      ? upTo(rows).map((each) => ({ row: each, col }))
      : cellsOf(wrap ? upTo(rows) : [row], cols)
    const at = line.findIndex((cell) => cell.row === row && cell.col === col)
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown'
    const target = firstEnabled(forward ? line.slice(at + 1) : line.slice(0, at).reverse())
    if (target) focusCell(target.row, target.col)
  }, [focusCell, firstEnabled, rows, cols, wrap])

  // The grid shrinks whenever the date range narrows or the "only people on duty"
  // filter is switched on. Without clamping here, an active cell that no longer
  // exists leaves every cell at tabIndex -1 and the matrix becomes unreachable by
  // keyboard, so the position is clamped at render rather than only on move.
  // A disabled active cell hands the stop to the first enabled one.
  const clamped = {
    row: Math.min(active.row, Math.max(0, rows - 1)),
    col: Math.min(active.col, Math.max(0, cols - 1)),
  }
  const safe = isCellDisabled(clamped.row, clamped.col) ? firstEnabled(cellsOf(upTo(rows), cols)) : clamped
  const safeRow = safe?.row ?? -1
  const safeCol = safe?.col ?? -1

  /** Props for one cell button. Only the active cell stays in the tab order. */
  const cellProps = (row: number, col: number) => ({
    ref: (node: HTMLButtonElement | null) => {
      refs.current.set(key(row, col), node)
    },
    tabIndex: safeRow === row && safeCol === col ? 0 : -1,
    onKeyDown: (event: React.KeyboardEvent) => onKeyDown(event, row, col),
    onFocus: () => setActive({ row, col }),
  })

  return { cellProps, focusCell, active: { row: safeRow, col: safeCol } }
}
