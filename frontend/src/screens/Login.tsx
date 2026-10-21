import { FormEvent, useEffect, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../api'
import { useBranding } from '../hooks/useBranding'
import { Messages, useMessages } from '../i18n'
import { AnchorButton, Box, Button, Field, IconButton, Input } from '../ui'
import { AuthFrame } from '../components/AuthFrame'
import { meKey } from '../session'

/** What the person can do about a refused sign-in. Only a rejected login or
 *  password can mean a disabled account; a directory outage or a conflict
 *  has its own remedy, and suggesting a disabled account there misleads. */
function loginHint(error: Error, hints: Messages['auth']['hints']): string {
  const status = error instanceof ApiError ? error.status : 0
  if (status === 401) return hints.unauthorized
  if (status === 409) return hints.conflict
  if (status === 429) return hints.throttled
  return hints.other
}

/** The codes the API's single sign-on callback can send the browser back
 *  with (`/?sso=<code>`); each has its own sentence in the catalog. */
const SSO_REFUSALS = ['unavailable', 'rejected', 'no_account', 'inactive'] as const
type SsoRefusal = (typeof SSO_REFUSALS)[number]

function ssoRefusalOf(code: string | null): SsoRefusal | null {
  return SSO_REFUSALS.find((known) => known === code) ?? null
}

/** `expired` says the session this tab held has ended, so the person knows
 *  why the screen they were on gave way to this one. */
export function Login({ expired = false }: { expired?: boolean }) {
  const queryClient = useQueryClient()
  const t = useMessages()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  // Read once on arrival: the code leaves the URL right away so a reload does
  // not repeat the message, and the message itself gives way to the next
  // attempt the person makes.
  const [ssoRefusal, setSsoRefusal] = useState(() => ssoRefusalOf(searchParams.get('sso')))
  const branding = useBranding()
  const login = useMutation({
    mutationFn: () => api.login(username, password),
    onSuccess: (user) => queryClient.setQueryData(meKey, user),
    onError: () => setPassword(''),
  })

  useEffect(() => {
    if (!searchParams.has('sso')) return
    setSearchParams((params) => {
      params.delete('sso')
      return params
    }, { replace: true })
  }, [searchParams, setSearchParams])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setSsoRefusal(null)
    login.mutate()
  }

  // Where the person was when they were asked to sign in; the API sends them
  // back there after single sign-on, as the password form keeps them there.
  const ssoHref = `/api/v1/auth/sso/start?next=${encodeURIComponent(location.pathname + location.search)}`

  return (
    <AuthFrame title={t.auth.headline} screen={t.auth.login}>
      <form onSubmit={submit} className="login-card" aria-label={t.auth.login}>
        {ssoRefusal ? (
          <Box tone="bad" role="alert" title={t.auth.sso.errors[ssoRefusal].title}>
            {t.auth.sso.errors[ssoRefusal].hint}
          </Box>
        ) : login.error ? (
          <Box tone="bad" role="alert" title={login.error.message}>
            {loginHint(login.error, t.auth.hints)}
          </Box>
        ) : expired && (
          <Box tone="warn" role="status" title={t.auth.sessionExpired}>
            {t.auth.signInAgain}
          </Box>
        )}
        <Field label={t.auth.username}>
          {({ id }) => (
            <Input id={id} name="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
          )}
        </Field>
        <Field label={t.auth.password}>
          {({ id }) => (
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <Input id={id} name="password" autoComplete="current-password" type={showPassword ? 'text' : 'password'} className="in-pw-toggled" value={password} onChange={(e) => setPassword(e.target.value)} required />
              <IconButton
                label={showPassword ? t.auth.hidePassword : t.auth.showPassword}
                icon="eye"
                active={showPassword}
                onClick={() => setShowPassword((current) => !current)}
              />
            </div>
          )}
        </Field>
        <Button type="submit" variant="primary" loading={login.isPending} block>
          {login.isPending ? t.auth.signingIn : t.auth.signIn}
        </Button>
        {branding.ssoEnabled && (
          <>
            <div className="login-or">{t.auth.sso.or}</div>
            <AnchorButton href={ssoHref} icon="external" block>
              {t.auth.sso.button}
            </AnchorButton>
          </>
        )}
        <p className="muted small">
          {branding.ldapEnabled && <>{t.auth.directoryHint}</>}
          {t.auth.forgotPassword}
        </p>
      </form>
    </AuthFrame>
  )
}
