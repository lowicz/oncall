import type { KeyboardEvent } from 'react'

export interface RadioNavigationOption<T extends string> {
  value: T
  disabled?: boolean
}

/** The choices the arrow keys stop on: the enabled ones, or all of them when every one is blocked. */
const navigable = <T extends string>(options: readonly RadioNavigationOption<T>[]) => {
  const enabled = options.filter((option) => !option.disabled)
  return enabled.length > 0 ? enabled : options
}

/**
 * Return the one tab stop for a radio group.
 * If nothing is selected yet, the first enabled option is the entry point.
 * Disabled choices stay available to a screen reader's reading cursor but are skipped by keyboard navigation.
 */
export function radioTabIndex<T extends string>(value: T, option: T, options: readonly RadioNavigationOption<T>[]) {
  const stops = navigable(options)
  const selected = stops.some((item) => item.value === value) ? value : stops[0]?.value
  return option === selected ? 0 : -1
}

const STEPS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }

/**
 * Shared arrow-key behaviour for segmented controls and radio cards: the
 * arrows select the next enabled choice, Home and End the first and last;
 * landing on the choice already made selects nothing again.
 * When every choice is blocked the arrows still walk them, so each reason can
 * be read, but select none.
 */
export function navigateRadioGroup<T extends string>(
  event: KeyboardEvent<HTMLElement>,
  current: T,
  options: readonly RadioNavigationOption<T>[],
  onChange: (value: T) => void,
) {
  const stops = navigable(options)
  let next: RadioNavigationOption<T>
  if (event.key === 'Home') next = stops[0]
  else if (event.key === 'End') next = stops.at(-1)!
  else if (STEPS[event.key]) {
    // From the current choice, even a blocked one a click focused, to the next stop.
    let index = options.findIndex((option) => option.value === current)
    do index = (index + STEPS[event.key] + options.length) % options.length
    while (!stops.includes(options[index]))
    next = options[index]
  } else return
  event.preventDefault()
  // Only the group's own choices: a nested control (how a selected day is taken) carries values too.
  const radios = event.currentTarget.closest<HTMLElement>('[role="radiogroup"]')!.children as HTMLCollectionOf<HTMLElement>
  const target = Array.from(radios).find((radio) => radio.dataset.value === next.value)!
  if (!next.disabled && target.getAttribute('aria-checked') !== 'true') onChange(next.value)
  target.focus()
}
