import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { renderScreen } from '../../test/render'
import { HistoryImportPanel } from './HistoryImport'
import { inFileOrder } from '../../lib/historyImport'
import { HistoryImportError, api } from '../../api'

// The order the API reports them in: the CSV checks first, then the roster
// checks, so rows jump back and forth.
const reported: HistoryImportError[] = [
  { row_number: 4, field: 'role', message: 'Duplikat roli dla tego dnia' },
  { row_number: 5, field: 'service_date', message: 'Oczekiwany format RRRR-MM-DD' },
  { row_number: 6, field: 'role', message: 'Dozwolone: primary, secondary, late_shift' },
  { row_number: 7, field: 'assignee_name', message: 'Osoba jest wymagana' },
  { row_number: 3, field: 'assignee_name', message: 'Osoby nie ma w zespole' },
  { row_number: 9, field: 'assignee_name', message: 'Osoby nie ma w zespole' },
  { row_number: 3, field: 'role', message: 'Zmiana 11–19 może występować tylko w dni robocze' },
  { row_number: null, field: null, message: 'Plik może zawierać maksymalnie 5000 wierszy' },
  { row_number: 2, field: 'assignee_name', message: 'Osoba nie była aktywna w rotacji tego dnia' },
  { row_number: 2, field: 'assignee_name', message: 'Osoba nie ma uprawnienia do tej roli' },
]

afterEach(() => {
  vi.restoreAllMocks()
})

describe('inFileOrder', () => {
  it('orders the problems by row, then by column as the CSV lays them out, then by message', () => {
    expect(inFileOrder(reported).map((error) => [error.row_number, error.message])).toEqual([
      [null, 'Plik może zawierać maksymalnie 5000 wierszy'],
      [2, 'Osoba nie była aktywna w rotacji tego dnia'],
      [2, 'Osoba nie ma uprawnienia do tej roli'],
      [3, 'Zmiana 11–19 może występować tylko w dni robocze'],
      [3, 'Osoby nie ma w zespole'],
      [4, 'Duplikat roli dla tego dnia'],
      [5, 'Oczekiwany format RRRR-MM-DD'],
      [6, 'Dozwolone: primary, secondary, late_shift'],
      [7, 'Osoba jest wymagana'],
      [9, 'Osoby nie ma w zespole'],
    ])
  })

  it('gives the same order whatever order the problems came in', () => {
    expect(inFileOrder([...reported].reverse())).toEqual(inFileOrder(reported))
    // The preview it was given stays as the API sent it.
    expect(reported[0].row_number).toBe(4)
  })
})

describe('HistoryImportPanel preview', () => {
  it('lists the problems of an uploaded file from the top of the file down', async () => {
    vi.spyOn(api, 'historyImports').mockResolvedValue([])
    vi.spyOn(api, 'previewHistory').mockResolvedValue({ filename: 'historia.csv', valid: false, rows: [], errors: reported.slice(0, 7) })
    const { container } = renderScreen(<HistoryImportPanel />)

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['service_date,role,assignee_name'], 'historia.csv', { type: 'text/csv' })] } })

    const box = (await screen.findByText('7 błędów - popraw plik i wgraj go ponownie')).closest('.box') as HTMLElement
    expect(within(box).getAllByRole('listitem').map((item) => item.textContent?.split(':')[0])).toEqual([
      'Wiersz 3', 'Wiersz 3', 'Wiersz 4', 'Wiersz 5', 'Wiersz 6', 'Wiersz 7', 'Wiersz 9',
    ])
    expect(screen.getByText('0 wierszy · 7 błędów')).toBeInTheDocument()
  })

  it('declines the number of problems', async () => {
    vi.spyOn(api, 'historyImports').mockResolvedValue([])
    vi.spyOn(api, 'previewHistory').mockResolvedValue({ filename: 'historia.csv', valid: false, rows: [], errors: reported.slice(0, 2) })
    const { container } = renderScreen(<HistoryImportPanel />)

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'historia.csv', { type: 'text/csv' })] } })

    expect(await screen.findByText('2 błędy - popraw plik i wgraj go ponownie')).toBeInTheDocument()
    expect(screen.getByText('0 wierszy · 2 błędy')).toBeInTheDocument()
  })
})
