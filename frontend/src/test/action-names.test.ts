/**
 * One act, one name: a button never carries three different names for the
 * same thing, and an ellipsis announces a dialog, never a form in the same
 * panel. Checked on the catalogs of both languages.
 */
import { describe, expect, it } from 'vitest'
import { en } from '../i18n/en'
import { pl } from '../i18n/pl'

describe.each([['Polish', pl], ['English', en]] as const)('the %s button names', (_, catalog) => {
  it('gives the three staffing buttons three names for three effects', () => {
    const { inspector, confirm } = catalog.schedule
    // "Change person" opens a form in the panel, "Save the staffing change"
    // saves it, and only the historical save opens a dialog.
    expect(new Set([inspector.changeStaffing, confirm.save, confirm.saveHistorical]).size).toBe(3)
    expect(inspector.changeStaffing.endsWith('…')).toBe(false)
    expect(confirm.save.endsWith('…')).toBe(false)
    expect(confirm.saveHistorical).toBe(`${confirm.save}…`)
    expect(inspector.changeRole('PRIMARY', 'Anna').endsWith(inspector.changeStaffing)).toBe(true)
  })

  it('names ending a rotation once, from the entry to both steps of the dialog', () => {
    const { rotationTab, offboarding } = catalog.people
    const name = rotationTab.rewriteAndEnd.replace('…', '')
    // The entry opens the dialog, so it carries the ellipsis; the button in
    // the dialog does not, and says the act in the same words.
    expect(rotationTab.rewriteAndEnd.endsWith('…')).toBe(true)
    expect(offboarding.rewriteAndEnd(0)).toBe(name)
    expect(offboarding.rewriteAndEnd(6).toLowerCase().endsWith(name.toLowerCase())).toBe(true)
    expect(offboarding.rewriteAndEnd(6)).toContain('6')
  })

  it('calls the team member screen and its swaps inbox by two different names', () => {
    expect(catalog.nav.screens.mine).toBe(catalog.mine.title)
    expect(catalog.swaps.inbox.mine).not.toBe(catalog.nav.screens.mine)
  })

  it('calls the ICS subscription the same in the button and in the panel', () => {
    expect(catalog.mine.exportIcs).toBe(catalog.mine.feeds.title)
  })
})
