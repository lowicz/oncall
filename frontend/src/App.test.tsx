import { useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import { Outlet, useLocation } from 'react-router-dom'
import { App } from './App'
import { ApiError, CurrentUser, UserRole, api } from './api'
import { messages } from './i18n'
import { setLanguage } from './i18n/language'
import { renderScreen } from './test/render'

/**
 * The screens are stood in for by markers that print their name and the
 * props App hands them, so these tests are about App alone: which screen an
 * address and an account reach, and what the dashboard passes down.
 */
const stubs = vi.hoisted(() => {
  const mounts: Record<string, number> = {}
  let releaseGenerator = () => {}
  const generatorGate = new Promise<void>((resolve) => { releaseGenerator = resolve })
  return { mounts, generatorGate, releaseGenerator: () => releaseGenerator() }
})

vi.mock('./components/AppShell', () => ({
  AppShell: ({ displayName, avatar, access, share }: {
    displayName: string
    avatar: string | null
    access: { role: string; hasTeamMember: boolean }
    share: { label: string } | null
  }) => {
    const location = useLocation()
    return (
      <div>
        <p data-testid="shell">
          {[displayName, access.role, `team:${access.hasTeamMember}`, avatar ?? 'no-photo', share?.label ?? 'no-share']
            .join(' | ')}
        </p>
        <p data-testid="path">{location.pathname}</p>
        <Outlet />
      </div>
    )
  },
}))

function marker(name: string) {
  return function Marker(props: Record<string, unknown>) {
    useEffect(() => {
      stubs.mounts[name] = (stubs.mounts[name] ?? 0) + 1
    }, [])
    const shown = Object.entries(props)
      .filter(([, value]) => typeof value !== 'object' || value === null)
      .map(([key, value]) => `${key}=${String(value)}`)
    return <h1>{[name, ...shown].join(' ')}</h1>
  }
}

vi.mock('./screens/Login', () => ({ Login: marker('Login') }))
vi.mock('./screens/ShareExchange', () => ({ ShareExchange: marker('ShareExchange') }))
vi.mock('./screens/Duty', () => ({ DutyScreen: marker('Duty') }))
vi.mock('./screens/Schedule', () => ({ ScheduleScreen: marker('Schedule') }))
vi.mock('./screens/Mine', () => ({ MineScreen: marker('Mine') }))
vi.mock('./screens/Swaps', () => ({ SwapPanel: marker('Swaps') }))
vi.mock('./screens/Fairness', () => ({ FairnessPanel: marker('Fairness') }))
vi.mock('./screens/SetPassword', () => ({ SetPassword: marker('SetPassword') }))
vi.mock('./screens/More', () => ({ MoreScreen: marker('More') }))
vi.mock('./screens/Generator', async () => {
  await stubs.generatorGate
  return { GeneratorPanel: marker('Generator') }
})
vi.mock('./screens/admin/HistoryImport', () => ({ HistoryImportPanel: marker('HistoryImport') }))
vi.mock('./screens/admin/ShareLinks', () => ({ ShareLinksPanel: marker('ShareLinks') }))
vi.mock('./screens/admin/Reports', () => ({ MonthlyReportsPanel: marker('Reports') }))
vi.mock('./screens/admin/Audit', () => ({ AuditPanel: marker('Audit') }))
vi.mock('./screens/admin/People', () => ({ PeoplePanel: marker('People') }))
vi.mock('./screens/admin/CalendarEvents', () => ({ CalendarEventsPanel: marker('CalendarEvents') }))

const user = (role: UserRole, overrides: Partial<CurrentUser> = {}): CurrentUser => ({
  username: 'jkowal',
  display_name: 'Jan Kowal',
  role,
  has_team_member: false,
  email: null,
  share: null,
  avatar_url: null,
  ...overrides,
})

function signIn(account: CurrentUser | null) {
  vi.spyOn(api, 'me').mockResolvedValue(account as CurrentUser)
}

const heading = () => screen.findByRole('heading', { level: 1 })

afterEach(() => {
  vi.restoreAllMocks()
  setLanguage('pl')
})

describe('App before the dashboard', () => {
  it('says it is checking the session while the first answer is pending', () => {
    vi.spyOn(api, 'me').mockReturnValue(new Promise(() => {}))
    renderScreen(<App />)
    expect(screen.getByRole('status', { name: messages().common.checkingSession })).toBeInTheDocument()
  })

  it('shows the login screen when nobody is signed in', async () => {
    vi.spyOn(api, 'me').mockRejectedValue(new ApiError('Brak sesji', 401))
    renderScreen(<App />, { route: '/grafik' })
    expect(await heading()).toHaveTextContent('Login expired=false')
  })

  it('tells the person their session ended when the account became null', async () => {
    signIn(null)
    renderScreen(<App />)
    expect(await heading()).toHaveTextContent('Login expired=true')
  })

  it.each([
    ['/share/abc', 'ShareExchange'],
    ['/activate?token=t', 'SetPassword mode=activate'],
    ['/reset?token=t', 'SetPassword mode=reset'],
  ])('opens %s without a session', async (route, shown) => {
    const me = vi.spyOn(api, 'me')
    renderScreen(<App />, { route })
    expect(await heading()).toHaveTextContent(shown)
    expect(me).not.toHaveBeenCalled()
  })
})

describe('the dashboard', () => {
  it('passes the account, its photo and its share link to the shell and the landing screen', async () => {
    signIn(user('member', {
      has_team_member: true,
      avatar_url: '/api/v1/auth/me/avatar',
      share: { label: 'Zarząd', starts_on: '2026-09-01', ends_on: '2026-09-30', expires_at: '2026-10-01T00:00:00Z' },
    }))
    const ownAvatar = vi.spyOn(api, 'ownAvatar').mockResolvedValue('data:image/png;base64,AAA')
    renderScreen(<App />)
    expect(await heading()).toHaveTextContent('Duty role=member displayName=Jan Kowal hasTeamMember=true')
    expect(await screen.findByText('Jan Kowal | member | team:true | data:image/png;base64,AAA | Zarząd'))
      .toBeInTheDocument()
    expect(ownAvatar).toHaveBeenCalledWith('/api/v1/auth/me/avatar')
  })

  it('shows initials until there is a photo and asks for none without an address', async () => {
    signIn(user('viewer'))
    const ownAvatar = vi.spyOn(api, 'ownAvatar')
    renderScreen(<App />)
    expect(await screen.findByTestId('shell')).toHaveTextContent('Jan Kowal | viewer | team:false | no-photo | no-share')
    expect(ownAvatar).not.toHaveBeenCalled()
  })

  it.each([
    ['/grafik', 'Schedule role=viewer displayName=Jan Kowal hasTeamMember=false'],
    ['/wiecej', 'More displayName=Jan Kowal avatar=null'],
  ])('lets anyone open %s', async (route, shown) => {
    signIn(user('viewer'))
    renderScreen(<App />, { route })
    expect(await heading()).toHaveTextContent(shown)
  })

  it('keeps the old calendar address working', async () => {
    signIn(user('viewer'))
    renderScreen(<App />, { route: '/kalendarz' })
    expect(await heading()).toHaveTextContent(/^Schedule/)
    expect(screen.getByTestId('path')).toHaveTextContent('/grafik')
  })

  it('sends an unknown address to the landing screen', async () => {
    signIn(user('viewer'))
    renderScreen(<App />, { route: '/nie-ma-takiej' })
    expect(await heading()).toHaveTextContent(/^Duty/)
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/$/)
  })
})

describe('what each account may reach', () => {
  const ROTATION = ['/moje', '/zamiany', '/sprawiedliwosc']
  const COORDINATION = ['/generator', '/import', '/raporty']
  const ADMINISTRATION = ['/udostepnienia', '/osoby', '/wydarzenia', '/audyt']
  const SCREENS: Record<string, string> = {
    '/moje': 'Mine',
    '/zamiany': 'Swaps',
    '/sprawiedliwosc': 'Fairness',
    '/generator': 'Generator',
    '/import': 'HistoryImport',
    '/raporty': 'Reports',
    '/udostepnienia': 'ShareLinks',
    '/osoby': 'People',
    '/wydarzenia': 'CalendarEvents',
    '/audyt': 'Audit',
  }

  it('shows the loading screen while a screen loaded on demand arrives', async () => {
    signIn(user('coordinator'))
    renderScreen(<App />, { route: '/generator' })
    expect(await screen.findByRole('status', { name: messages().common.loadingScreen })).toBeInTheDocument()
    stubs.releaseGenerator()
    expect(await heading()).toHaveTextContent(/^Generator$/)
  })

  const cases: Array<[string, UserRole, boolean, string[], string[]]> = [
    ['a viewer', 'viewer', false, [], [...ROTATION, ...COORDINATION, ...ADMINISTRATION]],
    ['a member outside the rotation', 'member', false, [], [...ROTATION, ...COORDINATION, ...ADMINISTRATION]],
    ['a member in the rotation', 'member', true, ROTATION, [...COORDINATION, ...ADMINISTRATION]],
    ['a coordinator', 'coordinator', false, [...ROTATION, ...COORDINATION], ADMINISTRATION],
    ['an administrator', 'admin', false, [...ROTATION, ...COORDINATION, ...ADMINISTRATION], []],
  ]

  describe.each(cases)('%s', (_who, role, hasTeamMember, allowed, refused) => {
    it.each(allowed.map((route) => [route]))('opens %s', async (route) => {
      signIn(user(role, { has_team_member: hasTeamMember }))
      renderScreen(<App />, { route })
      expect(await heading()).toHaveTextContent(new RegExp(`^${SCREENS[route]}\\b`))
      expect(screen.getByTestId('path')).toHaveTextContent(route)
    })

    if (refused.length > 0) {
      it.each(refused.map((route) => [route]))('is sent from %s to the landing screen', async (route) => {
        signIn(user(role, { has_team_member: hasTeamMember }))
        renderScreen(<App />, { route })
        expect(await heading()).toHaveTextContent(/^Duty/)
        expect(screen.getByTestId('path')).toHaveTextContent(/^\/$/)
      })
    }
  })
})

describe('switching the language', () => {
  it('mounts the screen afresh so nothing keeps words from the language left', async () => {
    signIn(user('viewer'))
    renderScreen(<App />, { route: '/grafik' })
    await heading()
    const before = stubs.mounts.Schedule
    act(() => setLanguage('en'))
    expect(await heading()).toHaveTextContent(/^Schedule/)
    expect(stubs.mounts.Schedule).toBe(before + 1)
  })
})
