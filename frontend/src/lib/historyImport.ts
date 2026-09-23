import { HistoryImportError } from '../api'

const COLUMN_ORDER = ['service_date', 'role', 'assignee_name']

/**
 * The problems in the order of the file, so it can be fixed top to bottom:
 * those about the whole file first, then by row, and within a row by column
 * as the CSV lays them out and then by message.
 */
export function inFileOrder(errors: HistoryImportError[]): HistoryImportError[] {
  const column = (field: string | null) => {
    if (field === null) return -1
    const index = COLUMN_ORDER.indexOf(field)
    return index < 0 ? COLUMN_ORDER.length : index
  }
  return [...errors].sort((a, b) =>
    (a.row_number ?? 0) - (b.row_number ?? 0)
    || column(a.field) - column(b.field)
    || a.message.localeCompare(b.message, 'pl'))
}
