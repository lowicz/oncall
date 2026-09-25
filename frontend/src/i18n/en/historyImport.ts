import type { Messages } from '../pl'
import { pluralEn } from '../../lib/plural'

export const historyImport: Messages['historyImport'] = {
  title: 'History import',
  subtitle: 'The whole CSV is checked first. Nothing is saved without your confirmation.',
  stage: 'Import stage',
  steps: {
    file: 'CSV file',
    preview: 'preview and errors',
    done: 'imported',
  },
  checking: 'Checking…',
  chooseCsv: 'Choose CSV',
  downloadTemplate: 'Download template',
  templateFileName: 'oncall-history-template.csv',
  limits: 'UTF-8 · max. 1 MB / 5000 rows',
  templateNote: 'The names in the template are examples - replace them with names from the team, exactly as they are written on the People screen.',
  imported: 'The history has been imported.',
  rows: (count: number) => pluralEn(count, ['row', 'rows']),
  errors: (count: number) => pluralEn(count, ['error', 'errors']),
  importing: 'Importing…',
  confirmImport: 'Confirm import',
  fixAndReupload: (errors: string) => `${errors} - fix the file and upload it again`,
  rowPrefix: (row: number) => `Row ${row}: `,
  moreErrors: (count: number) => `… and ${count} more`,
  moreRows: (rows: string) => `+ ${rows} more`,
  previous: {
    title: 'Earlier imports',
    loading: 'Loading imports',
    empty: 'No earlier imports',
    undo: 'Undo import',
  },
}
