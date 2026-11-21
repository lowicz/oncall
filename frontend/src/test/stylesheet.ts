import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { onTestFinished } from 'vitest'

/** The safe-area inset the test stylesheet stands in for a phone's home bar or notch. */
export const SAFE_AREA_INSET = 34

function appStyles() {
  const source = ['src/tokens.css', 'src/styles.css'].map((file) => readFileSync(resolve(process.cwd(), file), 'utf8')).join('\n')
  return source.replace(/env\(safe-area-inset-(?:top|bottom)\)/g, `${SAFE_AREA_INSET}px`)
}

function appendStylesheet(css: string) {
  const style = document.createElement('style')
  style.textContent = css
  document.head.appendChild(style)
  onTestFinished(() => style.remove())
  return style
}

/**
 * Loads the app's real `tokens.css` and `styles.css` into the document for the
 * current test, so an assertion on `getComputedStyle` exercises the actual
 * cascade and token values rather than a class name. jsdom defines no
 * environment variables, so `env(safe-area-inset-*)` becomes a
 * `SAFE_AREA_INSET` px inset instead of an invalid value.
 */
export function loadRealStylesheet() {
  return appendStylesheet(appStyles())
}

/** Applies one real media query's rules unconditionally in jsdom. */
export function loadRealMediaQuery(condition: string) {
  const source = appendStylesheet(appStyles())
  const media = Array.from(source.sheet!.cssRules).find((rule) => (
    'conditionText' in rule && 'cssRules' in rule && rule.conditionText === condition
  )) as CSSMediaRule
  return appendStylesheet(Array.from(media.cssRules).map((rule) => rule.cssText).join('\n'))
}

/** The colour a token resolves to under the loaded stylesheet, as `getComputedStyle` reports colours. */
export function tokenColor(token: string) {
  const probe = document.createElement('i')
  probe.style.color = `var(${token})`
  document.body.appendChild(probe)
  const color = getComputedStyle(probe).color
  probe.remove()
  return color
}
