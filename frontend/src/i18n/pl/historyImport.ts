import { pluralPl } from '../../lib/plural'

/** The history import: the CSV upload, its preview with the errors, the earlier imports. */
export const historyImport = {
  title: 'Import historii',
  subtitle: 'Najpierw sprawdzimy cały CSV. Nic nie zostanie zapisane bez zatwierdzenia.',
  stage: 'Etap importu',
  steps: {
    file: 'plik CSV',
    preview: 'podgląd i błędy',
    done: 'zaimportowano',
  },
  checking: 'Sprawdzam…',
  chooseCsv: 'Wybierz CSV',
  downloadTemplate: 'Pobierz szablon',
  templateFileName: 'oncall-history-template.csv',
  limits: 'UTF-8 · maks. 1 MB / 5000 wierszy',
  templateNote: 'Nazwy w szablonie są przykładowe - zastąp je nazwami z zespołu, dokładnie tak, jak są zapisane w panelu Osoby.',
  imported: 'Historia została zaimportowana.',
  /** "1 wiersz", "3 wiersze", "12 wierszy". */
  rows: (count: number) => pluralPl(count, ['wiersz', 'wiersze', 'wierszy']),
  /** "1 błąd", "2 błędy", "7 błędów". */
  errors: (count: number) => pluralPl(count, ['błąd', 'błędy', 'błędów']),
  importing: 'Importuję…',
  confirmImport: 'Zatwierdź import',
  /** The heading of the error box; `errors` is already "7 błędów". */
  fixAndReupload: (errors: string) => `${errors} - popraw plik i wgraj go ponownie`,
  rowPrefix: (row: number) => `Wiersz ${row}: `,
  moreErrors: (count: number) => `… i ${count} więcej`,
  /** The rows the preview does not list; `rows` is already "5 wierszy". */
  moreRows: (rows: string) => `+ ${rows} kolejnych`,
  previous: {
    title: 'Wcześniejsze importy',
    loading: 'Wczytywanie importów',
    empty: 'Brak wcześniejszych importów',
    undo: 'Cofnij import',
  },
}
