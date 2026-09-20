import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ShareLinkCreated, api } from '../../api'
import { addDays, formatDate, warsawDate } from '../../lib/dates'
import { CopyButton } from '../../components/CopyButton'
import { DateField } from '../../components/DateField'
import { Box, Button, Checkbox, EmptyState, ErrorState, Field, Input, List, ListRow, LoadingBlock, PageHeader, SectionHeading, Select, StatusBadge, StatusTone } from '../../ui'

export const shareLinkStatus = (link: { used_at: string | null; revoked_at: string | null; expires_at: string }): { label: string; tone: StatusTone } => {
  if (link.revoked_at) return { label: 'odwołany', tone: 'bad' }
  if (link.used_at) return { label: 'użyty', tone: 'ok' }
  if (link.expires_at < new Date().toISOString()) return { label: 'wygasły', tone: 'warn' }
  return { label: 'aktywny', tone: 'sig' }
}

export function ShareLinksPanel() {
  const queryClient = useQueryClient()
  const today = warsawDate()
  const links = useQuery({ queryKey: ['share-links'], queryFn: api.shareLinks })
  const [form, setForm] = useState({ label: '', starts_on: today, ends_on: addDays(today, 13), expires_days: 7 })
  const [created, setCreated] = useState<ShareLinkCreated | null>(null)
  const [feedUrl, setFeedUrl] = useState<{ linkId: string; url: string } | null>(null)
  const [showRevoked, setShowRevoked] = useState(false)
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
  const revoke = useMutation({ mutationFn: api.revokeShareLink, onSuccess: invalidate })
  const error = create.error ?? createFeed.error ?? revoke.error
  const visible = links.data?.filter((link) => showRevoked || !link.revoked_at) ?? []

  return (
    <div className="page">
      <PageHeader title="Udostępnienia" sub="Jednorazowy link wymieniany jest na ograniczoną sesję tylko do odczytu opublikowanego grafiku, bez zakładania konta." />
      <form
        className="panel panel-padded stack-sm"
        aria-label="Nowy link"
        onSubmit={(event) => { event.preventDefault(); create.mutate(form) }}
      >
        <SectionHeading as="h3" title="Nowy link" />
        <div className="frow">
          <Field label="Odbiorca" id="share-label" required>
            {({ id }) => <Input id={id} value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} required placeholder="np. dyspozytornia" />}
          </Field>
          <DateField id="share-from" label="Grafik od" value={form.starts_on} onChange={(value) => setForm({ ...form, starts_on: value })} required />
          <DateField id="share-to" label="Grafik do" value={form.ends_on} onChange={(value) => setForm({ ...form, ends_on: value })} required minDate={form.starts_on} />
          <Field label="Ważność linku" id="share-expires-days">
            {({ id }) => (
              <Select id={id} name="expires_days" value={form.expires_days} onChange={(event) => setForm({ ...form, expires_days: Number(event.target.value) })}>
                {[1, 3, 7, 14, 30].map((days) => <option key={days} value={days}>{days} dni</option>)}
              </Select>
            )}
          </Field>
        </div>
        <div className="row">
          <Button type="submit" variant="primary" icon="link" loading={create.isPending}>Utwórz link</Button>
        </div>
      </form>
      {error && <Box tone="bad" role="alert" title={error.message} />}
      {created && (
        <Box tone="ok" role="status" title={`Jednorazowy link, ważny do ${formatDate(created.expires_at)}. Przekaż go odbiorcy; nie pokażemy go ponownie.`}>
          <div className="token-once"><code>{created.url}</code><CopyButton value={created.url} /></div>
        </Box>
      )}
      <SectionHeading
        title="Linki"
        meta={links.data ? `${visible.length}` : undefined}
        controls={<Checkbox label="Pokaż odwołane" checked={showRevoked} onChange={(event) => setShowRevoked(event.target.checked)} />}
      />
      {links.isLoading && <LoadingBlock label="Wczytywanie linków" rows={2} />}
      {links.error && <ErrorState error={links.error} onRetry={() => links.refetch()} />}
      {links.data && visible.length === 0 && (
        <EmptyState compact icon="link" title="Nie utworzono jeszcze żadnych linków" description="Link daje osobie spoza zespołu wgląd w opublikowany grafik na wskazany zakres dat." />
      )}
      {visible.length > 0 && (
        <List className="panel">
          {visible.map((link) => {
            const status = shareLinkStatus(link)
            return (
              <ListRow
                key={link.id}
                aside={(
                  <>
                    <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                    {feedUrl?.linkId === link.id
                      ? <CopyButton value={feedUrl.url} label="Kopiuj ICS" />
                      : <Button size="sm" disabled={createFeed.isPending || Boolean(link.revoked_at)} onClick={() => createFeed.mutate(link.id)}>Kanał ICS</Button>}
                    <Button size="sm" variant="ghost" disabled={revoke.isPending || Boolean(link.revoked_at)} onClick={() => revoke.mutate(link.id)}>Odwołaj</Button>
                  </>
                )}
              >
                <b>{link.label}</b>
                <small>{formatDate(link.starts_on)} – {formatDate(link.ends_on)} · wygasa {formatDate(link.expires_at)}{link.used_at ? ` · użyty ${formatDate(link.used_at)}` : ''}</small>
              </ListRow>
            )
          })}
        </List>
      )}
    </div>
  )
}
