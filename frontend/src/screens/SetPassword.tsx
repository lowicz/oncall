import { FormEvent, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { Box, Button, Field, Input, LinkButton } from '../ui'
import { AuthFrame } from '../components/AuthFrame'
import { useMessages } from '../i18n'

export function SetPassword({ mode }: { mode: 'activate' | 'reset' }) {
  const [params] = useSearchParams()
  const t = useMessages().auth
  const token = params.get('token') ?? ''
  const saving = useMessages().common.saving
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
  const title = mode === 'activate' ? t.activateAccount : t.setNewPassword
  const mismatch = Boolean(confirmation && confirmation !== password)
  const expired = Boolean(tokenInfo.error)

  return (
    <AuthFrame title={expired ? t.linkNoLongerWorks : title} screen={title}>
      <form onSubmit={submit} className="login-card" aria-label={title}>
        {!token && <Box tone="bad" role="alert" title={t.tokenMissing} />}
        {tokenInfo.error && (
          <Box tone="warn" role="alert" title={tokenInfo.error.message}>
            {t.askForNewLink}
          </Box>
        )}
        {tokenInfo.data && (
          <p>{t.settingPasswordFor(tokenInfo.data.display_name, tokenInfo.data.username)}</p>
        )}
        {mutation.error && <Box tone="bad" role="alert" title={mutation.error.message} />}
        {mutation.isSuccess ? (
          <>
            <Box tone="ok" role="status" title={t.passwordSet} />
            <LinkButton to="/" variant="primary" block>{t.goToLogin}</LinkButton>
          </>
        ) : expired ? (
          <LinkButton to="/" block>{t.backToLogin}</LinkButton>
        ) : (
          <>
            <Field label={t.newPassword} hint={t.passwordHint}>
              {({ id, describedBy }) => (
                <Input id={id} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} required aria-describedby={describedBy} />
              )}
            </Field>
            <Field label={t.repeatPassword} error={mismatch ? t.passwordsDiffer : undefined}>
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
              {mutation.isPending ? saving : title}
            </Button>
          </>
        )}
      </form>
    </AuthFrame>
  )
}
