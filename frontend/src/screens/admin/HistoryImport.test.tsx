import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderScreen } from '../../test/render'
import { HistoryImportPanel } from './HistoryImport'
import { inFileOrder } from '../../lib/historyImport'
import { HistoryImportError, HistoryImportPreview, HistoryImportRecord, api } from '../../api'

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

const importRows = (count: number): HistoryImportPreview['rows'] => Array.from({ length: count }, (_, index) => ({
  row_number: index + 2,
  service_date: `2026-01-${String(index + 5).padStart(2, '0')}`,
  role: index % 2 ? 'secondary' : 'primary',
  assignee_name: `Osoba ${index + 1}`,
}))

const chooseFile = (container: HTMLElement, files: File[]) => {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files } })
}

const csvFile = () => new File(['service_date,role,assignee_name'], 'historia.csv', { type: 'text/csv' })

const stepStates = () => within(screen.getByRole('list', { name: 'Etap importu' })).getAllByRole('listitem')
  .map((step) => [step.textContent, step.className.replace('step step-', ''), step.getAttribute('aria-current')])

describe('HistoryImportPanel import', () => {
  it('previews a valid file, imports it on confirmation and moves through the steps', async () => {
    vi.spyOn(api, 'historyImports').mockResolvedValue([])
    let checked: (preview: HistoryImportPreview) => void = () => {}
    const previewHistory = vi.spyOn(api, 'previewHistory').mockReturnValue(new Promise((done) => { checked = done }))
    let imported: (value: { schedule_id: string; imported_rows: number }) => void = () => {}
    const commit = vi.spyOn(api, 'commitHistory').mockReturnValue(new Promise((done) => { imported = done }))
    const { container } = renderScreen(<HistoryImportPanel />)
    expect(stepStates()).toEqual([
      ['plik CSV', 'on', 'step'], ['podgląd i błędy', 'todo', null], ['zaimportowano', 'todo', null],
    ])

    const file = csvFile()
    chooseFile(container, [file])
    expect(await screen.findByText('Sprawdzam…')).toBeInTheDocument()
    expect(previewHistory.mock.calls[0][0]).toBe(file)
    const preview: HistoryImportPreview = { filename: 'historia.csv', valid: true, rows: importRows(12), errors: [] }
    checked(preview)

    const section = await screen.findByRole('region', { name: 'historia.csv' })
    expect(screen.getByText('Wybierz CSV')).toBeInTheDocument()
    expect(within(section).getByText('12 wierszy · 0 błędów')).toBeInTheDocument()
    expect(within(section).getByText('Osoba 1')).toBeInTheDocument()
    expect(within(section).getByText('05-01-2026')).toBeInTheDocument()
    expect(within(section).getByText('Osoba 10')).toBeInTheDocument()
    expect(within(section).queryByText('Osoba 11')).not.toBeInTheDocument()
    expect(within(section).getByText('+ 2 wiersze kolejnych')).toBeInTheDocument()
    expect(within(section).queryByText(/popraw plik/)).not.toBeInTheDocument()
    expect(stepStates()).toEqual([
      ['plik CSV', 'done', null], ['podgląd i błędy', 'on', 'step'], ['zaimportowano', 'todo', null],
    ])

    fireEvent.click(within(section).getByRole('button', { name: 'Zatwierdź import' }))
    expect(await within(section).findByRole('button', { name: /Importuję…/ })).toBeDisabled()
    expect(commit.mock.calls[0][0]).toEqual(preview)
    imported({ schedule_id: 's1', imported_rows: 12 })

    expect(await screen.findByRole('status')).toHaveTextContent('Historia została zaimportowana.')
    expect(screen.queryByRole('region', { name: 'historia.csv' })).not.toBeInTheDocument()
    expect(stepStates()).toEqual([
      ['plik CSV', 'done', null], ['podgląd i błędy', 'done', null], ['zaimportowano', 'done', null],
    ])
  })

  it('does nothing when the file dialog is closed without a file', async () => {
    vi.spyOn(api, 'historyImports').mockResolvedValue([])
    const previewHistory = vi.spyOn(api, 'previewHistory')
    const { container } = renderScreen(<HistoryImportPanel />)
    await screen.findByText('Brak wcześniejszych importów')

    chooseFile(container, [])

    expect(previewHistory).not.toHaveBeenCalled()
    expect(screen.getByText('Wybierz CSV')).toBeInTheDocument()
  })

  it('shows why a file could not be checked', async () => {
    vi.spyOn(api, 'historyImports').mockResolvedValue([])
    vi.spyOn(api, 'previewHistory').mockRejectedValue(new Error('Plik nie jest w UTF-8'))
    const { container } = renderScreen(<HistoryImportPanel />)

    chooseFile(container, [csvFile()])

    expect(await screen.findByRole('alert')).toHaveTextContent('Plik nie jest w UTF-8')
  })

  it('shows why an import was refused and keeps the preview', async () => {
    vi.spyOn(api, 'historyImports').mockResolvedValue([])
    vi.spyOn(api, 'previewHistory').mockResolvedValue({ filename: 'historia.csv', valid: true, rows: importRows(1), errors: [] })
    vi.spyOn(api, 'commitHistory').mockRejectedValue(new Error('Zakres nakłada się na istniejący grafik'))
    const { container } = renderScreen(<HistoryImportPanel />)

    chooseFile(container, [csvFile()])
    fireEvent.click(await screen.findByRole('button', { name: 'Zatwierdź import' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Zakres nakłada się na istniejący grafik')
    expect(screen.getByRole('region', { name: 'historia.csv' })).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('lists the first 20 problems, file-wide ones without a row, and blocks the import', async () => {
    vi.spyOn(api, 'historyImports').mockResolvedValue([])
    const errors: HistoryImportError[] = [
      { row_number: null, field: null, message: 'Plik może zawierać maksymalnie 5000 wierszy' },
      ...Array.from({ length: 24 }, (_, index) => ({ row_number: index + 2, field: 'assignee_name', message: 'Osoby nie ma w zespole' })),
    ]
    vi.spyOn(api, 'previewHistory').mockResolvedValue({ filename: 'historia.csv', valid: false, rows: importRows(3), errors })
    const { container } = renderScreen(<HistoryImportPanel />)

    chooseFile(container, [csvFile()])

    const box = (await screen.findByText('25 błędów - popraw plik i wgraj go ponownie')).closest('.box') as HTMLElement
    const items = within(box).getAllByRole('listitem')
    expect(items).toHaveLength(21)
    expect(items[0]).toHaveTextContent(/^Plik może zawierać maksymalnie 5000 wierszy$/)
    expect(items[1]).toHaveTextContent('Wiersz 2: Osoby nie ma w zespole')
    expect(items[20]).toHaveTextContent('… i 5 więcej')
    expect(screen.getByRole('button', { name: 'Zatwierdź import' })).toBeDisabled()
    expect(screen.queryByText(/kolejnych/)).not.toBeInTheDocument()
  })
})

describe('HistoryImportPanel earlier imports', () => {
  const record: HistoryImportRecord = {
    id: 'h1', name: 'Import historii 2025', starts_on: '2025-01-01', ends_on: '2025-12-31', rows: 730, created_at: '2026-09-01T10:00:00Z',
  }

  it('lists earlier imports and undoes one', async () => {
    const list = vi.spyOn(api, 'historyImports').mockResolvedValue([record])
    const remove = vi.spyOn(api, 'deleteSchedule').mockResolvedValue(undefined)
    renderScreen(<HistoryImportPanel />)

    const row = (await screen.findByText('Import historii 2025')).closest('.list-row') as HTMLElement
    expect(row).toHaveTextContent('01-01-2025 – 31-12-2025 · 730 wierszy · 01-09-2026')
    expect(screen.getByRole('heading', { name: 'Wcześniejsze importy' }).nextElementSibling).toHaveTextContent('1')
    fireEvent.click(within(row).getByRole('button', { name: 'Cofnij import' }))

    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1))
    expect(remove.mock.calls[0][0]).toBe('h1')
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
  })

  it('shows why an import could not be undone', async () => {
    vi.spyOn(api, 'historyImports').mockResolvedValue([record])
    vi.spyOn(api, 'deleteSchedule').mockRejectedValue(new Error('Grafik ma już korekty'))
    renderScreen(<HistoryImportPanel />)

    fireEvent.click(await screen.findByRole('button', { name: 'Cofnij import' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Grafik ma już korekty')
  })

  it('offers a retry when the earlier imports fail to load', async () => {
    const list = vi.spyOn(api, 'historyImports')
      .mockRejectedValueOnce(new Error('Serwer niedostępny'))
      .mockResolvedValue([record])
    renderScreen(<HistoryImportPanel />)

    expect(await screen.findByText('Serwer niedostępny')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }))

    expect(await screen.findByText('Import historii 2025')).toBeInTheDocument()
    expect(list).toHaveBeenCalledTimes(2)
  })
})
