import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ConnectionTest, ConnectionTestOutcome, ForwardingMode, ForwardingOutcome, ForwardingSettings, ForwardingState, api } from '../../api'
import { CopyButton } from '../../components/CopyButton'
import { messages, useMessages } from '../../i18n'
import { formatDate, formatMoment } from '../../lib/dates'
import {
  Box,
  Button,
  Dialog,
  ErrorState,
  Field,
  IconButton,
  Input,
  KeyValue,
  LoadingBlock,
  PageHeader,
  SectionHeading,
  Select,
  StatusBadge,
  StatusTone,
  useToast,
} from '../../ui'

const MODES: ForwardingMode[] = ['off', 'dry_run', 'live']
const outcomeTone: Record<ForwardingOutcome, StatusTone> = {
  applied: 'ok', unchanged: 'ok', failed: 'bad', skipped_no_primary: 'warn', skipped_no_phone: 'warn', dry_run: 'sig',
}
const testTone: Record<ConnectionTestOutcome, 'ok' | 'warn' | 'bad'> = {
  ok: 'ok', password_expired: 'warn', login_refused: 'bad', connection: 'bad', configuration: 'bad',
}
/** How long a revealed password stays on the screen. */
const REVEAL_SECONDS = 60
const SETTINGS_KEY = ['forwarding-settings']
const STATE_KEY = ['forwarding-state']
/** A timestamp as the screen prints it, or the dash for one not recorded. */
const moment = (value: string | null) => (value ? formatMoment(value) : messages().common.none)

export function ForwardingPanel() {
  const t = useMessages().forwarding
  const settings = useQuery({ queryKey: SETTINGS_KEY, queryFn: api.forwardingSettings })
  const state = useQuery({ queryKey: STATE_KEY, queryFn: api.forwardingState })
  return (
    <div className="page">
      <PageHeader title={t.title} sub={t.subtitle} />
      {settings.isLoading && <LoadingBlock label={t.settings.loading} rows={3} />}
      {settings.error && <ErrorState error={settings.error} onRetry={() => settings.refetch()} />}
      {settings.data && <SettingsForm saved={settings.data} />}
      <SectionHeading title={t.state.title} />
      {state.isLoading && <LoadingBlock label={t.state.loading} rows={3} />}
      {state.error && <ErrorState error={state.error} onRetry={() => state.refetch()} />}
      {state.data && settings.data && <StateCard settings={settings.data} state={state.data} />}
    </div>
  )
}

const blankToNull = (value: string) => value.trim() || null

function SettingsForm({ saved }: Readonly<{ saved: ForwardingSettings }>) {
  const t = useMessages().forwarding
  const toast = useToast()
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    mode: saved.mode,
    base_url: saved.base_url,
    vpbx_number: saved.vpbx_number ?? '',
    username: saved.username ?? '',
    wco_user_id: saved.wco_user_id ?? '',
  })
  // Null keeps the stored password; a string is a new one being typed.
  const [password, setPassword] = useState<string | null>(saved.password_set ? null : '')
  const [revealOpen, setRevealOpen] = useState(false)
  const test = useMutation({ mutationFn: api.testForwardingConnection })
  const save = useMutation({
    mutationFn: () => api.updateForwardingSettings({
      mode: form.mode,
      base_url: form.base_url.trim(),
      vpbx_number: blankToNull(form.vpbx_number),
      username: blankToNull(form.username),
      wco_user_id: blankToNull(form.wco_user_id),
      password: password || null,
    }),
    onSuccess: (updated) => {
      queryClient.setQueryData(SETTINGS_KEY, updated)
      queryClient.invalidateQueries({ queryKey: STATE_KEY })
      setPassword(updated.password_set ? null : '')
      test.reset()
      toast.success(t.settings.saved)
    },
  })
  const complete = Boolean(saved.vpbx_number && saved.username && saved.wco_user_id && saved.password_set)
  const refused = saved.credentials_invalid_since !== null
  let testHint = t.test.hint
  if (!complete) testHint = t.test.incomplete
  else if (refused) testHint = t.test.refused
  const result = test.data
  const resultTitle = ({ outcome, number }: ConnectionTest) => {
    if (outcome !== 'ok') return t.test.outcomes[outcome]
    return number ? t.test.outcomes.ok(number) : t.test.outcomes.okNoNumber
  }

  // The dialog is a sibling of the form, not a child: React bubbles a
  // submit through the component tree, so a dialog nested in the form would
  // save the settings with every reveal.
  return (
    <>
      <form
        className="panel panel-padded stack-sm"
        aria-label={t.settings.title}
        onSubmit={(event) => { event.preventDefault(); save.mutate() }}
      >
        <SectionHeading as="h3" title={t.settings.title} meta={t.settings.savedAt(formatMoment(saved.updated_at))} />
        <div className="frow">
          <Field label={t.settings.mode} id="forwarding-mode" hint={t.settings.modeHints[form.mode]}>
            {({ id, describedBy }) => (
              <Select id={id} name="mode" value={form.mode} aria-describedby={describedBy} onChange={(event) => setForm({ ...form, mode: event.target.value as ForwardingMode })}>
                {MODES.map((mode) => <option key={mode} value={mode}>{t.settings.modes[mode]}</option>)}
              </Select>
            )}
          </Field>
          <Field label={t.settings.baseUrl} id="forwarding-base-url" hint={t.settings.baseUrlHint} required>
            {({ id, describedBy }) => <Input id={id} type="url" mono value={form.base_url} aria-describedby={describedBy} required onChange={(event) => setForm({ ...form, base_url: event.target.value })} />}
          </Field>
        </div>
        <div className="frow">
          <Field label={t.settings.vpbxNumber} id="forwarding-vpbx">
            {({ id }) => <Input id={id} mono value={form.vpbx_number} autoComplete="off" onChange={(event) => setForm({ ...form, vpbx_number: event.target.value })} />}
          </Field>
          <Field label={t.settings.username} id="forwarding-username">
            {({ id }) => <Input id={id} value={form.username} autoComplete="off" onChange={(event) => setForm({ ...form, username: event.target.value })} />}
          </Field>
          <Field label={t.settings.wcoUserId} id="forwarding-user-id" hint={t.settings.wcoUserIdHint}>
            {({ id, describedBy }) => <Input id={id} mono value={form.wco_user_id} aria-describedby={describedBy} autoComplete="off" onChange={(event) => setForm({ ...form, wco_user_id: event.target.value })} />}
          </Field>
        </div>
        {password === null ? (
          <div className="row">
            <span className="muted small">
              {saved.password_changed_at ? t.settings.passwordSet(formatMoment(saved.password_changed_at)) : t.settings.passwordSetUnknown}
            </span>
            <Button size="sm" onClick={() => setPassword('')}>{t.settings.changePassword}</Button>
            <Button size="sm" icon="eye" onClick={() => setRevealOpen(true)}>{t.reveal.action}</Button>
          </div>
        ) : (
          <div className="frow">
            <Field label={t.settings.password} id="forwarding-password" hint={t.settings.passwordHint} required={!saved.password_set}>
              {({ id, describedBy }) => (
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <Input id={id} type="password" autoComplete="new-password" value={password} aria-describedby={describedBy} required={!saved.password_set} onChange={(event) => setPassword(event.target.value)} />
                  {saved.password_set && <Button size="sm" variant="ghost" onClick={() => setPassword(null)}>{t.settings.keepPassword}</Button>}
                </div>
              )}
            </Field>
          </div>
        )}
        <div className="row">
          <Button type="submit" variant="primary" loading={save.isPending}>{t.settings.save}</Button>
          <Button icon="refresh" disabled={!complete || refused} loading={test.isPending} onClick={() => test.mutate()}>{t.test.action}</Button>
          <span className="muted small">{testHint}</span>
        </div>
        {save.error && <Box tone="bad" role="alert" title={save.error.message} />}
        {test.error && <Box tone="bad" role="alert" title={test.error.message} />}
        {result && (
          <Box tone={testTone[result.outcome]} role="status" title={resultTitle(result)}>
            {result.detail && <span className="mono">{result.detail}</span>}
          </Box>
        )}
      </form>
      <RevealDialog open={revealOpen} onClose={() => setRevealOpen(false)} />
    </>
  )
}

function StateCard({ settings, state }: Readonly<{ settings: ForwardingSettings; state: ForwardingState }>) {
  const t = useMessages().forwarding.state
  const none = messages().common.none
  let desired = none
  if (state.desired_for_day !== null) {
    const day = formatDate(state.desired_for_day)
    desired = state.desired_member_name === null ? t.noPrimary(day) : t.desiredValue(state.desired_member_name, state.desired_number ?? t.noNumber, day)
  }
  let applied = none
  if (state.applied_number !== null) {
    applied = state.applied_member_name === null ? state.applied_number : t.appliedBy(state.applied_number, state.applied_member_name)
  }
  const items = [
    { key: t.desired, value: desired, mono: true },
    { key: t.applied, value: applied, mono: true },
    { key: t.appliedAt, value: moment(state.applied_at), mono: true },
    { key: t.lastAttempt, value: moment(state.last_attempt_at), mono: true },
    {
      key: t.lastOutcome,
      value: state.last_outcome
        ? <StatusBadge tone={outcomeTone[state.last_outcome]}>{t.outcomes[state.last_outcome]}</StatusBadge>
        : none,
      mono: state.last_outcome === null,
    },
    ...(state.last_error ? [{ key: t.lastError, value: state.last_error }] : []),
    ...(state.failing_since
      ? [
        { key: t.failingSince, value: formatMoment(state.failing_since), mono: true },
        { key: t.attempts, value: `${state.attempts}`, mono: true },
        { key: t.nextAttempt, value: moment(state.next_attempt_at), mono: true },
      ]
      : []),
    { key: t.passwordChangedAt, value: moment(settings.password_changed_at), mono: true },
    ...(settings.rotation_pending_since
      ? [{ key: t.rotationPendingSince, value: formatMoment(settings.rotation_pending_since), mono: true }]
      : []),
    ...(settings.credentials_invalid_since
      ? [{ key: t.credentialsInvalidSince, value: formatMoment(settings.credentials_invalid_since), mono: true }]
      : []),
  ]
  return <div className="panel panel-padded"><KeyValue items={items} /></div>
}

/** One revealed value: masked until the eye opens it, copied as it is. */
function Secret({ value }: Readonly<{ value: string }>) {
  const t = useMessages().auth
  const [visible, setVisible] = useState(false)
  return (
    <div className="token-once">
      <code>{visible ? value : '•'.repeat(12)}</code>
      <IconButton label={visible ? t.hidePassword : t.showPassword} icon="eye" size="sm" active={visible} onClick={() => setVisible((current) => !current)} />
      <CopyButton value={value} />
    </div>
  )
}

/**
 * The stored WCO password for switching the number by hand. The value lives
 * only in this dialog's mutation: never a query, and with no `gcTime` the
 * mutation cache drops it once `REVEAL_SECONDS` pass or the dialog closes.
 */
function RevealDialog({ open, onClose }: Readonly<{ open: boolean; onClose: () => void }>) {
  const t = useMessages().forwarding.reveal
  const common = useMessages().common
  const [confirmation, setConfirmation] = useState('')
  const [left, setLeft] = useState(REVEAL_SECONDS)
  const reveal = useMutation({
    mutationFn: api.revealForwardingPassword,
    gcTime: 0,
    onSuccess: () => { setConfirmation(''); setLeft(REVEAL_SECONDS) },
  })
  const revealed = reveal.data
  const { reset } = reveal
  useEffect(() => {
    if (!revealed) return
    const hide = window.setTimeout(reset, REVEAL_SECONDS * 1000)
    const tick = window.setInterval(() => setLeft((seconds) => Math.max(0, seconds - 1)), 1000)
    return () => { window.clearTimeout(hide); window.clearInterval(tick) }
  }, [revealed, reset])
  const close = () => { setConfirmation(''); reset(); onClose() }

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t.title}
      size="sm"
      dismissible={!reveal.isPending}
      actions={revealed ? (
        <Button onClick={close}>{common.close}</Button>
      ) : (
        <>
          <Button onClick={close} disabled={reveal.isPending}>{common.cancel}</Button>
          <Button type="submit" form="forwarding-reveal" variant="primary" loading={reveal.isPending} disabled={confirmation === ''}>{t.show}</Button>
        </>
      )}
    >
      {revealed ? (
        <div className="stack-sm">
          {revealed.credentials_invalid_since && (
            <Box tone="bad" role="alert" title={t.invalid(formatMoment(revealed.credentials_invalid_since))} />
          )}
          {revealed.pending ? (
            <>
              <p className="small">{t.pendingFirst(moment(revealed.pending_since))}</p>
              <Secret value={revealed.pending} />
              <p className="small">{t.thenCurrent}</p>
            </>
          ) : (
            <p className="small">{t.current}</p>
          )}
          <Secret value={revealed.current} />
          <output className="muted small">{t.hidesIn(left)}</output>
        </div>
      ) : (
        <form id="forwarding-reveal" className="stack-sm" onSubmit={(event) => { event.preventDefault(); reveal.mutate(confirmation) }}>
          <p className="small">{t.audited}</p>
          <Field label={t.yourPassword} id="forwarding-confirmation">
            {({ id }) => <Input id={id} type="password" autoComplete="current-password" autoFocus value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required />}
          </Field>
          {reveal.error && <Box tone="bad" role="alert" title={reveal.error.message} />}
        </form>
      )}
    </Dialog>
  )
}
