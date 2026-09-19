import { useCallback, useRef, useState } from 'react'

interface Cell { row: number; col: number }

/**
 * Roving tabindex for a two-dimensional grid of buttons.
 *
 * Without it every cell is a tab stop: a 4-person / 30-day matrix put 120 stops
 * between the calendar and the rest of the page, and a real team makes that
 * several hundred. Here the grid is a single stop and the arrow keys move
 * inside it, which is the pattern screen-reader and keyboard users expect.
 */
export function useGridNavigation(rows: number, cols: number) {
  const [active, setActive] = useState<Cell>({ row: 0, col: 0 })
  const refs = useRef(new Map<string, HTMLButtonElement | null>())
  const key = (row: number, col: number) => `${row}:${col}`

  const focusCell = useCallback((row: number, col: number) => {
    const clamped = {
      row: Math.max(0, Math.min(row, rows - 1)),
      col: Math.max(0, Math.min(col, cols - 1)),
    }
    setActive(clamped)
    refs.current.get(key(clamped.row, clamped.col))?.focus()
  }, [rows, cols])

  const onKeyDown = useCallback((event: React.KeyboardEvent, row: number, col: number) => {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [row, col - 1],
      ArrowRight: [row, col + 1],
      ArrowUp: [row - 1, col],
      ArrowDown: [row + 1, col],
      // A week at a time, which is how rotations are actually read.
      PageUp: [row, col - 7],
      PageDown: [row, col + 7],
    }
    if (event.key === 'Home') {
      event.preventDefault()
      focusCell(event.ctrlKey ? 0 : row, 0)
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      focusCell(event.ctrlKey ? rows - 1 : row, cols - 1)
      return
    }
    const move = moves[event.key]
    if (!move) return
    event.preventDefault()
    focusCell(move[0], move[1])
  }, [focusCell, rows, cols])

  // The grid shrinks whenever the date range narrows or the "only people on duty"
  // filter is switched on. Without clamping here, an active cell that no longer
  // exists leaves every cell at tabIndex -1 and the matrix becomes unreachable by
  // keyboard, so the position is clamped at render rather than only on move.
  const safeRow = Math.min(active.row, Math.max(0, rows - 1))
  const safeCol = Math.min(active.col, Math.max(0, cols - 1))

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
