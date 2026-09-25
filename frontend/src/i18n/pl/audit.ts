/** The audit trail: the filters, the list of events and the CSV export. */
export const audit = {
  title: 'Audyt',
  subtitle: 'Istotne operacje zapisane w systemie, najnowsze na górze. Czasy w strefie Europe/Warsaw.',
  exportCsv: 'Eksportuj CSV',
  csv: {
    fileName: 'audyt.csv',
    columns: {
      occurredAt: 'czas_utc',
      action: 'akcja',
      actor: 'aktor',
      summary: 'opis',
      details: 'szczegoly',
    },
  },
  filters: {
    title: 'Filtry audytu',
    action: 'Akcja',
    allActions: 'Wszystkie',
    person: 'Osoba',
    search: 'Szukaj',
    from: 'Od',
    to: 'Do',
    showRoutineLogins: 'Pokaż zwykłe logowania',
  },
  routineLoginsHidden: 'Rutynowe logowania są w tym widoku ukryte. Włącz „Pokaż zwykłe logowania”, żeby je uwzględnić w wynikach.',
  empty: 'Brak zdarzeń dla wybranego filtra',
  /** `label` is the name of the sign-in action, from `labels.auditActions`. */
  emptyLogins: (label: string) => `W wybranym zakresie nie ma zdarzeń „${label}”. Zmień zakres dat albo pozostałe filtry.`,
  emptyHint: 'Zmień albo wyczyść filtry, żeby zobaczyć więcej zdarzeń.',
  details: 'Szczegóły',
  loading: 'Wczytywanie zdarzeń',
  loadMore: 'Załaduj więcej',
}
