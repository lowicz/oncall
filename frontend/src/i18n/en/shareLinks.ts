import type { Messages } from '../pl'
import { pluralEn } from '../../lib/plural'

export const shareLinks: Messages['shareLinks'] = {
  title: 'Share links',
  subtitle: 'A one-time link is exchanged for a limited, read-only session of the published schedule, with no account needed.',
  status: {
    revoked: 'revoked',
    used: 'used',
    expired: 'expired',
    active: 'active',
  },
  form: {
    title: 'New link',
    recipient: 'Recipient',
    recipientPlaceholder: 'e.g. dispatch desk',
    scheduleFrom: 'Schedule from',
    scheduleTo: 'Schedule to',
    validity: 'Link validity',
    days: (count: number) => pluralEn(count, ['day', 'days']),
    create: 'Create link',
  },
  created: (expiresAt: string) => `One-time link, valid until ${expiresAt}. Pass it on to the recipient; it will not be shown again.`,
  list: {
    title: 'Links',
    showRevoked: 'Show revoked',
    loading: 'Loading links',
    empty: 'No links have been created yet',
    emptyDescription: 'A link gives someone outside the team a view of the published schedule for the chosen date range.',
    copyIcs: 'Copy ICS',
    icsFeed: 'ICS feed',
    revoke: 'Revoke',
    summary: (startsOn: string, endsOn: string, expiresAt: string) => `${startsOn} – ${endsOn} · expires ${expiresAt}`,
    usedOn: (date: string) => `used ${date}`,
  },
  revokeDialog: {
    title: 'Revoke this share link?',
    confirm: 'Revoke link',
    description: (label: string, startsOn: string, endsOn: string) =>
      `The link for “${label}” (${startsOn} – ${endsOn}) will stop working. This cannot be undone.`,
  },
}
