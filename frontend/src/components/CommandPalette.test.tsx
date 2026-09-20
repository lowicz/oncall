import { afterEach, describe, expect, it, vi } from 'vitest'
import { useLocation } from 'react-router-dom'
import { fireEvent, screen } from '@testing-library/react'
import { api } from '../api'
import { renderScreen } from '../test/render'
import { CommandPalette, parseDayQuery } from './CommandPalette'

afterEach(() => vi.restoreAllMocks())

describe('parseDayQuery', () => {
  const today = new Date('2026-09-10T09:00:00+02:00')

  it('reads ISO, Polish numeric and short-month dates', () => {
    expect(parseDayQuery('2026-09-24', today)).toBe('2026-09-24')
    expect(parseDayQuery('24-09-2026', today)).toBe('2026-09-24')
    expect(parseDayQuery('24.09', today)).toBe('2026-09-24')
    expect(parseDayQuery('3.1.2027', today)).toBe('2027-01-03')
    expect(parseDayQuery('24 wrz', today)).toBe('2026-09-24')
    expect(parseDayQuery('24 września 2027', today)).toBe('2027-09-24')
  })

  it('rejects anything that is not a day', () => {
    expect(parseDayQuery('Anna', today)).toBeNull()
    expect(parseDayQuery('24 xyz', today)).toBeNull()
    expect(parseDayQuery('', today)).toBeNull()
  })
})

function Location() {
  const location = useLocation()
  return <span data-testid="path">{location.pathname}{location.search}</span>
}

describe('CommandPalette', () => {
  function renderPalette(role: 'viewer' | 'member' | 'coordinator' | 'admin' = 'member') {
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue({
      generated_at: '2026-09-01T10:00:00Z',
      is_published: true,
      id: 's1',
      version: 1,
      starts_on: '2026-09-01',
      ends_on: '2026-09-30',
      assignments: [
        { service_date: '2026-09-14', role: 'primary', assignee_name: 'Anna Kowalska', is_override: false },
        { service_date: '2026-09-15', role: 'primary', assignee_name: 'Marek Nowak', is_override: false },
      ],
      current: [],
      today_is_day_off: false,
      today_holiday_name: null,
    })
    const onOpenChange = vi.fn()
    const onLogout = vi.fn()
    renderScreen(
      <>
        <CommandPalette open onOpenChange={onOpenChange} access={{ role, hasTeamMember: role !== 'viewer' }} onLogout={onLogout} />
        <Location />
      </>,
    )
    return { onOpenChange, onLogout }
  }

  it('lists the screens the role can reach and filters them as the user types', async () => {
    renderPalette('coordinator')
    const input = await screen.findByRole('combobox')
    expect(screen.getByRole('option', { name: /Generator/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Osoby/ })).not.toBeInTheDocument()
    fireEvent.change(input, { target: { value: 'spraw' } })
    expect(screen.getByRole('option', { name: /Sprawiedliwość/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Generator/ })).not.toBeInTheDocument()
  })

  it('offers people from the published schedule and a typed day as places in the schedule', async () => {
    const { onOpenChange } = renderPalette()
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: 'anna' } })
    expect(await screen.findByRole('option', { name: /Anna Kowalska/ })).toBeInTheDocument()
    fireEvent.change(input, { target: { value: '24.09' } })
    fireEvent.click(screen.getByRole('option', { name: /2026-09-24/ }))
    expect(screen.getByTestId('path')).toHaveTextContent('/grafik?dzien=2026-09-24')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('runs the highlighted item on Enter and keeps every screen a viewer cannot open out of the list', async () => {
    const { onLogout } = renderPalette('viewer')
    const input = await screen.findByRole('combobox')
    expect(screen.queryByRole('option', { name: /Zamiany/ })).not.toBeInTheDocument()
    fireEvent.change(input, { target: { value: 'wylog' } })
    expect(screen.getByRole('option', { name: /Wyloguj/ })).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onLogout).toHaveBeenCalled()
  })
})
