import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Badge,
  Box,
  Button,
  Chip,
  Container,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import { useColorScheme } from '@mui/material/styles'
import MenuIcon from '@mui/icons-material/Menu'
import DarkModeOutlined from '@mui/icons-material/DarkModeOutlined'
import LightModeOutlined from '@mui/icons-material/LightModeOutlined'
import ExpandMore from '@mui/icons-material/ExpandMore'
import { ShareSession, api } from '../api'
import { Access, adminNav, docsHref, primaryNav, roleLabels, visibleFor } from '../lib/nav'
import { groupSwaps } from '../lib/swaps'
import { formatDate } from '../lib/dates'

function ThemeToggle() {
  const { mode, setMode } = useColorScheme()
  // Rendered before the scheme is known on the server-less first pass.
  if (!mode) return null
  const next = mode === 'dark' ? 'light' : 'dark'
  return (
    <Tooltip title={next === 'dark' ? 'Motyw ciemny' : 'Motyw jasny'}>
      <IconButton
        onClick={() => setMode(next)}
        aria-label={next === 'dark' ? 'Włącz motyw ciemny' : 'Włącz motyw jasny'}
        size="small"
      >
        {mode === 'dark' ? <LightModeOutlined fontSize="small" /> : <DarkModeOutlined fontSize="small" />}
      </IconButton>
    </Tooltip>
  )
}

function AdminMenu({ items }: { items: typeof adminNav }) {
  const [anchor, setAnchor] = useState<null | HTMLElement>(null)
  const location = useLocation()
  const active = items.some((item) => item.path === location.pathname)
  if (items.length === 0) return null
  return (
    <>
      <Button
        color="inherit"
        onClick={(event) => setAnchor(event.currentTarget)}
        endIcon={<ExpandMore />}
        className={active ? 'topnav-active' : undefined}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
      >
        Administracja
      </Button>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {items.map((item) => (
          <MenuItem
            key={item.path}
            component={NavLink}
            to={item.path}
            onClick={() => setAnchor(null)}
            selected={item.path === location.pathname}
          >
            {item.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}

export function AppShell({ displayName, access, share }: {
  displayName: string
  access: Access
  share: ShareSession | null
}) {
  const queryClient = useQueryClient()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      queryClient.clear()
      window.location.assign('/')
    },
  })
  const primary = visibleFor(primaryNav, access)
  const admin = visibleFor(adminNav, access)
  // Surfaced in the nav so a coordinator sees waiting requests without opening
  // the screen. Only fetched for accounts that can act on a swap.
  const swaps = useQuery({
    queryKey: ['swaps'],
    queryFn: () => api.swaps(),
    enabled: access.hasTeamMember || access.role === 'coordinator' || access.role === 'admin',
  })
  const actionable = groupSwaps(swaps.data ?? [], {
    displayName,
    role: access.role,
  }).actionable.length
  const navBadge = (path: string) => (path === '/zamiany' ? actionable : 0)

  return (
    <Box className="app-shell">
      <header className="topbar">
        <Stack direction="row" alignItems="center" gap={1}>
          <IconButton
            className="nav-toggle"
            aria-label="Otwórz nawigację"
            onClick={() => setDrawerOpen(true)}
            size="small"
          >
            <MenuIcon />
          </IconButton>
          <Box className="wordmark small">E<span>/</span> ON-CALL</Box>
        </Stack>
        <nav className="topnav" aria-label="Główna nawigacja">
          {primary.map((item) => (
            <Button
              key={item.path}
              component={NavLink}
              to={item.path}
              end={item.path === '/'}
              color="inherit"
            >
              {navBadge(item.path) > 0 ? (
                <Badge badgeContent={navBadge(item.path)} color="warning" className="nav-badge">
                  {item.label}
                </Badge>
              ) : item.label}
            </Button>
          ))}
          <AdminMenu items={admin} />
        </nav>
        <Stack direction="row" spacing={1} alignItems="center" className="topbar-actions">
          <Button color="inherit" component="a" href={docsHref}>
            Dokumentacja
          </Button>
          <ThemeToggle />
          {/* QA7-L16: an account whose display name already reads as the role
              ("Administrator") must not repeat it as "Administrator Administrator". */}
          {displayName !== roleLabels[access.role] && (
            <Chip label={roleLabels[access.role]} size="small" variant="outlined" />
          )}
          <Typography color="text.secondary" className="topbar-user">{displayName}</Typography>
          <Button color="inherit" onClick={() => logout.mutate()} disabled={logout.isPending}>
            Wyloguj
          </Button>
        </Stack>
      </header>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Box className="nav-drawer" role="presentation" onClick={() => setDrawerOpen(false)}>
          <Box className="wordmark small">E<span>/</span> ON-CALL</Box>
          {/* `.topbar-user` is hidden below the breakpoint, so on a phone the
              only place that can say who is logged in is this drawer (LOW5-10). */}
          <Box className="nav-drawer-identity">
            <Typography>{displayName}</Typography>
            {displayName !== roleLabels[access.role] && (
              <Chip label={roleLabels[access.role]} size="small" variant="outlined" />
            )}
          </Box>
          <Stack direction="row" alignItems="center" justifyContent="space-between" className="nav-drawer-actions">
            <ThemeToggle />
            <Button color="inherit" onClick={() => logout.mutate()} disabled={logout.isPending}>
              Wyloguj
            </Button>
          </Stack>
          <Divider />
          <List>
            {primary.map((item) => (
              <ListItemButton key={item.path} component={NavLink} to={item.path} end={item.path === '/'}>
                <ListItemText primary={item.label} />
                {navBadge(item.path) > 0 && (
                  <Badge badgeContent={navBadge(item.path)} color="warning" />
                )}
              </ListItemButton>
            ))}
          </List>
          {admin.length > 0 && (
            <>
              <Divider />
              <Typography className="eyebrow nav-drawer-heading">[ADMINISTRACJA]</Typography>
              <List>
                {admin.map((item) => (
                  <ListItemButton key={item.path} component={NavLink} to={item.path}>
                    <ListItemText primary={item.label} />
                  </ListItemButton>
                ))}
              </List>
            </>
          )}
          {/* `.topbar-actions` is hidden below the breakpoint, so on a phone
              the drawer is the only way to reach the documentation. */}
          <Divider />
          <List>
            <ListItemButton component="a" href={docsHref}>
              <ListItemText primary="Dokumentacja" />
            </ListItemButton>
          </List>
        </Box>
      </Drawer>

      <main>
        <Container maxWidth="xl">
          <Stack spacing={3}>
            {share && (
              <Alert severity="info">
                Link „{share.label}” - tylko do odczytu. Zakres od {formatDate(share.starts_on)} do {formatDate(share.ends_on)},
                ważny do {formatDate(share.expires_at)}.
              </Alert>
            )}
            <Outlet />
          </Stack>
        </Container>
      </main>
    </Box>
  )
}
