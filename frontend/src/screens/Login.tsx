import { FormEvent, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../api'
import { useBranding } from '../hooks/useBranding'
import { Box, Button, Field, IconButton, Input } from '../ui'
import { AuthFrame } from '../components/AuthFrame'
import { meKey } from '../session'

/** What the person can do about a refused sign-in. Only a rejected login or
 *  password can mean a disabled account; a directory outage or a conflict
 *  has its own remedy, and suggesting a disabled account there misleads. */
function loginHint(error: Error): string {
  const status = error instanceof ApiError ? error.status : 0
  if (status === 401) return 'Jeśli konto zostało wyłączone, skontaktuj się z administratorem.'
  if (status === 409) return 'Konto wymaga poprawki po stronie administratora - skontaktuj się z nim.'
  if (status === 429) return 'Odczekaj chwilę i spróbuj ponownie.'
  return 'Spróbuj ponownie za chwilę. Jeśli problem się powtarza, powiadom administratora.'
}

/** `expired` says the session this tab held has ended, so the person knows
 *  why the screen they were on gave way to this one. */
export function Login({ expired = false }: { expired?: boolean }) {
  const queryClient = useQueryClient()
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
    <AuthFrame title="Dyżury bez zgadywania." screen="Logowanie">
      <form onSubmit={submit} className="login-card" aria-label="Logowanie">
        {login.error ? (
          <Box tone="bad" role="alert" title={login.error.message}>
            {loginHint(login.error)}
          </Box>
        ) : expired && (
          <Box tone="warn" role="status" title="Sesja wygasła">
            Zaloguj się ponownie, aby wrócić do otwartego ekranu.
          </Box>
        )}
        <Field label="Login">
          {({ id }) => (
            <Input id={id} name="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
          )}
        </Field>
        <Field label="Hasło">
          {({ id }) => (
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <Input id={id} name="password" autoComplete="current-password" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} required />
              <IconButton
                label={showPassword ? 'Ukryj hasło' : 'Pokaż hasło'}
                icon="eye"
                active={showPassword}
                onClick={() => setShowPassword((current) => !current)}
              />
            </div>
          )}
        </Field>
        <Button type="submit" variant="primary" loading={login.isPending} block>
          {login.isPending ? 'Logowanie…' : 'Zaloguj'}
        </Button>
        <p className="muted small">
          {branding.ldapEnabled && <>Masz konto firmowe? Zaloguj się loginem i hasłem domenowym (AD). </>}
          Nie pamiętasz hasła? Poproś administratora systemu o jednorazowy link resetujący.
        </p>
      </form>
    </AuthFrame>
  )
}
