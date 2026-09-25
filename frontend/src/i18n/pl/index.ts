import { audit } from './audit'
import { auth } from './auth'
import { calendar } from './calendar'
import { calendarEvents } from './calendarEvents'
import { common } from './common'
import { dates } from './dates'
import { duty } from './duty'
import { fairness } from './fairness'
import { generator } from './generator'
import { historyImport } from './historyImport'
import { labels } from './labels'
import { mine } from './mine'
import { nav } from './nav'
import { people } from './people'
import { reports } from './reports'
import { schedule } from './schedule'
import { shareLinks } from './shareLinks'
import { shell } from './shell'
import { swaps } from './swaps'
import { theme } from './theme'

/**
 * The Polish catalog: the words the interface has always shown, and the
 * shape every other language is typed against (`Messages`). One module per
 * screen or shared module; see `../messages.ts` for the conventions.
 */
export const pl = {
  audit,
  auth,
  calendar,
  calendarEvents,
  common,
  dates,
  duty,
  fairness,
  generator,
  historyImport,
  labels,
  mine,
  nav,
  people,
  reports,
  schedule,
  shareLinks,
  shell,
  swaps,
  theme,
}

export type Messages = typeof pl
