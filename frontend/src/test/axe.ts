import axe from 'axe-core'
import { expect } from 'vitest'

// axe probes a canvas for some rules; jsdom has none and only logs that it does not.
HTMLCanvasElement.prototype.getContext = () => null

/**
 * Runs axe over a rendered element and fails with the rules it breaks. jsdom
 * lays nothing out, so axe leaves contrast undecided rather than failing it;
 * contrast is checked on the built app.
 */
export async function expectNoAxeViolations(element: Element) {
  const { violations } = await axe.run(element)
  expect(violations).toEqual([])
}
