import { useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { Box, Button, LoadingBlock } from '../ui'
import { AuthFrame } from '../components/AuthFrame'

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
      <AuthFrame title="Ten link nie działa" screen="Link podglądowy">
        <div className="login-card">
          <Box tone="bad" role="alert" title={exchange.error.message}>
            Link mógł wygasnąć albo zostać odwołany. Poproś o nowy osobę, która go wysłała.
          </Box>
          <Button variant="primary" block onClick={() => navigate('/', { replace: true })}>
            Przejdź do logowania
          </Button>
        </div>
      </AuthFrame>
    )
  }
  return <div className="center"><LoadingBlock label="Wymiana linku na sesję" rows={2} /></div>
}
