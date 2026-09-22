import { useQuery } from '@tanstack/react-query'
import { CurrentUser, api } from '../api'

/**
 * The signed-in person's photo from the directory, as a data URL for the
 * avatar, or null: while it loads, when the account has no photo there, when
 * the deployment reads none, and when the directory cannot answer. The
 * initials stay in every such case, so the shell never waits on the
 * directory.
 *
 * Fetched once per page load and kept in memory only, keyed by the login:
 * nothing is written to storage, and a second person signing in on the same
 * browser never sees the first one's face. Not retried and never refetched
 * on focus: a directory outage shows initials until the next page load
 * rather than a stream of requests to a directory that is down.
 */
export function useOwnAvatar(user: Pick<CurrentUser, 'username' | 'avatar_url'> | undefined): string | null {
  const url = user?.avatar_url ?? null
  const photo = useQuery({
    queryKey: ['own-avatar', user?.username ?? ''],
    queryFn: () => api.ownAvatar(url as string),
    enabled: url !== null,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  return photo.data ?? null
}
