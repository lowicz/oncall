import { FormEvent, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../api'
import { useBranding } from '../hooks/useBranding'
import { Messages, useMessages } from '../i18n'
import { Box, Button, Field, IconButton, Input } from '../ui'
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

/** `expired` says the session this tab held has ended, so the person knows
 *  why the screen they were on gave way to this one. */
export function Login({ expired = false }: { expired?: boolean }) {
  const queryClient = useQueryClient()
  const t = useMessages()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const branding = useBranding()
  const login = useMutation({
    mutationFn: () => api.login(username, password),
    onSuccess: (user) => queryClient.setQueryData(meKey, user),
    onError: () => setPassword(''),
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    login.mutate()
  }

  return (
    <AuthFrame title={t.auth.headline} screen={t.auth.login}>
      <form onSubmit={submit} className="login-card" aria-label={t.auth.login}>
        {login.error ? (
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
              <Input id={id} name="password" autoComplete="current-password" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} required />
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
        <p className="muted small">
          {branding.ldapEnabled && <>{t.auth.directoryHint}</>}
          {t.auth.forgotPassword}
        </p>
      </form>
    </AuthFrame>
  )
}
