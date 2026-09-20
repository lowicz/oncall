import { useSyncExternalStore } from 'react'

/** True while the viewport matches the media query; false where matchMedia is
 *  unavailable (tests, old engines), which is the desktop layout. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia?.(query)
      if (!media?.addEventListener) return () => {}
      media.addEventListener('change', onChange)
      return () => media.removeEventListener('change', onChange)
    },
    () => window.matchMedia?.(query)?.matches ?? false,
    () => false,
  )
}

/** Below this width the rail gives way to bottom tabs and panels become sheets. */
export const NARROW_QUERY = '(max-width: 900px)'

export const useNarrow = () => useMediaQuery(NARROW_QUERY)
