import { UserRole } from '../api'
import { Language, readLanguage } from '../i18n/language'
import { Messages, messages } from '../i18n'
import { IconName } from '../ui/Icon'

export interface Access {
  role: UserRole
  hasTeamMember: boolean
}

export type ScreenKey = keyof Messages['nav']['screens']

export interface NavItem {
  path: string
  /** The screen's name in the catalog; `navLabel` reads it in the current language. */
  label: ScreenKey
  icon: IconName
  visible: (access: Access) => boolean
}

const isCoordinator = ({ role }: Access) => role === 'coordinator' || role === 'admin'
const isAdmin = ({ role }: Access) => role === 'admin'
const inRotation = (access: Access) => access.hasTeamMember || isCoordinator(access)

/** Everyday work: the four screens everyone in the rotation uses. */
export const primaryNav: NavItem[] = [
  { path: '/', label: 'now', icon: 'clock', visible: () => true },
  { path: '/grafik', label: 'schedule', icon: 'calendar', visible: () => true },
  // Coordinators and admins reach this screen too: it is where they file
  // availability on behalf of someone who cannot.
  { path: '/moje', label: 'mine', icon: 'user', visible: inRotation },
  { path: '/zamiany', label: 'swaps', icon: 'swap', visible: inRotation },
]

/** Coordination: generating, fairness, reports, history. */
export const coordinationNav: NavItem[] = [
  { path: '/generator', label: 'generator', icon: 'wand', visible: isCoordinator },
  { path: '/sprawiedliwosc', label: 'fairness', icon: 'chart', visible: inRotation },
  { path: '/raporty', label: 'reports', icon: 'report', visible: isCoordinator },
  { path: '/import', label: 'historyImport', icon: 'upload', visible: isCoordinator },
]

/** Administration: accounts, events, links, audit. */
export const adminNav: NavItem[] = [
  { path: '/osoby', label: 'people', icon: 'people', visible: isAdmin },
  { path: '/wydarzenia', label: 'events', icon: 'event', visible: isAdmin },
  { path: '/udostepnienia', label: 'shareLinks', icon: 'link', visible: isAdmin },
  { path: '/audyt', label: 'audit', icon: 'audit', visible: isAdmin },
]

export const allNav = [...primaryNav, ...coordinationNav, ...adminNav]

/** The name of a screen in the current language. */
export const navLabel = (item: NavItem) => messages().nav.screens[item.label]

/**
 * The rendered documentation (docs/*.md -> /docs/) is served by the same nginx
 * as this application but is not part of it: plain static pages, outside the
 * router. So the shell links to it with a real anchor - a NavLink would have
 * the router swallow the click, find no matching route and bounce back to the
 * dashboard. The English pages sit under /docs/en/, so the link follows the
 * interface language.
 */
export const docsHref = (language: Language = readLanguage()) => (language === 'en' ? '/docs/en/' : '/docs/')

export const visibleFor = (items: NavItem[], access: Access) =>
  items.filter((item) => item.visible(access))

export const roleLabels = (): Record<UserRole, string> => messages().nav.roles

/** The nav item for a path, so a screen can name itself in the tab title. */
export const navFor = (pathname: string) => allNav.find((item) => item.path === pathname) ?? null
