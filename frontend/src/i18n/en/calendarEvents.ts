import type { Messages } from '../pl'

export const calendarEvents: Messages['calendarEvents'] = {
  title: 'Events',
  subtitle: 'Events are only a visual marker in the schedule - they change neither the staffing, the rates nor the reports.',
  list: {
    title: 'List',
    range: 'List range',
    showFrom: 'Show from',
    showTo: 'Show to',
    loading: 'Loading events',
    empty: 'No events in the selected range',
    edit: 'Edit',
    delete: 'Delete',
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
  deleteDialog: {
    title: 'Delete this event?',
    confirm: 'Delete',
    description: (title: string, dates: string) => `${title} (${dates}). This cannot be undone.`,
  },
}
