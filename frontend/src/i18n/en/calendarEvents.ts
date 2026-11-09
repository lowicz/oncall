import type { Messages } from '../pl'

export const calendarEvents: Messages['calendarEvents'] = {
  title: 'Events',
  subtitle: 'Events are only a visual marker in the schedule - they change neither the staffing, the rates nor the reports.',
  list: {
    title: 'List',
    range: 'List range',
    showFrom: 'Show from',
    showTo: 'Show to',
    loading: 'Loading events…',
    empty: 'No events in the selected range',
    edit: 'Edit',
    editLabel: (title: string) => `Edit “${title}”`,
    delete: 'Delete',
    deleteLabel: (title: string) => `Delete “${title}”`,
  },
  form: {
    newEvent: 'New event',
    editing: 'Editing an event',
    editEvent: 'Edit event',
    name: 'Name',
    from: 'From',
    to: 'To',
    color: 'Colour',
    save: 'Save',
    add: 'Add',
  },
  toast: {
    deleted: (title: string) => `Deleted “${title}”`,
    added: (title: string) => `Added “${title}”`,
    updated: (title: string) => `Saved “${title}”`,
  },
}
