import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useLocation } from 'react-router-dom'
import { fireEvent, screen, waitFor } from '@testing-library/react'
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

  it('rejects impossible calendar dates for every input shape', () => {
    expect(parseDayQuery('13.13', today)).toBeNull()
    expect(parseDayQuery('31.02', today)).toBeNull()
    expect(parseDayQuery('2026-13-13', today)).toBeNull()
    expect(parseDayQuery('29.02.2026', today)).toBeNull()
    expect(parseDayQuery('30 lut', today)).toBeNull()
    expect(parseDayQuery('29.02.2028', today)).toBe('2028-02-29')
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

  it('moves through the list with the arrows and the pointer, and opens a screen', async () => {
    const { onOpenChange } = renderPalette('coordinator')
    const input = await screen.findByRole('combobox')
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(options[2]).toHaveAttribute('aria-selected', 'true')
    expect(input).toHaveAttribute('aria-activedescendant', options[2].id)
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(options[1]).toHaveAttribute('aria-selected', 'true')
    // Any other key only types.
    fireEvent.keyDown(input, { key: 'a' })
    expect(options[1]).toHaveAttribute('aria-selected', 'true')

    const fairness = screen.getByRole('option', { name: /Sprawiedliwość/ })
    fireEvent.mouseEnter(fairness)
    expect(fairness).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByTestId('path')).toHaveTextContent('/sprawiedliwosc')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('jumps to a person in the schedule', async () => {
    renderPalette()
    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'marek' } })
    const option = await screen.findByRole('option', { name: /Marek Nowak/ })
    expect(option).toHaveTextContent('pokaż w grafiku')
    fireEvent.click(option)
    expect(screen.getByTestId('path')).toHaveTextContent('/grafik?osoba=Marek%20Nowak')
  })

  it('switches the theme and lists every action after ">"', async () => {
    renderPalette()
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: '>' } })
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Motyw: ciemny', 'Motyw: jasny', 'Motyw: systemowy', 'Dokumentacja', 'Wyloguj',
    ])
    fireEvent.click(screen.getByRole('option', { name: 'Motyw: jasny' }))
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
    expect(window.localStorage.getItem('oncall-theme')).toBe('light')
  })

  it('opens the documentation in the current language', async () => {
    const assign = vi.fn()
    const original = window.location
    Object.defineProperty(window, 'location', { value: { ...original, assign }, configurable: true })
    try {
      renderPalette()
      fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'dokument' } })
      fireEvent.click(screen.getByRole('option', { name: 'Dokumentacja' }))
      expect(assign).toHaveBeenCalledWith('/docs/')
    } finally {
      Object.defineProperty(window, 'location', { value: original, configurable: true })
    }
  })

  it('says nothing matches and does nothing on Enter', async () => {
    const { onOpenChange } = renderPalette()
    const input = await screen.findByRole('combobox')
    fireEvent.change(input, { target: { value: 'qqqq' } })
    expect(screen.getByText('Nic nie pasuje. Wpisz nazwisko, datę albo nazwę ekranu.')).toBeInTheDocument()
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
    expect(input).not.toHaveAttribute('aria-activedescendant')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('opens again with an empty search after it was closed', async () => {
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue({
      generated_at: '2026-09-01T10:00:00Z', is_published: true, id: 's1', version: 1,
      starts_on: '2026-09-01', ends_on: '2026-09-30', assignments: [], current: [],
      today_is_day_off: false, today_holiday_name: null,
    })
    function Harness() {
      const [open, setOpen] = useState(true)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Szukaj</button>
          <CommandPalette open={open} onOpenChange={setOpen} access={{ role: 'member', hasTeamMember: true }} onLogout={vi.fn()} />
        </>
      )
    }
    renderScreen(<Harness />)
    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'grafik' } })
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('combobox')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Szukaj' }))
    expect(await screen.findByRole('combobox')).toHaveValue('')
  })
})
