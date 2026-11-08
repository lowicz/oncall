import axe from 'axe-core'
import { expect } from 'vitest'

/**
 * Runs axe over a rendered element and fails with the rules it breaks. jsdom
 * lays nothing out, so axe leaves contrast undecided rather than failing it;
 * contrast is checked on the built app.
 */
export async function expectNoAxeViolations(element: Element) {
  const { violations } = await axe.run(element)
  expect(violations).toEqual([])
}
