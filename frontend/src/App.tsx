import { ReactNode, Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import { Box, CircularProgress } from '@mui/material'
import { Access } from './lib/nav'
import { AppShell } from './components/AppShell'
import { Login } from './screens/Login'
import { ShareExchange } from './screens/ShareExchange'
import { DutyScreen } from './screens/Duty'
import { MineScreen } from './screens/Mine'
import { SwapPanel } from './screens/Swaps'
import { FairnessPanel } from './screens/Fairness'
import { SetPassword } from './screens/SetPassword'

// The admin screens and the generator are reached by one role each and not on
// the landing path, so their code does not need to sit in the main bundle
// every viewer and member downloads (QA7-L17).
const GeneratorPanel = lazy(() =>
  import('./screens/Generator').then((m) => ({ default: m.GeneratorPanel })),
)
const HistoryImportPanel = lazy(() =>
  import('./screens/admin/HistoryImport').then((m) => ({ default: m.HistoryImportPanel })),
)
const ShareLinksPanel = lazy(() =>
  import('./screens/admin/ShareLinks').then((m) => ({ default: m.ShareLinksPanel })),
)
const MonthlyReportsPanel = lazy(() =>
  import('./screens/admin/Reports').then((m) => ({ default: m.MonthlyReportsPanel })),
)
const AuditPanel = lazy(() =>
  import('./screens/admin/Audit').then((m) => ({ default: m.AuditPanel })),
)
const PeoplePanel = lazy(() =>
  import('./screens/admin/People').then((m) => ({ default: m.PeoplePanel })),
)
const CalendarEventsPanel = lazy(() =>
  import('./screens/admin/CalendarEvents').then((m) => ({ default: m.CalendarEventsPanel })),
)

function RouteFallback() {
  return <Box className="center"><CircularProgress aria-label="Wczytywanie ekranu" /></Box>
}

/** Routes the account may not reach fall back to the dashboard rather than
 *  rendering an empty screen. The backend still enforces RBAC on every call. */
function Guarded({ allowed, children }: { allowed: boolean; children: ReactNode }) {
  if (!allowed) return <Navigate to="/" replace />
  return <>{children}</>
}

function Dashboard({ displayName, role, hasTeamMember, share }: {
  displayName: string
  role: Access['role']
  hasTeamMember: boolean
  share: Parameters<typeof AppShell>[0]['share']
}) {
  const access: Access = { role, hasTeamMember }
  const isCoordinator = role === 'coordinator' || role === 'admin'
  const isAdmin = role === 'admin'
  const inRotation = hasTeamMember || isCoordinator

  return (
    <Routes>
      <Route element={<AppShell displayName={displayName} access={access} share={share} />}>
        <Route
          index
          element={
            <DutyScreen role={role} displayName={displayName} hasTeamMember={hasTeamMember} />
          }
        />
        {/* The matrix lives on the dashboard itself; the old path stays linkable. */}
        <Route path="kalendarz" element={<Navigate to="/" replace />} />
        <Route
          path="moje"
          element={(
            <Guarded allowed={hasTeamMember || isCoordinator}>
              <MineScreen role={role} hasTeamMember={hasTeamMember} displayName={displayName} />
            </Guarded>
          )}
        />
        <Route
          path="zamiany"
          element={(
            <Guarded allowed={inRotation}>
              <SwapPanel
                displayName={displayName}
                role={role}
                hasTeamMember={hasTeamMember}
              />
            </Guarded>
          )}
        />
        <Route
          path="generator"
          element={(
            <Guarded allowed={isCoordinator}>
              <Suspense fallback={<RouteFallback />}><GeneratorPanel /></Suspense>
            </Guarded>
          )}
        />
        <Route
          path="sprawiedliwosc"
          element={<Guarded allowed={inRotation}><FairnessPanel /></Guarded>}
        />
        <Route
          path="import"
          element={(
            <Guarded allowed={isCoordinator}>
              <Suspense fallback={<RouteFallback />}><HistoryImportPanel /></Suspense>
            </Guarded>
          )}
        />
        <Route
          path="raporty"
          element={(
            <Guarded allowed={isCoordinator}>
              <Suspense fallback={<RouteFallback />}><MonthlyReportsPanel /></Suspense>
            </Guarded>
          )}
        />
        <Route
          path="udostepnienia"
          element={(
            <Guarded allowed={isAdmin}>
              <Suspense fallback={<RouteFallback />}><ShareLinksPanel /></Suspense>
            </Guarded>
          )}
        />
        <Route
          path="osoby"
          element={(
            <Guarded allowed={isAdmin}>
              <Suspense fallback={<RouteFallback />}><PeoplePanel /></Suspense>
            </Guarded>
          )}
        />
        <Route
          path="wydarzenia"
          element={(
            <Guarded allowed={isAdmin}>
              <Suspense fallback={<RouteFallback />}><CalendarEventsPanel /></Suspense>
            </Guarded>
          )}
        />
        <Route
          path="audyt"
          element={(
            <Guarded allowed={isAdmin}>
              <Suspense fallback={<RouteFallback />}><AuditPanel /></Suspense>
            </Guarded>
          )}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

function Home() {
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, retry: false })
  if (me.isLoading) {
    return <Box className="center"><CircularProgress aria-label="Sprawdzanie sesji" /></Box>
  }
  if (me.error || !me.data) return <Login />
  return (
    <Dashboard
      displayName={me.data.display_name}
      role={me.data.role}
      hasTeamMember={me.data.has_team_member}
      share={me.data.share}
    />
  )
}

export function App() {
  return (
    <Routes>
      <Route path="/share/:token" element={<ShareExchange />} />
      <Route path="/activate" element={<SetPassword mode="activate" />} />
      <Route path="/reset" element={<SetPassword mode="reset" />} />
      <Route path="*" element={<Home />} />
    </Routes>
  )
}
