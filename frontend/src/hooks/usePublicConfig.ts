import { useQuery } from '@tanstack/react-query'
import { api } from '../api'

/**
 * The instance settings the API serves before anyone is signed in
 * (`/api/v1/config`): the brand, the release, whether the directory signs
 * people in, and the retention the worker applies. Fetched once per session
 * and shared by every screen that reads any of it; a switch of language
 * refetches it with everything else.
 */
export function usePublicConfig() {
  return useQuery({
    queryKey: ['public-config'],
    queryFn: api.publicConfig,
    staleTime: Infinity,
    retry: 1,
  })
}
