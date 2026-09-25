import { NavLink } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { Access, adminNav, coordinationNav, docsHref, navLabel, primaryNav, roleLabels, visibleFor } from '../lib/nav'
import { useLanguage, useMessages } from '../i18n'
import { Avatar, Icon, List, ListRow, PageHeader, SectionHeading, Button } from '../ui'
import { DensitySegmented, ThemeSegmented } from '../components/AppShell'
import { LanguageSegmented } from '../components/LanguageControl'
import { useBranding } from '../hooks/useBranding'

/**
 * The fifth bottom tab on a phone: every screen the four tabs do not hold,
 * the theme, the language, the documentation, the way out and the release
 * running. On a desktop the rail has all of it, so this screen is reachable
 * but not linked.
 */
export function MoreScreen({ displayName, avatar = null, access }: { displayName: string; avatar?: string | null; access: Access }) {
  const queryClient = useQueryClient()
  const branding = useBranding()
  const t = useMessages()
  const [language] = useLanguage()
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      queryClient.clear()
      window.location.assign('/')
    },
  })
  const groups = [
    { label: t.shell.everyday, items: visibleFor(primaryNav, access).slice(4) },
    { label: t.shell.coordination, items: visibleFor(coordinationNav, access) },
    { label: t.shell.administration, items: visibleFor(adminNav, access) },
  ].filter((group) => group.items.length > 0)
  const roleLabel = roleLabels()[access.role]

  return (
    <div className="page page-narrow">
      <PageHeader
        title={<span className="row"><Avatar name={displayName} size={36} src={avatar} /> {displayName}</span>}
        sub={roleLabel !== displayName ? roleLabel : undefined}
      />
      {groups.map((group) => (
        <div key={group.label} className="stack-sm">
          <SectionHeading title={group.label} />
          <List className="panel">
            {group.items.map((item) => (
              <NavLink key={item.path} to={item.path} className="list-row" style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="list-main row"><Icon name={item.icon} /><b>{navLabel(item)}</b></div>
                <div className="list-aside"><Icon name="chevron-right" /></div>
              </NavLink>
            ))}
          </List>
        </div>
      ))}
      <div className="stack-sm">
        <SectionHeading title={t.shell.application} />
        <List className="panel">
          <ListRow aside={<ThemeSegmented />}><b>{t.theme.theme}</b></ListRow>
          <ListRow aside={<DensitySegmented />}><b>{t.theme.matrixDensity}</b></ListRow>
          <ListRow aside={<LanguageSegmented />}><b>{t.theme.language}</b></ListRow>
          <a href={docsHref(language)} className="list-row" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="list-main row"><Icon name="doc" /><b>{t.shell.documentation}</b></div>
            <div className="list-aside"><Icon name="external" /></div>
          </a>
          <ListRow aside={<Button size="sm" icon="logout" onClick={() => logout.mutate()} loading={logout.isPending}>{t.shell.logout}</Button>}>
            <b>{t.shell.session}</b>
          </ListRow>
          {branding.version && (
            <ListRow aside={<span className="muted">{branding.version}</span>}>
              <b>{t.shell.version}</b>
            </ListRow>
          )}
        </List>
      </div>
    </div>
  )
}
