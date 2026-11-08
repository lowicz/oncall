import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { onTestFinished } from 'vitest'

function appStyles() {
  return readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8').replace(
    /(\b(?:border(?:-top|-right|-bottom|-left)?|outline)\s*:[^;}]*?)var\(--[\w-]+\)/g,
    '$1currentColor',
  )
}

function appendStylesheet(css: string) {
  const style = document.createElement('style')
  style.textContent = css
  document.head.appendChild(style)
  onTestFinished(() => style.remove())
  return style
}

/**
 * Loads the app's real `styles.css` into the document for the current test, so
 * an assertion on `getComputedStyle` exercises the actual cascade rather than a
 * class name. jsdom cannot resolve a custom property inside a `border` or
 * `outline` shorthand and reports a nonsense width for it, so a colour token there is
 * replaced with `currentColor` first; widths and line styles stay as written.
 * jsdom resolves no `var()` anywhere else either, so assert on literal values.
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
