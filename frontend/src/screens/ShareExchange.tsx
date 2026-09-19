import { useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Alert, Box, Button, CircularProgress, Container } from '@mui/material'
import { api } from '../api'

export function ShareExchange() {
  const { token } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const started = useRef(false)
  const exchange = useMutation({
    mutationFn: (value: string) => api.exchangeShare(value),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['me'] })
      navigate('/', { replace: true })
    },
  })

  useEffect(() => {
    if (started.current || !token) return
    started.current = true
    exchange.mutate(token)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  if (exchange.error) {
    return (
      <Container maxWidth="xs" className="login-shell">
        <Box className="wordmark" aria-label="Erste On-call">E<span>/</span> ON-CALL</Box>
        <Alert severity="error">{exchange.error.message}</Alert>
        <Button variant="contained" onClick={() => navigate('/', { replace: true })}>
          Przejdź do logowania
        </Button>
      </Container>
    )
  }
  return (
    <Box className="center">
      <CircularProgress aria-label="Wymiana linku na sesję" />
    </Box>
  )
}
