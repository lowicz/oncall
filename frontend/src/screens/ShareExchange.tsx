import { useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { Box, Button, LoadingBlock } from '../ui'
import { AuthFrame } from '../components/AuthFrame'
import { useMessages } from '../i18n'

export function ShareExchange() {
  const { token } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const started = useRef(false)
  const t = useMessages().auth
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
      <AuthFrame title={t.shareLinkBroken} screen={t.shareLinkScreen}>
        <div className="login-card">
          <Box tone="bad" role="alert" title={exchange.error.message}>
            {t.shareLinkExplanation}
          </Box>
          <Button variant="primary" block onClick={() => navigate('/', { replace: true })}>
            {t.goToLogin}
          </Button>
        </div>
      </AuthFrame>
    )
  }
  return <div className="center"><LoadingBlock label={t.exchangingLink} rows={2} /></div>
}
