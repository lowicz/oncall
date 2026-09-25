import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ShareLink, ShareLinkCreated, api } from '../../api'
import { messages, useMessages } from '../../i18n'
import { addDays, formatDate, warsawDate } from '../../lib/dates'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { CopyButton } from '../../components/CopyButton'
import { DateField } from '../../components/DateField'
import { Box, Button, Checkbox, EmptyState, ErrorState, Field, Input, List, ListRow, LoadingBlock, PageHeader, SectionHeading, Select, StatusBadge, StatusTone } from '../../ui'

export const shareLinkStatus = (link: { used_at: string | null; revoked_at: string | null; expires_at: string }): { label: string; tone: StatusTone } => {
  const t = messages().shareLinks.status
  if (link.revoked_at) return { label: t.revoked, tone: 'bad' }
  if (link.used_at) return { label: t.used, tone: 'ok' }
  if (link.expires_at < new Date().toISOString()) return { label: t.expired, tone: 'warn' }
  return { label: t.active, tone: 'sig' }
}

export function ShareLinksPanel() {
  const t = useMessages()
  const queryClient = useQueryClient()
  const today = warsawDate()
  const links = useQuery({ queryKey: ['share-links'], queryFn: api.shareLinks })
  const [form, setForm] = useState({ label: '', starts_on: today, ends_on: addDays(today, 13), expires_days: 7 })
  const [created, setCreated] = useState<ShareLinkCreated | null>(null)
  const [feedUrl, setFeedUrl] = useState<{ linkId: string; url: string } | null>(null)
  const [showRevoked, setShowRevoked] = useState(false)
  const [toRevoke, setToRevoke] = useState<ShareLink | null>(null)
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['share-links'] })
  const create = useMutation({
    mutationFn: api.createShareLink,
    onSuccess: (value) => {
      setCreated(value)
      setForm((current) => ({ ...current, label: '' }))
      invalidate()
    },
  })
  const createFeed = useMutation({
    mutationFn: api.createShareLinkFeed,
    onSuccess: (value, linkId) => setFeedUrl({ linkId, url: value.url }),
  })
  const revoke = useMutation({
    mutationFn: api.revokeShareLink,
    onSuccess: () => { setToRevoke(null); invalidate() },
  })
  const error = create.error ?? createFeed.error ?? revoke.error
  const visible = links.data?.filter((link) => showRevoked || !link.revoked_at) ?? []

  return (
    <div className="page">
      <PageHeader title={t.shareLinks.title} sub={t.shareLinks.subtitle} />
      <form
        className="panel panel-padded stack-sm"
        aria-label={t.shareLinks.form.title}
        onSubmit={(event) => { event.preventDefault(); create.mutate(form) }}
      >
        <SectionHeading as="h3" title={t.shareLinks.form.title} />
        <div className="frow">
          <Field label={t.shareLinks.form.recipient} id="share-label" required>
            {({ id }) => <Input id={id} value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} required placeholder={t.shareLinks.form.recipientPlaceholder} />}
          </Field>
          <DateField id="share-from" label={t.shareLinks.form.scheduleFrom} value={form.starts_on} onChange={(value) => setForm({ ...form, starts_on: value })} required />
          <DateField id="share-to" label={t.shareLinks.form.scheduleTo} value={form.ends_on} onChange={(value) => setForm({ ...form, ends_on: value })} required minDate={form.starts_on} />
          <Field label={t.shareLinks.form.validity} id="share-expires-days">
            {({ id }) => (
              <Select id={id} name="expires_days" value={form.expires_days} onChange={(event) => setForm({ ...form, expires_days: Number(event.target.value) })}>
                {[1, 3, 7, 14, 30].map((days) => <option key={days} value={days}>{t.shareLinks.form.days(days)}</option>)}
              </Select>
            )}
          </Field>
        </div>
        <div className="row">
          <Button type="submit" variant="primary" icon="link" loading={create.isPending}>{t.shareLinks.form.create}</Button>
        </div>
      </form>
      {error && <Box tone="bad" role="alert" title={error.message} />}
      {created && (
        <Box tone="ok" role="status" title={t.shareLinks.created(formatDate(created.expires_at))}>
          <div className="token-once"><code>{created.url}</code><CopyButton value={created.url} /></div>
        </Box>
      )}
      <SectionHeading
        title={t.shareLinks.list.title}
        meta={links.data ? `${visible.length}` : undefined}
        controls={<Checkbox label={t.shareLinks.list.showRevoked} checked={showRevoked} onChange={(event) => setShowRevoked(event.target.checked)} />}
      />
      {links.isLoading && <LoadingBlock label={t.shareLinks.list.loading} rows={2} />}
      {links.error && <ErrorState error={links.error} onRetry={() => links.refetch()} />}
      {links.data && visible.length === 0 && (
        <EmptyState compact icon="link" title={t.shareLinks.list.empty} description={t.shareLinks.list.emptyDescription} />
      )}
      {visible.length > 0 && (
        <List className="panel">
          {visible.map((link) => {
            const status = shareLinkStatus(link)
            const summary = t.shareLinks.list.summary(formatDate(link.starts_on), formatDate(link.ends_on), formatDate(link.expires_at))
            return (
              <ListRow
                key={link.id}
                aside={(
                  <>
                    <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                    {feedUrl?.linkId === link.id
                      ? <CopyButton value={feedUrl.url} label={t.shareLinks.list.copyIcs} />
                      : <Button size="sm" disabled={createFeed.isPending || Boolean(link.revoked_at)} onClick={() => createFeed.mutate(link.id)}>{t.shareLinks.list.icsFeed}</Button>}
                    <Button size="sm" variant="ghost" disabled={revoke.isPending || Boolean(link.revoked_at)} onClick={() => { revoke.reset(); setToRevoke(link) }}>{t.shareLinks.list.revoke}</Button>
                  </>
                )}
              >
                <b>{link.label}</b>
                <small>{link.used_at ? `${summary} · ${t.shareLinks.list.usedOn(formatDate(link.used_at))}` : summary}</small>
              </ListRow>
            )
          })}
        </List>
      )}
      <ConfirmDialog
        open={Boolean(toRevoke)}
        pending={revoke.isPending}
        error={revoke.error ? revoke.error.message : null}
        onCancel={() => setToRevoke(null)}
        onConfirm={() => toRevoke && revoke.mutate(toRevoke.id)}
        title={t.shareLinks.revokeDialog.title}
        confirmLabel={t.shareLinks.revokeDialog.confirm}
        confirmColor="error"
        description={toRevoke && t.shareLinks.revokeDialog.description(toRevoke.label, formatDate(toRevoke.starts_on), formatDate(toRevoke.ends_on))}
      />
    </div>
  )
}
