import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { onTestFinished } from 'vitest'

/**
 * Loads the app's real `styles.css` into the document for the current test, so
 * an assertion on `getComputedStyle` exercises the actual cascade rather than a
 * class name. jsdom cannot resolve a custom property inside a `border`
 * shorthand and reports a nonsense width for it, so a colour token there is
 * replaced with `currentColor` first; widths and line styles stay as written.
 * jsdom resolves no `var()` anywhere else either, so assert on literal values.
 */
export function loadRealStylesheet() {
  const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8').replace(
    /(\bborder(?:-top|-right|-bottom|-left)?\s*:[^;}]*?)var\(--[\w-]+\)/g,
    '$1currentColor',
  )
  const style = document.createElement('style')
  style.textContent = css
  document.head.appendChild(style)
  onTestFinished(() => style.remove())
}
