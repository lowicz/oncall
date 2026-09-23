import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { renderScreen } from '../test/render'
import { ScheduleComparison } from './ScheduleComparison'
import { RotationMode, ScheduleComparison as Comparison, ScheduleSummary, api } from '../api'

const summary = (id: string, rotation_mode: RotationMode): ScheduleSummary => ({
  id,
  name: `Szkic ${id}`,
  starts_on: '2026-10-05',
  ends_on: '2026-11-01',
  status: 'draft',
  version: 1,
  rotation_mode,
  solver_status: 'OPTIMAL',
  assignment_count: 76,
  created_at: '2026-09-10T08:00:00Z',
})

const comparison = (leftId: string, rightId: string): Comparison => ({
  starts_on: '2026-10-05',
  ends_on: '2026-11-01',
  variants: [
    { id: leftId, name: `Szkic ${leftId}`, rotation_mode: 'daily', assignment_count: 76, handovers: 40, max_consecutive_days: 2, load_spread: 1.5, override_count: 0 },
    { id: rightId, name: `Szkic ${rightId}`, rotation_mode: 'weekly', assignment_count: 76, handovers: 8, max_consecutive_days: 7, load_spread: 3, override_count: 1 },
  ],
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ScheduleComparison', () => {
  it('picks and compares the only daily and the only weekly draft at once', async () => {
    const compare = vi.spyOn(api, 'compareSchedules').mockImplementation(async (left, right) => comparison(left, right))
    renderScreen(<ScheduleComparison drafts={[summary('d1', 'daily'), summary('w1', 'weekly')]} />)

    expect(screen.getByLabelText('Wariant dzienny')).toHaveValue('d1')
    expect(screen.getByLabelText('Wariant tygodniowy')).toHaveValue('w1')
    expect(await screen.findByRole('rowheader', { name: 'Rozpiętość obciążenia' })).toBeInTheDocument()
    expect(compare).toHaveBeenCalledTimes(1)
    expect(compare).toHaveBeenCalledWith('d1', 'w1')
    expect(screen.getByRole('row', { name: /Rozpiętość obciążenia/ })).toHaveTextContent('Rozpiętość obciążenia1,53')
  })

  it('waits for the person to choose when one side has several drafts', async () => {
    const compare = vi.spyOn(api, 'compareSchedules').mockImplementation(async (left, right) => comparison(left, right))
    renderScreen(<ScheduleComparison drafts={[summary('d1', 'daily'), summary('d2', 'daily'), summary('w1', 'weekly')]} />)

    const daily = screen.getByLabelText('Wariant dzienny')
    expect(daily).toHaveValue('')
    // The side with a single draft still has nothing to choose.
    expect(screen.getByLabelText('Wariant tygodniowy')).toHaveValue('w1')
    const button = screen.getByRole('button', { name: 'Porównaj' })
    expect(button).toBeDisabled()
    expect(compare).not.toHaveBeenCalled()

    fireEvent.change(daily, { target: { value: 'd2' } })
    expect(compare).not.toHaveBeenCalled()
    fireEvent.click(button)
    expect(await screen.findByRole('rowheader', { name: 'Przydziały' })).toBeInTheDocument()
    expect(compare).toHaveBeenCalledWith('d2', 'w1')
  })

  it('hands the choice back once a second draft of one kind appears', async () => {
    const compare = vi.spyOn(api, 'compareSchedules').mockImplementation(async (left, right) => comparison(left, right))
    function Drafts() {
      const [drafts, setDrafts] = useState([summary('d1', 'daily'), summary('w1', 'weekly')])
      return (
        <>
          <button type="button" onClick={() => setDrafts((current) => [...current, summary('w2', 'weekly')])}>Nowy szkic</button>
          <ScheduleComparison drafts={drafts} />
        </>
      )
    }
    renderScreen(<Drafts />)
    await screen.findByRole('rowheader', { name: 'Przydziały' })

    fireEvent.click(screen.getByRole('button', { name: 'Nowy szkic' }))
    expect(screen.getByLabelText('Wariant tygodniowy')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Porównaj' })).toBeDisabled()
    expect(compare).toHaveBeenCalledTimes(1)
  })
})
