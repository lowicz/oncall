import { FormEvent, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Alert, Box, Button, Container, Paper, Stack, TextField, Typography } from '@mui/material'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api'

export function SetPassword({ mode }: { mode: 'activate' | 'reset' }) {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const tokenInfo = useQuery({
    queryKey: ['password-token', mode, token],
    queryFn: () => api.passwordTokenInfo(
      token,
      mode === 'activate' ? 'activation' : 'password_reset',
    ),
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

  return (
    <Container maxWidth="xs" className="login-shell">
      <Box className="wordmark" aria-label="Erste On-call">E<span>/</span> ON-CALL</Box>
      <Typography variant="h1">{title}</Typography>
      <Paper component="form" onSubmit={submit} className="login-panel" variant="outlined">
        <Stack spacing={2.5}>
          {!token && <Alert severity="error">W linku brakuje tokenu.</Alert>}
          {tokenInfo.error && <Alert severity="error">{tokenInfo.error.message}</Alert>}
          {tokenInfo.data && (
            <Typography>
              Ustawiasz hasło dla: {tokenInfo.data.display_name}{' '}
              (<code>{tokenInfo.data.username}</code>)
            </Typography>
          )}
          {mutation.error && <Alert severity="error">{mutation.error.message}</Alert>}
          {mutation.isSuccess ? (
            <>
              <Alert severity="success">Hasło zostało ustawione.</Alert>
              <Button component={Link} to="/" variant="contained">Przejdź do logowania</Button>
            </>
          ) : (
            <>
              <TextField
                label="Nowe hasło"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                helperText="Co najmniej 12 znaków"
                inputProps={{ minLength: 12 }}
                required
              />
              <TextField
                label="Powtórz hasło"
                type="password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                error={Boolean(confirmation && confirmation !== password)}
                helperText={confirmation && confirmation !== password ? 'Hasła nie są identyczne' : ' '}
                required
              />
              <Button
                type="submit"
                variant="contained"
                disabled={!tokenInfo.data || password.length < 12 || password !== confirmation || mutation.isPending}
              >
                {mutation.isPending ? 'Zapisuję…' : title}
              </Button>
            </>
          )}
        </Stack>
      </Paper>
    </Container>
  )
}
