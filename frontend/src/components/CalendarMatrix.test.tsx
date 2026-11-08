import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { focusManager } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { renderScreen } from '../test/render'
import { CalendarMatrix } from './CalendarMatrix'
import { ScheduleScreen } from '../screens/Schedule'
import { ApiError, api } from '../api'
import type { CalendarData, NumberHandover, OverrideCheck, RuleViolation, SwapImpact } from '../api'

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
  fireEvent.click(await screen.findByRole('button', { name: 'Zmień osobę' }))
  const picker = await screen.findByRole('combobox', { name: /^Osoba na / })
  const option = await screen.findByRole('option', { name: replacement })
  fireEvent.change(picker, { target: { value: option.getAttribute('value') } })
}

const threeInSeven = {
  rule: 'three_in_seven',
  message: 'Więcej niż 3 dyżury on-call w okresie 7 dni.',
  member_name: 'Marek Nowak',
  days: [day(1), day(2), day(3), day(4)],
}

/** The save button of the change form: blocked through `aria-disabled`, so it stays focusable. */
const saveButton = () => screen.getByRole('button', { name: 'Zapisz zmianę obsady' })
const expectBlocked = (button: HTMLElement) => expect(button).toHaveAttribute('aria-disabled', 'true')
const expectReady = (button: HTMLElement) => expect(button).not.toHaveAttribute('aria-disabled')

/** Pick Marek for Anna's primary duty on day(1); the decision frame opens under him. */
const confirmHandOver = async () => {
  const annaCells = await screen.findAllByRole('button', { name: /Anna Kowalska.*PRIMARY/ })
  fireEvent.click(annaCells[0])
  fireEvent.click(await screen.findByRole('button', { name: 'Zmień osobę' }))
  fireEvent.change(await screen.findByRole('combobox', { name: /^Osoba na / }), { target: { value: 'm2' } })
  return saveButton()
}

const checked = (
  violations: RuleViolation[] = [],
  ends_handover: NumberHandover | null = null,
): OverrideCheck => ({ violations, ends_handover })

describe('CalendarMatrix override decision frame', () => {
  it('says which number handover the correction ends, without asking to acknowledge it', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(calendarWithPrimary())
    vi.spyOn(api, 'directOverrideCheck').mockResolvedValue(checked([], {
      id: 'h1',
      day: day(1),
      from_member_id: 'm1',
      from_name: 'Anna Kowalska',
      to_member_id: 'm2',
      to_name: 'Marek Nowak',
      starts_at: `${day(1)}T09:40:00Z`,
      until: `${day(1)}T11:40:00Z`,
    }))
    vi.spyOn(api, 'swapImpact').mockResolvedValue(impactFor('Anna Kowalska', 'Marek Nowak'))
    renderScreen(matrix())

    const save = await confirmHandOver()

    expect(await screen.findByText(
      'Ta korekta zakończy przekazanie numeru on-call Anna Kowalska → Marek Nowak. Numer wróci do osoby na PRIMARY, a obie strony dostaną e-mail.',
    )).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    await waitFor(() => expectReady(save))
  })

  it('shows the hard rules the override would break before confirming', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(calendar())
    const check = vi.spyOn(api, 'directOverrideCheck').mockResolvedValue(checked([threeInSeven]))
    renderScreen(matrix())

    await startStaffChange(/Anna Kowalska/, 'Marek Nowak')

    // No confirmation dialog: the rules sit in the panel under the chosen person.
    expect(await screen.findByText(/Ta korekta złamie reguły twarde/)).toBeInTheDocument()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByText(/Więcej niż 3 dyżury on-call w okresie 7 dni/)).toBeInTheDocument()
    expect(screen.getByText(/Naruszenie trafi do dziennika audytu/)).toBeInTheDocument()
    expect(check).toHaveBeenCalledWith(
      expect.objectContaining({ replacement_member_id: 'm2', role: 'primary' }),
    )
    // Saving waits for the explicit acknowledgement.
    expectBlocked(saveButton())
  })

  it('sends the acknowledgement only once the coordinator ticks it', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(calendarWithPrimary())
    vi.spyOn(api, 'directOverrideCheck').mockResolvedValue(checked([threeInSeven]))
    vi.spyOn(api, 'swapImpact').mockResolvedValue(impactFor('Anna Kowalska', 'Marek Nowak'))
    const override = vi.spyOn(api, 'directOverride').mockResolvedValue({} as never)
    renderScreen(matrix())

    const confirm = await confirmHandOver()
    const acknowledgement = await screen.findByRole('checkbox', { name: 'Rozumiem i świadomie łamię te reguły' })
    expect(acknowledgement).not.toBeChecked()
    expectBlocked(confirm)
    // A blocked save is a no-op, not a request.
    fireEvent.click(confirm)
    expect(override).not.toHaveBeenCalled()

    fireEvent.click(acknowledgement)
    expectReady(confirm)
    fireEvent.click(confirm)

    await waitFor(() => expect(override).toHaveBeenCalled())
    expect(override.mock.calls[0][0]).toMatchObject({
      replacement_member_id: 'm2', acknowledge_rule_violations: true,
    })
    expect(await screen.findByText('E-mail o zmianie dostaną obie osoby. Naruszenie reguł zapisane w audycie.')).toBeInTheDocument()
  })

  it('checks again and asks for the acknowledgement when the write finds a new violation', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(calendarWithPrimary())
    const check = vi.spyOn(api, 'directOverrideCheck')
      .mockResolvedValueOnce(checked())
      .mockResolvedValue(checked([threeInSeven]))
    vi.spyOn(api, 'swapImpact').mockResolvedValue(impactFor('Anna Kowalska', 'Marek Nowak'))
    const override = vi.spyOn(api, 'directOverride').mockRejectedValueOnce(
      new ApiError('Korekta złamie reguły twarde grafiku; potwierdź świadome naruszenie', 409, [threeInSeven]),
    )
    renderScreen(matrix())

    const confirm = await confirmHandOver()
    expect(await screen.findByRole('status')).toHaveTextContent('Bez naruszeń reguł twardych')
    expectReady(confirm)
    fireEvent.click(confirm)

    await waitFor(() => expect(override).toHaveBeenCalledTimes(1))
    expect(override.mock.calls[0][0]).toMatchObject({ acknowledge_rule_violations: false })
    expect(await screen.findByText(/Ta korekta złamie reguły twarde/)).toBeInTheDocument()
    expect(check).toHaveBeenCalledTimes(2)
    // The refusal is announced and focused in the frame.
    const refusal = screen.getByRole('alert')
    expect(refusal).toHaveTextContent('Korekta złamie reguły twarde grafiku')
    expect(refusal).toHaveFocus()
    expect(screen.getByRole('checkbox', { name: 'Rozumiem i świadomie łamię te reguły' })).not.toBeChecked()
    expectBlocked(saveButton())
  })

  it('locks the change form while the save is in flight', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(calendarWithPrimary())
    vi.spyOn(api, 'directOverrideCheck').mockResolvedValue(checked())
    vi.spyOn(api, 'swapImpact').mockResolvedValue(impactFor('Anna Kowalska', 'Marek Nowak'))
    let finish: (value: never) => void = () => {}
    const override = vi.spyOn(api, 'directOverride').mockReturnValue(new Promise((resolve) => { finish = resolve }))
    renderScreen(matrix())

    const confirm = await confirmHandOver()
    expect(await screen.findByRole('status')).toHaveTextContent('Bez naruszeń reguł twardych')
    fireEvent.click(confirm)
    await waitFor(() => expect(override).toHaveBeenCalledTimes(1))

    // Nothing may change the choice the pending request was made for.
    const panel = screen.getByRole('dialog')
    expect(within(panel).getByRole('combobox', { name: 'Rola' })).toBeDisabled()
    expect(within(panel).getByRole('combobox', { name: /^Osoba na / })).toBeDisabled()
    expect(within(panel).getByRole('button', { name: 'Wróć' })).toBeDisabled()
    expect(within(panel).getByRole('button', { name: /Zapisz/ })).toBeDisabled()

    finish({} as never)
    await waitFor(() => expect(panel).not.toBeInTheDocument())
    expect(override).toHaveBeenCalledTimes(1)
  })

  it('keeps the change form open while the save is in flight, so its refusal is seen', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(calendarWithPrimary())
    vi.spyOn(api, 'directOverrideCheck').mockResolvedValue(checked())
    vi.spyOn(api, 'swapImpact').mockResolvedValue(impactFor('Anna Kowalska', 'Marek Nowak'))
    let refuse: (error: Error) => void = () => {}
    vi.spyOn(api, 'directOverride').mockReturnValue(new Promise((_, reject) => { refuse = reject }))
    renderScreen(matrix())

    const confirm = await confirmHandOver()
    expect(await screen.findByRole('status')).toHaveTextContent('Bez naruszeń reguł twardych')
    fireEvent.click(confirm)
    await waitFor(() => expect(confirm).toBeDisabled())

    const panel = screen.getByRole('dialog')
    fireEvent.keyDown(panel, { key: 'Escape' })
    fireEvent.click(within(panel).getByRole('button', { name: 'Zamknij panel' }))
    fireEvent.click(screen.getAllByRole('button', { name: /^Marek Nowak, / })[0])
    expect(screen.getByRole('dialog')).toBe(panel)
    expect(within(panel).getByRole('combobox', { name: /^Osoba na / })).toHaveValue('m2')

    refuse(new ApiError('Grafik zmienił wersję', 409))
    const refusal = await within(panel).findByRole('alert')
    expect(refusal).toHaveTextContent('Grafik zmienił wersję')
    expect(refusal).toHaveFocus()
  })

  it('shows no warning when the override is clean', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(calendar())
    vi.spyOn(api, 'directOverrideCheck').mockResolvedValue(checked())
    renderScreen(matrix())

    await startStaffChange(/Anna Kowalska/, 'Marek Nowak')

    // The line says the rules are being checked, then that none is broken.
    expect(screen.getByRole('status')).toHaveTextContent('Sprawdzam reguły twarde…')
    expectBlocked(saveButton())
    expect(await screen.findByText('Bez naruszeń reguł twardych')).toBe(screen.getByRole('status'))
    expect(screen.queryByText(/Ta korekta złamie reguły twarde/)).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /świadomie łamię/ })).not.toBeInTheDocument()
    expectReady(saveButton())
  })
})

describe('CalendarMatrix staffing change (MED6-03)', () => {
  it('titles the drawer by the day and keeps the clicked person as context', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(calendar())
    renderScreen(matrix())

    const cells = await screen.findAllByRole('button', { name: /Anna Kowalska/ })
    fireEvent.click(cells[0])
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Otwarto z wiersza: Anna Kowalska')).toBeInTheDocument()
    // The person's name is context, not the dialog's title.
    expect(dialog).toHaveAccessibleName(expect.stringMatching(/^czw 10-09-2026/))
    expect(dialog).not.toHaveAccessibleName(expect.stringMatching(/Anna Kowalska/))
  })

  it('lets the coordinator remove a duty from the person whose cell they clicked', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(calendarWithPrimary())
    vi.spyOn(api, 'directOverrideCheck').mockResolvedValue(checked())
    vi.spyOn(api, 'swapImpact').mockResolvedValue(impactFor('Anna Kowalska', 'Marek Nowak'))
    const override = vi.spyOn(api, 'directOverride').mockResolvedValue({} as never)
    renderScreen(matrix())

    // Click Anna's own primary cell - the very move the old UI trapped.
    const annaCells = await screen.findAllByRole('button', { name: /Anna Kowalska.*PRIMARY/ })
    fireEvent.click(annaCells[0])
    fireEvent.click(await screen.findByRole('button', { name: 'Zmień osobę' }))
    const picker = await screen.findByRole('combobox', { name: /^Osoba na / })
    // Anna is the current holder, so she is offered but disabled with a reason.
    expect(screen.getByRole('option', { name: /Anna Kowalska · już pełni tę rolę/ })).toBeDisabled()
    fireEvent.change(picker, { target: { value: 'm2' } })
    await screen.findByText('Bez naruszeń reguł twardych')
    fireEvent.click(saveButton())

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
    fireEvent.click(await screen.findByRole('button', { name: 'Zmień osobę' }))

    expect(await screen.findByText('Wybierz osobę, która ma objąć tę rolę.')).toBeInTheDocument()
    expectBlocked(saveButton())
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
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
    fireEvent.click(await screen.findByRole('button', { name: 'Zmień osobę' }))
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
    fireEvent.click(await screen.findByRole('button', { name: 'Wydarzenie…' }))
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
  const reachConfirm = (replacement: string) => startStaffChange(/Anna Kowalska.*PRIMARY/, replacement)

  it('shows the balance impact for both people alongside the hard-rule check', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(calendarWithPrimary())
    vi.spyOn(api, 'directOverrideCheck').mockResolvedValue(checked())
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
    vi.spyOn(api, 'directOverrideCheck').mockResolvedValue(checked())
    const impact = vi.spyOn(api, 'swapImpact').mockResolvedValue(impactFor('x', 'y'))
    renderScreen(matrix())

    await startStaffChange(/Marek Nowak/, 'Anna Kowalska')

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
    const check = vi.spyOn(api, 'directOverrideCheck').mockResolvedValue(checked())
    renderScreen(matrix())

    const cells = await screen.findAllByRole('button', { name: /Anna Kowalska/ })
    fireEvent.click(cells[0])
    // The day drawer names the unavailability as day context.
    expect(await screen.findByText(/Marek Nowak: Nie mogę - Urlop/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Zmień osobę' }))
    await screen.findByRole('combobox', { name: /^Osoba na / })
    expect(screen.getByRole('option', { name: /Marek Nowak · niedostępna tego dnia/ })).toBeDisabled()
    expect(check).not.toHaveBeenCalled()
  })

  it('still offers the correction for a soft preference', async () => {
    const data = withUnavailability()
    data.availability[0].kind = 'prefer_not'
    vi.spyOn(api, 'calendar').mockResolvedValue(data)
    vi.spyOn(api, 'directOverrideCheck').mockResolvedValue(checked())
    renderScreen(matrix())

    await startStaffChange(/Anna Kowalska/, 'Marek Nowak')
    await waitFor(() => expectReady(saveButton()))
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

  const stored = { id: 'e1', title: 'Audyt', color: 'red' as const, starts_on: '2026-09-01', ends_on: '2026-09-25', created_at: '2026-08-01T10:00:00Z' }

  const deleteFromDay = async () => {
    const cells = await screen.findAllByRole('button', { name: /Anna Kowalska/ })
    fireEvent.click(cells[0])
    fireEvent.click(await screen.findByRole('button', { name: 'Usuń' }))
  }

  it('deletes at once and recreates the whole event with Undo', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(withEvent())
    const read = vi.spyOn(api, 'calendarEvents').mockResolvedValue([{ ...stored, id: 'other' }, stored])
    const remove = vi.spyOn(api, 'deleteCalendarEvent').mockResolvedValue(undefined)
    const create = vi.spyOn(api, 'createCalendarEvent').mockResolvedValue({ ...stored, id: 'e2' })
    renderScreen(matrix())

    await deleteFromDay()

    await waitFor(() => expect(remove).toHaveBeenCalledWith('e1'))
    expect(read).toHaveBeenCalledWith(withEvent().days[0].service_date, withEvent().days[0].service_date)
    expect(screen.queryByRole('dialog', { name: 'Usunąć wydarzenie?' })).not.toBeInTheDocument()
    expect(await screen.findByText('Usunięto „Audyt”')).toBeInTheDocument()
    // The same words as on the events screen, with every day the event had.
    expect(screen.getByText('01-09-2026 – 25-09-2026')).toBeInTheDocument()
    expect(screen.queryByText('Audyt', { selector: 'span' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cofnij' }))
    // The event comes back over every day it had, not only the one it was deleted from.
    await waitFor(() => expect(create).toHaveBeenCalledWith({ starts_on: '2026-09-01', ends_on: '2026-09-25', title: 'Audyt', color: 'red' }))
    await waitFor(() => expect(api.calendar).toHaveBeenCalledTimes(3))
    // The inspector still open on that day shows the event again.
    expect(await within(screen.getByRole('dialog')).findByText('Audyt', { selector: 'span' })).toBeInTheDocument()
  })

  it('leaves a restored event out of an inspector open on a day outside its range', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(withEvent())
    vi.spyOn(api, 'calendarEvents').mockResolvedValue([{ ...stored, starts_on: day(0), ends_on: day(0) }])
    vi.spyOn(api, 'deleteCalendarEvent').mockResolvedValue(undefined)
    const create = vi.spyOn(api, 'createCalendarEvent').mockResolvedValue({ ...stored, id: 'e2' })
    renderScreen(matrix())

    await deleteFromDay()
    expect(await screen.findByText('Usunięto „Audyt”')).toBeInTheDocument()
    fireEvent.click((await screen.findAllByRole('button', { name: /Anna Kowalska/ }))[1])
    fireEvent.click(screen.getByRole('button', { name: 'Cofnij' }))

    await waitFor(() => expect(create).toHaveBeenCalled())
    await waitFor(() => expect(api.calendar).toHaveBeenCalledTimes(3))
    expect(within(screen.getByRole('dialog')).queryByText('Audyt', { selector: 'span' })).not.toBeInTheDocument()
  })
})

type Row = CalendarData['assignments'][number]
type Day = CalendarData['days'][number]

/** Monday 07-09 to Sunday 13-09-2026, the week of the pinned "today" (Thursday 10-09). */
const WEEK_OF_TODAY = { starts_on: '2026-09-07', ends_on: '2026-09-13' }
const DATES = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13']

const addDaysIso = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

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

    // A chip that leads to a day names it, ends in a chevron and says where it leads.
    const clash = within(riskRow()).getByRole('button', { name: '1 osoba z dyżurem w dniu niedostępności' })
    expect(clash).toHaveClass('chip-bad')
    expect(clash).toHaveAccessibleDescription('Pokaż pierwszy taki dzień')
    expect(clash.querySelector('.chip-go')).toBeInTheDocument()
    fireEvent.click(clash)
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

  it('draws no risk row when the screen leaves the risks out', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week({ assignments: [] }))
    renderScreen(<CalendarMatrix role="coordinator" displayName="Koordynator" range={WEEK_OF_TODAY} showRisks={false} />)
    expect((await screen.findAllByText('Anna Kowalska')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('list', { name: 'Ryzyka w zakresie' })).not.toBeInTheDocument()
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
    expect(screen.getByLabelText('Wczytywanie grafiku…')).toHaveAttribute('aria-busy', 'true')
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
    expect(within(grid).getByRole('columnheader', { name: 'pt · 02 · brak pełnej obsady' })).toBeInTheDocument()
    expect(within(grid).getByRole('columnheader', { name: 'czw · 01 · Migracja' })).toBeInTheDocument()
    expect(within(grid).getByRole('columnheader', { name: 'sob · 03 · Święto testowe' })).toBeInTheDocument()

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
      // The highlight is said in words and to assistive technology, not only in colour.
      const row = cells[0].closest('tr') as HTMLElement
      expect(row).toHaveAttribute('aria-current', 'true')
      expect(within(row).getByRole('rowheader')).toHaveTextContent('podświetlona')
      expect(screen.getAllByText('podświetlona')).toHaveLength(1)
      expect(cells[0]).not.toHaveAttribute('aria-current')
      fireEvent.click(cells[0])
      await waitFor(() => expect(cells[0]).toHaveAttribute('aria-current', 'true'))
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
    expect(within(dialog).queryByRole('button', { name: /Zmień osobę$/ })).not.toBeInTheDocument()
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
    expect(within(dialog).getByText('11:00–19:00 · korekta')).toBeInTheDocument()
    expect(within(dialog).getByText('nieznana osoba: Wolę nie - stary wpis')).toBeInTheDocument()
    expect(within(dialog).getByText('Ola Wiśniewska: Chętnie wezmę')).toBeInTheDocument()
    // The row the day was opened from is a tag in the header, not a sentence about the screen.
    expect(within(dialog).getByText('Otwarto z wiersza: Ola Wiśniewska')).toBeInTheDocument()
  })

  it('adds a note for someone who is not on duty that day', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week())
    renderScreen(<CalendarMatrix role="member" displayName="Ola Wiśniewska" range={WEEK_OF_TODAY} view="list" />)
    fireEvent.click(await screen.findByRole('button', { name: 'SECONDARY, pt 11-09-2026, Marek Nowak' }))
    const dialog = await screen.findByRole('dialog', { name: /^pt 11-09-2026/ })
    expect(within(dialog).getByText('Otwarto z wiersza: Ola Wiśniewska')).toBeInTheDocument()
  })

  it('opens a day from the list without a row for a viewer outside the team', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week())
    renderScreen(<CalendarMatrix role="viewer" displayName="Gość" range={WEEK_OF_TODAY} view="list" />)
    fireEvent.click(await screen.findByRole('button', { name: 'PRIMARY, pt 11-09-2026, Anna Kowalska' }))
    const dialog = await screen.findByRole('dialog', { name: /^pt 11-09-2026/ })
    expect(within(dialog).queryByText(/Otwarto z wiersza/)).not.toBeInTheDocument()
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

  it('shows the way into a correction on every role row without a hover', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week())
    renderScreen(<CalendarMatrix role="coordinator" displayName="Koordynator" range={WEEK_OF_TODAY} />)
    fireEvent.click((await screen.findAllByRole('button', { name: /^Anna Kowalska, pt 11-09-2026/ }))[0])
    const dialog = await screen.findByRole('dialog')
    const staffed = within(dialog).getByRole('button', { name: 'SECONDARY: Marek Nowak. Zmień osobę' })
    const change = within(staffed).getByText('Zmień…')
    expect(change).toHaveClass('btn', 'btn-sm', 'btn-ghost')
    expect(change).toHaveAttribute('aria-hidden', 'true')
    const gap = within(dialog).getByRole('button', { name: '11–19: brak obsady. Obsadź' })
    expect(within(gap).getByText('Obsadź…')).not.toHaveClass('btn-ghost')
  })

  it('opens on the role row that was clicked and lets the role and the person change', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week({
      members: [
        { id: 'm1', display_name: 'Anna Kowalska' },
        { id: 'm2', display_name: 'Marek Nowak' },
        { id: 'm3', display_name: 'Ola Wiśniewska' },
      ],
    }))
    renderScreen(<CalendarMatrix role="coordinator" displayName="Koordynator" range={WEEK_OF_TODAY} />)
    const dialog = await openForm(/^Anna Kowalska, pt 11-09-2026/, '11–19: brak obsady. Obsadź')

    const role = within(dialog).getByRole('combobox', { name: 'Rola' })
    expect(role).toHaveValue('late_shift')
    expect(within(dialog).getByText('Obecnie: brak opublikowanego przydziału')).toBeInTheDocument()
    expectBlocked(saveButton())

    const person = within(dialog).getByRole('combobox', { name: /^Osoba na / })
    fireEvent.change(person, { target: { value: 'm3' } })
    await waitFor(() => expectReady(saveButton()))
    fireEvent.change(person, { target: { value: '' } })
    expectBlocked(saveButton())

    fireEvent.change(person, { target: { value: 'm3' } })
    fireEvent.change(role, { target: { value: 'secondary' } })
    expect(person).toHaveValue('')
    expect(within(dialog).getByText('Obecnie: Marek Nowak')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Wróć' }))
    expect(within(dialog).queryByRole('combobox', { name: /^Osoba na / })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'SECONDARY: Marek Nowak. Zmień osobę' })).toHaveClass('role-row-sel')
  })

  it('asks for a reason in a dialog before correcting a day already past', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week())
    vi.spyOn(api, 'directOverrideCheck').mockResolvedValue(checked())
    vi.spyOn(api, 'swapImpact').mockResolvedValue(impactFor('Anna Kowalska', 'Ola Wiśniewska'))
    const save = vi.spyOn(api, 'directOverride')
      .mockRejectedValueOnce(new ApiError('Grafik zmienił wersję', 409))
      .mockResolvedValue({} as never)
    renderScreen(<CalendarMatrix role="coordinator" displayName="Koordynator" range={WEEK_OF_TODAY} />)
    const dialog = await openForm(/^Anna Kowalska, wt 08-09-2026/, 'PRIMARY: Anna Kowalska. Zmień osobę')
    fireEvent.change(within(dialog).getByRole('combobox', { name: /^Osoba na / }), { target: { value: 'm3' } })

    // The rules and the balance stay in the panel; only the reason has a dialog of its own.
    await within(dialog).findByText('Bez naruszeń reguł twardych')
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument()
    const openConfirm = async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz zmianę obsady…' }))
      return screen.findByRole('dialog', { name: 'Potwierdź korektę historyczną' })
    }
    let confirm = await openConfirm()
    const reason = within(confirm).getByRole('textbox', { name: /Powód korekty historycznej/ })
    const confirmSave = within(confirm).getByRole('button', { name: 'Zapisz zmianę obsady' })
    expect(confirmSave).toBeDisabled()
    fireEvent.change(reason, { target: { value: 'za mało' } })
    expect(within(confirm).getByText('Wpisz co najmniej 10 znaków')).toBeInTheDocument()
    expect(confirmSave).toBeDisabled()
    fireEvent.change(reason, { target: { value: '  Zamiana ustalona telefonicznie ' } })
    fireEvent.click(confirmSave)

    // A refusal is shown in the dialog that covers the panel.
    const dialogRefusal = await within(confirm).findByRole('alert')
    expect(dialogRefusal).toHaveTextContent('Grafik zmienił wersję')
    expect(dialogRefusal).toHaveFocus()
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
    // Cancel returns to the panel, which keeps the refusal.
    fireEvent.click(within(confirm).getByRole('button', { name: 'Anuluj' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Potwierdź korektę historyczną' })).not.toBeInTheDocument())
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Grafik zmienił wersję')

    // Trying again keeps the reason and drops the refusal.
    confirm = await openConfirm()
    expect(within(confirm).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(confirm).getByRole('textbox', { name: /Powód korekty historycznej/ })).toHaveValue('Zamiana ustalona telefonicznie')
    fireEvent.click(within(confirm).getByRole('button', { name: 'Zapisz zmianę obsady' }))

    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(save.mock.calls[0][0]).toEqual({
      schedule_id: 's1', expected_version: 4, service_date: '2026-09-08', role: 'primary',
      replacement_member_id: 'm3', reason: 'Zamiana ustalona telefonicznie', acknowledge_rule_violations: false,
    })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Potwierdź zmianę obsady' })).not.toBeInTheDocument())
    // The toast says what changed and who is told, and reopens the day.
    expect(await screen.findByText('Zmieniono obsadę 8 wrz · PRIMARY: Anna Kowalska → Ola Wiśniewska')).toBeInTheDocument()
    expect(screen.getByText('E-mail o zmianie dostaną obie osoby.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: /^wt 08-09-2026/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Otwórz dzień' }))
    expect(await screen.findByRole('dialog', { name: /^wt 08-09-2026/ })).toBeInTheDocument()
  })

  it('names only the person on duty once an empty slot is filled', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week({
      members: [
        { id: 'm1', display_name: 'Anna Kowalska' },
        { id: 'm2', display_name: 'Marek Nowak' },
        { id: 'm3', display_name: 'Ola Wiśniewska' },
      ],
    }))
    vi.spyOn(api, 'directOverrideCheck').mockResolvedValue(checked())
    const save = vi.spyOn(api, 'directOverride').mockResolvedValue({} as never)
    renderScreen(<CalendarMatrix role="coordinator" displayName="Koordynator" range={WEEK_OF_TODAY} />)
    const dialog = await openForm(/^Anna Kowalska, pt 11-09-2026/, '11–19: brak obsady. Obsadź')
    fireEvent.change(within(dialog).getByRole('combobox', { name: /^Osoba na / }), { target: { value: 'm3' } })
    const confirm = within(dialog).getByRole('button', { name: /^Zapisz zmianę obsady$/ })
    await waitFor(() => expect(confirm).toBeEnabled())
    fireEvent.click(confirm)

    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(await screen.findByText('Obsadzono 11–19 11 wrz: Ola Wiśniewska')).toBeInTheDocument()
    expect(screen.getByText('E-mail o dyżurze dostanie Ola Wiśniewska.')).toBeInTheDocument()
  })

  it('closes the past-day dialog on a new violation so the panel can take the acknowledgement', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week())
    vi.spyOn(api, 'directOverrideCheck')
      .mockResolvedValueOnce(checked())
      .mockResolvedValue(checked([threeInSeven]))
    vi.spyOn(api, 'swapImpact').mockResolvedValue(impactFor('Anna Kowalska', 'Ola Wiśniewska'))
    const save = vi.spyOn(api, 'directOverride')
      .mockRejectedValueOnce(new ApiError('Korekta złamie reguły twarde grafiku; potwierdź świadome naruszenie', 409, [threeInSeven]))
      .mockResolvedValue({} as never)
    renderScreen(<CalendarMatrix role="coordinator" displayName="Koordynator" range={WEEK_OF_TODAY} />)
    const dialog = await openForm(/^Anna Kowalska, wt 08-09-2026/, 'PRIMARY: Anna Kowalska. Zmień osobę')
    fireEvent.change(within(dialog).getByRole('combobox', { name: /^Osoba na / }), { target: { value: 'm3' } })
    await within(dialog).findByText('Bez naruszeń reguł twardych')
    const openConfirm = async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz zmianę obsady…' }))
      return screen.findByRole('dialog', { name: 'Potwierdź korektę historyczną' })
    }
    let confirm = await openConfirm()
    fireEvent.change(within(confirm).getByRole('textbox', { name: /Powód korekty historycznej/ }), { target: { value: 'Zamiana ustalona telefonicznie' } })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Zapisz zmianę obsady' }))

    // The refusal moves to the panel, beside the violations and their acknowledgement.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Potwierdź korektę historyczną' })).not.toBeInTheDocument())
    expect(await within(dialog).findByText(/Więcej niż 3 dyżury on-call w okresie 7 dni/)).toBeInTheDocument()
    const refusal = within(dialog).getByRole('alert')
    expect(refusal).toHaveTextContent('Korekta złamie reguły twarde grafiku')
    await waitFor(() => expect(refusal).toHaveFocus())
    const acknowledgement = within(dialog).getByRole('checkbox', { name: 'Rozumiem i świadomie łamię te reguły' })
    expect(acknowledgement).not.toBeChecked()
    expectBlocked(within(dialog).getByRole('button', { name: 'Zapisz zmianę obsady…' }))

    fireEvent.click(acknowledgement)
    confirm = await openConfirm()
    expect(within(confirm).getByRole('textbox', { name: /Powód korekty historycznej/ })).toHaveValue('Zamiana ustalona telefonicznie')
    fireEvent.click(within(confirm).getByRole('button', { name: 'Zapisz zmianę obsady' }))

    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(save.mock.calls[1][0]).toMatchObject({
      reason: 'Zamiana ustalona telefonicznie', acknowledge_rule_violations: true,
    })
  })

  it('lets the change go ahead when the rule check itself fails', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week())
    vi.spyOn(api, 'directOverrideCheck').mockRejectedValue(new ApiError('Sprawdzenie niedostępne', 503))
    vi.spyOn(api, 'swapImpact').mockResolvedValue(impactFor('Anna Kowalska', 'Ola Wiśniewska'))
    const save = vi.spyOn(api, 'directOverride').mockResolvedValue({} as never)
    renderScreen(<CalendarMatrix role="coordinator" displayName="Koordynator" range={WEEK_OF_TODAY} />)
    const dialog = await openForm(/^Anna Kowalska, pt 11-09-2026/, 'PRIMARY: Anna Kowalska. Zmień osobę')
    fireEvent.change(within(dialog).getByRole('combobox', { name: /^Osoba na / }), { target: { value: 'm3' } })

    expect(await within(dialog).findByRole('status')).toHaveTextContent('Nie udało się sprawdzić reguł twardych; zapis sprawdzi je ponownie.')
    expect(within(dialog).getByRole('status')).toHaveClass('rule-line-warn')
    expectReady(saveButton())
    fireEvent.click(saveButton())
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0][0]).toMatchObject({ reason: undefined, acknowledge_rule_violations: false })
  })

  it('shows a refused change in the frame and moves focus to it', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week())
    const check = vi.spyOn(api, 'directOverrideCheck').mockResolvedValue(checked())
    vi.spyOn(api, 'swapImpact').mockResolvedValue(impactFor('Anna Kowalska', 'Ola Wiśniewska'))
    vi.spyOn(api, 'directOverride').mockRejectedValue(new ApiError('Grafik zmienił wersję', 409))
    renderScreen(<CalendarMatrix role="coordinator" displayName="Koordynator" range={WEEK_OF_TODAY} />)
    const dialog = await openForm(/^Anna Kowalska, pt 11-09-2026/, 'PRIMARY: Anna Kowalska. Zmień osobę')
    fireEvent.change(within(dialog).getByRole('combobox', { name: /^Osoba na / }), { target: { value: 'm3' } })

    await within(dialog).findByText('Bez naruszeń reguł twardych')
    fireEvent.click(saveButton())
    const refusal = await within(dialog).findByRole('alert')
    // A day not yet past is saved straight from the panel, with no dialog.
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(refusal).toHaveTextContent('Grafik zmienił wersję')
    expect(refusal).toHaveFocus()
    // A refusal without rule violations is not re-checked.
    expect(check).toHaveBeenCalledTimes(1)

    // The refusal was about the person it was made for: choosing again drops
    // it, and the frame that reappears leaves the focus where it is.
    const person = within(dialog).getByRole('combobox', { name: /^Osoba na / })
    person.focus()
    fireEvent.change(person, { target: { value: '' } })
    fireEvent.change(person, { target: { value: 'm3' } })
    await within(dialog).findByText('Bez naruszeń reguł twardych')
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
    expect(person).toHaveFocus()
  })

  it('explains a block that appears while the form is open', async () => {
    const load = vi.spyOn(api, 'calendar').mockResolvedValue(week())
    renderScreen(<CalendarMatrix role="admin" displayName="Administrator" range={WEEK_OF_TODAY} />)
    const dialog = await openForm(/^Anna Kowalska, pt 11-09-2026/, 'PRIMARY: Anna Kowalska. Zmień osobę')
    fireEvent.change(within(dialog).getByRole('combobox', { name: /^Osoba na / }), { target: { value: 'm3' } })

    // Meanwhile Ola marks the day as one she cannot take; the screen refreshes when the window regains focus.
    load.mockResolvedValue(week({ availability: [{ member_id: 'm3', kind: 'unavailable', starts_on: '2026-09-11', ends_on: '2026-09-11', note: null }] }))
    act(() => { focusManager.setFocused(false); focusManager.setFocused(true) })
    expect(await within(dialog).findByText('Wybrana osoba niedostępna tego dnia.')).toBeInTheDocument()
    expectBlocked(saveButton())

    // Then the day drops out of the publication altogether.
    load.mockResolvedValue(week({}, { '2026-09-11': { published: false } }))
    act(() => { focusManager.setFocused(false); focusManager.setFocused(true) })
    expect(await within(dialog).findByText('Dzień jest poza opublikowanym grafikiem.')).toBeInTheDocument()
    act(() => { focusManager.setFocused(undefined) })
  })
})

describe('CalendarMatrix day correction', () => {
  const urlop = { member_id: 'm1', kind: 'unavailable' as const, starts_on: '2026-09-11', ends_on: '2026-09-11', note: 'urlop' }
  const openFriday = async () => {
    fireEvent.click((await screen.findAllByRole('button', { name: /^Marek Nowak, pt 11-09-2026/ }))[0])
    return screen.findByRole('dialog')
  }
  const COLLISION = 'Kolizja: Anna Kowalska ma PRIMARY 11 wrz mimo zgłoszenia „Nie mogę”'

  it('frames a duty held on a day its holder cannot take, above the roles, and changes the person from it', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week({ availability: [urlop] }))
    vi.spyOn(api, 'directOverrideCheck').mockResolvedValue(checked())
    renderScreen(<CalendarMatrix role="coordinator" displayName="Koordynator" range={WEEK_OF_TODAY} />)
    const dialog = await openFriday()

    const frame = within(dialog).getByText(COLLISION, { selector: 'b' }).closest('.box')!
    expect(frame).toHaveClass('box-warn')
    expect(frame).toHaveTextContent('Powód: „urlop”.')
    expect(frame.compareDocumentPosition(within(dialog).getByRole('group', { name: 'Obsada dnia' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // The role row reads the same words to a screen reader.
    expect(within(dialog).getByRole('button', { name: `PRIMARY: Anna Kowalska. Zmień osobę. ${COLLISION}` })).toBeInTheDocument()

    fireEvent.click(within(frame as HTMLElement).getByRole('button', { name: 'Zmień osobę' }))
    expect(await within(dialog).findByRole('combobox', { name: 'Rola' })).toHaveValue('primary')
    expect(within(dialog).getByRole('combobox', { name: 'Osoba na PRIMARY · 11 wrz' })).toBeInTheDocument()
  })

  it('names the conflict without a reason or an exit where there is none to give', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week({ availability: [{ ...urlop, note: null }] }, { '2026-09-11': { published: false } }))
    renderScreen(<CalendarMatrix role="coordinator" displayName="Koordynator" range={WEEK_OF_TODAY} />)
    const dialog = await openFriday()

    const frame = within(dialog).getByText(COLLISION, { selector: 'b' }).closest('.box')!
    expect(frame).not.toHaveTextContent('Powód')
    expect(within(frame as HTMLElement).queryByRole('button')).not.toBeInTheDocument()
    // Off the publication the role rows are not buttons; the text is still read.
    expect(within(dialog).getByRole('group', { name: 'Obsada dnia' })).toHaveTextContent(COLLISION)
  })

  it('keeps the conflict frame to coordinators, like the risk chip', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week({ availability: [urlop] }))
    renderScreen(<CalendarMatrix role="member" displayName="Marek Nowak" range={WEEK_OF_TODAY} />)
    const dialog = await openFriday()
    expect(within(dialog).queryByText(COLLISION)).not.toBeInTheDocument()
  })

  it('says why a person is blocked in the option and describes the chosen one under the field', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week({
      members: [
        { id: 'm1', display_name: 'Anna Kowalska', eligibility: [{ role: 'primary', starts_on: '2026-01-01', ends_on: null }] },
        { id: 'm2', display_name: 'Marek Nowak', eligibility: [{ role: 'primary', starts_on: '2026-01-01', ends_on: null }, { role: 'secondary', starts_on: '2026-01-01', ends_on: null }] },
        { id: 'm3', display_name: 'Ola Wiśniewska', eligibility: [
          { role: 'primary', starts_on: '2026-01-01', ends_on: null },
          { role: 'secondary', starts_on: '2026-01-01', ends_on: '2026-09-01' },
          { role: 'late_shift', starts_on: '2026-01-01', ends_on: null },
        ] },
        { id: 'm4', display_name: 'Piotr Zieliński' },
      ],
      availability: [{ member_id: 'm3', kind: 'prefer', starts_on: '2026-09-11', ends_on: '2026-09-11', note: null }],
    }))
    vi.spyOn(api, 'directOverrideCheck').mockResolvedValue(checked())
    vi.spyOn(api, 'swapImpact').mockResolvedValue(impactFor('Anna Kowalska', 'Ola Wiśniewska'))
    renderScreen(<CalendarMatrix role="coordinator" displayName="Koordynator" range={WEEK_OF_TODAY} />)
    const dialog = await openFriday()
    fireEvent.click(within(dialog).getByRole('button', { name: /^PRIMARY: Anna Kowalska/ }))
    const person = await within(dialog).findByRole('combobox', { name: 'Osoba na PRIMARY · 11 wrz' })

    // The reason is the option's own words, after the name, and the option stays listed.
    expect(within(dialog).getByRole('option', { name: 'Anna Kowalska · już pełni tę rolę tego dnia' })).toBeDisabled()
    expect(within(dialog).getByRole('option', { name: 'Marek Nowak · ma już drugi on-call tego dnia' })).toBeDisabled()
    expect(person).toHaveAccessibleDescription('Wybierz osobę, która ma objąć tę rolę.')

    fireEvent.change(person, { target: { value: 'm3' } })
    expect(person).toHaveAccessibleDescription('Ola Wiśniewska: uprawnienia PRIMARY, 11–19. Zgłoszenie na 11 wrz: „Chętnie wezmę”.')
    fireEvent.change(person, { target: { value: 'm4' } })
    // No eligibility in the payload: only what the person reported is said.
    expect(person).toHaveAccessibleDescription('Bez zgłoszenia na 11 wrz.')
  })

  it('looks every cell up instead of searching the payload for it', async () => {
    const dates = Array.from({ length: 56 }, (_, index) => addDaysIso('2026-09-07', index))
    const people = Array.from({ length: 12 }, (_, index) => ({ id: `p${index}`, display_name: `Osoba ${index}` }))
    const data = week({
      starts_on: dates[0],
      ends_on: dates[55],
      members: people,
      assignments: dates.flatMap((date, index) => [
        duty(date, 'primary', people[index % 12].display_name, people[index % 12].id),
        duty(date, 'secondary', people[(index + 1) % 12].display_name, people[(index + 1) % 12].id),
      ]),
      availability: people.map((person, index) => ({ member_id: person.id, kind: 'prefer_not' as const, starts_on: dates[index], ends_on: dates[index + 3], note: null })),
    })
    data.days = dates.map((service_date) => ({ service_date, weekday: '', is_day_off: false, holiday_name: null, published: true, events: [] }))
    // Count the searches of the payload's own lists, wherever they come from.
    let searches = 0
    for (const list of [data.assignments, data.availability] as unknown[][]) {
      for (const method of ['filter', 'find'] as const) {
        Object.defineProperty(list, method, {
          value: (...args: Parameters<unknown[]['filter']>) => {
            searches += 1
            return (Array.prototype[method] as (...rest: unknown[]) => unknown).apply(list, args)
          },
        })
      }
    }
    vi.spyOn(api, 'calendar').mockResolvedValue(data)
    renderScreen(<CalendarMatrix role="coordinator" displayName="Koordynator" range={{ starts_on: dates[0], ends_on: dates[55] }} zoom="8" />)
    expect(await screen.findAllByRole('button', { name: /^Osoba 0, / })).toHaveLength(56)

    // A handful per render for the whole range, never one per cell (672 of them).
    expect(searches).toBeGreaterThan(0)
    expect(searches).toBeLessThan(people.length)
  })

  it('keeps the last range on screen while the next one loads', async () => {
    const nextWeek = { starts_on: '2026-09-14', ends_on: '2026-09-20' }
    let finish: (value: CalendarData) => void = () => {}
    vi.spyOn(api, 'calendar').mockImplementation((startsOn) => (startsOn === nextWeek.starts_on
      ? new Promise((resolve) => { finish = resolve })
      : Promise.resolve(week())))
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
    await screen.findByRole('region', { name: 'Macierz grafiku' })

    fireEvent.click(screen.getByRole('button', { name: 'Następny tydzień' }))
    await waitFor(() => expect(api.calendar).toHaveBeenCalledWith(nextWeek.starts_on, nextWeek.ends_on))
    expect(screen.getByRole('region', { name: 'Macierz grafiku' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByRole('status', { name: 'Wczytywanie grafiku…' })).not.toBeInTheDocument()
    // A day of the range being left opens no inspector over the one coming.
    fireEvent.click(screen.getAllByRole('button', { name: /^Anna Kowalska, pt 11-09-2026/ })[0])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    act(() => finish({ ...week(), ...nextWeek }))
    await waitFor(() => expect(screen.getByRole('region', { name: 'Macierz grafiku' })).not.toHaveAttribute('aria-busy'))
    fireEvent.click(screen.getAllByRole('button', { name: /^Anna Kowalska, pt 11-09-2026/ })[0])
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })
})

describe('CalendarMatrix events', () => {
  const openDay = async () => {
    fireEvent.click((await screen.findAllByRole('button', { name: /^Anna Kowalska, pt 11-09-2026/ }))[0])
    return screen.findByRole('dialog')
  }

  it('adds an event in its own window and keeps the day inspector open behind it', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week())
    const create = vi.spyOn(api, 'createCalendarEvent').mockRejectedValue(new ApiError('Tytuł jest za długi', 422))
    renderScreen(<CalendarMatrix role="coordinator" displayName="Koordynator" range={WEEK_OF_TODAY} />)
    const inspector = await openDay()

    fireEvent.click(within(inspector).getByRole('button', { name: 'Wydarzenie…' }))
    let form = await screen.findByRole('dialog', { name: 'Dodaj wydarzenie tego dnia' })
    expect(form).toHaveTextContent('pt 11-09-2026')
    await waitFor(() => expect(within(form).getByRole('textbox', { name: /^Nazwa/ })).toHaveFocus())
    expect(within(inspector).queryByRole('textbox', { name: /^Nazwa/ })).not.toBeInTheDocument()
    fireEvent.click(within(form).getByRole('button', { name: 'Anuluj' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Dodaj wydarzenie tego dnia' })).not.toBeInTheDocument())
    expect(screen.getByRole('dialog', { name: 'pt 11-09-2026' })).toBeInTheDocument()

    fireEvent.click(within(inspector).getByRole('button', { name: 'Wydarzenie…' }))
    form = await screen.findByRole('dialog', { name: 'Dodaj wydarzenie tego dnia' })
    const title = within(form).getByRole('textbox', { name: /^Nazwa/ })
    fireEvent.change(title, { target: { value: '   ' } })
    expect(within(form).getByRole('button', { name: 'Dodaj wydarzenie' })).toBeDisabled()
    // Enter in the field submits the form past the disabled button.
    fireEvent.submit(title.closest('form')!)
    expect(create).not.toHaveBeenCalled()
    fireEvent.change(title, { target: { value: 'Bardzo długi tytuł' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Dodaj wydarzenie' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent('Tytuł jest za długi')
  })

  it('lists the new event on the open day once it is saved', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week())
    let finish: (value: Awaited<ReturnType<typeof api.createCalendarEvent>>) => void = () => {}
    vi.spyOn(api, 'createCalendarEvent').mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    renderScreen(<CalendarMatrix role="coordinator" displayName="Koordynator" range={WEEK_OF_TODAY} />)
    const inspector = await openDay()
    fireEvent.click(within(inspector).getByRole('button', { name: 'Wydarzenie…' }))
    const form = await screen.findByRole('dialog', { name: 'Dodaj wydarzenie tego dnia' })
    fireEvent.change(within(form).getByRole('textbox', { name: /^Nazwa/ }), { target: { value: 'Release' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Dodaj wydarzenie' }))
    // A save in flight cannot be abandoned from the window.
    await waitFor(() => expect(within(form).getByRole('button', { name: 'Anuluj' })).toBeDisabled())
    expect(within(form).queryByRole('button', { name: 'Zamknij' })).not.toBeInTheDocument()

    finish({ id: 'e1', title: 'Release', color: 'blue', starts_on: '2026-09-11', ends_on: '2026-09-11', created_at: '2026-09-10T07:00:00Z' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Dodaj wydarzenie tego dnia' })).not.toBeInTheDocument())
    expect(within(inspector).getByText('Release')).toBeInTheDocument()
    await waitFor(() => expect(api.calendar).toHaveBeenCalledTimes(2))
  })

  it('shows on the day why an event was not deleted', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week({}, { '2026-09-11': { events: [{ id: 'e1', title: 'Audyt', color: 'red' }] } }))
    vi.spyOn(api, 'calendarEvents').mockResolvedValue([])
    vi.spyOn(api, 'deleteCalendarEvent').mockRejectedValue(new ApiError('Brak uprawnień', 403))
    renderScreen(<CalendarMatrix role="coordinator" displayName="Koordynator" range={WEEK_OF_TODAY} />)
    const dialog = await openDay()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Usuń' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Brak uprawnień')
    expect(within(dialog).getByText('Audyt')).toBeInTheDocument()
  })

  it('forgets a deleted event of a day closed in the meantime', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(week({}, { '2026-09-11': { events: [{ id: 'e1', title: 'Audyt', color: 'red' }] } }))
    let finish: () => void = () => {}
    vi.spyOn(api, 'calendarEvents').mockResolvedValue([{ id: 'e1', starts_on: '2026-09-11', ends_on: '2026-09-11', title: 'Audyt', color: 'red', created_at: '2026-08-01T10:00:00Z' }])
    vi.spyOn(api, 'deleteCalendarEvent').mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
    renderScreen(<CalendarMatrix role="coordinator" displayName="Koordynator" range={WEEK_OF_TODAY} />)
    const dialog = await openDay()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Usuń' }))
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^pt 11-09-2026/ })).not.toBeInTheDocument())

    finish()
    await waitFor(() => expect(screen.getByText('Usunięto „Audyt”')).toBeInTheDocument())
    expect(screen.queryByRole('dialog', { name: /^pt 11-09-2026/ })).not.toBeInTheDocument()
    expect(api.calendar).toHaveBeenCalledTimes(2)
  })
})

describe('CalendarMatrix role swap (P6)', () => {
  /** Anna PRIMARY and Marek SECONDARY every day; Marek also has 11–19 on Thursday 10-09 (today). */
  const pairWeek = (over: Partial<CalendarData> = {}) => week({
    assignments: [...covered(), duty('2026-09-10', 'late_shift', 'Marek Nowak', 'm2'), duty('2026-09-08', 'late_shift', 'Marek Nowak', 'm2')],
    ...over,
  })
  const swapImpact = (): SwapImpact => ({ ...impactFor('Anna Kowalska', 'Marek Nowak'), service_date: '2026-09-10', return_date: '2026-09-10', return_points: 1 })
  const openDay = async (cell: RegExp) => {
    fireEvent.click((await screen.findAllByRole('button', { name: cell }))[0])
    return screen.findByRole('dialog')
  }
  const trigger = (dialog: HTMLElement) =>
    within(dialog).getByRole('button', { name: 'Zamień miejscami: Anna Kowalska na SECONDARY, Marek Nowak na PRIMARY' })
  const swapButton = (dialog: HTMLElement) => within(dialog).getByRole('button', { name: 'Zamień miejscami' })
  const THURSDAY = /^Anna Kowalska, czw 10-09-2026/
  const swapLines = (late: boolean) => [
    { service_date: '2026-09-10', role: 'primary', replacement_member_id: 'm2', with_late_shift: false },
    { service_date: '2026-09-10', role: 'secondary', replacement_member_id: 'm1', with_late_shift: late },
  ]

  it('previews, saves without a dialog and undoes from the panel', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(pairWeek())
    vi.spyOn(api, 'publicConfig').mockResolvedValue({ undo_window_seconds: 12 } as never)
    const check = vi.spyOn(api, 'batchOverrideCheck').mockResolvedValue(checked())
    const impact = vi.spyOn(api, 'swapImpact').mockResolvedValue(swapImpact())
    const save = vi.spyOn(api, 'batchOverride').mockResolvedValue([])
    renderScreen(matrix())
    const dialog = await openDay(THURSDAY)

    const open = trigger(dialog)
    expect(open).toHaveTextContent('Zamień miejscami…')
    expect(open).toHaveAttribute('aria-expanded', 'false')
    expect(open).toHaveAttribute('aria-controls', 'role-swap-frame')
    fireEvent.click(open)
    expect(open).toHaveAttribute('aria-expanded', 'true')

    const frame = within(dialog).getByRole('region', { name: 'Zamiana miejscami' })
    expect(frame).toHaveAttribute('id', 'role-swap-frame')
    expect(frame).toHaveTextContent('PAnna Kowalska → Marek Nowak')
    expect(frame).toHaveTextContent('SMarek Nowak → Anna Kowalska')
    expect(frame).toHaveTextContent('11–19Marek Nowak → Anna Kowalska')
    expect(within(frame).getByRole('checkbox', { name: /razem z SECONDARY/ })).toBeChecked()
    expect(frame).toHaveTextContent('Polityka wiąże 11–19 z SECONDARY, a Anna Kowalska ma do niej uprawnienia.')
    expect(within(frame).queryByRole('textbox')).not.toBeInTheDocument()
    // The rows the swap moves are lit while the frame is open.
    for (const name of ['PRIMARY: Anna Kowalska. Zmień osobę', 'SECONDARY: Marek Nowak. Zmień osobę', '11–19: Marek Nowak. Zmień osobę']) {
      expect(within(dialog).getByRole('button', { name })).toHaveClass('role-row-sel')
    }

    await within(frame).findByText('Bez naruszeń reguł twardych')
    expect(check).toHaveBeenCalledWith({ batches: [{ schedule_id: 's1', assignments: swapLines(true) }] })
    expect(impact).toHaveBeenCalledWith('2026-09-10', 'primary', 'm2', {
      inReturn: { service_date: '2026-09-10', role: 'secondary' }, scope: 'single', returnScope: undefined, correction: false,
    })
    expect(await within(frame).findByText(/Anna Kowalska · PRIMARY → SECONDARY i 11–19/)).toBeInTheDocument()
    expect(within(frame).getByText(/Marek Nowak · SECONDARY i 11–19 → PRIMARY/)).toBeInTheDocument()
    // One day, so its worth is said once.
    expect(within(frame).getAllByText(/czw 10-09-2026 to 1 punkt/)).toHaveLength(1)

    fireEvent.click(swapButton(dialog))
    await waitFor(() => expect(save).toHaveBeenCalledWith({
      schedule_id: 's1', expected_version: 4, kind: 'role_swap', assignments: swapLines(true),
      reason: undefined, acknowledge_rule_violations: false,
    }))
    expect(await screen.findByText('Zamieniono miejscami czw 10-09-2026: Marek Nowak PRIMARY, Anna Kowalska SECONDARY i 11–19')).toBeInTheDocument()
    expect(screen.getByText('E-maile do obu osób wyjdą po zamknięciu „Cofnij”.')).toBeInTheDocument()
    await waitFor(() => expect(within(dialog).queryByRole('region', { name: 'Zamiana miejscami' })).not.toBeInTheDocument())

    // The panel offers the same Undo as the toast.
    const undo = within(dialog).getByRole('button', { name: 'Cofnij zamianę: Anna Kowalska PRIMARY, Marek Nowak SECONDARY i 11–19' })
    expect(undo).toHaveTextContent('Cofnij zamianę')
    fireEvent.click(undo)
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(save.mock.calls[1][0]).toEqual({
      schedule_id: 's1', expected_version: 5, kind: 'role_swap', reason: undefined, acknowledge_rule_violations: true,
      assignments: [
        { service_date: '2026-09-10', role: 'primary', replacement_member_id: 'm1', with_late_shift: false },
        { service_date: '2026-09-10', role: 'secondary', replacement_member_id: 'm2', with_late_shift: true },
      ],
    })
    await waitFor(() => expect(screen.queryByText(/^Zamieniono miejscami/)).not.toBeInTheDocument())
    expect(trigger(dialog)).toBeInTheDocument()
  })

  it('lets the panel Undo lapse with the window and reports a failed Undo', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(pairWeek())
    vi.spyOn(api, 'batchOverrideCheck').mockResolvedValue(checked())
    vi.spyOn(api, 'swapImpact').mockResolvedValue(swapImpact())
    const save = vi.spyOn(api, 'batchOverride')
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new ApiError('Grafik zmienił się; odśwież kalendarz', 409))
    renderScreen(matrix())
    const dialog = await openDay(THURSDAY)
    fireEvent.click(trigger(dialog))
    await within(dialog).findByText('Bez naruszeń reguł twardych')
    fireEvent.click(swapButton(dialog))

    fireEvent.click(await within(dialog).findByRole('button', { name: /^Cofnij zamianę/ }))
    expect(await screen.findByText('Nie udało się cofnąć zamiany')).toBeInTheDocument()
    expect(save).toHaveBeenCalledTimes(2)
    // Without the config the window is the server's default ten seconds.
    act(() => { vi.advanceTimersByTime(10_000) })
    await waitFor(() => expect(within(dialog).queryByRole('button', { name: /^Cofnij zamianę/ })).not.toBeInTheDocument())
    expect(trigger(dialog)).toBeInTheDocument()
  })

  it('leaves 11–19 behind only knowingly', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(pairWeek())
    const check = vi.spyOn(api, 'batchOverrideCheck').mockImplementation(async ({ batches }) =>
      checked(batches[0].assignments[1].with_late_shift
        ? []
        : [{ rule: 'late_shift_anchor', member_name: 'Marek Nowak', days: ['2026-09-10'], message: '11–19 bez SECONDARY' }]))
    const impact = vi.spyOn(api, 'swapImpact').mockResolvedValue(swapImpact())
    const save = vi.spyOn(api, 'batchOverride').mockResolvedValue([])
    renderScreen(matrix())
    const dialog = await openDay(THURSDAY)
    fireEvent.click(trigger(dialog))
    const frame = within(dialog).getByRole('region', { name: 'Zamiana miejscami' })

    fireEvent.click(within(frame).getByRole('checkbox', { name: /razem z SECONDARY/ }))
    expect(frame).toHaveTextContent('11–19Marek Nowak (bez zmian)')
    expect(within(dialog).getByRole('button', { name: '11–19: Marek Nowak. Zmień osobę' })).not.toHaveClass('role-row-sel')
    expect(await within(frame).findByText(/11–19 bez SECONDARY/)).toBeInTheDocument()
    expect(check).toHaveBeenLastCalledWith({ batches: [{ schedule_id: 's1', assignments: swapLines(false) }] })
    await waitFor(() => expect(impact).toHaveBeenLastCalledWith('2026-09-10', 'primary', 'm2', expect.objectContaining({ scope: 'single', returnScope: 'single' })))
    expectBlocked(swapButton(dialog))
    fireEvent.click(swapButton(dialog))
    expect(save).not.toHaveBeenCalled()

    fireEvent.click(within(frame).getByRole('checkbox', { name: 'Rozumiem i świadomie łamię te reguły' }))
    expectReady(swapButton(dialog))
    fireEvent.click(swapButton(dialog))
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({
      assignments: swapLines(false), acknowledge_rule_violations: true,
    })))
    expect(await screen.findByText('Zamieniono miejscami czw 10-09-2026: Marek Nowak PRIMARY, Anna Kowalska SECONDARY')).toBeInTheDocument()
  })

  it('keeps 11–19 where the person taking SECONDARY may not hold it, and with PRIMARY where the policy binds it there', async () => {
    const restricted = [
      { id: 'm1', display_name: 'Anna Kowalska', eligibility: (['primary', 'secondary'] as const).map((role) => ({ role, starts_on: '2026-01-01', ends_on: null })) },
      { id: 'm2', display_name: 'Marek Nowak' },
    ]
    vi.spyOn(api, 'calendar').mockResolvedValue(pairWeek({ members: restricted }))
    vi.spyOn(api, 'batchOverrideCheck').mockResolvedValue(checked())
    vi.spyOn(api, 'swapImpact').mockResolvedValue(swapImpact())
    const policy = vi.spyOn(api, 'swapPolicy').mockResolvedValue({ coordinator_approval_required: true, late_shift_anchor: 'secondary' })
    const view = renderScreen(matrix())
    let dialog = await openDay(THURSDAY)
    fireEvent.click(trigger(dialog))
    let late = await within(dialog).findByRole('checkbox', { name: /razem z SECONDARY/ })
    expect(late).not.toBeChecked()
    expect(late).toHaveAttribute('aria-disabled', 'true')
    expect(dialog).toHaveTextContent('Anna Kowalska nie ma uprawnień do 11–19, więc 11–19 zostaje bez zmian.')
    view.unmount()

    policy.mockResolvedValue({ coordinator_approval_required: true, late_shift_anchor: 'primary' })
    const anchoredToPrimary = pairWeek()
    anchoredToPrimary.assignments = anchoredToPrimary.assignments.map((item) =>
      item.role === 'late_shift' ? { ...item, assignee_name: 'Anna Kowalska', member_id: 'm1' } : item)
    vi.mocked(api.calendar).mockResolvedValue(anchoredToPrimary)
    const impact = vi.mocked(api.swapImpact)
    renderScreen(matrix())
    dialog = await openDay(THURSDAY)
    fireEvent.click(trigger(dialog))
    late = await within(dialog).findByRole('checkbox', { name: /razem z PRIMARY/ })
    expect(late).toBeChecked()
    await waitFor(() => expect(impact).toHaveBeenLastCalledWith('2026-09-10', 'primary', 'm2', expect.objectContaining({ scope: undefined, returnScope: 'single' })))
  })

  it('says in the frame that the swap ends the open number handover, without asking to acknowledge it', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(pairWeek())
    vi.spyOn(api, 'batchOverrideCheck').mockResolvedValue(checked([], {
      id: 'h1',
      day: '2026-09-10',
      from_member_id: 'm1',
      from_name: 'Anna Kowalska',
      to_member_id: 'm2',
      to_name: 'Marek Nowak',
      starts_at: '2026-09-10T09:40:00Z',
      until: '2026-09-10T11:40:00Z',
    }))
    vi.spyOn(api, 'swapImpact').mockResolvedValue(swapImpact())
    renderScreen(matrix())
    const dialog = await openDay(THURSDAY)
    fireEvent.click(trigger(dialog))
    const frame = within(dialog).getByRole('region', { name: 'Zamiana miejscami' })

    expect(await within(frame).findByText(
      'Ta korekta zakończy przekazanie numeru on-call Anna Kowalska → Marek Nowak. Numer wróci do osoby na PRIMARY, a obie strony dostaną e-mail.',
    )).toBeInTheDocument()
    expect(within(frame).queryByRole('checkbox', { name: /Rozumiem/ })).not.toBeInTheDocument()
    expectReady(swapButton(dialog))
  })

  it('says in the frame who may not take the other role and holds the swap without checking it', async () => {
    const members = [
      { id: 'm1', display_name: 'Anna Kowalska' },
      { id: 'm2', display_name: 'Marek Nowak', eligibility: [{ role: 'secondary' as const, starts_on: '2026-01-01', ends_on: null }] },
    ]
    const availability = [{ member_id: 'm1', kind: 'unavailable' as const, starts_on: '2026-09-10', ends_on: '2026-09-11', note: 'Urlop' }]
    vi.spyOn(api, 'calendar').mockResolvedValue(pairWeek({ members, availability }))
    const check = vi.spyOn(api, 'batchOverrideCheck').mockResolvedValue(checked())
    const save = vi.spyOn(api, 'batchOverride').mockResolvedValue([])
    renderScreen(matrix())
    const dialog = await openDay(THURSDAY)
    fireEvent.click(trigger(dialog))
    const frame = within(dialog).getByRole('region', { name: 'Zamiana miejscami' })

    expect(within(frame).getAllByRole('alert').map((alert) => alert.textContent)).toEqual([
      'Marek Nowak nie ma tego dnia uprawnień do PRIMARY, więc tej zamiany nie da się zapisać.',
      'Anna Kowalska ma tego dnia wpis niedostępności, więc nie przejmie SECONDARY i tej zamiany nie da się zapisać.',
    ])
    expect(within(frame).queryByText(/reguł twardych/)).not.toBeInTheDocument()
    expectBlocked(swapButton(dialog))
    fireEvent.click(swapButton(dialog))
    expect(save).not.toHaveBeenCalled()
    expect(check).not.toHaveBeenCalled()
  })

  it('asks for a reason in the frame for a day already past', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(pairWeek())
    vi.spyOn(api, 'batchOverrideCheck').mockResolvedValue(checked())
    vi.spyOn(api, 'swapImpact').mockResolvedValue(swapImpact())
    const save = vi.spyOn(api, 'batchOverride')
      .mockRejectedValueOnce(new ApiError('Grafik zmienił się; odśwież kalendarz', 409))
      .mockResolvedValue([])
    renderScreen(matrix())
    const dialog = await openDay(/^Anna Kowalska, wt 08-09-2026/)
    fireEvent.click(trigger(dialog))
    await within(dialog).findByText('Bez naruszeń reguł twardych')

    const reason = within(dialog).getByRole('textbox', { name: 'Powód korekty (minimum 10 znaków)' })
    expectBlocked(swapButton(dialog))
    fireEvent.change(reason, { target: { value: '  Zamiana po fakcie ' } })
    expectReady(swapButton(dialog))
    fireEvent.click(swapButton(dialog))

    const refusal = await within(dialog).findByRole('alert')
    expect(refusal).toHaveTextContent('Grafik zmienił się; odśwież kalendarz')
    fireEvent.click(swapButton(dialog))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(save.mock.calls[1][0]).toEqual(expect.objectContaining({ reason: 'Zamiana po fakcie' }))
  })

  it('checks again when the write meets a rule the frame did not show', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(pairWeek())
    const check = vi.spyOn(api, 'batchOverrideCheck').mockResolvedValue(checked())
    vi.spyOn(api, 'swapImpact').mockResolvedValue(swapImpact())
    vi.spyOn(api, 'batchOverride').mockRejectedValue(new ApiError('Złamie reguły', 409, [
      { rule: 'three_in_seven', member_name: 'Anna Kowalska', days: ['2026-09-10'], message: 'Trzy dyżury w 7 dni' },
    ]))
    renderScreen(matrix())
    const dialog = await openDay(THURSDAY)
    fireEvent.click(trigger(dialog))
    await within(dialog).findByText('Bez naruszeń reguł twardych')
    fireEvent.click(swapButton(dialog))

    await waitFor(() => expect(check).toHaveBeenCalledTimes(2))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Złamie reguły')
  })

  it('saves after a failed check, leaving the rules to the write', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(pairWeek())
    vi.spyOn(api, 'batchOverrideCheck').mockRejectedValue(new ApiError('Nie sprawdzono reguł', 503))
    vi.spyOn(api, 'swapImpact').mockResolvedValue(swapImpact())
    const save = vi.spyOn(api, 'batchOverride').mockResolvedValue([])
    renderScreen(matrix())
    const dialog = await openDay(THURSDAY)
    fireEvent.click(trigger(dialog))

    await within(dialog).findByText('Nie udało się sprawdzić reguł twardych; zapis sprawdzi je ponownie.')
    fireEvent.click(swapButton(dialog))
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ acknowledge_rule_violations: false })))
  })

  it('closes with Cancel, the trigger, a role change or another day', async () => {
    vi.spyOn(api, 'calendar').mockResolvedValue(pairWeek())
    vi.spyOn(api, 'batchOverrideCheck').mockResolvedValue(checked())
    vi.spyOn(api, 'swapImpact').mockResolvedValue(swapImpact())
    renderScreen(matrix())
    const dialog = await openDay(THURSDAY)
    const region = () => within(dialog).queryByRole('region', { name: 'Zamiana miejscami' })

    fireEvent.click(trigger(dialog))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Anuluj' }))
    expect(region()).not.toBeInTheDocument()
    fireEvent.click(trigger(dialog))
    fireEvent.click(trigger(dialog))
    expect(region()).not.toBeInTheDocument()
    fireEvent.click(trigger(dialog))
    fireEvent.click(within(dialog).getByRole('button', { name: 'PRIMARY: Anna Kowalska. Zmień osobę' }))
    expect(region()).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Wróć' }))
    fireEvent.click(trigger(dialog))
    fireEvent.click((await screen.findAllByRole('button', { name: /^Anna Kowalska, pt 11-09-2026/ }))[0])
    expect(region()).not.toBeInTheDocument()
  })

  it('is offered to a coordinator for a published pair of two people only', async () => {
    const days = { '2026-09-11': { published: false } }
    const assignments = [
      ...covered(['2026-09-07', '2026-09-08', '2026-09-11']),
      duty('2026-09-09', 'primary', 'Anna Kowalska', 'm1'), duty('2026-09-09', 'secondary', 'Anna Kowalska', 'm1'),
      duty('2026-09-10', 'primary', 'Anna Kowalska', 'm1'),
    ]
    vi.spyOn(api, 'calendar').mockResolvedValue(week({ assignments }, days))
    const view = renderScreen(matrix())
    const noSwap = async (cell: RegExp) => {
      const dialog = await openDay(cell)
      expect(within(dialog).queryByRole('button', { name: /^Zamień miejscami/ })).not.toBeInTheDocument()
    }
    await noSwap(/^Anna Kowalska, śr 09-09-2026/)
    await noSwap(/^Anna Kowalska, czw 10-09-2026/)
    await noSwap(/^Anna Kowalska, pt 11-09-2026/)
    view.unmount()

    renderScreen(matrix('member', 'Anna Kowalska'))
    await noSwap(/^Anna Kowalska, pon 07-09-2026/)
  })
})
