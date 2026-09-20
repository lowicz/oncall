import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { Button, MenuItem, Paper, TextField } from '@mui/material'
import { screen } from '@testing-library/react'
import { renderScreen } from '../test/render'
import { DateField } from './DateField'

/**
 * The layout invariant behind `.form-row` (styles.css):
 *
 *   every control in one form row shares a top edge, and every hint below them
 *   shares a baseline - whether a given field carries a hint or not.
 *
 * It broke because the rows centred their items: a field with a hint is taller
 * than one without, so hinted fields floated about 11 px above their
 * neighbours and their hints landed level with the middle of the boxes beside
 * them. jsdom has no layout engine, so this measures the mechanism rather than
 * the pixels: the real stylesheet has to resolve `align-items: start` onto the
 * row, and the row's non-control items have to take the control band's height.
 */

// Read from disk rather than imported: the assertions are about what the
// shipped stylesheet says, and vitest does not process CSS imports.
const styles = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8')

beforeAll(() => {
  const sheet = document.createElement('style')
  sheet.textContent = styles
  document.head.appendChild(sheet)
})

/** A row exactly like the availability form: hintless, hinted, hintless, action. */
function RepresentativeRow() {
  return (
    <Paper className="form-row availability-form">
      <TextField select label="Typ" value="unavailable" onChange={() => {}}>
        <MenuItem value="unavailable">Nie mogę</MenuItem>
      </TextField>
      <DateField id="from" label="Od" value="2026-09-14" onChange={() => {}} required />
      <DateField id="to" label="Do" value="2026-09-16" onChange={() => {}} required />
      <TextField label="Powód" value="" onChange={() => {}} />
      <Button variant="contained">Dodaj</Button>
    </Paper>
  )
}

const row = () => document.querySelector('.form-row') as HTMLElement

describe('form rows', () => {
  it('aligns every control in the row on one top edge, hinted or not', () => {
    renderScreen(<RepresentativeRow />)
    // `center` is what pulled hinted fields off the band; `start` pins it.
    expect(getComputedStyle(row()).alignItems).toBe('start')
  })

  it('keeps the hinted and hintless fields as siblings of that one row', () => {
    renderScreen(<RepresentativeRow />)
    const fields = [...row().children].filter((node) =>
      node.classList.contains('MuiFormControl-root'),
    )
    expect(fields).toHaveLength(4)
    // Two of the four carry a hint; alignment must not depend on which.
    const hinted = fields.filter((field) => field.querySelector('.MuiFormHelperText-root'))
    expect(hinted).toHaveLength(2)
    expect(hinted.every((field) => field.parentElement === row())).toBe(true)
  })

  it('gives the row action the height of the control band, not of the row', () => {
    renderScreen(<RepresentativeRow />)
    const button = screen.getByRole('button', { name: 'Dodaj' })
    const style = getComputedStyle(button)
    expect(style.alignSelf).toBe('start')
    expect(style.height).toBe('var(--control-height)')
  })

  it('states the control band once, as a token', () => {
    // The band is a single declared height; buttons, switches and action
    // blocks all resolve against it instead of repeating a magic number.
    expect(styles).toMatch(/--control-height:\s*56px/)
  })
})
