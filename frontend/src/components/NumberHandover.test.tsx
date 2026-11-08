import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderScreen } from '../test/render'
import { expectNoAxeViolations } from '../test/axe'
import { api } from '../api'
import type { HandoverPair, NumberHandover, PairMember } from '../api'
import { HeldNumber, heldNumber, useForwardingNow } from '../hooks/useForwardingNow'
import { HandoverActions, HandoverViewer, NumberPill } from './NumberHandover'

// The suite clock is Thursday 2026-09-10, 09:00 in Warsaw (src/test/setup.ts);
// the duty day ends at 09:00 the next morning.
const side = (name: string, over: Partial<PairMember> = {}): PairMember => ({ name, is_you: false, has_phone: true, ...over })
const PAIR: HandoverPair = { primary: side('Anna Kowalska'), secondary: side('Marek Nowak') }
const MAREK_PHONE = '+48 602 345 678'

const HANDOVER: NumberHandover = {
  id: 'h1', day: '2026-09-10', from_member_id: 'm1', from_name: 'Anna Kowalska', to_member_id: 'm2', to_name: 'Marek Nowak',
  starts_at: '2026-09-10T07:00:00Z', until: '2026-09-10T09:00:00Z', started_by_name: 'Anna Kowalska',
}

const held = (over: Partial<HeldNumber> = {}): HeldNumber => ({
  mode: 'live', day: '2026-09-10', day_ends_at: '2026-09-11T09:00:00+02:00',
  holder_member_id: 'm1', holder_name: 'Anna Kowalska', holder_role: 'primary',
  handover: null, status: 'confirmed', confirmed_at: '2026-09-10T06:55:00Z', pair: PAIR,
  ...over,
})
const handedOver = (over: Partial<HeldNumber> = {}) =>
  held({ holder_member_id: 'm2', holder_name: 'Marek Nowak', holder_role: 'secondary', handover: HANDOVER, ...over })

function pretendNarrow() {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: query.includes('max-width: 900px'),
    media: query, onchange: null, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }))
}

/** The receiver's phone as the reader's duty list shows it: none when they have none. */
const actions = (viewer: Exclude<HandoverViewer, null>, now = held(), hasPhone = true, receiverPhone: string | null = hasPhone ? MAREK_PHONE : null) =>
  renderScreen(<HandoverActions now={now} pair={{ ...PAIR, secondary: side('Marek Nowak', { has_phone: hasPhone }) }} receiverPhone={receiverPhone} viewer={viewer} />)

/** The duration group of the open popover or sheet. */
const durations = () => screen.getByRole('radiogroup', { name: 'Na jak długo' })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('heldNumber', () => {
  it('is nothing while forwarding is off or nobody holds the number', () => {
    expect(heldNumber(undefined)).toBeNull()
    expect(heldNumber({ ...held(), mode: 'off', holder_name: null, status: null })).toBeNull()
    expect(heldNumber({ ...held(), holder_name: null, status: null })).toBeNull()
    const now = held()
    expect(heldNumber(now)).toBe(now)
  })
})

describe('useForwardingNow', () => {
  function Probe() {
    useForwardingNow()
    return null
  }

  it('asks every few seconds while WCO has not confirmed the number', async () => {
    const read = vi.spyOn(api, 'forwardingNow').mockResolvedValue(held({ status: 'switching', confirmed_at: null }))
    renderScreen(<Probe />)
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1))
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('asks once a minute once it did', async () => {
    const read = vi.spyOn(api, 'forwardingNow').mockResolvedValue(held())
    renderScreen(<Probe />)
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1))
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(read).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(55_000) })
    expect(read).toHaveBeenCalledTimes(2)
  })
})

describe('NumberPill', () => {
  it('names where the number rings and opens who answers it and since when WCO confirmed it', async () => {
    const { container } = renderScreen(<NumberPill now={held()} where="numer on-call" />)
    const pill = screen.getByRole('button', { name: 'numer on-call' })
    expect(pill).toHaveClass('pill-ok')
    fireEvent.click(pill)
    const details = await screen.findByRole('dialog', { name: 'Numer on-call' })
    expect(within(details).getByRole('heading', { level: 2, name: 'Numer on-call' })).toBeInTheDocument()
    expect(details).toHaveTextContent('Odbiera Anna Kowalska (PRIMARY).')
    expect(details).toHaveTextContent('WCO potwierdziło przekierowanie o 08:55.')
    expect(details).not.toHaveTextContent('Przekazany')
    await expectNoAxeViolations(container)
  })

  it('says a handover is still switching and until when it holds, in a dry run too, but not who started it', async () => {
    renderScreen(<NumberPill now={handedOver({ mode: 'dry_run', status: 'switching', confirmed_at: null })} where="numer on-call u Ciebie" />)
    const pill = screen.getByRole('button', { name: 'numer on-call u Ciebie · przełączam · do 11:00' })
    expect(pill).toHaveClass('pill-pending')
    fireEvent.click(pill)
    const details = await screen.findByRole('dialog', { name: 'Numer on-call' })
    expect(details).toHaveTextContent('Odbiera Marek Nowak (SECONDARY).')
    expect(details).toHaveTextContent('Przekazany od 09:00 do 11:00.')
    expect(details).not.toHaveTextContent('Anna Kowalska')
    expect(details).toHaveTextContent('Przełączam numer: WCO jeszcze nie potwierdziło przekierowania.')
    expect(details).toHaveTextContent('Tryb próbny: WCO nie zostanie zmienione.')
  })

  it('raises a failed switch as an alert and leaves the end out of it', async () => {
    renderScreen(<NumberPill now={handedOver({ status: 'failed', confirmed_at: null })} where="numer on-call: Marek Nowak" />)
    expect(screen.getByRole('alert')).toHaveTextContent('numer on-call: Marek Nowak · nie przełączono')
    fireEvent.click(screen.getByRole('button', { name: 'numer on-call: Marek Nowak · nie przełączono' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('Nie udało się przełączyć numeru.')
  })

  it('says nothing of a confirmation it has no time for', async () => {
    renderScreen(<NumberPill now={handedOver({ confirmed_at: null })} where="numer on-call" />)
    fireEvent.click(screen.getByRole('button', { name: 'numer on-call · do 11:00' }))
    expect(await screen.findByRole('dialog')).not.toHaveTextContent('WCO')
  })
})

describe('handing the number over', () => {
  it('opens a popover with the receiver, four durations and the effect as a sentence', async () => {
    const { container } = actions('primary')
    fireEvent.click(screen.getByRole('button', { name: 'Przekaż numer…' }))
    const popover = await screen.findByRole('dialog', { name: 'Przekaż numer on-call' })
    expect(within(popover).getByRole('heading', { level: 2 })).toHaveTextContent('Przekaż numer on-call')
    expect(popover).toHaveTextContent('Odbierze Marek Nowak · SECONDARY · +48 602 345 678')
    expect(within(popover).getByRole('link', { name: /602/ })).toHaveAttribute('href', 'tel:+48602345678')
    expect(within(durations()).getAllByRole('radio').map((radio) => radio.textContent)).toEqual(['1 h', '2 h', 'do 09:00 jutro', 'inny…'])
    expect(within(durations()).getByRole('radio', { name: '2 h' })).toHaveAttribute('aria-checked', 'true')
    expect(popover).toHaveTextContent('Najpóźniej do 09:00 jutro: wtedy numer przechodzi na kolejnego PRIMARY.')
    expect(popover).toHaveTextContent('Numer wraca do Ciebie o 11:00.')
    fireEvent.click(within(durations()).getByRole('radio', { name: '1 h' }))
    expect(popover).toHaveTextContent('Numer wraca do Ciebie o 10:00.')
    fireEvent.click(within(durations()).getByRole('radio', { name: 'do 09:00 jutro' }))
    expect(popover).toHaveTextContent('Numer wraca do Ciebie o 09:00 jutro.')
    expect(popover).not.toHaveTextContent('Tryb próbny')
    await expectNoAxeViolations(container)
    fireEvent.click(within(popover).getByRole('button', { name: 'Anuluj' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('takes another time within the duty day only', async () => {
    vi.setSystemTime(new Date('2026-09-10T11:40:00+02:00'))
    const start = vi.spyOn(api, 'startHandover')
    actions('primary')
    fireEvent.click(screen.getByRole('button', { name: 'Przekaż numer…' }))
    const popover = await screen.findByRole('dialog')
    fireEvent.click(within(durations()).getByRole('radio', { name: 'inny…' }))
    const field = within(popover).getByLabelText('Do godziny')
    expect(field).toHaveAttribute('type', 'time')
    expect(field).toHaveAttribute('min', '11:40')
    expect(field).toHaveAttribute('max', '09:00')
    const submit = within(popover).getByRole('button', { name: 'Przekaż numer' })
    // Nothing chosen yet: no effect to state and nothing to send.
    expect(popover).not.toHaveTextContent('Numer wraca')
    expect(submit).toHaveAttribute('aria-disabled', 'true')
    fireEvent.change(field, { target: { value: '13:40' } })
    expect(popover).toHaveTextContent('Numer wraca do Ciebie o 13:40.')
    fireEvent.change(field, { target: { value: '08:30' } })
    expect(popover).toHaveTextContent('Numer wraca do Ciebie o 08:30 jutro.')
    fireEvent.change(field, { target: { value: '10:00' } })
    expect(within(popover).getByRole('alert')).toHaveTextContent('Wybierz godzinę późniejszą niż teraz, najpóźniej 09:00 jutro.')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(submit).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(submit)
    expect(start).not.toHaveBeenCalled()
  })

  it('offers only what fits before the duty day ends', async () => {
    vi.setSystemTime(new Date('2026-09-11T07:30:00+02:00'))
    actions('primary')
    fireEvent.click(screen.getByRole('button', { name: 'Przekaż numer…' }))
    const popover = await screen.findByRole('dialog')
    expect(within(durations()).getByRole('radio', { name: '2 h' })).toBeDisabled()
    expect(within(durations()).getByRole('radio', { name: '1 h' })).toBeEnabled()
    expect(within(durations()).getByRole('radio', { name: 'do 09:00' })).toHaveAttribute('aria-checked', 'true')
    expect(popover).toHaveTextContent('Numer wraca do Ciebie o 09:00.')
  })

  it('starts it in one click, says only that it switches, and Undo ends it', async () => {
    vi.spyOn(api, 'publicConfig').mockResolvedValue({
      ldap_enabled: false, sso_enabled: false, app_name: 'On-call', app_subtitle: '', version: 'dev',
      audit_retention_days: 365, login_audit_retention_days: 90, undo_window_seconds: 30,
    })
    const start = vi.spyOn(api, 'startHandover').mockResolvedValue(HANDOVER)
    const end = vi.spyOn(api, 'endHandover').mockResolvedValue(undefined)
    actions('primary')
    fireEvent.click(screen.getByRole('button', { name: 'Przekaż numer…' }))
    const popover = await screen.findByRole('dialog')
    fireEvent.click(within(popover).getByRole('button', { name: 'Przekaż numer' }))

    expect(await screen.findByText('Przełączam numer · odbiera Marek Nowak · do 11:00')).toBeInTheDocument()
    expect(start).toHaveBeenCalledWith(expect.stringMatching(/^2026-09-10T09:00:/))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Przekaż numer on-call' })).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Cofnij' }))
    await waitFor(() => expect(end).toHaveBeenCalledWith('h1'))
    await waitFor(() => expect(screen.queryByText('Przełączam numer · odbiera Marek Nowak · do 11:00')).not.toBeInTheDocument())
  })

  it('says so when Undo could not end it', async () => {
    vi.spyOn(api, 'startHandover').mockResolvedValue(HANDOVER)
    vi.spyOn(api, 'endHandover').mockRejectedValue(new Error('offline'))
    actions('primary')
    fireEvent.click(screen.getByRole('button', { name: 'Przekaż numer…' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Przekaż numer' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cofnij' }))
    expect(await screen.findByText('Nie udało się cofnąć przekazania numeru')).toBeInTheDocument()
  })

  it('keeps a refusal in the popover', async () => {
    vi.spyOn(api, 'startHandover').mockRejectedValue(new Error('Numer on-call jest już przekazany: odbiera Marek Nowak.'))
    actions('primary')
    fireEvent.click(screen.getByRole('button', { name: 'Przekaż numer…' }))
    const popover = await screen.findByRole('dialog')
    fireEvent.click(within(popover).getByRole('button', { name: 'Przekaż numer' }))
    expect(await within(popover).findByRole('alert')).toHaveTextContent('Numer on-call jest już przekazany: odbiera Marek Nowak.')
  })

  it('lets the SECONDARY take it, blocked with the reason while they have no phone number', async () => {
    const start = vi.spyOn(api, 'startHandover')
    const { container } = actions('secondary', held({ mode: 'dry_run' }), false)
    fireEvent.click(screen.getByRole('button', { name: 'Przejmij numer…' }))
    const popover = await screen.findByRole('dialog', { name: 'Przejmij numer on-call' })
    expect(popover).toHaveTextContent('Odbierze Marek Nowak · SECONDARY')
    expect(within(popover).queryByRole('link')).not.toBeInTheDocument()
    expect(popover).toHaveTextContent('Numer wraca do osoby na PRIMARY (Anna Kowalska) o 11:00.')
    expect(popover).toHaveTextContent('Tryb próbny: przekazanie zostanie zapisane, ale WCO nie zostanie zmienione.')
    const submit = within(popover).getByRole('button', { name: 'Przejmij numer' })
    expect(submit).toHaveAttribute('aria-disabled', 'true')
    expect(submit).toHaveAccessibleDescription('Nie masz numeru telefonu w Moje. Uzupełnij go, żeby przejąć numer.')
    fireEvent.click(submit)
    expect(start).not.toHaveBeenCalled()
    await expectNoAxeViolations(container)
  })

  it('names a receiver the duty list does not show without a link, and still lets the number go to their phone', async () => {
    const start = vi.spyOn(api, 'startHandover').mockResolvedValue(HANDOVER)
    actions('primary', held(), true, null)
    fireEvent.click(screen.getByRole('button', { name: 'Przekaż numer…' }))
    const popover = await screen.findByRole('dialog')
    expect(popover).toHaveTextContent('Odbierze Marek Nowak · SECONDARY')
    expect(within(popover).queryByRole('link')).not.toBeInTheDocument()
    fireEvent.click(within(popover).getByRole('button', { name: 'Przekaż numer' }))
    await waitFor(() => expect(start).toHaveBeenCalled())
  })

  it('names the receiver without a phone number to a coordinator', async () => {
    actions('coordinator', held(), false)
    fireEvent.click(screen.getByRole('button', { name: 'Przekaż numer…' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('Marek Nowak nie ma numeru telefonu w Moje. Poproś o jego uzupełnienie.')
  })

  it('opens as a sheet from the bottom on a phone, closed by its button', async () => {
    pretendNarrow()
    vi.spyOn(api, 'startHandover').mockResolvedValue(HANDOVER)
    const { container } = actions('primary')
    fireEvent.click(screen.getByRole('button', { name: 'Przekaż numer…' }))
    const sheet = await screen.findByRole('dialog', { name: 'Przekaż numer on-call' })
    expect(sheet).toHaveClass('sheet')
    expect(within(sheet).queryByRole('button', { name: 'Anuluj' })).not.toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Przekaż numer' })).toHaveClass('btn-block')
    await expectNoAxeViolations(container)
    fireEvent.click(within(sheet).getByRole('button', { name: 'Zamknij' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Przekaż numer…' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Przekaż numer' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Przekaż numer on-call' })).not.toBeInTheDocument())
  })
})

describe('ending a handover', () => {
  it('gives the PRIMARY the number back at once, with a toast and no Undo', async () => {
    const end = vi.spyOn(api, 'endHandover').mockResolvedValue(undefined)
    actions('primary', handedOver())
    fireEvent.click(screen.getByRole('button', { name: 'Zabierz numer z powrotem' }))
    expect(await screen.findByText('Numer on-call znów u Ciebie')).toBeInTheDocument()
    expect(end).toHaveBeenCalledWith('h1')
    expect(screen.queryByRole('button', { name: 'Cofnij' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: /Przekaż/ })).not.toBeInTheDocument()
  })

  it('lets the SECONDARY give it back and names who answers again', async () => {
    vi.spyOn(api, 'endHandover').mockResolvedValue(undefined)
    actions('secondary', handedOver())
    fireEvent.click(screen.getByRole('button', { name: 'Oddaj numer' }))
    expect(await screen.findByText('Numer on-call znów odbiera Anna Kowalska')).toBeInTheDocument()
  })

  it('lets a coordinator end it and reports a refusal', async () => {
    vi.spyOn(api, 'endHandover').mockRejectedValue(new Error('To przekazanie numeru on-call już się zakończyło'))
    actions('coordinator', handedOver())
    fireEvent.click(screen.getByRole('button', { name: 'Zakończ przekazanie' }))
    expect(await screen.findByText('To przekazanie numeru on-call już się zakończyło')).toBeInTheDocument()
  })

  it('offers to check the switch again, re-reading where the number rings, or to end the handover while it failed', async () => {
    const read = vi.spyOn(api, 'forwardingNow').mockResolvedValue(handedOver({ status: 'failed', confirmed_at: null }))
    function Probe() {
      useForwardingNow()
      return null
    }
    renderScreen(<><Probe /><HandoverActions now={handedOver({ status: 'failed', confirmed_at: null })} pair={PAIR} receiverPhone={MAREK_PHONE} viewer="primary" /></>)
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'Zakończ przekazanie' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Spróbuj ponownie' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sprawdź ponownie' }))
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2))
  })
})
