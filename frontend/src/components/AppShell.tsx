import { useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ShareSession, api } from '../api'
import { Access, adminNav, coordinationNav, docsHref, navFor, navLabel, primaryNav, roleLabels, visibleFor } from '../lib/nav'
import { groupSwaps } from '../lib/swaps'
import { formatDate } from '../lib/dates'
import { useBranding, useDocumentTitle } from '../hooks/useBranding'
import { useNarrow } from '../hooks/useMediaQuery'
import { Density, ThemeMode, useDensity, useThemeMode } from '../theme'
import { useLanguage, useMessages } from '../i18n'
import { LanguageMenuRadio } from './LanguageControl'
import { Avatar, Icon, IconButton, Mark, Menu, MenuLink, MenuItem, MenuRadioGroup, MenuSeparator, Segmented, cx } from '../ui'
import { NowStrip } from './NowStrip'
import { CommandPalette } from './CommandPalette'
import { ErrorBoundary } from './ErrorBoundary'

function useThemeOptions() {
  const t = useMessages().theme
  const themeOptions: Array<{ value: ThemeMode; label: string }> = [
    { value: 'dark', label: t.modes.dark },
    { value: 'light', label: t.modes.light },
    { value: 'system', label: t.modes.system },
  ]
  const densityOptions: Array<{ value: Density; label: string }> = [
    { value: 'default', label: t.densities.default },
    { value: 'compact', label: t.densities.compact },
  ]
  return { themeOptions, densityOptions }
}

export function ThemeSegmented({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const t = useMessages().theme
  const { themeOptions } = useThemeOptions()
  const [mode, setMode] = useThemeMode()
  return <Segmented<ThemeMode> size={size} label={t.theme} value={mode} onChange={setMode} options={themeOptions} />
}

export function DensitySegmented() {
  const t = useMessages().theme
  const { densityOptions } = useThemeOptions()
  const [density, setDensity] = useDensity()
  return <Segmented<Density> size="sm" label={t.density} value={density} onChange={setDensity} options={densityOptions} />
}

function RailLink({ path, label, icon, badge }: { path: string; label: string; icon: Parameters<typeof Icon>[0]['name']; badge?: number }) {
  const t = useMessages()
  return (
    <NavLink to={path} end={path === '/'} className={({ isActive }) => cx('nav-link', isActive && 'active')}>
      <Icon name={icon} />
      <span>{label}</span>
      {badge ? <span className="nav-cnt" aria-label={t.shell.pendingDecisions(badge)}>{badge}</span> : null}
    </NavLink>
  )
}

/**
 * The account menu behind the avatar: who is logged in, the theme, the
 * matrix density and the language as radio groups (Base UI keeps the menu open while they
 * change), the documentation, the palette and the way out. The release
 * running closes the menu as a dim footer: this menu is the one place every
 * layout has (a phone, the collapsed rail, a share-link session), so it is
 * where the version can always be found. The avatar is the person's photo
 * from the directory when there is one, their initials otherwise.
 */
function AccountMenu({ displayName, avatar, roleLine, version, share, onPalette, onLogout, logoutPending }: {
  displayName: string
  avatar: string | null
  roleLine: string | null
  version: string
  share: boolean
  onPalette: () => void
  onLogout: () => void
  logoutPending: boolean
}) {
  const t = useMessages()
  const [language] = useLanguage()
  const { themeOptions, densityOptions } = useThemeOptions()
  const [mode, setMode] = useThemeMode()
  const [density, setDensity] = useDensity()
  return (
    <Menu
      align="end"
      trigger={(
        <button type="button" className="ib" aria-label={t.shell.account(displayName)} title={displayName} style={{ border: 0 }}>
          <Avatar name={displayName} src={avatar} />
        </button>
      )}
    >
      <div className="menu-block">
        <b>{displayName}</b>
        {roleLine && <span className="muted small">{roleLine}</span>}
      </div>
      <MenuSeparator />
      <MenuRadioGroup<ThemeMode> label={t.theme.theme} value={mode} onChange={setMode} options={themeOptions} />
      <MenuRadioGroup<Density> label={t.theme.matrixDensity} value={density} onChange={setDensity} options={densityOptions} />
      <LanguageMenuRadio />
      <MenuSeparator />
      <MenuLink to={docsHref(language)} external><Icon name="doc" /> {t.shell.documentation}</MenuLink>
      {!share && <MenuItem onClick={onPalette}><Icon name="search" /> {t.shell.commandPalette} <span className="kbd" style={{ marginLeft: 'auto' }}>Ctrl K</span></MenuItem>}
      <MenuSeparator />
      <MenuItem onClick={onLogout} disabled={logoutPending}><Icon name="logout" /> {t.shell.logout}</MenuItem>
      {version && (
        <>
          <MenuSeparator />
          <div className="menu-block dim small">{t.shell.versionLine(version)}</div>
        </>
      )}
    </Menu>
  )
}

/**
 * The shell: a rail of screens on the left, the "Teraz" strip on top of
 * every screen, the account menu with theme and density, the command
 * palette on Ctrl K, and bottom tabs on a phone. A share-link session gets
 * no rail (it can only look at the published schedule) but a banner naming
 * the link and its range.
 */
export function AppShell({ displayName, avatar = null, access, share }: {
  displayName: string
  /** The person's own photo as a data URL, or null for the initials. */
  avatar?: string | null
  access: Access
  share: ShareSession | null
}) {
  const queryClient = useQueryClient()
  const location = useLocation()
  const branding = useBranding()
  const t = useMessages()
  const [language] = useLanguage()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      queryClient.clear()
      window.location.assign('/')
    },
  })
  const primary = visibleFor(primaryNav, access)
  const coordination = visibleFor(coordinationNav, access)
  const admin = visibleFor(adminNav, access)
  const canSwap = access.hasTeamMember || access.role === 'coordinator' || access.role === 'admin'
  // Surfaced in the rail so a coordinator sees waiting requests without opening
  // the screen. Only fetched for accounts that can act on a swap.
  const swaps = useQuery({ queryKey: ['swaps'], queryFn: () => api.swaps(), enabled: canSwap })
  const actionable = groupSwaps(swaps.data ?? [], { displayName, role: access.role }).actionable.length
  const badge = (path: string) => (path === '/zamiany' ? actionable : 0)
  const current = navFor(location.pathname)
  const screenLabel = current ? navLabel(current) : location.pathname === '/wiecej' ? t.nav.screens.more : null
  useDocumentTitle(screenLabel, branding.name)

  const doLogout = useCallback(() => logout.mutate(), [logout])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const narrow = useNarrow()
  // A share-link session can only look at the published schedule: no rail,
  // no tabs, a banner naming the link instead.
  const showRail = !share && !narrow
  const showTabs = !share && narrow
  const tabItems = primary.slice(0, 4)
  // QA7-L16: a display name that already reads as the role is not repeated.
  const roleLine = roleLabels()[access.role] !== displayName ? roleLabels()[access.role] : null
  const accountMenu = (
    <AccountMenu
      displayName={displayName}
      avatar={avatar}
      roleLine={roleLine}
      version={branding.version}
      share={Boolean(share)}
      onPalette={() => setPaletteOpen(true)}
      onLogout={doLogout}
      logoutPending={logout.isPending}
    />
  )

  return (
    <div className={cx('app', !showRail && 'app-norail')}>
      <a className="sr-only" href="#tresc">{t.shell.skipToContent}</a>
      {showRail && (
        <aside className="rail">
          <NavLink to="/" className="brand" aria-label={branding.name}>
            <Mark />
            <span className="brand-text">
              <b className="brand-name">{branding.name}</b>
              {branding.subtitle && <small className="brand-sub">{branding.subtitle}</small>}
            </span>
          </NavLink>
          <nav className="nav" aria-label={t.shell.mainNavigation}>
            {primary.map((item) => <RailLink key={item.path} path={item.path} label={navLabel(item)} icon={item.icon} badge={badge(item.path)} />)}
            {coordination.length > 0 && <div className="nav-sec">{t.shell.coordination}</div>}
            {coordination.map((item) => <RailLink key={item.path} path={item.path} label={navLabel(item)} icon={item.icon} />)}
            {admin.length > 0 && <div className="nav-sec">{t.shell.administration}</div>}
            {admin.map((item) => <RailLink key={item.path} path={item.path} label={navLabel(item)} icon={item.icon} />)}
          </nav>
          <div className="rail-foot">
            <a href={docsHref(language)} className="nav-link" style={{ padding: 0 }}><Icon name="doc" /><span>{t.shell.documentation}</span></a>
            <button type="button" onClick={() => setPaletteOpen(true)}>{t.shell.palette} <span className="kbd">Ctrl</span> <span className="kbd">K</span></button>
            {branding.version && <span>{t.shell.versionLine(branding.version)}</span>}
          </div>
        </aside>
      )}
      <div className="main">
        {share && (
          <div className="banner" role="status">
            <b>{t.shell.preview}</b>
            <span>
              {t.shell.shareBanner(share.label, formatDate(share.starts_on), formatDate(share.ends_on), formatDate(share.expires_at))}
            </span>
          </div>
        )}
        {narrow ? (
          // A phone is a different hierarchy, not a squeezed desktop: the
          // "Teraz" strip gives way to a top bar and the dashboard carries the
          // current duties as cards.
          <header className="mob-top">
            <Mark size={22} />
            <span className="mob-top-title">{screenLabel ?? branding.name}</span>
            {!share && <IconButton label={t.shell.searchHint} icon="search" onClick={() => setPaletteOpen(true)} />}
            {accountMenu}
          </header>
        ) : (
          <NowStrip>
            {!share && (
              <button type="button" className="now-search" onClick={() => setPaletteOpen(true)} aria-label={t.shell.searchHint} aria-keyshortcuts="Control+K">
                <Icon name="search" />
                <span>{t.shell.search}</span>
                <span className="kbd">Ctrl K</span>
              </button>
            )}
            {accountMenu}
          </NowStrip>
        )}
        <main id="tresc" className="page-host">
          <ErrorBoundary key={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
        {showTabs && (
          <nav className="tabs-bottom" aria-label={t.shell.bottomNavigation}>
            {tabItems.map((item) => (
              <NavLink key={item.path} to={item.path} end={item.path === '/'} className={({ isActive }) => cx('tab-link', isActive && 'active')}>
                <Icon name={item.icon} size={18} />
                {navLabel(item)}
                {badge(item.path) ? <span className="nav-cnt">{badge(item.path)}</span> : null}
              </NavLink>
            ))}
            <NavLink to="/wiecej" className={({ isActive }) => cx('tab-link', isActive && 'active')}>
              <Icon name="more" size={18} />
              {t.nav.screens.more}
            </NavLink>
          </nav>
        )}
      </div>
      {!share && (
        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} access={access} onLogout={doLogout} />
      )}
      {logout.isPending && <span className="sr-only" role="status">{t.shell.loggingOut}</span>}
    </div>
  )
}
