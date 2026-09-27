import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { renderScreen } from '../test/render'
import { CalendarDayList } from './CalendarDayList'
import type { CalendarData } from '../api'

type Day = CalendarData['days'][number]
type Row = CalendarData['assignments'][number]

const day = (service_date: string, over: Partial<Day> = {}): Day => ({
  service_date, weekday: '', is_day_off: false, holiday_name: null, published: true, events: [], ...over,
})

const duty = (service_date: string, role: Row['role'], assignee_name: string, over: Partial<Row> = {}): Row => ({
  service_date, role, assignee_name, is_override: false, schedule_id: 's1', schedule_version: 1, member_id: null, change_kind: null, ...over,
})

// Wednesday 09-09 to Tuesday 15-09-2026; "today" is Thursday 10-09.
const data: CalendarData = {
  starts_on: '2026-09-09',
  ends_on: '2026-09-15',
  days: [
    day('2026-09-09'),
    day('2026-09-10', { events: [{ id: 'e1', title: 'Migracja bazy', color: 'blue' }] }),
    day('2026-09-12', { is_day_off: true }),
    day('2026-09-13', { is_day_off: true, holiday_name: 'Święto testowe' }),
    day('2026-09-14'),
    day('2026-09-15', { published: false }),
  ],
  members: [{ id: 'm1', display_name: 'Anna Kowalska' }, { id: 'm2', display_name: 'Marek Nowak' }],
  team_has_members: true,
  assignments: [
    duty('2026-09-09', 'primary', 'Anna Kowalska'),
    duty('2026-09-09', 'secondary', 'Marek Nowak', { change_kind: 'swap' }),
    duty('2026-09-12', 'primary', 'Marek Nowak'),
    duty('2026-09-13', 'late_shift', 'Anna Kowalska'),
  ],
  availability: [
    { member_id: 'm1', kind: 'unavailable', starts_on: '2026-09-14', ends_on: '2026-09-14', note: null },
    { member_id: 'm2', kind: 'prefer', starts_on: '2026-09-09', ends_on: '2026-09-15', note: null },
  ],
}

const items = () => within(screen.getByRole('list', { name: 'Grafik dzień po dniu' })).getAllByRole('listitem')

describe('CalendarDayList', () => {
  it('reads the schedule a day at a time, under week headings', () => {
    renderScreen(
      <CalendarDayList
        data={data}
        displayName="Anna Kowalska"
        gaps={[{ service_date: '2026-09-10', missing: ['primary', 'secondary'] }, { service_date: '2026-09-15', missing: ['primary'] }]}
        onSelectDay={vi.fn()}
        selectedDate="2026-09-12"
      />,
    )
    expect(screen.getByText('Tydzień 37 · 7 – 13 wrz')).toBeInTheDocument()
    expect(screen.getByText('Tydzień 38 · 14 – 20 wrz')).toBeInTheDocument()

    const [wed, thu, sat, sun, mon, tue] = items()
    expect(within(wed).getByText('Anna Kowalska')).toHaveClass('dayrow-you')
    expect(within(wed).getByText('Marek Nowak')).not.toHaveClass('dayrow-you')
    expect(within(wed).getAllByText('brak obsady')).toHaveLength(1)

    expect(thu).toHaveClass('dayrow-td', 'dayrow-gap')
    expect(within(thu).getByText('brak: PRIMARY, SECONDARY')).toBeInTheDocument()
    expect(within(thu).getByText('Migracja bazy')).toBeInTheDocument()

    // A day off without a day shift offers no late-shift row.
    expect(sat).toHaveClass('dayrow-we', 'dayrow-sel')
    expect(within(sat).getAllByRole('button')).toHaveLength(2)
    expect(within(sat).getByText('2X')).toBeInTheDocument()
    expect(within(sun).getByText('Święto testowe')).toBeInTheDocument()
    expect(within(sun).getAllByRole('button')).toHaveLength(3)

    expect(within(mon).getByText('Twoja dostępność: Nie mogę')).toBeInTheDocument()
    expect(within(tue).getByText('poza publikacją')).toBeInTheDocument()
    expect(tue).not.toHaveClass('dayrow-gap')
    expect(within(tue).queryByText(/brak:/)).not.toBeInTheDocument()
  })

  it('hands the chosen day and role to the caller', () => {
    const onSelectDay = vi.fn()
    renderScreen(<CalendarDayList data={data} displayName="Anna Kowalska" gaps={[]} onSelectDay={onSelectDay} />)
    fireEvent.click(screen.getByRole('button', { name: 'SECONDARY, śr 09-09-2026, Marek Nowak' }))
    expect(onSelectDay).toHaveBeenCalledWith(data.days[0], 'secondary')
  })

  it('shows no availability for a viewer who is not on the team', () => {
    renderScreen(<CalendarDayList data={data} displayName="Gość" gaps={[]} onSelectDay={vi.fn()} />)
    expect(screen.queryByText(/Twoja dostępność/)).not.toBeInTheDocument()
    expect(within(items()[4]).queryByText('Chętnie wezmę')).not.toBeInTheDocument()
  })
})
