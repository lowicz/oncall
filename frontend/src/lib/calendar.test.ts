import { describe, expect, it } from 'vitest'
import { CalendarData } from '../api'
import {
  availabilityDutyConflicts,
  coverageGaps,
  hasDutyInRange,
  isCurrentAssignee,
  monthGroups,
  orderMembers,
  staffingCandidates,
  startsWeek,
} from './calendar'

const day = (service_date: string, weekday: string, is_day_off = false) =>
  ({ service_date, weekday, is_day_off, holiday_name: null, published: true, events: [] })

const assignment = (service_date: string, role: 'primary' | 'secondary' | 'late_shift', assignee_name: string) => ({
  service_date,
  role,
  assignee_name,
  is_override: false,
  schedule_id: 's1',
  schedule_version: 1,
  change_kind: null,
})

const data = (over: Partial<CalendarData> = {}): CalendarData => ({
  starts_on: '2026-09-01',
  ends_on: '2026-09-02',
  days: [day('2026-09-01', 'wt'), day('2026-09-02', 'śr')],
  members: [{ id: 'm1', display_name: 'Anna' }],
  team_has_members: true,
  assignments: [],
  availability: [],
  ...over,
})

describe('coverageGaps', () => {
  it('reports a day with nobody on primary or secondary', () => {
    expect(coverageGaps(data())).toEqual([
      { service_date: '2026-09-01', missing: ['primary', 'secondary'] },
      { service_date: '2026-09-02', missing: ['primary', 'secondary'] },
    ])
  })

  it('reports only the role that is actually missing', () => {
    const gaps = coverageGaps(data({
      assignments: [
        assignment('2026-09-01', 'primary', 'Anna'),
        assignment('2026-09-02', 'primary', 'Anna'),
        assignment('2026-09-02', 'secondary', 'Marek'),
      ],
    }))
    expect(gaps).toEqual([{ service_date: '2026-09-01', missing: ['secondary'] }])
  })

  it('does not treat a missing 11-19 shift as a coverage gap', () => {
    // The late shift only exists on working days (archive/docs/PLAN.md §3).
    const gaps = coverageGaps(data({
      assignments: [
        assignment('2026-09-01', 'primary', 'Anna'),
        assignment('2026-09-01', 'secondary', 'Marek'),
        assignment('2026-09-02', 'primary', 'Anna'),
        assignment('2026-09-02', 'secondary', 'Marek'),
      ],
    }))
    expect(gaps).toEqual([])
  })
})

describe('orderMembers', () => {
  it('puts the signed-in person first, then people on duty, then the rest', () => {
    const members = [
      { id: '1', display_name: 'Ola' },
      { id: '2', display_name: 'Anna' },
      { id: '3', display_name: 'Piotr' },
    ]
    const ordered = orderMembers(members, [assignment('2026-09-01', 'primary', 'Piotr')], 'Ola')
    expect(ordered.map((m) => m.display_name)).toEqual(['Ola', 'Piotr', 'Anna'])
  })

  it('sorts the idle remainder using Polish collation', () => {
    const members = [
      { id: '1', display_name: 'Zofia' },
      { id: '2', display_name: 'Ćma' },
      { id: '3', display_name: 'Adam' },
    ]
    const ordered = orderMembers(members, [], 'Nikt')
    expect(ordered.map((m) => m.display_name)).toEqual(['Adam', 'Ćma', 'Zofia'])
  })
})

describe('hasDutyInRange', () => {
  it('separates people with and without duties', () => {
    const assignments = [assignment('2026-09-01', 'primary', 'Anna')]
    expect(hasDutyInRange({ id: '1', display_name: 'Anna' }, assignments)).toBe(true)
    expect(hasDutyInRange({ id: '2', display_name: 'Marek' }, assignments)).toBe(false)
  })
})

describe('isCurrentAssignee', () => {
  it('matches by identity and falls back to the legacy label', () => {
    const member = { id: 'm1', display_name: 'Anna' }
    expect(isCurrentAssignee(member, { ...assignment('2026-09-01', 'primary', 'Stara nazwa'), member_id: 'm1' })).toBe(true)
    expect(isCurrentAssignee(member, assignment('2026-09-01', 'primary', 'Anna'))).toBe(true)
    expect(isCurrentAssignee(member, assignment('2026-09-01', 'primary', 'Marek'))).toBe(false)
  })
})

describe('availabilityDutyConflicts', () => {
  it('finds a hard unavailability covering an assigned slot', () => {
    const calendar = data({
      assignments: [assignment('2026-09-01', 'primary', 'Anna')],
      availability: [{
        member_id: 'm1',
        kind: 'unavailable',
        starts_on: '2026-09-01',
        ends_on: '2026-09-02',
        note: null,
      }],
    })

    expect(availabilityDutyConflicts(calendar)).toEqual([{
      member_id: 'm1',
      display_name: 'Anna',
      service_date: '2026-09-01',
      role: 'primary',
    }])
  })
})

describe('monthGroups', () => {
  it('collapses contiguous days into labelled month spans', () => {
    const groups = monthGroups([
      day('2026-09-29', 'wt'), day('2026-09-30', 'śr'),
      day('2026-10-01', 'czw'), day('2026-10-02', 'pt'), day('2026-10-03', 'sob'),
    ])
    expect(groups).toEqual([
      { key: '2026-09', label: 'wrzesień 2026', shortLabel: 'wrz 2026', span: 2 },
      { key: '2026-10', label: 'październik 2026', shortLabel: 'paź 2026', span: 3 },
    ])
  })

  it('spans the whole range when it sits inside one month', () => {
    expect(monthGroups([day('2026-09-01', 'wt'), day('2026-09-02', 'śr')]))
      .toEqual([{ key: '2026-09', label: 'wrzesień 2026', shortLabel: 'wrz 2026', span: 2 }])
  })
})

describe('startsWeek', () => {
  it('marks Mondays only', () => {
    expect(startsWeek(day('2026-09-07', 'pon'))).toBe(true)
    expect(startsWeek(day('2026-09-08', 'wt'))).toBe(false)
  })
})

describe('staffingCandidates (MED6-03)', () => {
  const roster = (over: Partial<CalendarData> = {}) => data({
    members: [
      { id: 'm1', display_name: 'Anna' },
      { id: 'm2', display_name: 'Bartek' },
      { id: 'm3', display_name: 'Celina' },
    ],
    ...over,
  })

  it('offers every in-rotation person, current assignee last and disabled', () => {
    const calendar = roster({
      assignments: [{ ...assignment('2026-09-01', 'primary', 'Anna'), member_id: 'm1' }],
    })
    const result = staffingCandidates(calendar, '2026-09-01', 'primary')

    expect(result.map((item) => item.display_name)).toEqual(['Bartek', 'Celina', 'Anna'])
    expect(result.find((item) => item.id === 'm1')).toMatchObject({
      isCurrent: true,
      disabledReason: 'już pełni tę rolę tego dnia',
    })
    expect(result.find((item) => item.id === 'm2')?.disabledReason).toBeUndefined()
  })

  it('disables a person who is hard-unavailable that day', () => {
    const calendar = roster({
      availability: [{
        member_id: 'm2',
        kind: 'unavailable',
        starts_on: '2026-09-01',
        ends_on: '2026-09-01',
        note: null,
      }],
    })
    const bartek = staffingCandidates(calendar, '2026-09-01', 'primary')
      .find((item) => item.id === 'm2')
    expect(bartek?.disabledReason).toBe('niedostępna tego dnia')
  })

  it('disables a person already holding the opposite on-call role', () => {
    const calendar = roster({
      assignments: [{ ...assignment('2026-09-01', 'secondary', 'Celina'), member_id: 'm3' }],
    })
    const celina = staffingCandidates(calendar, '2026-09-01', 'primary')
      .find((item) => item.id === 'm3')
    expect(celina?.disabledReason).toBe('ma już drugi on-call tego dnia')
  })

  it('does not treat the opposite-role clash as a blocker for the 11-19 shift', () => {
    const calendar = roster({
      assignments: [{ ...assignment('2026-09-01', 'primary', 'Celina'), member_id: 'm3' }],
    })
    const celina = staffingCandidates(calendar, '2026-09-01', 'late_shift')
      .find((item) => item.id === 'm3')
    expect(celina?.disabledReason).toBeUndefined()
  })

  it('drops people whose rotation window does not cover the day', () => {
    const calendar = roster({
      members: [
        { id: 'm1', display_name: 'Anna', active_from: '2026-01-01' },
        { id: 'm2', display_name: 'Bartek', active_from: '2026-09-15' },
        { id: 'm3', display_name: 'Celina', active_from: '2026-01-01', active_until: '2026-08-31' },
      ],
    })
    expect(staffingCandidates(calendar, '2026-09-01', 'primary').map((item) => item.id))
      .toEqual(['m1'])
  })

  it('disables a person without eligibility for the selected role', () => {
    const calendar = roster({
      members: [
        {
          id: 'm2', display_name: 'Bartek', active_from: '2026-01-01',
          eligibility: [{ role: 'secondary', starts_on: '2026-01-01', ends_on: null }],
        },
      ],
    })
    expect(
      staffingCandidates(calendar, '2026-09-01', 'primary')[0].disabledReason,
    ).toBe('nie ma uprawnień do roli')
  })
})
