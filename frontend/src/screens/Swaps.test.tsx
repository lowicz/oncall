import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderScreen } from '../test/render'
import { SwapPanel } from './Swaps'
import { api } from '../api'
import type { SwapImpact, SwapRequest } from '../api'

// The suite clock is 2026-09-10 (src/test/setup.ts).

const swap = (over: Partial<SwapRequest> & { id: string }): SwapRequest => ({
  schedule_id: 'sched-1',
  service_date: '2026-09-14',
  role: 'primary',
  requester_name: 'Anna Kowalska',
  replacement_name: 'Piotr Zieliński',
  status: 'pending_replacement',
  note: null,
  decision_note: null,
  created_at: '2026-09-01T10:00:00Z',
  ...over,
})

function stub(swaps: SwapRequest[]) {
  vi.spyOn(api, 'swaps').mockResolvedValue(swaps)
  vi.spyOn(api, 'availability').mockResolvedValue([])
  vi.spyOn(api, 'publishedSchedule').mockResolvedValue({
    generated_at: '2026-09-01T10:00:00Z',
    is_published: true,
    id: 'sched-1',
    version: 3,
    starts_on: '2026-09-01',
    ends_on: '2026-09-30',
    assignments: [],
    current: [],
    today_is_day_off: false,
    today_holiday_name: null,
  })
}

const inbox = (name: RegExp) => screen.getByRole('button', { name })

afterEach(() => vi.restoreAllMocks())

describe('SwapPanel inbox', () => {
  it('opens on "Do mnie" when a request waits for me and decides it in the sheet', async () => {
    stub([swap({ id: '1' })])
    renderScreen(<SwapPanel displayName="Piotr Zieliński" role="member" hasTeamMember />)

    expect(await screen.findByText('1 czeka na Twoją decyzję · 0 czeka na drugą stronę · 0 zamkniętych')).toBeInTheDocument()
    expect(inbox(/^Do mnie/)).toHaveAttribute('aria-pressed', 'true')
    const row = screen.getByRole('row', { name: /pon 14 wrz/ })
    expect(within(row).getByText('czeka na Ciebie')).toBeInTheDocument()

    fireEvent.click(within(row).getByRole('button', { name: /Zdecyduj/ }))
    const sheet = await screen.findByRole('dialog', { name: 'Zamiana · pon 14 wrz PRIMARY' })
    expect(within(sheet).getByRole('button', { name: 'Akceptuję' })).toBeEnabled()
    expect(within(sheet).getByRole('button', { name: 'Odrzuć' })).toBeDisabled()
  })

  it('files a request waiting for someone else under "W toku", with a preview only', async () => {
    stub([swap({ id: '1', replacement_name: 'Ola Wiśniewska' })])
    renderScreen(<SwapPanel displayName="Piotr Zieliński" role="member" hasTeamMember />)

    expect(await screen.findByText('Nikt Cię o nic nie prosi')).toBeInTheDocument()
    fireEvent.click(inbox(/^W toku/))
    expect(await screen.findByRole('cell', { name: 'Ola Wiśniewska' })).toBeInTheDocument()
    expect(screen.getByText('czeka na: Ola Wiśniewska')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Podgląd/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Zdecyduj/ })).not.toBeInTheDocument()
  })

  it('lands a coordinator on "Do zatwierdzenia" and approves from the sheet', async () => {
    stub([swap({ id: '1', status: 'pending_coordinator' })])
    const approve = vi.spyOn(api, 'approveSwap').mockResolvedValue(swap({ id: '1', status: 'approved' }))
    renderScreen(<SwapPanel displayName="Koordynator" role="coordinator" hasTeamMember={false} />)

    fireEvent.click(await screen.findByRole('button', { name: /Zdecyduj/ }))
    expect(inbox(/^Do zatwierdzenia/)).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Piotr zgodził(a) się · czeka na Ciebie')).toBeInTheDocument()
    // A coordinator without a rotation slot has no request to file.
    expect(screen.queryByRole('button', { name: 'Nowa zamiana' })).not.toBeInTheDocument()

    const sheet = await screen.findByRole('dialog', { name: /^Zamiana ·/ })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Zatwierdź i wpisz do grafiku' }))
    await waitFor(() => expect(approve).toHaveBeenCalled())
    expect(approve.mock.calls[0][0]).toBe('1')
    expect(await screen.findByText('Zamiana wpisana do grafiku')).toBeInTheDocument()
  })

  it('counts on "Do zatwierdzenia" only what waits for the coordinator, as the header does', async () => {
    stub([
      swap({ id: '1' }),
      swap({ id: '2', service_date: '2026-09-15', status: 'pending_coordinator' }),
    ])
    renderScreen(<SwapPanel displayName="Koordynator" role="coordinator" hasTeamMember={false} />)

    expect(await screen.findByText('1 czeka na Twoją decyzję · 1 czeka na drugą stronę · 0 zamkniętych')).toBeInTheDocument()
    const tab = inbox(/^Do zatwierdzenia/)
    expect(tab).toHaveAccessibleName('Do zatwierdzenia: 1 sprawa')
    // The request still waiting for the replacement stays listed, just not counted.
    expect(screen.getAllByRole('row', { name: /wrz/ })).toHaveLength(2)
  })

  it('does not badge or open "Do zatwierdzenia" while every request waits for a replacement', async () => {
    stub([swap({ id: '1' })])
    renderScreen(<SwapPanel displayName="Koordynator" role="coordinator" hasTeamMember={false} />)

    expect(await screen.findByText('0 czeka na Twoją decyzję · 1 czeka na drugą stronę · 0 zamkniętych')).toBeInTheDocument()
    const tab = inbox(/^Do zatwierdzenia/)
    expect(tab).toHaveAccessibleName('Do zatwierdzenia: 0 spraw')
    expect(tab).toHaveTextContent('0')
    expect(tab).toHaveAttribute('aria-pressed', 'false')
  })

  it('names each filter with its count spelled out for screen readers', async () => {
    stub([
      swap({ id: '1' }),
      swap({ id: '2', replacement_name: 'Ola Wiśniewska' }),
      swap({ id: '3', requester_name: 'Marek Nowak', replacement_name: 'Ola Wiśniewska', status: 'pending_coordinator' }),
      swap({ id: '4', status: 'approved' }),
    ])
    renderScreen(<SwapPanel displayName="Piotr Zieliński" role="member" hasTeamMember />)

    await screen.findByText('1 czeka na Twoją decyzję · 2 czekają na drugą stronę · 1 zamknięta')
    expect(screen.getByRole('button', { name: 'Do mnie: 1 sprawa' })).toHaveTextContent('Do mnie1')
    expect(screen.getByRole('button', { name: 'Moje: 0 spraw' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'W toku: 2 sprawy' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Zamknięte' })).toBeInTheDocument()
  })

  it('keeps settled requests under "Zamknięte" with no decisions left', async () => {
    stub([swap({ id: '1', status: 'approved' }), swap({ id: '2', status: 'rejected', decision_note: 'Urlop' })])
    renderScreen(<SwapPanel displayName="Piotr Zieliński" role="admin" hasTeamMember />)

    await screen.findByText('Nikt Cię o nic nie prosi')
    fireEvent.click(inbox(/^Zamknięte/))
    expect(await screen.findByText('Zatwierdzona')).toBeInTheDocument()
    expect(screen.getByText('Odrzucona')).toBeInTheDocument()
    expect(screen.getByText('powód: „Urlop”')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Zdecyduj/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: /Podgląd/ })[0])
    const sheet = await screen.findByRole('dialog', { name: /^Zamiana ·/ })
    expect(within(sheet).queryByRole('button', { name: /Akceptuję|Zatwierdź|Odrzuć|Wycofaj/ })).not.toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Zamknij' })).toBeInTheDocument()
  })

  it('rejects only with a reason, typed in the sheet itself', async () => {
    stub([swap({ id: '1' })])
    const reject = vi.spyOn(api, 'rejectSwap').mockResolvedValue(swap({ id: '1', status: 'rejected' }))
    renderScreen(<SwapPanel displayName="Piotr Zieliński" role="member" hasTeamMember />)

    // The reason lives in the sheet, not in the table row.
    expect(screen.queryByLabelText(/Powód odrzucenia/)).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: /Zdecyduj/ }))
    const sheet = await screen.findByRole('dialog', { name: /^Zamiana ·/ })
    const confirm = within(sheet).getByRole('button', { name: 'Odrzuć' })
    expect(confirm).toBeDisabled()

    fireEvent.change(within(sheet).getByLabelText(/Powód odrzucenia/), { target: { value: 'Jestem na urlopie' } })
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)
    await waitFor(() => expect(reject).toHaveBeenCalled())
    expect(reject.mock.calls[0][0]).toEqual({ id: '1', reason: 'Jestem na urlopie' })
    // The sheet closes; the toast that follows is a dialog of its own.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Zamiana ·/ })).not.toBeInTheDocument())
    expect(await screen.findByText('Odrzucono zamianę')).toBeInTheDocument()
  })

  it('lets the author withdraw their own open request from "Moje"', async () => {
    stub([swap({ id: '1', requester_name: 'Anna Kowalska' })])
    const cancel = vi.spyOn(api, 'cancelSwap').mockResolvedValue(swap({ id: '1', status: 'cancelled' }))
    renderScreen(<SwapPanel displayName="Anna Kowalska" role="member" hasTeamMember />)

    fireEvent.click(await screen.findByRole('button', { name: /Podgląd/ }))
    expect(inbox(/^Moje/)).toHaveAttribute('aria-pressed', 'true')
    const sheet = await screen.findByRole('dialog', { name: /^Zamiana ·/ })
    const withdraw = within(sheet).getByRole('button', { name: 'Wycofaj' })
    expect(withdraw).toBeDisabled()
    fireEvent.change(within(sheet).getByLabelText(/Powód wycofania/), { target: { value: 'Zmiana planów' } })
    fireEvent.click(withdraw)
    await waitFor(() => expect(cancel).toHaveBeenCalled())
    expect(cancel.mock.calls[0][0]).toEqual({ id: '1', reason: 'Zmiana planów' })
  })

  it('opens the inbox named in the address', async () => {
    stub([swap({ id: '1', status: 'approved' }), swap({ id: '2' })])
    renderScreen(<SwapPanel displayName="Piotr Zieliński" role="member" hasTeamMember />, { route: '/zamiany?skrzynka=zamkniete' })
    expect(await screen.findByText('Zatwierdzona')).toBeInTheDocument()
    expect(inbox(/^Zamknięte/)).toHaveAttribute('aria-pressed', 'true')
    expect(inbox(/^Do mnie/)).toHaveTextContent('1')
  })

  it('fetches its own published schedule rather than taking it as a prop', async () => {
    stub([])
    renderScreen(<SwapPanel displayName="Anna Kowalska" role="member" hasTeamMember />)
    await waitFor(() => expect(api.publishedSchedule).toHaveBeenCalled())
  })
})

const balance = (actual: number, deviation: number) => ({ actual, expected: 1, deviation })
const member = (name: string, primaryActual: number, deviation: number) => ({
  member_id: name,
  display_name: name,
  active_from: '2024-01-01',
  eligible_days: {},
  primary: balance(primaryActual, deviation),
  secondary: balance(0, 0),
  late_shift: balance(0, 0),
  weekends: balance(0, 0),
  holidays: balance(0, 0),
  total_points: primaryActual,
})

const impact: SwapImpact = {
  service_date: '2099-09-14',
  role: 'primary',
  points: 1,
  window_start: '2098-09-14',
  window_end: '2099-09-14',
  requester: {
    member_id: 'a1',
    display_name: 'Anna Kowalska',
    before: member('Anna Kowalska', 5, 1),
    after: member('Anna Kowalska', 4, 0),
  },
  replacement: {
    member_id: 'p1',
    display_name: 'Piotr Zieliński',
    before: member('Piotr Zieliński', 2, -1),
    after: member('Piotr Zieliński', 3, 0),
  },
}

function stubSchedule() {
  stub([])
  vi.spyOn(api, 'publishedSchedule').mockResolvedValue({
    generated_at: '2026-09-01T10:00:00Z',
    is_published: true,
    id: 'sched-1',
    version: 3,
    starts_on: '2026-09-01',
    ends_on: '2099-12-31',
    assignments: [
      { service_date: '2099-09-14', role: 'primary', assignee_name: 'Anna Kowalska', is_override: false },
    ],
    current: [],
    today_is_day_off: false,
    today_holiday_name: null,
  })
}

describe('SwapPanel new request', () => {
  it('shows the points moving between the two people once both are chosen', async () => {
    stubSchedule()
    vi.spyOn(api, 'swapOptions').mockResolvedValue([
      { member_id: 'p1', display_name: 'Piotr Zieliński', availability: 'prefer', on_duty_that_day: false },
    ])
    const impactCall = vi.spyOn(api, 'swapImpact').mockResolvedValue(impact)

    renderScreen(<SwapPanel displayName="Anna Kowalska" role="member" hasTeamMember />)
    // The form waits behind the primary action; nothing is requested before it opens.
    expect(screen.queryByLabelText(/Mój dyżur/)).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Nowa zamiana' }))
    expect(impactCall).not.toHaveBeenCalled()

    const slot = await screen.findByLabelText(/Mój dyżur/)
    await screen.findByRole('option', { name: /PRIMARY/ })
    fireEvent.change(slot, { target: { value: '2099-09-14|primary' } })
    expect(screen.getByText('Oddajesz: pon 14 wrz · PRIMARY')).toBeInTheDocument()
    // Candidates are ranked, and each carries the balance and the reported
    // preference, so comparing two of them no longer means selecting each one
    // and reading the impact preview twice (MED5-09).
    const option = await screen.findByRole('radio', { name: /Piotr Zieliński/ })
    expect(option).toHaveTextContent('1 pkt poniżej udziału')
    expect(option).toHaveTextContent('Chętnie wezmę')
    fireEvent.click(option)

    await waitFor(() => expect(impactCall).toHaveBeenCalledWith('2099-09-14', 'primary', 'p1'))
    expect(await screen.findByText('Wpływ na bilans')).toBeInTheDocument()
    expect(await screen.findByText('punkty 5 → 4 (-1)')).toBeInTheDocument()
    expect(await screen.findByText('punkty 2 → 3 (+1)')).toBeInTheDocument()
    // A swap is handed over willingly - „oddaje", not the override's „traci".
    expect(await screen.findByText(/oddaje dyżur/)).toBeInTheDocument()
    expect(screen.queryByText(/traci dyżur/)).not.toBeInTheDocument()
  })

  it('sends the request, confirms with a toast naming the replacement and moves to "Moje"', async () => {
    stubSchedule()
    vi.spyOn(api, 'swapOptions').mockResolvedValue([
      { member_id: 'p1', display_name: 'Piotr Zieliński', availability: null, on_duty_that_day: false },
    ])
    vi.spyOn(api, 'swapImpact').mockResolvedValue(impact)
    const create = vi.spyOn(api, 'createSwap').mockResolvedValue(swap({ id: '9', service_date: '2099-09-14' }))

    renderScreen(<SwapPanel displayName="Anna Kowalska" role="member" hasTeamMember />)
    fireEvent.click(await screen.findByRole('button', { name: 'Nowa zamiana' }))
    const slot = await screen.findByLabelText(/Mój dyżur/)
    await screen.findByRole('option', { name: /PRIMARY/ })
    fireEvent.change(slot, { target: { value: '2099-09-14|primary' } })
    fireEvent.click(await screen.findByRole('radio', { name: /Piotr Zieliński/ }))
    fireEvent.change(screen.getByLabelText(/Powód/), { target: { value: 'Wyjazd' } })
    fireEvent.submit(screen.getByRole('form', { name: 'Nowa prośba o zamianę' }))

    await waitFor(() => expect(create).toHaveBeenCalled())
    expect(create.mock.calls[0][0]).toEqual({
      schedule_id: 'sched-1', service_date: '2099-09-14', role: 'primary', replacement_member_id: 'p1', note: 'Wyjazd',
    })
    expect(await screen.findByText('Wysłano do: Piotr Zieliński')).toBeInTheDocument()
    // The inbox switch goes through the router's search params and can land
    // a render after the toast.
    await waitFor(() => expect(inbox(/^Moje/)).toHaveAttribute('aria-pressed', 'true'))
    await waitFor(() => expect(screen.queryByLabelText(/Mój dyżur/)).not.toBeInTheDocument())
  })

  it('opens the form with the duty a link from "Moje" names', async () => {
    stubSchedule()
    vi.spyOn(api, 'swapOptions').mockResolvedValue([])
    renderScreen(<SwapPanel displayName="Anna Kowalska" role="member" hasTeamMember />, { route: '/zamiany?data=2099-09-14&rola=primary' })
    expect(await screen.findByLabelText(/Mój dyżur/)).toHaveValue('2099-09-14|primary')
    expect(await screen.findByText('Brak dostępnych zastępców')).toBeInTheDocument()
  })
})

describe('SwapPanel candidate rules (BLK6-01)', () => {
  async function openForm() {
    renderScreen(<SwapPanel displayName="Anna Kowalska" role="member" hasTeamMember />)
    fireEvent.click(await screen.findByRole('button', { name: 'Nowa zamiana' }))
    const slot = await screen.findByLabelText(/Mój dyżur/)
    await screen.findByRole('option', { name: /PRIMARY/ })
    fireEvent.change(slot, { target: { value: '2099-09-14|primary' } })
  }

  it('shows a blocked candidate with a reason and does not let them be picked', async () => {
    stubSchedule()
    vi.spyOn(api, 'swapImpact').mockRejectedValue(new Error('no impact needed'))
    vi.spyOn(api, 'swapOptions').mockResolvedValue([
      {
        member_id: 'p1',
        display_name: 'Piotr Zieliński',
        availability: null,
        on_duty_that_day: false,
        slots: [{ service_date: '2099-09-14', role: 'primary' }],
        blocking_violations: [
          {
            rule: 'three_in_seven',
            message: 'Więcej niż 3 dyżury on-call w okresie 7 dni.',
            member_name: 'Piotr Zieliński',
            days: ['2099-09-14'],
          },
        ],
        warning_violations: [],
        next_step: 'Wybierz inny dzień albo poproś koordynatora o korektę grafiku.',
      },
    ])
    await openForm()

    const option = await screen.findByRole('radio', { name: /Piotr Zieliński/ })
    expect(option).toBeDisabled()
    expect(option).toHaveTextContent(/nie można/)
  })

  it('warns before sending when the 11-19 anchor couples two slots', async () => {
    stubSchedule()
    vi.spyOn(api, 'swapImpact').mockRejectedValue(new Error('no impact needed'))
    vi.spyOn(api, 'swapOptions').mockResolvedValue([
      {
        member_id: 'p1',
        display_name: 'Piotr Zieliński',
        availability: null,
        on_duty_that_day: false,
        slots: [
          { service_date: '2099-09-14', role: 'primary' },
          { service_date: '2099-09-14', role: 'late_shift' },
        ],
        blocking_violations: [],
        warning_violations: [],
        next_step: null,
      },
    ])
    await openForm()
    fireEvent.click(await screen.findByRole('radio', { name: /Piotr Zieliński/ }))

    expect(await screen.findByText(/Prośba obejmie oba sloty tego dnia/)).toBeInTheDocument()
  })
})
