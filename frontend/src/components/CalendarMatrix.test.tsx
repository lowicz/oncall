import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { focusManager } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { renderScreen } from '../test/render'
import { CalendarMatrix } from './CalendarMatrix'
import { ScheduleScreen } from '../screens/Schedule'
import { ApiError, api } from '../api'
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

function Location() {
  const location = useLocation()
  return <span data-testid="path">{location.pathname}{location.search}</span>
}

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

const threeInSeven = {
  rule: 'three_in_seven',
  message: 'Więcej niż 3 dyżury on-call w okresie 7 dni.',
  member_name: 'Marek Nowak',
  days: [day(1), day(2), day(3), day(4)],
}

/** Open the confirmation for handing Anna's primary duty on day(1) to Marek. */
const confirmHandOver = async () => {
  const annaCells = await screen.findAllByRole('button', { name: /Anna Kowalska.*PRIMARY/ })
  fireEvent.click(annaCells[0])
  fireEvent.click(await screen.findByRole('button', { name: 'Zmień obsadę…' }))
  fireEvent.change(await screen.findByRole('combobox', { name: 'Osoba' }), { target: { value: 'm2' } })
  fireEvent.click(await screen.findByRole('button', { name: /Zmień obsadę…/ }))
  return screen.findByRole('button', { name: /^Zmień obsadę$/ })
}

describe('CalendarMatrix override confirmation', () => {
  it('shows the hard rules the override would break before confirming', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(calendar())
    const check = vi.spyOn(api, 'directOverrideCheck').mockResolvedValue([threeInSeven])
    renderScreen(matrix())

    await startStaffChange(/Anna Kowalska/, 'Marek Nowak')
    fireEvent.click(await screen.findByRole('button', { name: /Zmień obsadę…|Obsadź…/ }))

    expect(await screen.findByText(/Ta korekta złamie reguły twarde/)).toBeInTheDocument()
    expect(screen.getByText(/Więcej niż 3 dyżury on-call w okresie 7 dni/)).toBeInTheDocument()
    expect(screen.getByText(/Naruszenie trafi do dziennika audytu/)).toBeInTheDocument()
    expect(check).toHaveBeenCalledWith(
      expect.objectContaining({ replacement_member_id: 'm2', role: 'primary' }),
    )
    // Saving waits for the explicit acknowledgement.
    expect(screen.getByRole('button', { name: /^(Zmień obsadę|Obsadź)$/ })).toBeDisabled()
  })

  it('sends the acknowledgement only once the coordinator ticks it', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(calendarWithPrimary())
    vi.spyOn(api, 'directOverrideCheck').mockResolvedValue([threeInSeven])
    vi.spyOn(api, 'swapImpact').mockResolvedValue(impactFor('Anna Kowalska', 'Marek Nowak'))
    const override = vi.spyOn(api, 'directOverride').mockResolvedValue({} as never)
    renderScreen(matrix())

    const confirm = await confirmHandOver()
    const acknowledgement = await screen.findByRole('checkbox', { name: 'Rozumiem i świadomie łamię te reguły' })
    expect(acknowledgement).not.toBeChecked()
    expect(confirm).toBeDisabled()

    fireEvent.click(acknowledgement)
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)

    await waitFor(() => expect(override).toHaveBeenCalled())
    expect(override.mock.calls[0][0]).toMatchObject({
      replacement_member_id: 'm2', acknowledge_rule_violations: true,
    })
  })

  it('checks again and asks for the acknowledgement when the write finds a new violation', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(calendarWithPrimary())
    const check = vi.spyOn(api, 'directOverrideCheck')
      .mockResolvedValueOnce([])
      .mockResolvedValue([threeInSeven])
    vi.spyOn(api, 'swapImpact').mockResolvedValue(impactFor('Anna Kowalska', 'Marek Nowak'))
    const override = vi.spyOn(api, 'directOverride').mockRejectedValueOnce(
      new ApiError('Korekta złamie reguły twarde grafiku; potwierdź świadome naruszenie', 409, [threeInSeven]),
    )
    renderScreen(matrix())

    const confirm = await confirmHandOver()
    await waitFor(() => expect(confirm).toBeEnabled())
    fireEvent.click(confirm)

    await waitFor(() => expect(override).toHaveBeenCalledTimes(1))
    expect(override.mock.calls[0][0]).toMatchObject({ acknowledge_rule_violations: false })
    expect(await screen.findByText(/Ta korekta złamie reguły twarde/)).toBeInTheDocument()
    expect(check).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('checkbox', { name: 'Rozumiem i świadomie łamię te reguły' })).not.toBeChecked()
    expect(screen.getByRole('button', { name: /^(Zmień obsadę|Obsadź)$/ })).toBeDisabled()
  })

  it('shows no warning when the override is clean', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(calendar())
    vi.spyOn(api, 'directOverrideCheck').mockResolvedValue([])
    renderScreen(matrix())

    await startStaffChange(/Anna Kowalska/, 'Marek Nowak')
    fireEvent.click(await screen.findByRole('button', { name: /Zmień obsadę…|Obsadź…/ }))

    const confirm = await screen.findByRole('button', { name: /^(Zmień obsadę|Obsadź)$/ })
    expect(screen.queryByText(/Ta korekta złamie reguły twarde/)).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /świadomie łamię/ })).not.toBeInTheDocument()
    await waitFor(() => expect(confirm).toBeEnabled())
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
      acknowledge_rule_violations: false,
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
    // Asked for as a correction: 11-19 moves with its anchor role only.
    expect(impact).toHaveBeenCalledWith(day(1), 'primary', 'm2', { correction: true })
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

type Row = CalendarData['assignments'][number]
type Day = CalendarData['days'][number]

/** Monday 07-09 to Sunday 13-09-2026, the week of the pinned "today" (Thursday 10-09). */
const WEEK_OF_TODAY = { starts_on: '2026-09-07', ends_on: '2026-09-13' }
const DATES = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13']

const duty = (service_date: string, role: Row['role'], assignee_name: string, member_id: string, over: Partial<Row> = {}): Row => ({
  service_date, role, assignee_name, member_id, is_override: false, schedule_id: 's1', schedule_version: 4, change_kind: null, ...over,
})

/** Anna holds PRIMARY and Marek SECONDARY on every day, so the week has no gap. */
const covered = (dates = DATES) => dates.flatMap((date) => [duty(date, 'primary', 'Anna Kowalska', 'm1'), duty(date, 'secondary', 'Marek Nowak', 'm2')])

const week = (over: Partial<CalendarData> = {}, days: Record<string, Partial<Day>> = {}): CalendarData => ({
  ...WEEK_OF_TODAY,
  days: DATES.map((service_date) => ({
    service_date,
    weekday: '',
    is_day_off: service_date >= '2026-09-12',
    holiday_name: null,
    published: true,
    events: [],
    ...days[service_date],
  })),
  members: [
    { id: 'm1', display_name: 'Anna Kowalska' },
    { id: 'm2', display_name: 'Marek Nowak' },
    { id: 'm3', display_name: 'Ola Wiśniewska' },
  ],
  team_has_members: true,
  assignments: covered(),
  availability: [],
  ...over,
})

const riskRow = () => screen.getByRole('list', { name: 'Ryzyka w zakresie' })

describe('CalendarMatrix risk chips', () => {
  it('names the gaps, the unpublished days and the clashes, and each chip opens its first day', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week({
      // Only Monday is staffed; the weekend is not published yet.
      assignments: covered(['2026-09-07']),
      availability: [{ member_id: 'm1', kind: 'unavailable', starts_on: '2026-09-07', ends_on: '2026-09-07', note: null }],
    }, { '2026-09-12': { published: false }, '2026-09-13': { published: false } }))
    renderScreen(<CalendarMatrix role="coordinator" displayName="Koordynator" range={WEEK_OF_TODAY} />)

    const gaps = await screen.findByRole('button', { name: /4 dni bez pełnej obsady/ })
    expect(gaps).toHaveTextContent('4 dni bez pełnej obsady · 08-09, 09-09, 10-09…')
    expect(within(riskRow()).getByText('2 dni poza opublikowanym grafikiem')).toHaveAttribute('title', 'Obsadzenie wymaga wygenerowania i opublikowania nowego grafiku')
    expect(within(riskRow()).queryByText('Pełna obsada w całym zakresie')).not.toBeInTheDocument()

    fireEvent.click(gaps)
    expect(await screen.findByRole('dialog', { name: /^wt 08-09-2026/ })).toBeInTheDocument()
    // The grid's single tab stop moves to that day's column.
    expect(screen.getAllByRole('button', { name: /^Anna Kowalska, wt 08-09-2026/ })[0]).toHaveAttribute('tabindex', '0')

    fireEvent.click(within(riskRow()).getByRole('button', { name: /1 osoba z dyżurem w dniu niedostępności/ }))
    expect(await screen.findByRole('dialog', { name: /^pon 07-09-2026/ })).toBeInTheDocument()
  })

  it('tells a member the coordinator has not published yet and keeps clashes to coordinators', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week({
      availability: [{ member_id: 'm1', kind: 'unavailable', starts_on: '2026-09-07', ends_on: '2026-09-07', note: null }],
    }, { '2026-09-13': { published: false } }))
    renderScreen(<CalendarMatrix role="member" displayName="Anna Kowalska" range={WEEK_OF_TODAY} />)

    // Sunday has duties but is outside the publication: no gap, so full coverage.
    expect(await within(await screen.findByRole('list', { name: 'Ryzyka w zakresie' })).findByText('Pełna obsada w całym zakresie')).toBeInTheDocument()
    expect(screen.queryByText(/z dyżurem w dniu niedostępności/)).not.toBeInTheDocument()
  })

  it('tells a member that unstaffed days past the publication wait for the coordinator', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week({ assignments: covered(DATES.slice(0, 6)) }, { '2026-09-13': { published: false } }))
    renderScreen(<CalendarMatrix role="member" displayName="Anna Kowalska" range={WEEK_OF_TODAY} />)
    expect(await screen.findByText('1 dzień poza opublikowanym grafikiem')).toHaveAttribute('title', 'Koordynator jeszcze nie opublikował tego okresu')
    expect(screen.queryByRole('button', { name: /bez pełnej obsady/ })).not.toBeInTheDocument()
  })

  it('shows a coordinator full coverage only when nobody holds a duty on a day they cannot', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week({
      availability: [{ member_id: 'm2', kind: 'unavailable', starts_on: '2026-09-09', ends_on: '2026-09-09', note: null }],
    }))
    renderScreen(<CalendarMatrix role="admin" displayName="Administrator" range={WEEK_OF_TODAY} />)
    expect(await screen.findByRole('button', { name: /1 osoba z dyżurem w dniu niedostępności/ })).toBeInTheDocument()
    expect(within(riskRow()).queryByText('Pełna obsada w całym zakresie')).not.toBeInTheDocument()
  })

  it('names a clean week as fully staffed for a coordinator', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week())
    renderScreen(<CalendarMatrix role="coordinator" displayName="Koordynator" range={WEEK_OF_TODAY} />)
    expect(await screen.findByText('Pełna obsada w całym zakresie')).toBeInTheDocument()
  })

  it('carries only the chips the screen adds when the risks are left out', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week({ assignments: [] }))
    renderScreen(<CalendarMatrix role="coordinator" displayName="Koordynator" range={WEEK_OF_TODAY} showRisks={false} extraChips={<span>2 zamiany czekają</span>} />)
    expect(await screen.findByText('2 zamiany czekają')).toBeInTheDocument()
    expect(screen.queryByText(/bez pełnej obsady/)).not.toBeInTheDocument()
  })

  it('opens the first gap in the day list too', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week({ assignments: covered(DATES.slice(0, 6)) }))
    renderScreen(<CalendarMatrix role="coordinator" displayName="Koordynator" range={WEEK_OF_TODAY} view="list" />)
    fireEvent.click(await screen.findByRole('button', { name: /1 dzień bez pełnej obsady/ }))
    expect(await screen.findByRole('dialog', { name: /^niedz 13-09-2026/ })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Macierz grafiku' })).not.toBeInTheDocument()
  })
})

describe('CalendarMatrix states', () => {
  it('shows a failed load that can be retried', async () => {
    const load = vi.spyOn(api, 'calendar').mockRejectedValue(new ApiError('Serwer niedostępny', 503))
    renderScreen(<CalendarMatrix role="member" displayName="Anna Kowalska" range={WEEK_OF_TODAY} />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Serwer niedostępny')
    load.mockResolvedValue(week())
    fireEvent.click(within(alert).getByRole('button', { name: 'Spróbuj ponownie' }))
    expect(await screen.findByRole('region', { name: 'Macierz grafiku' })).toBeInTheDocument()
  })

  it('waits for the screen to settle the range before asking for it', () => {
    const load = vi.spyOn(api, 'calendar')
    renderScreen(<CalendarMatrix role="member" displayName="Anna Kowalska" range={WEEK_OF_TODAY} enabled={false} />)
    expect(screen.getByLabelText('Wczytywanie grafiku')).toHaveAttribute('aria-busy', 'true')
    expect(load).not.toHaveBeenCalled()
  })

  it('sends an admin of an empty team to the people screen', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week({ members: [], assignments: [], team_has_members: false }))
    renderScreen(<CalendarMatrix role="admin" displayName="Administrator" range={WEEK_OF_TODAY} />)
    expect(await screen.findByText('Nikt nie jest jeszcze w rotacji')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Otwórz Osoby' })).toHaveAttribute('href', '/osoby')
  })

  it('tells anyone else the rotation is empty', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week({ members: [], assignments: [], team_has_members: false }))
    renderScreen(<CalendarMatrix role="coordinator" displayName="Koordynator" range={WEEK_OF_TODAY} view="list" />)
    expect(await screen.findByText('Brak osób w rotacji')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Otwórz Osoby' })).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Grafik dzień po dniu' })).not.toBeInTheDocument()
  })

  it('says nobody is in the rotation in a range the team does not reach', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week({ members: [], assignments: [] }))
    renderScreen(
      <CalendarMatrix
        role="member"
        displayName="Anna Kowalska"
        range={WEEK_OF_TODAY}
        heading={(summary) => <h2>{`Osób: ${summary.people}, z dyżurem: ${summary.onDuty}, zespół: ${summary.teamHasMembers ? 'tak' : 'nie'}`}</h2>}
      />,
    )
    expect(await screen.findByText('Nikt nie jest w rotacji w tym zakresie')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Osób: 0, z dyżurem: 0, zespół: tak' })).toBeInTheDocument()
  })

  it('keeps only people on duty when asked, and says when that leaves nobody', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValueOnce(week())
    const first = renderScreen(<CalendarMatrix role="member" displayName="Anna Kowalska" range={WEEK_OF_TODAY} hideIdle heading={<h2>Grafik</h2>} />)
    expect(await screen.findAllByRole('button', { name: /^Marek Nowak/ })).not.toHaveLength(0)
    expect(screen.getByRole('heading', { name: 'Grafik' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Ola Wiśniewska/ })).not.toBeInTheDocument()
    first.unmount()

    vi.spyOn(api, 'calendar').mockResolvedValue(week({ assignments: [] }))
    renderScreen(<CalendarMatrix role="member" displayName="Anna Kowalska" range={WEEK_OF_TODAY} hideIdle />)
    expect(await screen.findByText('Nikt nie ma dyżuru w tym zakresie')).toBeInTheDocument()
  })
})

describe('CalendarMatrix grid', () => {
  it('heads short and long months, marks gap days and names each row', async () => {
    const range = { starts_on: '2026-09-28', ends_on: '2026-10-04' }
    const dates = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']
    vi.spyOn(api, 'calendar').mockResolvedValue({
      ...week(),
      ...range,
      days: dates.map((service_date) => ({
        service_date, weekday: '', is_day_off: service_date >= '2026-10-03', holiday_name: null, published: true, events: [],
        ...(service_date === '2026-10-01' ? { events: [{ id: 'e1', title: 'Migracja', color: 'teal' as const }] } : {}),
        ...(service_date === '2026-10-03' ? { holiday_name: 'Święto testowe' } : {}),
      })),
      members: [
        { id: 'm1', display_name: 'Anna Kowalska' },
        { id: 'm2', display_name: 'Marek Nowak' },
        { id: 'm3', display_name: 'Ola Wiśniewska' },
        { id: 'm4', display_name: 'Piotr Były', active_until: '2026-09-01' },
      ],
      assignments: [
        ...covered(dates.filter((date) => date !== '2026-10-02')),
        duty('2026-09-28', 'late_shift', 'Marek Nowak', 'm2', { change_kind: 'swap' }),
      ],
    })
    renderScreen(<CalendarMatrix role="member" displayName="Ola Wiśniewska" range={range} zoom="8" />)

    const grid = await screen.findByRole('region', { name: 'Macierz grafiku' })
    expect(grid.querySelector('table')).toHaveAttribute('data-zoom', '8')
    expect(within(grid).getByRole('columnheader', { name: 'wrz 2026' })).toHaveAttribute('colspan', '3')
    expect(within(grid).getByRole('columnheader', { name: 'październik 2026' })).toHaveAttribute('colspan', '4')
    const headers = within(grid).getAllByRole('columnheader')
    expect(headers.find((cell) => cell.textContent === 'pt02brak pełnej obsady')).toHaveAttribute('title', 'brak pełnej obsady')
    expect(headers.find((cell) => cell.textContent === 'czw01')).toHaveAttribute('title', 'Migracja')
    expect(headers.find((cell) => cell.textContent === 'sob03')).toHaveAttribute('title', 'Święto testowe')
    expect(headers.find((cell) => cell.textContent === 'wt29')).not.toHaveAttribute('title')

    // Yourself first, then the people on duty, then the rest.
    expect(within(grid).getByText('Ty')).toBeInTheDocument()
    expect(within(grid).getByText('Z dyżurem w zakresie')).toBeInTheDocument()
    expect(within(grid).getByText('Pozostali')).toBeInTheDocument()
    expect(within(grid).getByText('poza rotacją')).toBeInTheDocument()
    expect(within(grid).getByRole('button', { name: 'Marek Nowak, pon 28-09-2026, SECONDARY, 11–19 zamiana' })).toHaveClass('cell')
    expect(within(grid).getByRole('button', { name: /^Anna Kowalska, czw 01-10-2026/ })).toHaveClass('cell-ev')
  })

  it('lights and scrolls to the person the palette named, once', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    try {
      vi.spyOn(api, 'calendar').mockResolvedValue(week())
      renderScreen(<CalendarMatrix role="member" displayName="Anna Kowalska" range={WEEK_OF_TODAY} focusPerson="Marek Nowak" />)
      const cells = await screen.findAllByRole('button', { name: /^Marek Nowak/ })
      expect(cells[0]).toHaveClass('cell-hl')
      await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1))
      expect(scroll).toHaveBeenCalledWith({ block: 'center' })
    } finally {
      delete (Element.prototype as Partial<Element>).scrollIntoView
    }
  })

  it('ignores a person or a day the range does not hold', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    try {
      vi.spyOn(api, 'calendar').mockResolvedValue(week())
      renderScreen(<CalendarMatrix role="member" displayName="Anna Kowalska" range={WEEK_OF_TODAY} focusPerson="Nieznany" focusDay="2026-12-24" />)
      await screen.findByRole('region', { name: 'Macierz grafiku' })
      expect(scroll).not.toHaveBeenCalled()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    } finally {
      delete (Element.prototype as Partial<Element>).scrollIntoView
    }
  })

  it('opens the named day in the day list', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week())
    renderScreen(<CalendarMatrix role="member" displayName="Anna Kowalska" range={WEEK_OF_TODAY} view="list" focusDay="2026-09-09" />)
    expect(await screen.findByRole('dialog', { name: /^śr 09-09-2026/ })).toBeInTheDocument()
  })
})

describe('CalendarMatrix day inspector', () => {
  const open = async (name: RegExp) => {
    fireEvent.click((await screen.findAllByRole('button', { name }))[0])
    return screen.findByRole('dialog')
  }

  it('names what a day is worth', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week({}, { '2026-09-13': { holiday_name: 'Święto testowe' } }))
    renderScreen(<CalendarMatrix role="member" displayName="Anna Kowalska" range={WEEK_OF_TODAY} />)

    expect(within(await open(/^Anna Kowalska, czw 10-09-2026/)).getByText('1X · dzień roboczy')).toBeInTheDocument()
    expect(within(await open(/^Anna Kowalska, sob 12-09-2026/)).getByText('2X · dzień wolny')).toBeInTheDocument()
    const sunday = await open(/^Anna Kowalska, niedz 13-09-2026/)
    expect(within(sunday).getByText('2X · Święto testowe')).toBeInTheDocument()
    expect(within(sunday).getByText('nie dotyczy w dzień wolny')).toBeInTheDocument()
    expect(within(sunday).getAllByText('całodobowo')).toHaveLength(2)
  })

  it('sends a coordinator from an unpublished day to the generator', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week({ assignments: covered(DATES.slice(0, 5)) }, { '2026-09-12': { published: false } }))
    renderScreen(<><CalendarMatrix role="coordinator" displayName="Koordynator" range={WEEK_OF_TODAY} /><Location /></>)

    const dialog = await open(/^Anna Kowalska, sob 12-09-2026/)
    expect(within(dialog).getByText('poza publikacją')).toBeInTheDocument()
    expect(within(dialog).getByText(/Ten dzień jest poza opublikowanym zakresem grafiku\. Żeby go obsadzić/)).toBeInTheDocument()
    // Nothing to staff by hand here: the roles are not buttons.
    expect(within(dialog).queryByRole('button', { name: /Zmień obsadę$/ })).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('link', { name: 'Otwórz generator z tym zakresem' }))
    expect(screen.getByTestId('path')).toHaveTextContent('/generator?od=2026-09-12&do=2026-10-11')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('tells a member an unpublished day is still to come', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week({}, { '2026-09-12': { published: false } }))
    renderScreen(<CalendarMatrix role="member" displayName="Ola Wiśniewska" range={WEEK_OF_TODAY} />)
    const dialog = await open(/^Anna Kowalska, sob 12-09-2026/)
    expect(within(dialog).getByText(/Koordynator jeszcze nie opublikował grafiku na ten okres/)).toBeInTheDocument()
    expect(within(dialog).queryByRole('link', { name: 'Otwórz generator z tym zakresem' })).not.toBeInTheDocument()
  })

  it('offers a member a swap of their own duty and closes on the way', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week())
    renderScreen(<><CalendarMatrix role="member" displayName="Marek Nowak" range={WEEK_OF_TODAY} /><Location /></>)
    const dialog = await open(/^Anna Kowalska, pt 11-09-2026/)
    // The day is Marek's even from Anna's row: the swap is for his role.
    fireEvent.click(within(dialog).getByRole('link', { name: 'Poproś o zamianę' }))
    expect(screen.getByTestId('path')).toHaveTextContent('/zamiany?data=2026-09-11&rola=secondary')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('offers no swap to a viewer and explains the rest of the day to a bystander', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week({
      assignments: [...covered(), duty('2026-09-11', 'late_shift', 'Marek Nowak', 'm2', { change_kind: 'manual_override' })],
      availability: [
        { member_id: 'm3', kind: 'prefer', starts_on: '2026-09-11', ends_on: '2026-09-11', note: null },
        { member_id: 'gone', kind: 'prefer_not', starts_on: '2026-09-11', ends_on: '2026-09-11', note: 'stary wpis' },
      ],
    }))
    renderScreen(<CalendarMatrix role="viewer" displayName="Marek Nowak" range={WEEK_OF_TODAY} />)
    const dialog = await open(/^Ola Wiśniewska, pt 11-09-2026/)
    expect(within(dialog).queryByRole('link', { name: 'Poproś o zamianę' })).not.toBeInTheDocument()
    expect(within(dialog).getByText('korekta')).toBeInTheDocument()
    expect(within(dialog).getByText('nieznana osoba: Wolę nie - stary wpis')).toBeInTheDocument()
    expect(within(dialog).getByText('Ola Wiśniewska: Chętnie wezmę')).toBeInTheDocument()
    // Marek is on duty that day, so the row note stops at the name.
    expect(within(dialog).getByText('Z wiersza osoby: Ola Wiśniewska.')).toBeInTheDocument()
  })

  it('adds a note for someone who is not on duty that day', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week())
    renderScreen(<CalendarMatrix role="member" displayName="Ola Wiśniewska" range={WEEK_OF_TODAY} view="list" />)
    fireEvent.click(await screen.findByRole('button', { name: 'SECONDARY, pt 11-09-2026, Marek Nowak' }))
    const dialog = await screen.findByRole('dialog', { name: /^pt 11-09-2026/ })
    expect(within(dialog).getByText('Z wiersza osoby: Ola Wiśniewska. Szczegóły opublikowanego grafiku.')).toBeInTheDocument()
  })

  it('opens a day from the list without a row for a viewer outside the team', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week())
    renderScreen(<CalendarMatrix role="viewer" displayName="Gość" range={WEEK_OF_TODAY} view="list" />)
    fireEvent.click(await screen.findByRole('button', { name: 'PRIMARY, pt 11-09-2026, Anna Kowalska' }))
    const dialog = await screen.findByRole('dialog', { name: /^pt 11-09-2026/ })
    expect(within(dialog).queryByText(/Z wiersza osoby/)).not.toBeInTheDocument()
  })

  it('keeps an open day while the range moves away from it', async () => {
    const nextWeek = { starts_on: '2026-09-14', ends_on: '2026-09-20' }
    vi.spyOn(api, 'calendar').mockImplementation(async (startsOn) => (startsOn === nextWeek.starts_on
      ? { ...week({ assignments: [] }), ...nextWeek, days: [] }
      : week({}, { '2026-09-11': { published: false } })))
    function Harness() {
      const [range, setRange] = useState(WEEK_OF_TODAY)
      return (
        <>
          <button type="button" onClick={() => setRange(nextWeek)}>Następny tydzień</button>
          <CalendarMatrix role="member" displayName="Anna Kowalska" range={range} />
        </>
      )
    }
    renderScreen(<Harness />)
    const dialog = await open(/^Anna Kowalska, pt 11-09-2026/)
    expect(within(dialog).getByText('poza publikacją')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Następny tydzień' }))
    await waitFor(() => expect(api.calendar).toHaveBeenCalledWith(nextWeek.starts_on, nextWeek.ends_on))
    // Nothing in the new range says otherwise, so the day is no longer marked unpublished.
    await waitFor(() => expect(within(dialog).queryByText('poza publikacją')).not.toBeInTheDocument())
    expect(dialog).toHaveAccessibleName(expect.stringMatching(/^pt 11-09-2026/))
  })

  it('closes from its close button', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week())
    renderScreen(<CalendarMatrix role="member" displayName="Anna Kowalska" range={WEEK_OF_TODAY} />)
    const dialog = await open(/^Anna Kowalska, pt 11-09-2026/)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zamknij panel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

describe('CalendarMatrix staffing form', () => {
  const openForm = async (cell: RegExp, roleRow: string) => {
    fireEvent.click((await screen.findAllByRole('button', { name: cell }))[0])
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: roleRow }))
    return dialog
  }

  it('opens on the role row that was clicked and lets the role and the person change', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week({
      members: [
        { id: 'm1', display_name: 'Anna Kowalska' },
        { id: 'm2', display_name: 'Marek Nowak' },
        { id: 'm3', display_name: 'Ola Wiśniewska' },
      ],
    }))
    renderScreen(<CalendarMatrix role="coordinator" displayName="Koordynator" range={WEEK_OF_TODAY} />)
    const dialog = await openForm(/^Anna Kowalska, pt 11-09-2026/, '11–19: brak obsady. Zmień obsadę')

    const role = within(dialog).getByRole('combobox', { name: 'Rola' })
    expect(role).toHaveValue('late_shift')
    expect(within(dialog).getByText('Obecnie: brak opublikowanego przydziału')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Obsadź…' })).toBeDisabled()

    const person = within(dialog).getByRole('combobox', { name: 'Osoba' })
    fireEvent.change(person, { target: { value: 'm3' } })
    expect(within(dialog).getByRole('button', { name: 'Obsadź…' })).toBeEnabled()
    fireEvent.change(person, { target: { value: '' } })
    expect(within(dialog).getByRole('button', { name: 'Obsadź…' })).toBeDisabled()

    fireEvent.change(person, { target: { value: 'm3' } })
    fireEvent.change(role, { target: { value: 'secondary' } })
    expect(person).toHaveValue('')
    expect(within(dialog).getByText('Obecnie: Marek Nowak')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Wróć' }))
    expect(within(dialog).queryByRole('combobox', { name: 'Osoba' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'SECONDARY: Marek Nowak. Zmień obsadę' })).toHaveClass('role-row-sel')
  })

  it('asks for a reason before correcting a day already past', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week())
    vi.spyOn(api, 'directOverrideCheck').mockResolvedValue([])
    vi.spyOn(api, 'swapImpact').mockResolvedValue(impactFor('Anna Kowalska', 'Ola Wiśniewska'))
    const save = vi.spyOn(api, 'directOverride').mockResolvedValue({} as never)
    renderScreen(<CalendarMatrix role="coordinator" displayName="Koordynator" range={WEEK_OF_TODAY} />)
    const dialog = await openForm(/^Anna Kowalska, wt 08-09-2026/, 'PRIMARY: Anna Kowalska. Zmień obsadę')
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Osoba' }), { target: { value: 'm3' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zmień obsadę…' }))

    const confirmation = await screen.findByRole('dialog', { name: 'Potwierdź zmianę obsady' })
    expect(confirmation).toHaveTextContent('Przypiszesz: Ola Wiśniewska zamiast Anna Kowalska')
    fireEvent.change(within(confirmation).getByRole('textbox', { name: /Powód korekty historycznej/ }), { target: { value: 'Zamiana ustalona telefonicznie' } })
    const confirm = within(confirmation).getByRole('button', { name: 'Zmień obsadę' })
    await waitFor(() => expect(confirm).toBeEnabled())
    fireEvent.click(confirm)

    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0][0]).toEqual({
      schedule_id: 's1', expected_version: 4, service_date: '2026-09-08', role: 'primary',
      replacement_member_id: 'm3', reason: 'Zamiana ustalona telefonicznie', acknowledge_rule_violations: false,
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('lets the change go ahead when the rule check itself fails', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week())
    vi.spyOn(api, 'directOverrideCheck').mockRejectedValue(new ApiError('Sprawdzenie niedostępne', 503))
    vi.spyOn(api, 'swapImpact').mockResolvedValue(impactFor('Anna Kowalska', 'Ola Wiśniewska'))
    const save = vi.spyOn(api, 'directOverride').mockResolvedValue({} as never)
    renderScreen(<CalendarMatrix role="coordinator" displayName="Koordynator" range={WEEK_OF_TODAY} />)
    const dialog = await openForm(/^Anna Kowalska, pt 11-09-2026/, 'PRIMARY: Anna Kowalska. Zmień obsadę')
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Osoba' }), { target: { value: 'm3' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zmień obsadę…' }))

    const confirmation = await screen.findByRole('dialog', { name: 'Potwierdź zmianę obsady' })
    const confirm = within(confirmation).getByRole('button', { name: 'Zmień obsadę' })
    await waitFor(() => expect(confirm).toBeEnabled())
    fireEvent.click(confirm)
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0][0]).toMatchObject({ reason: undefined, acknowledge_rule_violations: false })
  })

  it('shows a refused change in the confirmation, then in the form once it is cancelled', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week())
    const check = vi.spyOn(api, 'directOverrideCheck').mockResolvedValue([])
    vi.spyOn(api, 'swapImpact').mockResolvedValue(impactFor('Anna Kowalska', 'Ola Wiśniewska'))
    vi.spyOn(api, 'directOverride').mockRejectedValue(new ApiError('Grafik zmienił wersję', 409))
    renderScreen(<CalendarMatrix role="coordinator" displayName="Koordynator" range={WEEK_OF_TODAY} />)
    const dialog = await openForm(/^Anna Kowalska, pt 11-09-2026/, 'PRIMARY: Anna Kowalska. Zmień obsadę')
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Osoba' }), { target: { value: 'm3' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zmień obsadę…' }))

    const confirmation = await screen.findByRole('dialog', { name: 'Potwierdź zmianę obsady' })
    const confirm = within(confirmation).getByRole('button', { name: 'Zmień obsadę' })
    await waitFor(() => expect(confirm).toBeEnabled())
    fireEvent.click(confirm)
    expect(await within(confirmation).findByRole('alert')).toHaveTextContent('Grafik zmienił wersję')
    // A refusal without rule violations is not re-checked.
    expect(check).toHaveBeenCalledTimes(1)

    fireEvent.click(within(confirmation).getByRole('button', { name: 'Anuluj' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Potwierdź zmianę obsady' })).not.toBeInTheDocument())
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent('Grafik zmienił wersję')
  })

  it('explains a block that appears while the form is open', async () => {
    const load = vi.spyOn(api, 'calendar').mockResolvedValue(week())
    renderScreen(<CalendarMatrix role="admin" displayName="Administrator" range={WEEK_OF_TODAY} />)
    const dialog = await openForm(/^Anna Kowalska, pt 11-09-2026/, 'PRIMARY: Anna Kowalska. Zmień obsadę')
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Osoba' }), { target: { value: 'm3' } })

    // Meanwhile Ola marks the day as one she cannot take; the screen refreshes when the window regains focus.
    load.mockResolvedValue(week({ availability: [{ member_id: 'm3', kind: 'unavailable', starts_on: '2026-09-11', ends_on: '2026-09-11', note: null }] }))
    act(() => { focusManager.setFocused(false); focusManager.setFocused(true) })
    expect(await within(dialog).findByText('Wybrana osoba niedostępna tego dnia.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Zmień obsadę…' })).toBeDisabled()

    // Then the day drops out of the publication altogether.
    load.mockResolvedValue(week({}, { '2026-09-11': { published: false } }))
    act(() => { focusManager.setFocused(false); focusManager.setFocused(true) })
    expect(await within(dialog).findByText('Dzień jest poza opublikowanym grafikiem.')).toBeInTheDocument()
    act(() => { focusManager.setFocused(undefined) })
  })
})

describe('CalendarMatrix events', () => {
  const openDay = async () => {
    fireEvent.click((await screen.findAllByRole('button', { name: /^Anna Kowalska, pt 11-09-2026/ }))[0])
    return screen.findByRole('dialog')
  }

  it('closes the event form on cancel and shows why an event was not added', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week())
    const create = vi.spyOn(api, 'createCalendarEvent').mockRejectedValue(new ApiError('Tytuł jest za długi', 422))
    renderScreen(<CalendarMatrix role="coordinator" displayName="Koordynator" range={WEEK_OF_TODAY} />)
    const dialog = await openDay()

    const toggle = within(dialog).getByRole('button', { name: 'Wydarzenie' })
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Anuluj' }))
    expect(within(dialog).queryByRole('textbox', { name: /^Nazwa/ })).not.toBeInTheDocument()

    fireEvent.click(toggle)
    const title = within(dialog).getByRole('textbox', { name: /^Nazwa/ })
    fireEvent.change(title, { target: { value: '   ' } })
    expect(within(dialog).getByRole('button', { name: 'Dodaj wydarzenie' })).toBeDisabled()
    // Enter in the field submits the form past the disabled button.
    fireEvent.submit(title.closest('form')!)
    expect(create).not.toHaveBeenCalled()
    fireEvent.change(title, { target: { value: 'Bardzo długi tytuł' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dodaj wydarzenie' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Tytuł jest za długi')
  })

  it('keeps nothing of a day closed before its new event was saved', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week())
    let finish: (value: Awaited<ReturnType<typeof api.createCalendarEvent>>) => void = () => {}
    vi.spyOn(api, 'createCalendarEvent').mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    renderScreen(<CalendarMatrix role="coordinator" displayName="Koordynator" range={WEEK_OF_TODAY} />)
    const dialog = await openDay()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Wydarzenie' }))
    fireEvent.change(within(dialog).getByRole('textbox', { name: /^Nazwa/ }), { target: { value: 'Release' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dodaj wydarzenie' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zamknij panel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    finish({ id: 'e1', title: 'Release', color: 'blue', starts_on: '2026-09-11', ends_on: '2026-09-11', created_at: '2026-09-10T07:00:00Z' })
    await waitFor(() => expect(api.calendar).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows why an event was not deleted, in the confirmation and on the day', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week({}, { '2026-09-11': { events: [{ id: 'e1', title: 'Audyt', color: 'red' }] } }))
    vi.spyOn(api, 'deleteCalendarEvent').mockRejectedValue(new ApiError('Brak uprawnień', 403))
    renderScreen(<CalendarMatrix role="coordinator" displayName="Koordynator" range={WEEK_OF_TODAY} />)
    const dialog = await openDay()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Usuń' }))
    const confirmation = await screen.findByRole('dialog', { name: 'Usunąć wydarzenie?' })
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Usuń' }))

    expect(await within(confirmation).findByRole('alert')).toHaveTextContent('Brak uprawnień')
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Anuluj' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Usunąć wydarzenie?' })).not.toBeInTheDocument())
    expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent('Brak uprawnień')
  })

  it('forgets a deleted event of a day closed in the meantime', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week({}, { '2026-09-11': { events: [{ id: 'e1', title: 'Audyt', color: 'red' }] } }))
    let finish: () => void = () => {}
    vi.spyOn(api, 'deleteCalendarEvent').mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
    renderScreen(<CalendarMatrix role="coordinator" displayName="Koordynator" range={WEEK_OF_TODAY} />)
    const dialog = await openDay()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Usuń' }))
    const confirmation = await screen.findByRole('dialog', { name: 'Usunąć wydarzenie?' })
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Usuń' }))
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^pt 11-09-2026/ })).not.toBeInTheDocument())

    finish()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(api.calendar).toHaveBeenCalledTimes(2)
  })
})
