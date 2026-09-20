import { FormEvent, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { Box, Button, Field, Input, LinkButton } from '../ui'
import { AuthFrame } from '../components/AuthFrame'

export function SetPassword({ mode }: { mode: 'activate' | 'reset' }) {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const tokenInfo = useQuery({
    queryKey: ['password-token', mode, token],
    queryFn: () => api.passwordTokenInfo(token, mode === 'activate' ? 'activation' : 'password_reset'),
    enabled: token.length >= 20,
    retry: false,
  })
  const mutation = useMutation({
    mutationFn: () => mode === 'activate'
      ? api.activateAccount(token, password)
      : api.resetPassword(token, password),
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (password === confirmation) mutation.mutate()
  }
  const title = mode === 'activate' ? 'Aktywuj konto' : 'Ustaw nowe hasło'
  const mismatch = Boolean(confirmation && confirmation !== password)
  const expired = Boolean(tokenInfo.error)

  return (
    <AuthFrame title={expired ? 'Ten link już nie działa' : title} screen={title}>
      <form onSubmit={submit} className="login-card" aria-label={title}>
        {!token && <Box tone="bad" role="alert" title="W linku brakuje tokenu." />}
        {tokenInfo.error && (
          <Box tone="warn" role="alert" title={tokenInfo.error.message}>
            Poproś administratora o nowy link. Jeśli pamiętasz obecne hasło, nadal działa.
          </Box>
        )}
        {tokenInfo.data && (
          <p>Ustawiasz hasło dla: {tokenInfo.data.display_name} ({tokenInfo.data.username})</p>
        )}
        {mutation.error && <Box tone="bad" role="alert" title={mutation.error.message} />}
        {mutation.isSuccess ? (
          <>
            <Box tone="ok" role="status" title="Hasło zostało ustawione." />
            <LinkButton to="/" variant="primary" block>Przejdź do logowania</LinkButton>
          </>
        ) : expired ? (
          <LinkButton to="/" block>Wróć do logowania</LinkButton>
        ) : (
          <>
            <Field label="Nowe hasło" hint="Co najmniej 12 znaków">
              {({ id, describedBy }) => (
                <Input id={id} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} required aria-describedby={describedBy} />
              )}
            </Field>
            <Field label="Powtórz hasło" error={mismatch ? 'Hasła nie są identyczne' : undefined}>
              {({ id, describedBy, invalid }) => (
                <Input id={id} type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required invalid={invalid} aria-describedby={describedBy} />
              )}
            </Field>
            <Button
              type="submit"
              variant="primary"
              block
              loading={mutation.isPending}
              disabled={!tokenInfo.data || password.length < 12 || password !== confirmation}
            >
              {mutation.isPending ? 'Zapisuję…' : title}
            </Button>
          </>
        )}
      </form>
    </AuthFrame>
  )
}
