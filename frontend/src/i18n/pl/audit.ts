import { pluralPl } from '../../lib/plural'

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
  /**
   * Where the trail ends: what the worker deletes and after how many days,
   * from the deployment's configuration. 0 keeps that kind for ever. The
   * schedule corrections a republish reads are never deleted.
   */
  retention: (auditDays: number, loginDays: number) => {
    const entries = auditDays > 0
      ? `Wpisy starsze niż ${pluralPl(auditDays, ['dzień', 'dni', 'dni'])} są usuwane automatycznie`
      : 'Wpisy są przechowywane bezterminowo'
    const logins = loginDays > 0
      ? `zwykłe logowania są usuwane po ${pluralPl(loginDays, ['dniu', 'dniach', 'dniach'])}`
      : 'zwykłe logowania są przechowywane bezterminowo'
    return `${entries}, ${logins}. Korekty grafiku są zachowywane bezterminowo.`
  },
}
