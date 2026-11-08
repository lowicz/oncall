import { fireEvent, screen, within } from '@testing-library/react'

/** Opens the menu behind the button named `trigger` and returns it. */
export async function openMenu(trigger: string | RegExp) {
  fireEvent.click(await screen.findByRole('button', { name: trigger }))
  return screen.findByRole('menu')
}

/** Picks `item` (an action, a link or an on/off setting) from the menu behind `trigger`. */
export async function chooseFromMenu(trigger: string | RegExp, item: string | RegExp) {
  const menu = await openMenu(trigger)
  const target = within(menu).queryByRole('menuitem', { name: item }) ?? within(menu).getByRole('menuitemcheckbox', { name: item })
  fireEvent.click(target)
}
