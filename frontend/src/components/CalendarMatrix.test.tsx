import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderScreen } from '../test/render'
import { CalendarMatrix } from './CalendarMatrix'
import { ScheduleScreen } from '../screens/Schedule'
import { api } from '../api'
import type { CalendarData, SwapImpact } from '../api'

const day = (offset: number): string => {
  const base = new Date()
  base.setDate(base.getDate() + offset)
  return base.toISOString().slice(0, 10)
}

const calendar = (): CalendarData => ({
  starts_on: day(0),
  ends_on: day(6),
  days: Array.from({ length: 7 }, (_, index) => ({
    service_date: day(index),
    weekday: 'pon',
    is_day_off: false,
    holiday_name: null,
    published: true,
    events: [],
  })),
  members: [
    { id: 'm1', display_name: 'Anna Kowalska' },
    { id: 'm2', display_name: 'Marek Nowak' },
  ],
  team_has_members: true,
  assignments: [
    {
      service_date: day(1),
      role: 'secondary',
      assignee_name: 'Anna Kowalska',
      is_override: false,
      schedule_id: 's1',
      schedule_version: 1,
      member_id: 'm1',
      change_kind: null,
    },
  ],
  availability: [],
})

/** Calendar with Anna Kowalska already holding primary on day(1). */
const calendarWithPrimary = (): CalendarData => ({
  ...calendar(),
  assignments: [
    {
      service_date: day(1),
      role: 'primary',
      assignee_name: 'Anna Kowalska',
      is_override: false,
      schedule_id: 's1',
      schedule_version: 1,
      member_id: 'm1',
      change_kind: null,
    },
  ],
})

const fairnessMember = (name: string): SwapImpact['requester']['before'] => ({
  member_id: name,
  display_name: name,
  active_from: '2024-01-01',
  eligible_days: { primary: 10, secondary: 10, late_shift: 10, weekends: 4, holidays: 1 },
  primary: { actual: 3, expected: 3, deviation: 0 },
  secondary: { actual: 2, expected: 2, deviation: 0 },
  late_shift: { actual: 0, expected: 0, deviation: 0 },
  weekends: { actual: 1, expected: 1, deviation: 0 },
  holidays: { actual: 0, expected: 0, deviation: 0 },
  total_points: 5,
})

const impactFor = (from: string, to: string): SwapImpact => ({
  service_date: day(1),
  role: 'primary',
  points: 1,
  window_start: '2025-09-09',
  window_end: '2026-09-09',
  requester: {
    member_id: from,
    display_name: from,
    before: { ...fairnessMember(from), primary: { actual: 4, expected: 3, deviation: 1 } },
    after: { ...fairnessMember(from), primary: { actual: 3, expected: 3, deviation: 0 } },
  },
  replacement: {
    member_id: to,
    display_name: to,
    before: { ...fairnessMember(to), primary: { actual: 1, expected: 3, deviation: -2 } },
    after: { ...fairnessMember(to), primary: { actual: 2, expected: 3, deviation: -1 } },
  },
})

afterEach(() => vi.restoreAllMocks())

const WEEK = { starts_on: day(0), ends_on: day(6) }
const matrix = (role: 'coordinator' | 'member' = 'coordinator', displayName = 'Koordynator') => (
  <CalendarMatrix role={role} displayName={displayName} range={WEEK} zoom="2" />
)

describe('ScheduleScreen default range', () => {
  const publication = (ends_on: string | null) => ({
    generated_at: '2026-09-06T10:00:00Z',
    is_published: ends_on !== null,
    id: ends_on ? 's1' : null,
    version: ends_on ? 1 : null,
    starts_on: ends_on ? day(0) : null,
    ends_on,
    assignments: [],
    current: [],
    today_is_day_off: false,
    today_holiday_name: null,
  })

  it('asks for the covered range, not a rigid four weeks', async () => {
    const calendarCall = vi.spyOn(api, 'calendar').mockResolvedValue(calendar())
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication(day(2)))
    renderScreen(<ScheduleScreen role="coordinator" displayName="Koordynator" />)

    await waitFor(() => expect(calendarCall).toHaveBeenCalledWith(day(0), day(2)))
    // Exactly once: the query waits for the publication rather than fetching
    // „today only" first and jumping.
    expect(calendarCall).toHaveBeenCalledTimes(1)
  })

  it('falls back to the next four weeks on an empty installation (QA7-L01)', async () => {
    const calendarCall = vi.spyOn(api, 'calendar').mockResolvedValue(calendar())
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication(null))
    renderScreen(<ScheduleScreen role="coordinator" displayName="Koordynator" />)

    await waitFor(() => expect(calendarCall).toHaveBeenCalledWith(day(0), day(27)))
    expect(calendarCall).toHaveBeenCalledTimes(1)
  })

  it('takes the range from the URL and opens the day the palette named', async () => {
    const calendarCall = vi.spyOn(api, 'calendar').mockResolvedValue(calendar())
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue(publication(day(2)))
    renderScreen(
      <ScheduleScreen role="coordinator" displayName="Koordynator" />,
      { route: `/grafik?od=${day(0)}&do=${day(6)}&dzien=${day(1)}` },
    )

    await waitFor(() => expect(calendarCall).toHaveBeenCalledWith(day(0), day(6)))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAccessibleName(expect.stringMatching(/^pt 11-09-2026/))
  })
})

/** Open the day drawer from any cell of the given person, then step into the
 *  explicit staffing-change form and pick a replacement (MED6-03). */
const startStaffChange = async (cellName: RegExp, replacement: string) => {
  const cells = await screen.findAllByRole('button', { name: cellName })
  fireEvent.click(cells[0])
  fireEvent.click(await screen.findByRole('button', { name: 'Zmień obsadę…' }))
  const picker = await screen.findByRole('combobox', { name: 'Osoba' })
  const option = await screen.findByRole('option', { name: replacement })
  fireEvent.change(picker, { target: { value: option.getAttribute('value') } })
}

describe('CalendarMatrix override confirmation', () => {
  it('shows the hard rules the override would break before confirming', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(calendar())
    const check = vi.spyOn(api, 'directOverrideCheck').mockResolvedValue([
      {
        rule: 'three_in_seven',
        message: 'Więcej niż 3 dyżury on-call w okresie 7 dni.',
        member_name: 'Marek Nowak',
        days: [day(1), day(2), day(3), day(4)],
      },
    ])
    renderScreen(matrix())

    await startStaffChange(/Anna Kowalska/, 'Marek Nowak')
    fireEvent.click(await screen.findByRole('button', { name: /Zmień obsadę…|Obsadź…/ }))

    expect(await screen.findByText(/Ta korekta złamie reguły twarde/)).toBeInTheDocument()
    expect(screen.getByText(/Więcej niż 3 dyżury on-call w okresie 7 dni/)).toBeInTheDocument()
    expect(screen.getByText(/Naruszenie trafi do dziennika audytu/)).toBeInTheDocument()
    expect(check).toHaveBeenCalledWith(
      expect.objectContaining({ replacement_member_id: 'm2', role: 'primary' }),
    )
    // Warned, not blocked: the confirm button stays enabled.
    expect(screen.getByRole('button', { name: /^(Zmień obsadę|Obsadź)$/ })).toBeEnabled()
  })

  it('shows no warning when the override is clean', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(calendar())
    vi.spyOn(api, 'directOverrideCheck').mockResolvedValue([])
    renderScreen(matrix())

    await startStaffChange(/Anna Kowalska/, 'Marek Nowak')
    fireEvent.click(await screen.findByRole('button', { name: /Zmień obsadę…|Obsadź…/ }))

    await screen.findByRole('button', { name: /^(Zmień obsadę|Obsadź)$/ })
    expect(screen.queryByText(/Ta korekta złamie reguły twarde/)).not.toBeInTheDocument()
  })
})

describe('CalendarMatrix staffing change (MED6-03)', () => {
  it('titles the drawer by the day and keeps the clicked person as context', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(calendar())
    renderScreen(matrix())

    const cells = await screen.findAllByRole('button', { name: /Anna Kowalska/ })
    fireEvent.click(cells[0])
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Z wiersza osoby: Anna Kowalska/)).toBeInTheDocument()
    // The person's name is context, not the dialog's title.
    expect(dialog).toHaveAccessibleName(expect.stringMatching(/^czw 10-09-2026/))
    expect(dialog).not.toHaveAccessibleName(expect.stringMatching(/Anna Kowalska/))
  })

  it('lets the coordinator remove a duty from the person whose cell they clicked', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(calendarWithPrimary())
    vi.spyOn(api, 'directOverrideCheck').mockResolvedValue([])
    vi.spyOn(api, 'swapImpact').mockResolvedValue(impactFor('Anna Kowalska', 'Marek Nowak'))
    const override = vi.spyOn(api, 'directOverride').mockResolvedValue({} as never)
    renderScreen(matrix())

    // Click Anna's own primary cell - the very move the old UI trapped.
    const annaCells = await screen.findAllByRole('button', { name: /Anna Kowalska.*PRIMARY/ })
    fireEvent.click(annaCells[0])
    fireEvent.click(await screen.findByRole('button', { name: 'Zmień obsadę…' }))
    const picker = await screen.findByRole('combobox', { name: 'Osoba' })
    // Anna is the current holder, so she is offered but disabled with a reason.
    expect(screen.getByRole('option', { name: /Anna Kowalska - już pełni tę rolę/ })).toBeDisabled()
    fireEvent.change(picker, { target: { value: 'm2' } })
    fireEvent.click(await screen.findByRole('button', { name: /Zmień obsadę…/ }))
    fireEvent.click(await screen.findByRole('button', { name: /^Zmień obsadę$/ }))

    await waitFor(() => expect(override).toHaveBeenCalled())
    expect(override.mock.calls[0][0]).toMatchObject({
      service_date: day(1), role: 'primary', replacement_member_id: 'm2',
    })
  })

  it('spells out why the confirm step is disabled until a person is picked', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(calendar())
    renderScreen(matrix())

    const cells = await screen.findAllByRole('button', { name: /Anna Kowalska/ })
    fireEvent.click(cells[0])
    fireEvent.click(await screen.findByRole('button', { name: 'Zmień obsadę…' }))

    expect(await screen.findByText('Wybierz osobę, która ma objąć tę rolę.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Zmień obsadę…|Obsadź…/ })).toBeDisabled()
  })

  it('never opens the change form on „11-19" for a day off', async () => {
    const base = calendar()
    const dayOff: CalendarData = {
      ...base,
      days: base.days.map((d, index) => index === 1 ? { ...d, is_day_off: true } : d),
      assignments: [{
        service_date: day(1),
        role: 'late_shift',
        assignee_name: 'Anna Kowalska',
        is_override: false,
        schedule_id: 's1',
        schedule_version: 1,
        member_id: 'm1',
        change_kind: null,
      }],
    }
    vi.spyOn(api, 'calendar').mockResolvedValue(dayOff)
    renderScreen(matrix())

    // Anna's 11-19 cell on the day off - selectedRole becomes 'late_shift'.
    const cells = await screen.findAllByRole('button', { name: /Anna Kowalska.*11–19/ })
    fireEvent.click(cells[0])
    fireEvent.click(await screen.findByRole('button', { name: 'Zmień obsadę…' }))
    // The role select clamps to PRIMARY rather than a value it cannot render.
    expect(await screen.findByRole('combobox', { name: 'Rola' })).toHaveValue('primary')
    expect(screen.queryByRole('option', { name: '11–19' })).not.toBeInTheDocument()
  })

  it('adds a calendar event from the day drawer', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(calendar())
    const create = vi.spyOn(api, 'createCalendarEvent').mockResolvedValue({
      id: 'e1', title: 'Release', color: 'blue',
      starts_on: day(0), ends_on: day(0), created_at: '2026-09-06T00:00:00Z',
    })
    renderScreen(matrix())

    const cells = await screen.findAllByRole('button', { name: /Anna Kowalska/ })
    fireEvent.click(cells[0])
    fireEvent.click(await screen.findByRole('button', { name: 'Wydarzenie' }))
    fireEvent.change(await screen.findByRole('textbox', { name: /^Nazwa/ }), {
      target: { value: 'Release' },
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Zielony' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dodaj wydarzenie' }))
    await waitFor(() => expect(create).toHaveBeenCalled())
    expect(create.mock.calls[0][0]).toMatchObject({
      starts_on: day(0), ends_on: day(0), title: 'Release', color: 'green',
    })
  })
})

describe('CalendarMatrix override balance preview (MED6-04)', () => {
  const reachConfirm = async (replacement: string) => {
    await startStaffChange(/Anna Kowalska.*PRIMARY/, replacement)
    fireEvent.click(await screen.findByRole('button', { name: /Zmień obsadę…|Obsadź…/ }))
  }

  it('shows the balance impact for both people alongside the hard-rule check', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(calendarWithPrimary())
    vi.spyOn(api, 'directOverrideCheck').mockResolvedValue([])
    const impact = vi.spyOn(api, 'swapImpact')
      .mockResolvedValue(impactFor('Anna Kowalska', 'Marek Nowak'))
    renderScreen(matrix())

    await reachConfirm('Marek Nowak')

    expect(await screen.findByText('Wpływ na bilans')).toBeInTheDocument()
    // Coordinator override, not a swap: the losing side „traci", does not „oddaje".
    expect(screen.getByText(/traci dyżur/)).toBeInTheDocument()
    expect(screen.getByText(/przejmuje dyżur/)).toBeInTheDocument()
    // Marek moves from -2 to -1 on primary: closer to balance.
    expect(screen.getAllByText(/bliżej równowagi/).length).toBeGreaterThan(0)
    expect(impact).toHaveBeenCalledWith(day(1), 'primary', 'm2')
  })

  it('says nobody loses a duty when the slot was empty', async () => {
    // calendar() has no primary assignment on day(0): filling it is a pure add.
    vi.spyOn(api, 'calendar').mockResolvedValue(calendar())
    vi.spyOn(api, 'directOverrideCheck').mockResolvedValue([])
    const impact = vi.spyOn(api, 'swapImpact').mockResolvedValue(impactFor('x', 'y'))
    renderScreen(matrix())

    await startStaffChange(/Marek Nowak/, 'Anna Kowalska')
    fireEvent.click(await screen.findByRole('button', { name: /Zmień obsadę…|Obsadź…/ }))

    expect(await screen.findByText(/Slot był pusty/)).toBeInTheDocument()
    expect(impact).not.toHaveBeenCalled()
  })
})

describe('CalendarMatrix hard unavailability', () => {
  const withUnavailability = (): CalendarData => ({
    ...calendar(),
    availability: [
      {
        member_id: 'm2',
        kind: 'unavailable',
        starts_on: day(0),
        ends_on: day(6),
        note: 'Urlop',
      },
    ],
  })

  it('offers an unavailable person only as a disabled option that says why', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(withUnavailability())
    const check = vi.spyOn(api, 'directOverrideCheck').mockResolvedValue([])
    renderScreen(matrix())

    const cells = await screen.findAllByRole('button', { name: /Anna Kowalska/ })
    fireEvent.click(cells[0])
    // The day drawer names the unavailability as day context.
    expect(await screen.findByText(/Marek Nowak: Nie mogę - Urlop/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Zmień obsadę…' }))
    await screen.findByRole('combobox', { name: 'Osoba' })
    expect(screen.getByRole('option', { name: /Marek Nowak - niedostępna tego dnia/ })).toBeDisabled()
    expect(check).not.toHaveBeenCalled()
  })

  it('still offers the correction for a soft preference', async () => {
    const data = withUnavailability()
    data.availability[0].kind = 'prefer_not'
    vi.spyOn(api, 'calendar').mockResolvedValue(data)
    vi.spyOn(api, 'directOverrideCheck').mockResolvedValue([])
    renderScreen(matrix())

    await startStaffChange(/Anna Kowalska/, 'Marek Nowak')
    expect(await screen.findByRole('button', { name: /Zmień obsadę…|Obsadź…/ })).toBeEnabled()
  })
})

describe('CalendarMatrix event deletion', () => {
  const withEvent = (): CalendarData => {
    const base = calendar()
    return {
      ...base,
      days: base.days.map((d, index) => index === 0 ? { ...d, events: [{ id: 'e1', title: 'Audyt', color: 'red' }] } : d),
    }
  }

  const openDeletion = async () => {
    const cells = await screen.findAllByRole('button', { name: /Anna Kowalska/ })
    fireEvent.click(cells[0])
    fireEvent.click(await screen.findByRole('button', { name: 'Usuń' }))
    return screen.findByRole('dialog', { name: 'Usunąć wydarzenie?' })
  }

  it('keeps the event when the confirmation is cancelled', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(withEvent())
    const remove = vi.spyOn(api, 'deleteCalendarEvent').mockResolvedValue(undefined)
    renderScreen(matrix())

    const confirm = await openDeletion()
    expect(within(confirm).getByText(/„Audyt” zniknie ze wszystkich dni/)).toBeInTheDocument()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Anuluj' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Usunąć wydarzenie?' })).not.toBeInTheDocument())
    expect(remove).not.toHaveBeenCalled()
    expect(screen.getByText('Audyt')).toBeInTheDocument()
  })

  it('deletes the event once confirmed', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(withEvent())
    const remove = vi.spyOn(api, 'deleteCalendarEvent').mockResolvedValue(undefined)
    renderScreen(matrix())

    const confirm = await openDeletion()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Usuń' }))

    await waitFor(() => expect(remove).toHaveBeenCalled())
    expect(remove.mock.calls[0][0]).toBe('e1')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Usunąć wydarzenie?' })).not.toBeInTheDocument())
  })
})
