import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api } from '../api'

export const DEFAULT_APP_NAME = 'On-call'

/**
 * The product name and subtitle come from the deployment (ONCALL_APP_NAME,
 * ONCALL_APP_SUBTITLE) through the public config endpoint, so the interface,
 * the e-mails and the calendar feeds all say the same thing and the source
 * tree carries no organisation name. Fetched once per session; until it
 * arrives the neutral default is shown.
 *
 * The version comes the same way, from the API process itself: it is the
 * release tag baked into the image (`dev` for a checkout build), so the
 * interface names what really runs rather than a string built into the
 * bundle. Empty until the configuration has arrived; the shell shows no
 * version line rather than a wrong one.
 */
export function useBranding() {
  const config = useQuery({
    queryKey: ['public-config'],
    queryFn: api.publicConfig,
    staleTime: Infinity,
    retry: 1,
  })
  const name = config.data?.app_name?.trim() || DEFAULT_APP_NAME
  const subtitle = config.data?.app_subtitle?.trim() || ''
  const version = config.data?.version?.trim() || ''
  return { name, subtitle, version, ldapEnabled: config.data?.ldap_enabled ?? false, loaded: config.isSuccess }
}

/** "Teraz · On-call" in the browser tab; the screen name first so several tabs
 *  can be told apart. */
export function useDocumentTitle(screen: string | null, appName: string) {
  useEffect(() => {
    document.title = screen ? `${screen} · ${appName}` : appName
  }, [screen, appName])
}
