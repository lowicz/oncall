/** Calendar events: the list over a date range and the form that adds or edits one. */
export const calendarEvents = {
  title: 'Wydarzenia',
  subtitle: 'Wydarzenia są tylko oznaczeniem wizualnym w grafiku - nie zmieniają obsady, stawek ani raportów.',
  list: {
    title: 'Lista',
    range: 'Zakres listy',
    showFrom: 'Pokaż od',
    showTo: 'Pokaż do',
    loading: 'Wczytywanie wydarzeń',
    empty: 'Brak wydarzeń w wybranym zakresie',
    edit: 'Edytuj',
    delete: 'Usuń',
  },
  form: {
    newEvent: 'Nowe wydarzenie',
    editing: 'Edycja wydarzenia',
    editEvent: 'Edytuj wydarzenie',
    name: 'Nazwa',
    from: 'Od',
    to: 'Do',
    color: 'Kolor',
    save: 'Zapisz',
    add: 'Dodaj',
  },
  deleteDialog: {
    title: 'Usunąć wydarzenie?',
    confirm: 'Usuń',
    /** `dates` is "24-09-2026" or "24-09-2026 – 26-09-2026". */
    description: (title: string, dates: string) => `${title} (${dates}). Tej operacji nie da się cofnąć.`,
  },
}
