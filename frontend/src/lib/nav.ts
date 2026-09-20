import { UserRole } from '../api'
import { IconName } from '../ui/Icon'

export interface Access {
  role: UserRole
  hasTeamMember: boolean
}

export interface NavItem {
  path: string
  label: string
  icon: IconName
  visible: (access: Access) => boolean
}

const isCoordinator = ({ role }: Access) => role === 'coordinator' || role === 'admin'
const isAdmin = ({ role }: Access) => role === 'admin'
const inRotation = (access: Access) => access.hasTeamMember || isCoordinator(access)

/** Everyday work: the four screens everyone in the rotation uses. */
export const primaryNav: NavItem[] = [
  { path: '/', label: 'Teraz', icon: 'clock', visible: () => true },
  { path: '/grafik', label: 'Grafik', icon: 'calendar', visible: () => true },
  // Coordinators and admins reach this screen too: it is where they file
  // availability on behalf of someone who cannot.
  { path: '/moje', label: 'Moje', icon: 'user', visible: inRotation },
  { path: '/zamiany', label: 'Zamiany', icon: 'swap', visible: inRotation },
]

/** Coordination: generating, fairness, reports, history. */
export const coordinationNav: NavItem[] = [
  { path: '/generator', label: 'Generator', icon: 'wand', visible: isCoordinator },
  { path: '/sprawiedliwosc', label: 'Sprawiedliwość', icon: 'chart', visible: inRotation },
  { path: '/raporty', label: 'Raport miesięczny', icon: 'report', visible: isCoordinator },
  { path: '/import', label: 'Import historii', icon: 'upload', visible: isCoordinator },
]

/** Administration: accounts, events, links, audit. */
export const adminNav: NavItem[] = [
  { path: '/osoby', label: 'Osoby', icon: 'people', visible: isAdmin },
  { path: '/wydarzenia', label: 'Wydarzenia', icon: 'event', visible: isAdmin },
  { path: '/udostepnienia', label: 'Udostępnienia', icon: 'link', visible: isAdmin },
  { path: '/audyt', label: 'Audyt', icon: 'audit', visible: isAdmin },
]

export const allNav = [...primaryNav, ...coordinationNav, ...adminNav]

/**
 * The rendered documentation (docs/*.md -> /docs/) is served by the same nginx
 * as this application but is not part of it: plain static pages, outside the
 * router. So the shell links to it with a real anchor - a NavLink would have
 * the router swallow the click, find no matching route and bounce back to the
 * dashboard.
 */
export const docsHref = '/docs/'

export const visibleFor = (items: NavItem[], access: Access) =>
  items.filter((item) => item.visible(access))

export const roleLabels: Record<UserRole, string> = {
  viewer: 'Podgląd',
  member: 'Członek zespołu',
  coordinator: 'Koordynator',
  admin: 'Administrator',
}

/** The nav item for a path, so a screen can name itself in the tab title. */
export const navFor = (pathname: string) => allNav.find((item) => item.path === pathname) ?? null
