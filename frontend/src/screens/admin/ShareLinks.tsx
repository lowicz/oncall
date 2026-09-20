import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Box, Button, Chip, CircularProgress, FormControlLabel, MenuItem, Paper, Switch, TextField, Typography } from '@mui/material'
import { ShareLinkCreated, api } from '../../api'
import { addDays, formatDate, warsawDate } from '../../lib/dates'
import { CopyButton } from '../../components/CopyButton'
import { EmptyState } from '../../components/EmptyState'
import { DateField } from '../../components/DateField'

const shareLinkStatus = (link: {
  used_at: string | null
  revoked_at: string | null
  expires_at: string
}) => {
  if (link.revoked_at) return { label: 'Odwołany', color: 'error' as const }
  if (link.used_at) return { label: 'Użyty', color: 'success' as const }
  if (link.expires_at < new Date().toISOString()) return { label: 'Wygasły', color: 'warning' as const }
  return { label: 'Aktywny', color: 'info' as const }
}

export function ShareLinksPanel() {
  const queryClient = useQueryClient()
  const today = warsawDate()
  const links = useQuery({ queryKey: ['share-links'], queryFn: api.shareLinks })
  const [form, setForm] = useState({
    label: '',
    starts_on: today,
    ends_on: addDays(today, 13),
    expires_days: 7,
  })
  const [created, setCreated] = useState<ShareLinkCreated | null>(null)
  const [feedUrl, setFeedUrl] = useState<{ linkId: string; url: string } | null>(null)
  const [showRevoked, setShowRevoked] = useState(false)
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['share-links'] })
  const create = useMutation({
    mutationFn: api.createShareLink,
    onSuccess: (value) => {
      setCreated(value)
      invalidate()
    },
  })
  const createFeed = useMutation({
    mutationFn: api.createShareLinkFeed,
    onSuccess: (value, linkId) => setFeedUrl({ linkId, url: value.url }),
  })
  const revoke = useMutation({ mutationFn: api.revokeShareLink, onSuccess: invalidate })

  return (
    <Box className="share-section" id="udostepnienia">
      <Box>
        <Typography className="eyebrow">[DOSTĘP DLA ODBIORCY]</Typography>
        <Typography variant="h1">Czasowe linki viewer</Typography>
        <Typography color="text.secondary">
          Jednorazowy link wymieniany jest na ograniczoną sesję tylko do odczytu.
        </Typography>
      </Box>
      <Paper
        component="form"
        variant="outlined"
        className="form-row share-form"
        onSubmit={(event) => {
          event.preventDefault()
          create.mutate(form)
        }}
      >
        <TextField
          label="Odbiorca"
          value={form.label}
          onChange={(event) => setForm({ ...form, label: event.target.value })}
          required
        />
        <DateField
          id="share-from"
          label="Od"
          value={form.starts_on}
          onChange={(value) => setForm({ ...form, starts_on: value })}
          required
        />
        <DateField
          id="share-to"
          label="Do"
          value={form.ends_on}
          onChange={(value) => setForm({ ...form, ends_on: value })}
          required
        />
        <TextField
          select
          id="share-expires-days"
          name="expires_days"
          label="Ważność"
          value={form.expires_days}
          onChange={(event) => setForm({ ...form, expires_days: Number(event.target.value) })}
        >
          {[1, 3, 7, 14, 30].map((days) => (
            <MenuItem key={days} value={days}>{days} dni</MenuItem>
          ))}
        </TextField>
        <Button type="submit" variant="contained" disabled={create.isPending}>
          Utwórz link
        </Button>
      </Paper>
      {(create.error || createFeed.error || revoke.error) && (
        <Alert severity="error">
          {create.error?.message ?? createFeed.error?.message ?? revoke.error?.message}
        </Alert>
      )}
      {created && (
        <Alert severity="success" action={<CopyButton value={created.url} />}>
          Jednorazowy link (przekaż odbiorcy, ważny do {formatDate(created.expires_at)}): {created.url}
        </Alert>
      )}
      <Paper variant="outlined" className="share-list">
        <FormControlLabel control={<Switch checked={showRevoked} onChange={(event) => setShowRevoked(event.target.checked)} />} label="Pokaż odwołane" />
        {links.isLoading && <CircularProgress size={24} />}
        {links.data?.length === 0 && (
          <EmptyState
            title="Nie utworzono jeszcze żadnych linków"
            description="Link daje osobie spoza zespołu wgląd w opublikowany grafik na wskazany zakres dat, bez zakładania konta."
          />
        )}
        {links.data?.filter((link) => showRevoked || !link.revoked_at).map((link) => {
          const status = shareLinkStatus(link)
          return (
            <Box className="share-row" key={link.id}>
              <Box className="grow">
                <Typography>{link.label}</Typography>
                <Typography className="date-code" color="text.secondary">
                  {formatDate(link.starts_on)} → {formatDate(link.ends_on)} · wygasa {formatDate(link.expires_at)}
                </Typography>
              </Box>
              <Chip label={status.label} color={status.color} size="small" variant="outlined" />
              {feedUrl?.linkId === link.id ? (
                <CopyButton value={feedUrl.url} label="Kopiuj ICS" />
              ) : (
                <Button
                  size="small"
                  disabled={createFeed.isPending || Boolean(link.revoked_at)}
                  onClick={() => createFeed.mutate(link.id)}
                >
                  Kanał ICS
                </Button>
              )}
              <Button
                size="small"
                color="error"
                disabled={revoke.isPending || Boolean(link.revoked_at)}
                onClick={() => revoke.mutate(link.id)}
              >
                Odwołaj
              </Button>
            </Box>
          )
        })}
      </Paper>
    </Box>
  )
}
