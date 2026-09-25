/** The monthly report for HR: the month picker, the CSV download, the preview table. */
export const reports = {
  title: 'Raport miesięczny',
  subtitle: 'CSV dla kadr: dni dyżurowe każdej osoby (primary i secondary razem) w dni robocze oraz w weekendy i święta, z podziałem na role i punktami (1X/2X). Zmiany 11-19 nie są dniami dyżurowymi; święto w sobotę lub niedzielę liczy się jako weekend.',
  month: 'Miesiąc rozliczenia',
  preparing: 'Przygotowuję…',
  downloadCsv: 'Pobierz CSV',
  downloaded: 'Raport został pobrany.',
  /** The name of the downloaded file; `month` is "2026-08". */
  fileName: (month: string) => `oncall-${month}.csv`,
  loadingPreview: 'Wczytywanie podglądu',
  noPublishedDuties: 'Wybrany miesiąc nie ma żadnych opublikowanych dyżurów.',
  partialCoverage: (staffedDays: number, daysInMonth: number) =>
    `Opublikowany grafik pokrywa ${staffedDays} z ${daysInMonth} dni tego miesiąca.`,
  partialCoverageNote: 'Raport uwzględnia tylko dni z pełną obsadą.',
  /** The table's accessible name; `month` is already formatted ("sierpień 2026"). */
  tableName: (month: string) => `Raport za ${month}`,
  scrollHint: 'Tabela jest szersza niż ekran - przewiń ją w bok, aby zobaczyć wszystkie kolumny, w tym punkty.',
  columns: {
    person: 'Osoba',
    /** The headline group: primary and secondary duty days together. */
    dutyDays: 'Dni dyżurowe',
    dutyDaysNote: 'primary + secondary',
    daysOff: 'weekendy i święta',
    dutyTotal: 'razem',
    points: 'Punkty',
    workdays: 'robocze',
    weekends: 'weekendy',
    holidays: 'święta',
    pointsPrimary: 'primary',
    pointsSecondary: 'secondary',
    pointsTotal: 'razem',
    total: 'Razem',
  },
}
