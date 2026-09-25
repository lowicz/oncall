/** Share links: one-time links that open a read-only view of the published schedule. */
export const shareLinks = {
  title: 'Udostępnienia',
  subtitle: 'Jednorazowy link wymieniany jest na ograniczoną sesję tylko do odczytu opublikowanego grafiku, bez zakładania konta.',
  status: {
    revoked: 'odwołany',
    used: 'użyty',
    expired: 'wygasły',
    active: 'aktywny',
  },
  form: {
    title: 'Nowy link',
    recipient: 'Odbiorca',
    recipientPlaceholder: 'np. dyspozytornia',
    scheduleFrom: 'Grafik od',
    scheduleTo: 'Grafik do',
    validity: 'Ważność linku',
    days: (count: number) => `${count} dni`,
    create: 'Utwórz link',
  },
  created: (expiresAt: string) => `Jednorazowy link, ważny do ${expiresAt}. Przekaż go odbiorcy; nie pokażemy go ponownie.`,
  list: {
    title: 'Linki',
    showRevoked: 'Pokaż odwołane',
    loading: 'Wczytywanie linków',
    empty: 'Nie utworzono jeszcze żadnych linków',
    emptyDescription: 'Link daje osobie spoza zespołu wgląd w opublikowany grafik na wskazany zakres dat.',
    copyIcs: 'Kopiuj ICS',
    icsFeed: 'Kanał ICS',
    revoke: 'Odwołaj',
    /** "14-09-2026 – 27-09-2026 · wygasa 21-09-2026", the dates already formatted. */
    summary: (startsOn: string, endsOn: string, expiresAt: string) => `${startsOn} – ${endsOn} · wygasa ${expiresAt}`,
    usedOn: (date: string) => `użyty ${date}`,
  },
  revokeDialog: {
    title: 'Odwołać link udostępnienia?',
    confirm: 'Odwołaj link',
    description: (label: string, startsOn: string, endsOn: string) =>
      `Link dla „${label}” (${startsOn} – ${endsOn}) przestanie działać. Tej operacji nie da się cofnąć.`,
  },
}
