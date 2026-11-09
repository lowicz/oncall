/** Calendar events: the list over a date range and the form that adds or edits one. */
export const calendarEvents = {
  title: 'Wydarzenia',
  subtitle: 'Wydarzenia są tylko oznaczeniem wizualnym w grafiku - nie zmieniają obsady, stawek ani raportów.',
  list: {
    title: 'Lista',
    range: 'Zakres listy',
    showFrom: 'Pokaż od',
    showTo: 'Pokaż do',
    loading: 'Wczytywanie wydarzeń…',
    empty: 'Brak wydarzeń w wybranym zakresie',
    edit: 'Edytuj',
    editLabel: (title: string) => `Edytuj „${title}”`,
    delete: 'Usuń',
    deleteLabel: (title: string) => `Usuń „${title}”`,
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
  toast: {
    deleted: (title: string) => `Usunięto „${title}”`,
    added: (title: string) => `Dodano „${title}”`,
    updated: (title: string) => `Zapisano „${title}”`,
  },
}
