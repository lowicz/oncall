import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { Box, Button, LoadingBlock } from '../ui'
import { AuthFrame } from '../components/AuthFrame'
import { useMessages } from '../i18n'
import { SignedIn, meKey } from '../session'

export function ShareExchange() {
  const { token } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const started = useRef(false)
  const t = useMessages().auth
  // The preview session takes the browser's one session cookie, so an
  // account signed in here would be signed out in every tab: that is asked
  // first. Replacing one preview with another needs no question.
  const me = useQuery<SignedIn>({ queryKey: meKey, queryFn: api.me, retry: false })
  const account = me.data && !me.data.share ? me.data : null
  const [replaceAccount, setReplaceAccount] = useState(false)
  const exchange = useMutation({
    mutationFn: (value: string) => api.exchangeShare(value),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: meKey })
      navigate('/', { replace: true })
    },
  })

  useEffect(() => {
    if (started.current || !token || me.isLoading || (account && !replaceAccount)) return
    started.current = true
    exchange.mutate(token)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, me.isLoading, account, replaceAccount])

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
  if (account && !replaceAccount) {
    return (
      <AuthFrame title={t.shareSignedInTitle} screen={t.shareLinkScreen}>
        <div className="login-card">
          <Box tone="warn">{t.shareReplacesSession(account.display_name)}</Box>
          <Button variant="primary" block onClick={() => navigate('/', { replace: true })}>
            {t.shareStaySignedIn}
          </Button>
          <Button block onClick={() => setReplaceAccount(true)}>{t.shareReplaceConfirm}</Button>
        </div>
      </AuthFrame>
    )
  }
  return <div className="center"><LoadingBlock label={t.exchangingLink} rows={2} /></div>
}
