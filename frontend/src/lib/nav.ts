import { UserRole } from '../api'

export interface Access {
  role: UserRole
  hasTeamMember: boolean
}

export interface NavItem {
  path: string
  label: string
  visible: (access: Access) => boolean
}

const isCoordinator = ({ role }: Access) => role === 'coordinator' || role === 'admin'
const isAdmin = ({ role }: Access) => role === 'admin'
const inRotation = (access: Access) => access.hasTeamMember || isCoordinator(access)

/** Everyday work, shown directly in the top bar. */
export const primaryNav: NavItem[] = [
  // The team matrix lives on the dashboard itself (archive/docs/PLAN.md §6
  // screen 1), so a separate "Kalendarz" entry would point at the same view.
  // /kalendarz stays routed as a redirect so older links keep working.
  { path: '/', label: 'Dyżury', visible: () => true },
  // Coordinators and admins reach this screen too: it is where they file
  // availability on behalf of someone who cannot
  // (archive/docs/PLAN-WYKONAWCZY-6.md tor D).
  { path: '/moje', label: 'Moje', visible: inRotation },
  { path: '/zamiany', label: 'Zamiany', visible: inRotation },
  { path: '/generator', label: 'Generator', visible: isCoordinator },
  { path: '/sprawiedliwosc', label: 'Sprawiedliwość', visible: inRotation },
]

/** Occasional administration, grouped behind one menu so it stops competing
 *  with the daily screens for attention. */
export const adminNav: NavItem[] = [
  { path: '/osoby', label: 'Osoby', visible: isAdmin },
  { path: '/wydarzenia', label: 'Wydarzenia', visible: isAdmin },
  { path: '/import', label: 'Import historii', visible: isCoordinator },
  { path: '/raporty', label: 'Raport miesięczny', visible: isCoordinator },
  { path: '/udostepnienia', label: 'Udostępnienia', visible: isAdmin },
  { path: '/audyt', label: 'Audyt', visible: isAdmin },
]

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
