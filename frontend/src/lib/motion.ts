const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

/** Smooth movement is decorative, so respect the operating system preference. */
export function preferredScrollBehavior(): ScrollBehavior {
  return window.matchMedia(REDUCED_MOTION).matches ? 'auto' : 'smooth'
}
