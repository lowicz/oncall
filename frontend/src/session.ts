import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { ApiError, CurrentUser } from './api'

/** The query holding who is signed in. Its data is the account, undefined
 *  until the first check answers, and null once a session this tab held has
 *  ended: the login screen then says so. */
export const meKey = ['me'] as const
export type SignedIn = CurrentUser | null

function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401
}

/**
 * The application's query client. Any request refused with 401 while an
 * account is signed in means the session ended behind the tab's back (cookie
 * lifetime, sign-out in another tab, a deactivated account): every cached
 * answer is dropped and `me` becomes null, so the shell gives way to the
 * login screen at the same address and signing in again returns to it. A 401
 * is not retried, so that happens on the first refusal.
 */
export function createQueryClient(): QueryClient {
  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: (error) => endSessionOn(error) }),
    mutationCache: new MutationCache({ onError: (error) => endSessionOn(error) }),
    defaultOptions: {
      queries: {
        retry: (failures, error) => !isUnauthorized(error) && failures < 1,
        staleTime: 30_000,
      },
    },
  })

  function endSessionOn(error: unknown) {
    if (!isUnauthorized(error) || !queryClient.getQueryData<SignedIn>(meKey)) return
    queryClient.setQueryData<SignedIn>(meKey, null)
    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== meKey[0] })
  }

  return queryClient
}
