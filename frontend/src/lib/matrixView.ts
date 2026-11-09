import type { MatrixZoom } from '../components/CalendarMatrix'

/** How a screen with the matrix keeps its view in the URL. */
export type MatrixView = 'matrix' | 'list'

export const WEEKS: Record<MatrixZoom, number> = { '2': 2, '4': 4, '8': 8 }

export const isZoom = (value: string | null): value is MatrixZoom => value === '2' || value === '4' || value === '8'

/** "Only on duty" in the URL of a screen with the matrix: `?tylko=z-dyzurem`. */
export const ONLY_ON_DUTY = { key: 'tylko', value: 'z-dyzurem' }

/** The matrix or the day list in the URL: `?widok=lista`; without it the screen's width chooses. */
export const VIEW_KEY = 'widok'
export const VIEW_SLUGS: Record<MatrixView, string> = { matrix: 'macierz', list: 'lista' }
export const viewOf = (slug: string | null, narrow: boolean): MatrixView =>
  (Object.keys(VIEW_SLUGS) as MatrixView[]).find((view) => VIEW_SLUGS[view] === slug) ?? (narrow ? 'list' : 'matrix')
