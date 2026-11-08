import { useCallback, useEffect } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'

// The last query written and the address it was written from. The router
// commits a navigation after the event that started it and hands every caller
// the query of the last render, so a second change made before that render
// (a quick second click) would start from the old query and drop the first.
// Any address that renders, written here or not, ends it.
let pending: { from: string; to: string } | null = null

/**
 * The query string of the current screen, for the view state that has to
 * survive a refresh and travel in a link: the window, the zoom, a filter, the
 * open person. A change replaces the history entry instead of adding one,
 * and a null value removes its parameter.
 */
export function useUrlParams() {
  const [params, setParams] = useSearchParams()
  const { pathname } = useLocation()
  useEffect(() => { pending = null }, [pathname, params])
  const update = useCallback((changes: Record<string, string | null>) => {
    const from = `${pathname}?${params.toString()}`
    const next = new URLSearchParams(pending?.from === from ? pending.to : params)
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    pending = { from, to: next.toString() }
    setParams(next, { replace: true })
  }, [pathname, params, setParams])
  return [params, update] as const
}
