import { FormEvent, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Container,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import Visibility from '@mui/icons-material/Visibility'
import VisibilityOff from '@mui/icons-material/VisibilityOff'
import { api } from '../api'

export function Login() {
  const queryClient = useQueryClient()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const config = useQuery({ queryKey: ['public-config'], queryFn: api.publicConfig })
  const login = useMutation({
    mutationFn: () => api.login(username, password),
    onSuccess: (user) => queryClient.setQueryData(['me'], user),
    onError: () => setPassword(''),
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    login.mutate()
  }

  return (
    <Container maxWidth="xs" className="login-shell">
      <Box className="wordmark" aria-label="Erste On-call">E<span>/</span> ON-CALL</Box>
      <Typography variant="h1">Dyżury bez zgadywania.</Typography>
      <Typography color="text.secondary">
        Zaloguj się, aby sprawdzić aktualny i nadchodzący harmonogram.
      </Typography>
      <Paper component="form" onSubmit={submit} className="login-panel" variant="outlined">
        <Stack spacing={2.5}>
          <Box>
            <Typography className="eyebrow">[LOGOWANIE]</Typography>
            <Typography variant="h2">Dostęp wewnętrzny</Typography>
          </Box>
          {login.error && (
            <Alert severity="error">
              {login.error.message}
              <Typography variant="body2">
                Jeśli konto zostało wyłączone, skontaktuj się z administratorem.
              </Typography>
            </Alert>
          )}
          <TextField id="login-username" name="username" autoComplete="username" label="Login" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
          <TextField
            id="login-password"
            name="password"
            autoComplete="current-password"
            label="Hasło"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label={showPassword ? 'Ukryj hasło' : 'Pokaż hasło'}
                      onClick={() => setShowPassword((current) => !current)}
                      edge="end"
                    >
                      {showPassword ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />
          <Button type="submit" variant="contained" size="large" disabled={login.isPending}>
            {login.isPending ? 'Logowanie…' : 'Zaloguj'}
          </Button>
          {config.data?.ldap_enabled && (
            <Typography variant="body2" color="text.secondary">
              Masz konto firmowe? Zaloguj się loginem i hasłem domenowym (AD).
            </Typography>
          )}
          <Typography variant="body2" color="text.secondary">
            Nie pamiętasz hasła? Poproś administratora systemu o jednorazowy link resetujący.
          </Typography>
        </Stack>
      </Paper>
    </Container>
  )
}
