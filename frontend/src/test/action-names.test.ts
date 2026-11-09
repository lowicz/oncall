/**
 * One act, one name: a button never carries different names for the same
 * thing, and an ellipsis announces that a form or a dialog follows, never a
 * save. Checked on the catalogs of both languages.
 */
import { describe, expect, it } from 'vitest'
import { en } from '../i18n/en'
import { pl } from '../i18n/pl'

describe.each([['Polish', pl], ['English', en]] as const)('the %s button names', (_, catalog) => {
  it('names the staffing buttons by their effects', () => {
    const { inspector, confirm, staffChange } = catalog.schedule
    // "Change person" opens a form in the panel, so it carries the ellipsis;
    // the saves name what they save and carry none.
    expect(new Set([inspector.changeStaffing, confirm.save, staffChange.saveRoles(2)]).size).toBe(3)
    expect(inspector.changeStaffing.endsWith('…')).toBe(true)
    expect(inspector.changePerson).toBe(inspector.changeStaffing)
    for (const name of [confirm.save, staffChange.saveRoles(2)]) expect(name.endsWith('…')).toBe(false)
    expect(`${inspector.changeRole('PRIMARY', 'Anna')}…`.endsWith(inspector.changeStaffing)).toBe(true)
  })

  it('starts a swap request under one name wherever it starts', () => {
    const name = catalog.swaps.newSwap
    // Every entry opens the request form, so every entry carries the ellipsis.
    expect(name.endsWith('…')).toBe(true)
    expect([catalog.mine.proposeSwap, catalog.mine.duties.swap, catalog.schedule.inspector.requestSwap]).toEqual([name, name, name])
    expect(catalog.swaps.compose.title).toBe(name.replace('…', ''))
  })

  it('calls the CSV export, showing a day and ending a handover by one name each', () => {
    expect(new Set([catalog.people.exportCsv, catalog.audit.exportCsv, catalog.reports.downloadCsv, catalog.fairness.exportCsv]).size).toBe(1)
    expect(new Set([catalog.swaps.toasts.openDay, catalog.schedule.toast.openDay, catalog.generator.problems.showDay]).size).toBe(1)
    expect(catalog.mine.availability.collision.openDay('1 wrz').startsWith(catalog.generator.problems.showDay)).toBe(true)
    expect(catalog.forwarding.state.endHandover).toBe(catalog.duty.handover.end)
  })

  it('calls generating a draft for a range as the schedule screen does', () => {
    expect(catalog.generator.form.create).toBe(catalog.schedule.actions.generateNext)
  })

  it('withdraws an import, which cannot be undone, under a name other than Undo', () => {
    const { previous, revokeDialog } = catalog.historyImport
    expect(previous.undo).toBe(`${revokeDialog.confirm}…`)
    expect(previous.undo).not.toContain(catalog.common.undo)
  })

  it('names ending a rotation once, from the entry to both steps of the dialog', () => {
    const { rotationTab, offboarding } = catalog.people
    const name = rotationTab.endRotation.replace('…', '')
    // The entry opens the dialog, so it carries the ellipsis; the button in
    // the dialog does not, and says the act in the same words.
    expect(rotationTab.endRotation.endsWith('…')).toBe(true)
    expect(offboarding.rewriteAndEnd(0)).toBe(name)
    expect(offboarding.rewriteAndEnd(6).toLowerCase().endsWith(name.toLowerCase())).toBe(true)
    expect(offboarding.rewriteAndEnd(6)).toContain('6')
  })

  it('calls the team member screen and its swaps inbox by two different names', () => {
    expect(catalog.nav.screens.mine).toBe(catalog.mine.title)
    // The phone's five bottom tabs keep a short form of the same screen.
    expect(catalog.nav.tabs.mine.length).toBeLessThan(catalog.nav.screens.mine.length)
    expect(catalog.swaps.inbox.mine).not.toBe(catalog.nav.screens.mine)
    // The empty inbox sends the member to the screen by the name the rail shows.
    expect(catalog.swaps.inbox.emptyToMeDescription).toContain(catalog.nav.screens.mine)
  })

  it('calls the ICS subscription the same in the button and in the panel', () => {
    expect(catalog.mine.exportIcs).toBe(catalog.mine.feeds.title)
  })
})
