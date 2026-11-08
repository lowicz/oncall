import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * The query string of the current screen, for the view state that has to
 * survive a refresh and travel in a link: the window, the zoom, a filter, the
 * open person. A change replaces the history entry instead of adding one,
 * and a null value removes its parameter.
 */
export function useUrlParams() {
  const [params, setParams] = useSearchParams()
  const update = useCallback((changes: Record<string, string | null>) => setParams((current) => {
    const next = new URLSearchParams(current)
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    return next
  }, { replace: true }), [setParams])
  return [params, update] as const
}
