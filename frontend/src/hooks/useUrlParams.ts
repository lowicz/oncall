import { useCallback, useEffect } from 'react'
import { useLocation, useNavigationType, useSearchParams } from 'react-router-dom'

type Changes = Record<string, string | null>

// The last query written, and every query of the same screen on the way to
// it. The router commits a navigation after the event that started it and
// renders it in a transition, so a later change can come from a render that
// still shows an older query (a quick second or third click); it starts from
// the last query written instead. Writes only ever replace the address, so
// a link or Back and Forward ends it, and so does a render of that query.
let pending: { pathname: string; seen: Set<string>; to: string } | null = null

/**
 * The query string of the current screen, for the view state that has to
 * survive a refresh and travel in a link: the window, the zoom, a filter, the
 * open person. A change replaces the history entry instead of adding one,
 * and a null value removes its parameter. A change relative to the current
 * view (a step forward) is a function of the latest query, which a render
 * may not show yet.
 */
export function useUrlParams() {
  const [params, setParams] = useSearchParams()
  const { pathname, key } = useLocation()
  const navigationType = useNavigationType()
  const shown = params.toString()
  useEffect(() => {
    if (navigationType !== 'REPLACE' || (pending?.pathname === pathname && pending.to === shown)) pending = null
  }, [key, navigationType, pathname, shown])
  const update = useCallback((changes: Changes | ((latest: URLSearchParams) => Changes)) => {
    if (pending?.pathname !== pathname || !pending.seen.has(shown)) pending = { pathname, seen: new Set([shown]), to: shown }
    const next = new URLSearchParams(pending.to)
    for (const [name, value] of Object.entries(typeof changes === 'function' ? changes(new URLSearchParams(next)) : changes)) {
      if (value === null) next.delete(name)
      else next.set(name, value)
    }
    pending.to = next.toString()
    pending.seen.add(pending.to)
    setParams(next, { replace: true })
  }, [pathname, shown, setParams])
  return [params, update] as const
}
