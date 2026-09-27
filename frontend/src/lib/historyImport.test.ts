import { describe, expect, it } from 'vitest'
import { HistoryImportError } from '../api'
import { inFileOrder } from './historyImport'

const problem = (row_number: number | null, field: string | null, message: string): HistoryImportError =>
  ({ row_number, field, message })

describe('inFileOrder', () => {
  it('lists whole-file problems first, then rows top to bottom, columns as the CSV lays them out', () => {
    const errors = [
      problem(3, 'assignee_name', 'Nieznana osoba'),
      problem(2, 'extra', 'Nieznana kolumna'),
      problem(2, 'role', 'Nieznana rola'),
      problem(null, null, 'Brak nagłówka'),
      problem(2, 'service_date', 'Zła data'),
      problem(2, null, 'Za mało kolumn'),
    ]
    expect(inFileOrder(errors).map((error) => error.message)).toEqual([
      'Brak nagłówka',
      'Za mało kolumn',
      'Zła data',
      'Nieznana rola',
      'Nieznana kolumna',
      'Nieznana osoba',
    ])
  })

  it('orders messages on the same cell alphabetically in the interface language', () => {
    const errors = [problem(1, 'role', 'Żadna'), problem(1, 'role', 'Ćwiczenie'), problem(1, 'role', 'Zła')]
    expect(inFileOrder(errors).map((error) => error.message)).toEqual(['Ćwiczenie', 'Zła', 'Żadna'])
  })

  it('leaves the given list untouched', () => {
    const errors = [problem(2, null, 'b'), problem(1, null, 'a')]
    inFileOrder(errors)
    expect(errors.map((error) => error.message)).toEqual(['b', 'a'])
  })
})
