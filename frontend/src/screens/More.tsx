import { NavLink } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { Access, adminNav, coordinationNav, docsHref, primaryNav, roleLabels, visibleFor } from '../lib/nav'
import { Avatar, Icon, List, ListRow, PageHeader, SectionHeading, Button } from '../ui'
import { DensitySegmented, ThemeSegmented } from '../components/AppShell'

/**
 * The fifth bottom tab on a phone: every screen the four tabs do not hold,
 * the theme, the documentation and the way out. On a desktop the rail has all
 * of it, so this screen is reachable but not linked.
 */
export function MoreScreen({ displayName, access }: { displayName: string; access: Access }) {
  const queryClient = useQueryClient()
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      queryClient.clear()
      window.location.assign('/')
    },
  })
  const groups = [
    { label: 'Codziennie', items: visibleFor(primaryNav, access).slice(4) },
    { label: 'Koordynacja', items: visibleFor(coordinationNav, access) },
    { label: 'Administracja', items: visibleFor(adminNav, access) },
  ].filter((group) => group.items.length > 0)

  return (
    <div className="page page-narrow">
      <PageHeader
        title={<span className="row"><Avatar name={displayName} size={36} /> {displayName}</span>}
        sub={roleLabels[access.role] !== displayName ? roleLabels[access.role] : undefined}
      />
      {groups.map((group) => (
        <div key={group.label} className="stack-sm">
          <SectionHeading title={group.label} />
          <List className="panel">
            {group.items.map((item) => (
              <NavLink key={item.path} to={item.path} className="list-row" style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="list-main row"><Icon name={item.icon} /><b>{item.label}</b></div>
                <div className="list-aside"><Icon name="chevron-right" /></div>
              </NavLink>
            ))}
          </List>
        </div>
      ))}
      <div className="stack-sm">
        <SectionHeading title="Aplikacja" />
        <List className="panel">
          <ListRow aside={<ThemeSegmented />}><b>Motyw</b></ListRow>
          <ListRow aside={<DensitySegmented />}><b>Gęstość macierzy</b></ListRow>
          <a href={docsHref} className="list-row" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="list-main row"><Icon name="doc" /><b>Dokumentacja</b></div>
            <div className="list-aside"><Icon name="external" /></div>
          </a>
          <ListRow aside={<Button size="sm" icon="logout" onClick={() => logout.mutate()} loading={logout.isPending}>Wyloguj</Button>}>
            <b>Sesja</b>
          </ListRow>
        </List>
      </div>
    </div>
  )
}
