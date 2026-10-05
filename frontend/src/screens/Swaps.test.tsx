import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { focusManager } from '@tanstack/react-query'
import { renderScreen } from '../test/render'
import { SwapPanel } from './Swaps'
import { api, ApiError } from '../api'
import type { AssignmentRole, RuleViolation, SwapImpact, SwapOption, SwapPolicy, SwapRequest, SwapReturnOption } from '../api'

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

const APPROVAL_REQUIRED: SwapPolicy = { coordinator_approval_required: true, late_shift_anchor: 'secondary' }
const NO_APPROVAL: SwapPolicy = { coordinator_approval_required: false, late_shift_anchor: 'secondary' }

function stub(swaps: SwapRequest[], policy: SwapPolicy = APPROVAL_REQUIRED) {
  vi.spyOn(api, 'swaps').mockResolvedValue(swaps)
  vi.spyOn(api, 'swapPolicy').mockResolvedValue(policy)
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
const stepsOf = (sheet: HTMLElement) =>
  within(within(sheet).getByRole('list', { name: 'Etap wniosku' })).getAllByRole('listitem').map((item) => item.textContent)

afterEach(() => {
  vi.restoreAllMocks()
  focusManager.setFocused(undefined)
})

describe('SwapPanel without the coordinator approval', () => {
  it('shows the coordinator stage while the policy asks for the approval', async () => {
    stub([swap({ id: '1' })])
    renderScreen(<SwapPanel displayName="Piotr Zieliński" role="member" hasTeamMember />)

    fireEvent.click(await screen.findByRole('button', { name: /Zdecyduj/ }))
    const sheet = await screen.findByRole('dialog', { name: /^Zamiana ·/ })
    expect(stepsOf(sheet)).toEqual(['złożona', 'zastępca', 'koordynator', 'w grafiku'])
    expect(within(sheet).queryByText('Po Twojej akceptacji zamiana trafi do grafiku od razu.')).not.toBeInTheDocument()
  })

  it('leaves the coordinator out of the stages and writes the swap in on acceptance', async () => {
    stub([swap({ id: '1' })], NO_APPROVAL)
    const accept = vi.spyOn(api, 'acceptSwap').mockResolvedValue(swap({ id: '1', status: 'approved' }))
    renderScreen(<SwapPanel displayName="Piotr Zieliński" role="member" hasTeamMember />)

    fireEvent.click(await screen.findByRole('button', { name: /Zdecyduj/ }))
    const sheet = await screen.findByRole('dialog', { name: /^Zamiana ·/ })
    await waitFor(() => expect(stepsOf(sheet)).toEqual(['złożona', 'zastępca', 'w grafiku']))
    expect(within(sheet).getByText('Po Twojej akceptacji zamiana trafi do grafiku od razu.')).toBeInTheDocument()

    fireEvent.click(within(sheet).getByRole('button', { name: 'Akceptuję' }))
    await waitFor(() => expect(accept).toHaveBeenCalled())
    expect(accept.mock.calls[0][0]).toEqual({ id: '1', acknowledge: false })
    expect(await screen.findByText('Zamiana wpisana do grafiku')).toBeInTheDocument()
  })

  it('keeps the stage for a request a coordinator already holds', async () => {
    stub([swap({ id: '1', status: 'pending_coordinator' })], NO_APPROVAL)
    renderScreen(<SwapPanel displayName="Koordynator" role="coordinator" hasTeamMember={false} />)

    fireEvent.click(await screen.findByRole('button', { name: /Zdecyduj/ }))
    const sheet = await screen.findByRole('dialog', { name: /^Zamiana ·/ })
    await waitFor(() => expect(stepsOf(sheet)).toEqual(['złożona', 'zastępca', 'koordynator', 'w grafiku']))
    expect(within(sheet).getByRole('button', { name: 'Zatwierdź i wpisz do grafiku' })).toBeEnabled()
  })

  it('gives a coordinator the members\' "W toku" inbox, since nothing waits for them', async () => {
    stub([swap({ id: '1' }), swap({ id: '2', service_date: '2026-09-15', status: 'approved' })], NO_APPROVAL)
    renderScreen(<SwapPanel displayName="Koordynator" role="coordinator" hasTeamMember={false} />)

    expect(await screen.findByText('0 czeka na Twoją decyzję · 1 czeka na drugą stronę · 1 zamknięta')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'W toku: 1 sprawa' })).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /^Do zatwierdzenia/ })).not.toBeInTheDocument()
    fireEvent.click(inbox(/^W toku/))
    expect(screen.getByText('czeka na: Piotr Zieliński')).toBeInTheDocument()
  })
})

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
    expect(approve.mock.calls[0][0]).toEqual({ id: '1', acknowledge: false })
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
  // Nothing to take in return, unless a test offers something.
  vi.spyOn(api, 'swapReturnOptions').mockResolvedValue([])
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
    fireEvent.change(slot, { target: { value: '2099-09-14' } })
    // A day with one role asks nothing about what is given of it.
    expect(screen.queryByRole('radiogroup', { name: 'Oddaję' })).not.toBeInTheDocument()
    // Candidates are ranked, and each carries the balance and the reported
    // preference, so comparing two of them no longer means selecting each one
    // and reading the impact preview twice (MED5-09).
    const option = await screen.findByRole('radio', { name: /Piotr Zieliński/ })
    expect(option).toHaveTextContent('1 pkt poniżej udziału')
    expect(option).toHaveTextContent('Chętnie wezmę')
    fireEvent.click(option)

    await waitFor(() => expect(impactCall).toHaveBeenCalledWith('2099-09-14', 'primary', 'p1', { correction: false }))
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
    fireEvent.change(slot, { target: { value: '2099-09-14' } })
    fireEvent.click(await screen.findByRole('radio', { name: /Piotr Zieliński/ }))
    fireEvent.change(screen.getByLabelText(/Powód/), { target: { value: 'Wyjazd' } })
    fireEvent.submit(screen.getByRole('form', { name: 'Nowa prośba o zamianę' }))

    await waitFor(() => expect(create).toHaveBeenCalled())
    expect(create.mock.calls[0][0]).toEqual({
      schedule_id: 'sched-1',
      service_date: '2099-09-14',
      role: 'primary',
      replacement_member_id: 'p1',
      note: 'Wyjazd',
      acknowledge_rule_violations: false,
    })
    expect(await screen.findByText('Wysłano do: Piotr Zieliński')).toBeInTheDocument()
    // The inbox switch goes through the router's search params and can land
    // a render after the toast.
    await waitFor(() => expect(inbox(/^Moje/)).toHaveAttribute('aria-pressed', 'true'))
    await waitFor(() => expect(screen.queryByLabelText(/Mój dyżur/)).not.toBeInTheDocument())
  })

  it('confirms without a name when the replacement left the list while the request was sent', async () => {
    stubSchedule()
    const options = vi.spyOn(api, 'swapOptions').mockResolvedValue([
      { member_id: 'p1', display_name: 'Piotr Zieliński', availability: null, on_duty_that_day: false },
    ])
    vi.spyOn(api, 'swapImpact').mockResolvedValue(impact)
    let finish: (value: SwapRequest) => void = () => {}
    vi.spyOn(api, 'createSwap').mockReturnValue(new Promise((resolve) => { finish = resolve }))

    renderScreen(<SwapPanel displayName="Anna Kowalska" role="member" hasTeamMember />)
    fireEvent.click(await screen.findByRole('button', { name: 'Nowa zamiana' }))
    const slot = await screen.findByLabelText(/Mój dyżur/)
    await screen.findByRole('option', { name: /PRIMARY/ })
    fireEvent.change(slot, { target: { value: '2099-09-14' } })
    fireEvent.click(await screen.findByRole('radio', { name: /Piotr Zieliński/ }))
    fireEvent.submit(screen.getByRole('form', { name: 'Nowa prośba o zamianę' }))

    // Returning to the tab reloads the candidates, and he is no longer one.
    options.mockResolvedValue([])
    act(() => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
    })
    await waitFor(() => expect(screen.queryByRole('radio', { name: /Piotr Zieliński/ })).not.toBeInTheDocument())
    act(() => finish(swap({ id: '9', service_date: '2099-09-14' })))

    expect(await screen.findByText('Wysłano prośbę o zamianę')).toBeInTheDocument()
  })

  it('opens the form with the duty a link from "Moje" names', async () => {
    stubSchedule()
    vi.spyOn(api, 'swapOptions').mockResolvedValue([])
    renderScreen(<SwapPanel displayName="Anna Kowalska" role="member" hasTeamMember />, { route: '/zamiany?data=2099-09-14&rola=primary' })
    expect(await screen.findByLabelText(/Mój dyżur/)).toHaveValue('2099-09-14')
    expect(await screen.findByText('Brak dostępnych zastępców')).toBeInTheDocument()
  })
})

describe('SwapPanel candidate rules (BLK6-01)', () => {
  async function openForm() {
    renderScreen(<SwapPanel displayName="Anna Kowalska" role="member" hasTeamMember />)
    fireEvent.click(await screen.findByRole('button', { name: 'Nowa zamiana' }))
    const slot = await screen.findByLabelText(/Mój dyżur/)
    await screen.findByRole('option', { name: /PRIMARY/ })
    fireEvent.change(slot, { target: { value: '2099-09-14' } })
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

  const THREE_IN_SEVEN = {
    rule: 'three_in_seven',
    message: 'Więcej niż 3 dyżury on-call w okresie 7 dni.',
    member_name: 'Piotr Zieliński',
    days: ['2099-09-14', '2099-09-15', '2099-09-18', '2099-09-19'],
  }
  const breaking = (over: Partial<SwapOption> = {}): SwapOption => ({
    member_id: 'p1',
    display_name: 'Piotr Zieliński',
    availability: null,
    on_duty_that_day: false,
    slots: [
      { service_date: '2099-09-14', role: 'primary' },
      { service_date: '2099-09-14', role: 'late_shift' },
    ],
    blocking_violations: [],
    rule_violations: [THREE_IN_SEVEN],
    warning_violations: [],
    next_step: null,
    ...over,
  })
  const sendButton = () => screen.getByRole('button', { name: 'Wyślij prośbę' })

  it('lets a candidate who breaks a rest rule be asked, once the requester acknowledges it', async () => {
    stubSchedule()
    vi.spyOn(api, 'swapImpact').mockRejectedValue(new Error('no impact needed'))
    vi.spyOn(api, 'swapOptions').mockResolvedValue([breaking({ on_duty_that_day: true })])
    const create = vi.spyOn(api, 'createSwap').mockResolvedValue(swap({ id: '9', service_date: '2099-09-14' }))
    await openForm()

    const option = await screen.findByRole('radio', { name: /Piotr Zieliński/ })
    expect(option).toBeEnabled()
    // The reason follows the other facts, separated like them.
    expect(option).toHaveTextContent('ma już dyżur tego dnia · łamie regułę: Więcej niż 3 dyżury on-call w okresie 7 dni.')
    expect(option).toHaveTextContent('wymaga potwierdzenia')
    expect(option).not.toHaveTextContent('reguła twarda')
    expect(option).not.toHaveClass('rank-best')
    fireEvent.click(option)

    const box = (await screen.findByText('Ta zamiana łamie reguły grafiku')).parentElement as HTMLElement
    expect(within(box).getByRole('listitem')).toHaveTextContent(
      'Piotr Zieliński: Więcej niż 3 dyżury on-call w okresie 7 dni. (14-09-2099, 15-09-2099, 18-09-2099, 19-09-2099)',
    )
    expect(within(box).getByText('Naruszenie zobaczą Piotr i koordynator, który zatwierdza zamianę. Trafi do dziennika audytu.')).toBeInTheDocument()
    // The tick is the requester's word; a reason is theirs to give or not.
    const reason = screen.getByLabelText(/Powód/)
    expect(reason).not.toBeRequired()
    expect(reason).toHaveAccessibleDescription('Zobaczą zastępca i koordynator.')
    expect(sendButton()).toBeDisabled()
    fireEvent.click(within(box).getByRole('checkbox', { name: 'Rozumiem i świadomie łamię te reguły' }))
    expect(sendButton()).toBeEnabled()

    fireEvent.click(sendButton())
    await waitFor(() => expect(create).toHaveBeenCalled())
    expect(create.mock.calls[0][0]).toEqual({
      schedule_id: 'sched-1',
      service_date: '2099-09-14',
      role: 'primary',
      replacement_member_id: 'p1',
      note: '',
      acknowledge_rule_violations: true,
    })
  })

  it('says the replacement decides alone when no coordinator approves swaps', async () => {
    stubSchedule()
    vi.spyOn(api, 'swapPolicy').mockResolvedValue(NO_APPROVAL)
    vi.spyOn(api, 'swapImpact').mockRejectedValue(new Error('no impact needed'))
    vi.spyOn(api, 'swapOptions').mockResolvedValue([breaking()])
    await openForm()
    fireEvent.click(await screen.findByRole('radio', { name: /Piotr Zieliński/ }))

    expect(await screen.findByText(
      'Naruszenie zobaczy Piotr; po akceptacji zamiana od razu trafi do grafiku, a koordynator dostanie o niej powiadomienie. Trafi do dziennika audytu.',
    )).toBeInTheDocument()
  })

  it('takes the acknowledgement back when another candidate is picked', async () => {
    stubSchedule()
    vi.spyOn(api, 'swapImpact').mockRejectedValue(new Error('no impact needed'))
    vi.spyOn(api, 'swapOptions').mockResolvedValue([
      breaking(),
      breaking({ member_id: 'o1', display_name: 'Ola Wiśniewska', rule_violations: [{ ...THREE_IN_SEVEN, member_name: 'Ola Wiśniewska' }] }),
      breaking({ member_id: 'c1', display_name: 'Celina Czysta', rule_violations: [] }),
    ])
    await openForm()

    // Whoever breaks no rule is listed first, whatever the balance says.
    const group = await screen.findByRole('radiogroup', { name: 'Zastępca' })
    expect(within(group).getAllByRole('radio').map((item) => item.textContent?.slice(0, 2))).toEqual(['1C', '2O', '3P'])

    fireEvent.click(screen.getByRole('radio', { name: /Piotr Zieliński/ }))
    fireEvent.change(screen.getByLabelText(/Powód/), { target: { value: 'Urlop, nikt inny nie może' } })
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Rozumiem i świadomie łamię te reguły' }))
    expect(sendButton()).toBeEnabled()

    fireEvent.click(screen.getByRole('radio', { name: /Ola Wiśniewska/ }))
    expect(screen.getByRole('checkbox', { name: 'Rozumiem i świadomie łamię te reguły' })).not.toBeChecked()
    expect(sendButton()).toBeDisabled()

    // A candidate who breaks nothing asks for neither the tick nor the reason.
    fireEvent.click(screen.getByRole('radio', { name: /Celina Czysta/ }))
    expect(screen.queryByText('Ta zamiana łamie reguły grafiku')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Powód/)).not.toBeRequired()
    expect(sendButton()).toBeEnabled()
  })

  it('reads the candidates again when the request is refused, so a roster that moved shows what to acknowledge', async () => {
    stubSchedule()
    vi.spyOn(api, 'swapImpact').mockRejectedValue(new Error('no impact needed'))
    const search = vi.spyOn(api, 'swapOptions')
      .mockResolvedValueOnce([breaking({ rule_violations: [] })])
      .mockResolvedValue([breaking()])
    vi.spyOn(api, 'createSwap').mockRejectedValue(new ApiError(
      'Zamiana złamie reguły twarde grafiku; potwierdź świadome naruszenie', 409, [THREE_IN_SEVEN],
      'Potwierdź świadome naruszenie reguł twardych albo zrezygnuj z tej zamiany.',
    ))
    await openForm()
    fireEvent.click(await screen.findByRole('radio', { name: /Piotr Zieliński/ }))
    fireEvent.click(sendButton())

    expect(await screen.findByText('Zamiana złamie reguły twarde grafiku; potwierdź świadome naruszenie')).toBeInTheDocument()
    expect(await screen.findByRole('checkbox', { name: 'Rozumiem i świadomie łamię te reguły' })).not.toBeChecked()
    expect(search).toHaveBeenCalledTimes(2)
    expect(sendButton()).toBeDisabled()
  })

  it('takes the acknowledgement back when the candidates read again break other rules', async () => {
    stubSchedule()
    vi.spyOn(api, 'swapImpact').mockRejectedValue(new Error('no impact needed'))
    vi.spyOn(api, 'swapOptions')
      .mockResolvedValueOnce([breaking()])
      .mockResolvedValue([breaking({ rule_violations: [{ ...THREE_IN_SEVEN, days: ['2099-09-14', '2099-09-15', '2099-09-16', '2099-09-18'] }] })])
    await openForm()
    fireEvent.click(await screen.findByRole('radio', { name: /Piotr Zieliński/ }))
    fireEvent.change(screen.getByLabelText(/Powód/), { target: { value: 'Urlop, nikt inny nie może' } })
    const tick = await screen.findByRole('checkbox', { name: 'Rozumiem i świadomie łamię te reguły' })
    fireEvent.click(tick)
    fireEvent.click(tick)
    expect(sendButton()).toBeDisabled()
    fireEvent.click(tick)
    expect(sendButton()).toBeEnabled()
    act(() => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
    })

    expect(await screen.findByText(/16-09-2099/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Rozumiem i świadomie łamię te reguły' })).not.toBeChecked()
    expect(sendButton()).toBeDisabled()
  })
})

describe('SwapPanel stages and sheets', () => {
  it('tells a member a request waits for the coordinator and leaves a withdrawal without a reason bare', async () => {
    stub([
      swap({ id: '1', replacement_name: 'Ola Wiśniewska', status: 'pending_coordinator' }),
      swap({ id: '2', service_date: '2026-09-15', status: 'cancelled' }),
    ])
    renderScreen(<SwapPanel displayName="Piotr Zieliński" role="member" hasTeamMember />)

    await screen.findByText('Nikt Cię o nic nie prosi')
    fireEvent.click(inbox(/^W toku/))
    expect(await screen.findByText('Ola zgodził(a) się · czeka na koordynatora')).toBeInTheDocument()

    fireEvent.click(inbox(/^Zamknięte/))
    const row = await screen.findByRole('row', { name: /wt 15 wrz/ })
    expect(within(row).getByText('Wycofana')).toBeInTheDocument()
    expect(within(row).queryByText(/powód/)).not.toBeInTheDocument()
  })

  it('shows both slots, the reason, the warnings and the missed date of an expired request', async () => {
    stub([swap({
      id: '1',
      service_date: '2026-09-08',
      note: 'Wyjazd służbowy',
      slots: [
        { service_date: '2026-09-08', role: 'primary' },
        { service_date: '2026-09-08', role: 'late_shift' },
      ],
      warnings: [
        { rule: 'rest', message: 'Brak odpoczynku po serii.', member_name: 'Piotr Zieliński', days: ['2026-09-07', '2026-09-08'] },
        { rule: 'weekend_block', message: 'Dzieli blok weekendowy.', member_name: 'Anna Kowalska', days: [] },
      ],
    })])
    renderScreen(<SwapPanel displayName="Piotr Zieliński" role="member" hasTeamMember />, { route: '/zamiany?skrzynka=zamkniete' })

    // It waits for nobody any more: it is counted and listed as closed, not in the inbox of the person it was addressed to.
    expect(await screen.findByText('0 czeka na Twoją decyzję · 0 czeka na drugą stronę · 1 zamknięta')).toBeInTheDocument()
    expect(inbox(/^Do mnie/)).toHaveAccessibleName('Do mnie: 0 spraw')
    const row = await screen.findByRole('row', { name: /wt 8 wrz/ })
    expect(row).toHaveTextContent('wt 8 wrz PRIMARY + 11–19')
    expect(row).toHaveTextContent('termin minął')
    expect(row).not.toHaveTextContent('czeka na Ciebie')
    // A request past its date can no longer be decided, only read.
    fireEvent.click(within(row).getByRole('button', { name: 'Podgląd: wt 8 wrz PRIMARY' }))
    const sheet = await screen.findByRole('dialog', { name: 'Zamiana · wt 8 wrz PRIMARY' })
    expect(within(sheet).getByText('wt 8 wrz · PRIMARY + 11–19')).toBeInTheDocument()
    expect(within(sheet).getByText('Powód od: Anna Kowalska')).toBeInTheDocument()
    expect(within(sheet).getByText('„Wyjazd służbowy”')).toBeInTheDocument()
    expect(within(sheet).getByText('Termin dyżuru minął.')).toBeInTheDocument()
    const warnings = within(sheet).getByText('Ostrzeżenia').parentElement as HTMLElement
    expect(within(warnings).getAllByRole('listitem')[0]).toHaveTextContent('Piotr Zieliński: Brak odpoczynku po serii. (07-09-2026, 08-09-2026)')
    expect(within(warnings).getAllByRole('listitem')[1]).toHaveTextContent(/^Anna Kowalska: Dzieli blok weekendowy\.$/)
    expect(within(sheet).queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: 'Akceptuję' })).not.toBeInTheDocument()
  })

  it.each([
    ['rejected', 'odrzucona', 'Grafik bez zmian'],
    ['cancelled', 'wycofana', 'Plany się zmieniły'],
  ] as const)('ends the stages of a %s request with its outcome and quotes the decision', async (status, outcome, note) => {
    stub([swap({ id: '1', status, decision_note: note })])
    renderScreen(<SwapPanel displayName="Piotr Zieliński" role="member" hasTeamMember />, { route: '/zamiany?skrzynka=zamkniete' })

    fireEvent.click(await screen.findByRole('button', { name: /^Podgląd/ }))
    const sheet = await screen.findByRole('dialog', { name: /^Zamiana ·/ })
    expect(stepsOf(sheet)).toEqual(['złożona', 'zastępca', 'koordynator', outcome])
    expect(within(sheet).getByText('Powód decyzji')).toBeInTheDocument()
    expect(within(sheet).getByText(`„${note}”`)).toBeInTheDocument()
  })

  const BROKEN = [{
    rule: 'three_in_seven',
    message: 'Więcej niż 3 dyżury on-call w okresie 7 dni.',
    member_name: 'Piotr Zieliński',
    days: ['2026-09-14', '2026-09-15'],
  }]
  const acknowledgement = (sheet: HTMLElement) => within(sheet).getByRole('checkbox', { name: 'Rozumiem i świadomie łamię te reguły' })

  it('has the replacement acknowledge the rules the swap breaks before accepting it', async () => {
    stub([swap({ id: '1', rule_violations: BROKEN })])
    const accept = vi.spyOn(api, 'acceptSwap').mockResolvedValue(swap({ id: '1', status: 'pending_coordinator' }))
    renderScreen(<SwapPanel displayName="Piotr Zieliński" role="member" hasTeamMember />)

    const row = await screen.findByRole('row', { name: /pon 14 wrz/ })
    expect(within(row).getByText('łamie reguły')).toBeInTheDocument()
    fireEvent.click(within(row).getByRole('button', { name: /Zdecyduj/ }))
    const sheet = await screen.findByRole('dialog', { name: /^Zamiana ·/ })
    expect(within(sheet).getByText('łamie reguły')).toBeInTheDocument()
    const box = within(sheet).getByText('Ta zamiana łamie reguły grafiku').parentElement as HTMLElement
    // It is the reader's own rest the swap cuts into, and the list says so.
    expect(within(box).getByRole('listitem')).toHaveTextContent(
      'Piotr Zieliński (Ty): Więcej niż 3 dyżury on-call w okresie 7 dni. (14-09-2026, 15-09-2026)',
    )
    expect(within(box).getByText('Twoja akceptacja potwierdza to naruszenie i trafia do dziennika audytu.')).toBeInTheDocument()

    expect(within(sheet).getByRole('button', { name: 'Akceptuję' })).toBeDisabled()
    fireEvent.click(acknowledgement(sheet))
    fireEvent.click(within(sheet).getByRole('button', { name: 'Akceptuję' }))
    await waitFor(() => expect(accept).toHaveBeenCalled())
    expect(accept.mock.calls[0][0]).toEqual({ id: '1', acknowledge: true })
  })

  it('has the coordinator acknowledge them before approving, and forgets the tick with the sheet', async () => {
    stub([swap({ id: '1', status: 'pending_coordinator', rule_violations: BROKEN })])
    const approve = vi.spyOn(api, 'approveSwap').mockResolvedValue(swap({ id: '1', status: 'approved' }))
    renderScreen(<SwapPanel displayName="Koordynator" role="coordinator" hasTeamMember={false} />)

    fireEvent.click(await screen.findByRole('button', { name: /Zdecyduj/ }))
    let sheet = await screen.findByRole('dialog', { name: /^Zamiana ·/ })
    const box = within(sheet).getByText('Ta zamiana łamie reguły grafiku').parentElement as HTMLElement
    expect(within(box).getByRole('listitem')).toHaveTextContent(/^Piotr Zieliński: /)
    expect(within(sheet).getByText('Twoje zatwierdzenie potwierdza to naruszenie i trafia do dziennika audytu.')).toBeInTheDocument()
    fireEvent.click(acknowledgement(sheet))
    expect(within(sheet).getByRole('button', { name: 'Zatwierdź i wpisz do grafiku' })).toBeEnabled()

    fireEvent.click(within(sheet).getByRole('button', { name: 'Zamknij' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Zamiana ·/ })).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Zdecyduj/ }))
    sheet = await screen.findByRole('dialog', { name: /^Zamiana ·/ })
    expect(acknowledgement(sheet)).not.toBeChecked()
    expect(within(sheet).getByRole('button', { name: 'Zatwierdź i wpisz do grafiku' })).toBeDisabled()

    fireEvent.click(acknowledgement(sheet))
    fireEvent.click(within(sheet).getByRole('button', { name: 'Zatwierdź i wpisz do grafiku' }))
    await waitFor(() => expect(approve).toHaveBeenCalled())
    expect(approve.mock.calls[0][0]).toEqual({ id: '1', acknowledge: true })
  })

  it('takes the tick back when the request read again breaks other rules', async () => {
    stub([swap({ id: '1', rule_violations: BROKEN })])
    vi.mocked(api.swaps)
      .mockResolvedValueOnce([swap({ id: '1', rule_violations: BROKEN })])
      .mockResolvedValue([swap({ id: '1', rule_violations: [...BROKEN, { ...BROKEN[0], rule: 'rest_after_run', message: 'Brak odpoczynku po serii.' }] })])
    renderScreen(<SwapPanel displayName="Piotr Zieliński" role="member" hasTeamMember />)

    fireEvent.click(await screen.findByRole('button', { name: /Zdecyduj/ }))
    const sheet = await screen.findByRole('dialog', { name: /^Zamiana ·/ })
    fireEvent.click(acknowledgement(sheet))
    fireEvent.click(acknowledgement(sheet))
    expect(within(sheet).getByRole('button', { name: 'Akceptuję' })).toBeDisabled()
    fireEvent.click(acknowledgement(sheet))
    expect(within(sheet).getByRole('button', { name: 'Akceptuję' })).toBeEnabled()
    act(() => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
    })

    expect(await within(sheet).findByText(/Brak odpoczynku po serii/)).toBeInTheDocument()
    expect(acknowledgement(sheet)).not.toBeChecked()
    expect(within(sheet).getByRole('button', { name: 'Akceptuję' })).toBeDisabled()
  })

  it('shows the requester what their open request breaks, with nothing to tick', async () => {
    stub([swap({ id: '1', rule_violations: BROKEN })])
    renderScreen(<SwapPanel displayName="Anna Kowalska" role="member" hasTeamMember />)

    fireEvent.click(await screen.findByRole('button', { name: /^Podgląd/ }))
    const sheet = await screen.findByRole('dialog', { name: /^Zamiana ·/ })
    expect(within(sheet).getByText('Ta zamiana łamie reguły grafiku')).toBeInTheDocument()
    expect(within(sheet).queryByRole('checkbox')).not.toBeInTheDocument()
    expect(within(sheet).queryByText(/potwierdza to naruszenie/)).not.toBeInTheDocument()
  })

  it('keeps the broken rules on a swap in the schedule and drops them from one that was turned down', async () => {
    stub([
      swap({ id: '1', status: 'approved', rule_violations: BROKEN }),
      swap({ id: '2', service_date: '2026-09-15', status: 'rejected', decision_note: 'Nie mogę', rule_violations: BROKEN }),
    ])
    renderScreen(<SwapPanel displayName="Piotr Zieliński" role="member" hasTeamMember />, { route: '/zamiany?skrzynka=zamkniete' })

    const approved = await screen.findByRole('row', { name: /pon 14 wrz/ })
    const rejected = screen.getByRole('row', { name: /wt 15 wrz/ })
    expect(within(approved).getByText('łamie reguły')).toBeInTheDocument()
    expect(within(rejected).queryByText('łamie reguły')).not.toBeInTheDocument()

    fireEvent.click(within(approved).getByRole('button', { name: /^Podgląd/ }))
    let sheet = await screen.findByRole('dialog', { name: /^Zamiana ·/ })
    expect(within(sheet).getByText('Świadomie złamane reguły')).toBeInTheDocument()
    expect(within(sheet).queryByRole('checkbox')).not.toBeInTheDocument()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Zamknij' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Zamiana ·/ })).not.toBeInTheDocument())

    fireEvent.click(within(rejected).getByRole('button', { name: /^Podgląd/ }))
    sheet = await screen.findByRole('dialog', { name: /^Zamiana ·/ })
    expect(within(sheet).queryByText(/reguły/)).not.toBeInTheDocument()
  })

  it('projects the points of an open request in the table and in the sheet', async () => {
    stub([swap({ id: '1', replacement_member_id: 'p1' })])
    const impactCall = vi.spyOn(api, 'swapImpact').mockResolvedValue(impact)
    renderScreen(<SwapPanel displayName="Piotr Zieliński" role="member" hasTeamMember />)

    const row = await screen.findByRole('row', { name: /pon 14 wrz/ })
    expect(await within(row).findByText(/^Piotr \+1/)).toBeInTheDocument()
    // A request stored with one slot projects that slot alone.
    expect(impactCall).toHaveBeenCalledWith('2026-09-14', 'primary', 'p1', { scope: 'single', correction: false })

    fireEvent.click(within(row).getByRole('button', { name: /Zdecyduj/ }))
    const sheet = await screen.findByRole('dialog', { name: /^Zamiana ·/ })
    expect(await within(sheet).findByText('Wpływ na bilans')).toBeInTheDocument()
    expect(within(sheet).getByText('to Ty')).toBeInTheDocument()
  })

  it('keeps the sheet open with the reason when a decision fails', async () => {
    stub([swap({ id: '1' })])
    vi.spyOn(api, 'acceptSwap').mockRejectedValue(new ApiError('Zamiana została już rozstrzygnięta', 409))
    renderScreen(<SwapPanel displayName="Piotr Zieliński" role="member" hasTeamMember />)

    fireEvent.click(await screen.findByRole('button', { name: /Zdecyduj/ }))
    const sheet = await screen.findByRole('dialog', { name: /^Zamiana ·/ })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Akceptuję' }))
    expect(await within(sheet).findByRole('alert')).toHaveTextContent('Zamiana została już rozstrzygnięta')
    // The refusal means the request moved; the list is read again.
    await waitFor(() => expect(api.swaps).toHaveBeenCalledTimes(2))
  })

  it('closes the sheet from its footer', async () => {
    stub([swap({ id: '1' })])
    renderScreen(<SwapPanel displayName="Piotr Zieliński" role="member" hasTeamMember />)

    fireEvent.click(await screen.findByRole('button', { name: /Zdecyduj/ }))
    const sheet = await screen.findByRole('dialog', { name: /^Zamiana ·/ })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Zamknij' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Zamiana ·/ })).not.toBeInTheDocument())
  })

  it('closes the sheet from its close button', async () => {
    stub([swap({ id: '1' })])
    renderScreen(<SwapPanel displayName="Piotr Zieliński" role="member" hasTeamMember />)

    fireEvent.click(await screen.findByRole('button', { name: /Zdecyduj/ }))
    const sheet = await screen.findByRole('dialog', { name: /^Zamiana ·/ })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Zamknij panel' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Zamiana ·/ })).not.toBeInTheDocument())
  })
})

describe('SwapPanel inbox states', () => {
  it('shows a failed list and loads it again on retry', async () => {
    stub([])
    const list = vi.spyOn(api, 'swaps')
      .mockRejectedValueOnce(new ApiError('Serwer nie odpowiada', 503))
      .mockResolvedValue([swap({ id: '1' })])
    renderScreen(<SwapPanel displayName="Piotr Zieliński" role="member" hasTeamMember />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Serwer nie odpowiada')
    fireEvent.click(within(alert).getByRole('button', { name: 'Spróbuj ponownie' }))
    expect(await screen.findByRole('row', { name: /pon 14 wrz/ })).toBeInTheDocument()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['moje', 'member', true, 'Nie masz otwartych próśb', 'Nowa zamiana zaczyna się od Twojego dyżuru.'],
    ['moje', 'viewer', false, 'Nie masz otwartych próśb', null],
    ['w-toku', 'member', true, 'Brak zamian w toku', null],
    ['w-toku', 'coordinator', false, 'Nic nie czeka na zatwierdzenie', null],
    ['zamkniete', 'member', true, 'Brak zamkniętych zamian', null],
  ] as const)('explains an empty "%s" inbox to a %s', async (box, role, hasTeamMember, title, description) => {
    stub([])
    renderScreen(<SwapPanel displayName="Piotr Zieliński" role={role} hasTeamMember={hasTeamMember} />, { route: `/zamiany?skrzynka=${box}` })

    expect(await screen.findByText(title)).toBeInTheDocument()
    if (description) expect(screen.getByText(description)).toBeInTheDocument()
    else expect(screen.queryByText('Nowa zamiana zaczyna się od Twojego dyżuru.')).not.toBeInTheDocument()
  })
})

describe('SwapPanel composing', () => {
  const option = (over: Partial<SwapOption> & { member_id: string }): SwapOption => ({
    display_name: over.member_id,
    availability: null,
    on_duty_that_day: false,
    ...over,
  })
  const impactFor = (name: string, before: number, after: number): SwapImpact => ({
    ...impact,
    service_date: '2099-09-14',
    replacement: {
      member_id: name,
      display_name: name,
      before: member(name, 2, before),
      after: member(name, 3, after),
    },
  })

  async function openComposer() {
    fireEvent.click(await screen.findByRole('button', { name: 'Nowa zamiana' }))
    const slot = await screen.findByLabelText(/Mój dyżur/)
    await screen.findByRole('option', { name: /PRIMARY/ })
    fireEvent.change(slot, { target: { value: '2099-09-14' } })
  }

  it('puts own duties that collide with "nie mogę" first and marks them', async () => {
    stubSchedule()
    vi.spyOn(api, 'availability').mockResolvedValue([
      { id: 'a1', kind: 'prefer', starts_on: '2099-09-14', ends_on: '2099-09-14', note: null, created_at: '2026-09-01T10:00:00Z' },
      { id: 'a2', kind: 'unavailable', starts_on: '2099-09-20', ends_on: '2099-09-21', note: null, created_at: '2026-09-01T10:00:00Z' },
    ])
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue({
      generated_at: '2026-09-01T10:00:00Z', is_published: true, id: 'sched-1', version: 3,
      starts_on: '2026-09-01', ends_on: '2099-12-31',
      assignments: [
        { service_date: '2099-09-16', role: 'primary', assignee_name: 'Anna Kowalska', is_override: false },
        { service_date: '2099-09-20', role: 'secondary', assignee_name: 'Anna Kowalska', is_override: false },
        { service_date: '2099-09-14', role: 'primary', assignee_name: 'Anna Kowalska', is_override: false },
        { service_date: '2099-09-15', role: 'primary', assignee_name: 'Marek Nowak', is_override: false },
        { service_date: '2026-09-01', role: 'primary', assignee_name: 'Anna Kowalska', is_override: false },
      ],
      current: [], today_is_day_off: false, today_holiday_name: null,
    })
    renderScreen(<SwapPanel displayName="Anna Kowalska" role="member" hasTeamMember />)
    fireEvent.click(await screen.findByRole('button', { name: 'Nowa zamiana' }))
    const slot = await screen.findByLabelText(/Mój dyżur/)
    await waitFor(() => expect(within(slot).getAllByRole('option')).toHaveLength(4))

    const labels = within(slot).getAllByRole('option').map((item) => item.textContent)
    expect(labels[0]).toBe('Wybierz dyżur')
    expect(labels[1]).toMatch(/^niedz 20 wrz · SECONDARY .* · kolizja: nie mogę$/)
    expect(labels[2]).toMatch(/^pon 14 wrz · PRIMARY /)
    expect(labels[2]).not.toMatch(/kolizja/)
    expect(labels[3]).toMatch(/^śr 16 wrz · PRIMARY /)
    expect(screen.getByText('Najpierw wybierz swój dyżur.')).toBeInTheDocument()
  })

  it('says so when there is no upcoming duty to give away, and sends nothing', async () => {
    stub([])
    const create = vi.spyOn(api, 'createSwap')
    renderScreen(<SwapPanel displayName="Anna Kowalska" role="member" hasTeamMember />)
    fireEvent.click(await screen.findByRole('button', { name: 'Nowa zamiana' }))

    expect(await screen.findByRole('option', { name: 'Brak nadchodzących dyżurów' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Wyślij prośbę/ })).toBeDisabled()
    fireEvent.submit(screen.getByRole('form', { name: 'Nowa prośba o zamianę' }))
    expect(create).not.toHaveBeenCalled()
  })

  it('lists own duties by date while the availability is still loading', async () => {
    stubSchedule()
    vi.spyOn(api, 'availability').mockReturnValue(new Promise(() => {}))
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue({
      generated_at: '2026-09-01T10:00:00Z', is_published: true, id: 'sched-1', version: 3,
      starts_on: '2026-09-01', ends_on: '2099-12-31',
      assignments: [
        { service_date: '2099-09-16', role: 'primary', assignee_name: 'Anna Kowalska', is_override: false },
        { service_date: '2099-09-14', role: 'primary', assignee_name: 'Anna Kowalska', is_override: false },
      ],
      current: [], today_is_day_off: false, today_holiday_name: null,
    })
    renderScreen(<SwapPanel displayName="Anna Kowalska" role="member" hasTeamMember />)
    fireEvent.click(await screen.findByRole('button', { name: 'Nowa zamiana' }))
    const slot = await screen.findByLabelText(/Mój dyżur/)
    await waitFor(() => expect(within(slot).getAllByRole('option')).toHaveLength(3))

    const labels = within(slot).getAllByRole('option').slice(1).map((item) => item.textContent)
    expect(labels[0]).toMatch(/^pon 14 wrz · PRIMARY /)
    expect(labels[1]).toMatch(/^śr 16 wrz · PRIMARY /)
    expect(labels.join()).not.toMatch(/kolizja/)
  })

  it('closes the form with its cancel button', async () => {
    stub([])
    renderScreen(<SwapPanel displayName="Anna Kowalska" role="member" hasTeamMember />)
    fireEvent.click(await screen.findByRole('button', { name: 'Nowa zamiana' }))
    const panel = await screen.findByRole('dialog', { name: 'Nowa zamiana' })
    fireEvent.click(within(panel).getByRole('button', { name: 'Anuluj' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nowa zamiana' })).not.toBeInTheDocument())
  })

  it('closes the form from its close button', async () => {
    stub([])
    renderScreen(<SwapPanel displayName="Anna Kowalska" role="member" hasTeamMember />)
    fireEvent.click(await screen.findByRole('button', { name: 'Nowa zamiana' }))
    const panel = await screen.findByRole('dialog', { name: 'Nowa zamiana' })
    fireEvent.click(within(panel).getByRole('button', { name: 'Zamknij panel' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nowa zamiana' })).not.toBeInTheDocument())
  })

  it('ranks candidates by how much the swap evens them out, blocked ones last', async () => {
    stubSchedule()
    vi.spyOn(api, 'swapOptions').mockResolvedValue([
      option({
        member_id: 'Zenon Blokowany',
        blocking_violations: [{ rule: 'three_in_seven', message: 'Więcej niż 3 dyżury w 7 dniach.', member_name: 'Zenon Blokowany', days: [] }],
      }),
      option({ member_id: 'Ewa Bez Bilansu' }),
      option({ member_id: 'Dorota Powyżej', availability: 'prefer', on_duty_that_day: true }),
      option({ member_id: 'Beata Bez Bilansu' }),
      option({ member_id: 'Celina Poniżej' }),
    ])
    vi.spyOn(api, 'swapImpact').mockImplementation(async (_date, _role, memberId) => {
      if (memberId === 'Celina Poniżej') return impactFor(memberId, -2, -1)
      if (memberId === 'Dorota Powyżej') return impactFor(memberId, 2, 1)
      throw new ApiError('Brak projekcji', 404)
    })
    renderScreen(<SwapPanel displayName="Anna Kowalska" role="member" hasTeamMember />)
    await openComposer()

    const group = await screen.findByRole('radiogroup', { name: 'Zastępca' })
    await waitFor(() => expect(within(group).getAllByRole('radio').map((item) => item.textContent?.slice(0, 1) + (item.textContent?.match(/[A-Z][a-ząćęłńóśźż]+/)?.[0] ?? ''))).toEqual([
      '1Celina', '2Dorota', '3Beata', '4Ewa', '–Zenon',
    ]))
    const [celina, dorota, , , zenon] = within(group).getAllByRole('radio')
    expect(celina).toHaveTextContent('2 pkt poniżej udziału')
    expect(celina).toHaveTextContent('poprawia bilans')
    expect(celina).toHaveClass('rank-best')
    expect(dorota).toHaveTextContent('Chętnie wezmę · ma już dyżur tego dnia')
    expect(dorota).toHaveTextContent('2 pkt powyżej udziału')
    expect(dorota).not.toHaveClass('rank-best')
    expect(zenon).toBeDisabled()
    expect(zenon).toHaveTextContent('nie można: Więcej niż 3 dyżury w 7 dniach.')
    expect(zenon).toHaveTextContent('reguła twarda')
  })

  it('names the rules a candidate bends before the request is sent', async () => {
    stubSchedule()
    vi.spyOn(api, 'swapImpact').mockRejectedValue(new ApiError('Brak projekcji', 404))
    vi.spyOn(api, 'swapOptions').mockResolvedValue([
      option({
        member_id: 'p1',
        display_name: 'Piotr Zieliński',
        warning_violations: [{ rule: 'day_off_block', message: 'Dzieli blok dni wolnych.', member_name: 'Piotr Zieliński', days: ['2099-09-12'] }],
      }),
    ])
    renderScreen(<SwapPanel displayName="Anna Kowalska" role="member" hasTeamMember />)
    await openComposer()

    const candidate = await screen.findByRole('radio', { name: /Piotr Zieliński/ })
    expect(candidate).toHaveTextContent('dzieli blok dni wolnych')
    fireEvent.click(candidate)
    expect(await screen.findByText('Wyślesz mimo to - koordynator zobaczy ostrzeżenie')).toBeInTheDocument()
    expect(screen.getByText(/Dzieli blok dni wolnych\./)).toHaveTextContent('Dzieli blok dni wolnych. (12-09-2099)')
  })

  it('says a warning goes unseen by a coordinator when no coordinator approves swaps', async () => {
    stubSchedule()
    vi.spyOn(api, 'swapPolicy').mockResolvedValue(NO_APPROVAL)
    vi.spyOn(api, 'swapImpact').mockRejectedValue(new ApiError('Brak projekcji', 404))
    vi.spyOn(api, 'swapOptions').mockResolvedValue([
      option({
        member_id: 'p1',
        display_name: 'Piotr Zieliński',
        slots: [
          { service_date: '2099-09-14', role: 'primary' },
          { service_date: '2099-09-14', role: 'late_shift' },
        ],
        warning_violations: [{ rule: 'day_off_block', message: 'Dzieli blok dni wolnych.', member_name: 'Piotr Zieliński', days: [] }],
      }),
    ])
    renderScreen(<SwapPanel displayName="Anna Kowalska" role="member" hasTeamMember />)
    await openComposer()

    const candidate = await screen.findByRole('radio', { name: /Piotr Zieliński/ })
    expect(candidate).toHaveTextContent('dzieli blok dni wolnych')
    fireEvent.click(candidate)
    expect(await screen.findByText('Wyślesz mimo to - zamiana nie wymaga zatwierdzenia koordynatora')).toBeInTheDocument()
  })

  it('shows failed candidates and searches again on retry', async () => {
    stubSchedule()
    const search = vi.spyOn(api, 'swapOptions')
      .mockRejectedValueOnce(new ApiError('Nie udało się wyszukać zastępców', 500))
      .mockResolvedValue([])
    renderScreen(<SwapPanel displayName="Anna Kowalska" role="member" hasTeamMember />)
    await openComposer()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Nie udało się wyszukać zastępców')
    fireEvent.click(within(alert).getByRole('button', { name: 'Spróbuj ponownie' }))
    expect(await screen.findByText('Brak dostępnych zastępców')).toBeInTheDocument()
    expect(search).toHaveBeenCalledTimes(2)
  })

  it.each([
    [
      'lists the rules a refused request breaks and the next step',
      new ApiError('Zamiana narusza reguły', 422, [
        { rule: 'three_in_seven', message: 'Więcej niż 3 dyżury w 7 dniach.', member_name: 'Piotr Zieliński', days: ['2099-09-14'] },
      ], 'Wybierz inny dzień.'),
      ['Zamiana narusza reguły', 'Więcej niż 3 dyżury w 7 dniach.', 'Wybierz inny dzień.'],
    ],
    [
      'lists the rules without a next step when the API gives none',
      new ApiError('Zamiana narusza reguły', 422, [
        { rule: 'three_in_seven', message: 'Więcej niż 3 dyżury w 7 dniach.', member_name: 'Piotr Zieliński', days: [] },
      ]),
      ['Zamiana narusza reguły', 'Więcej niż 3 dyżury w 7 dniach.'],
    ],
    ['names a refusal without rules as a plain error', new Error('Brak połączenia'), ['Brak połączenia']],
  ])('%s', async (_, error, texts) => {
    stubSchedule()
    vi.spyOn(api, 'swapImpact').mockRejectedValue(new ApiError('Brak projekcji', 404))
    vi.spyOn(api, 'swapOptions').mockResolvedValue([option({ member_id: 'p1', display_name: 'Piotr Zieliński' })])
    const create = vi.spyOn(api, 'createSwap').mockRejectedValue(error)
    renderScreen(<SwapPanel displayName="Anna Kowalska" role="member" hasTeamMember />)
    await openComposer()
    fireEvent.click(await screen.findByRole('radio', { name: /Piotr Zieliński/ }))
    fireEvent.click(screen.getByRole('button', { name: /Wyślij prośbę/ }))

    await waitFor(() => expect(create).toHaveBeenCalled())
    const form = screen.getByRole('form', { name: 'Nowa prośba o zamianę' })
    for (const text of texts) expect(await within(form).findByText(text, { exact: false })).toBeInTheDocument()
    if (texts.length === 2) expect(within(form).queryByText('Wybierz inny dzień.')).not.toBeInTheDocument()
  })
})

const THREE_IN_SEVEN = {
  rule: 'three_in_seven',
  message: 'Więcej niż 3 dyżury on-call w okresie 7 dni.',
  member_name: 'Piotr Zieliński',
  days: ['2099-09-14', '2099-09-15', '2099-09-18', '2099-09-19'],
}
const DAYS_OFF = { rule: 'single_day_off', message: 'Dzieli blok dni wolnych.', member_name: 'Anna Kowalska', days: ['2099-09-20'] }

/** A duty of Piotr that Anna could take for her Monday 14 September 2099. */
const returnOption = (day: string, over: Partial<SwapReturnOption> = {}): SwapReturnOption => ({
  service_date: day,
  role: 'secondary',
  slots: [{ service_date: day, role: 'secondary' }, { service_date: day, role: 'late_shift' }],
  blocking_violations: [],
  rule_violations: [],
  warning_violations: [],
  ...over,
})

describe('SwapPanel exchange: the "in return" step', () => {
  /** Piotr, to whom the Monday alone would be a fourth duty in the week. */
  const piotr: SwapOption = {
    member_id: 'p1',
    display_name: 'Piotr Zieliński',
    availability: null,
    on_duty_that_day: false,
    slots: [{ service_date: '2099-09-14', role: 'primary' }, { service_date: '2099-09-14', role: 'late_shift' }],
    blocking_violations: [],
    rule_violations: [THREE_IN_SEVEN],
    warning_violations: [],
  }
  const RETURNS = [
    returnOption('2099-09-16'),
    returnOption('2099-09-20', { slots: [{ service_date: '2099-09-20', role: 'secondary' }], warning_violations: [DAYS_OFF] }),
    returnOption('2099-09-18', { rule_violations: [{ ...THREE_IN_SEVEN, member_name: 'Anna Kowalska', days: ['2099-09-17', '2099-09-18'] }] }),
    returnOption('2099-09-21', { blocking_violations: [{ rule: 'same_day_oncall', message: 'Obie role on-call jednego dnia.', member_name: 'Anna Kowalska', days: ['2099-09-21'] }] }),
  ]

  function stubForm(option: SwapOption = piotr) {
    stubSchedule()
    vi.spyOn(api, 'swapOptions').mockResolvedValue([option])
    return vi.spyOn(api, 'swapImpact').mockResolvedValue(impact)
  }
  async function pickPiotr() {
    renderScreen(<SwapPanel displayName="Anna Kowalska" role="member" hasTeamMember />)
    fireEvent.click(await screen.findByRole('button', { name: 'Nowa zamiana' }))
    const slot = await screen.findByLabelText(/Mój dyżur/)
    await screen.findByRole('option', { name: /PRIMARY/ })
    fireEvent.change(slot, { target: { value: '2099-09-14' } })
    fireEvent.click(await screen.findByRole('radio', { name: /Piotr Zieliński/ }))
  }
  const returns = () => screen.findByRole('radiogroup', { name: 'W zamian biorę' })
  const choice = async (name: RegExp) => within(await returns()).findByRole('radio', { name })
  const steps = () => within(screen.getByRole('list', { name: 'Krok' })).getAllByRole('listitem')
  const sendButton = () => screen.getByRole('button', { name: 'Wyślij prośbę' })
  const acknowledgement = () => screen.queryByRole('checkbox', { name: 'Rozumiem i świadomie łamię te reguły' })

  it('offers the replacement\'s duties with a verdict for each, the clean exchange first in line', async () => {
    stubForm()
    let offer: (value: SwapReturnOption[]) => void = () => {}
    const search = vi.spyOn(api, 'swapReturnOptions').mockReturnValue(new Promise((resolve) => { offer = resolve }))
    await pickPiotr()

    expect(await screen.findByRole('status', { name: 'Szukam dyżurów do wzięcia w zamian' })).toBeInTheDocument()
    expect(search).toHaveBeenCalledWith('2099-09-14', 'primary', 'p1', undefined)
    expect(steps().map((item) => [item.textContent, item.getAttribute('aria-current')])).toEqual([
      ['1 dyżur', null], ['2 kandydat', null], ['3 w zamian', 'step'], ['4 powód i wysłanie', null],
    ])
    act(() => offer(RETURNS))

    const group = await returns()
    expect(within(group).getByText('opcjonalnie · od: Piotr')).toBeInTheDocument()
    const [nothing, clean, bends, breaks, blocked] = await within(group).findAllByRole('radio')
    // Handing the duty over is the choice until another is made, and says what it breaks.
    expect(nothing).toBeChecked()
    expect(nothing).toHaveTextContent('–Nic, tylko oddaję dyżurłamie regułę: Więcej niż 3 dyżury on-call w okresie 7 dni.wymaga potwierdzenia')
    expect(clean).toHaveTextContent('1śr 16 wrzSECONDARY + 11–19 · za 26669 dnibez naruszeń reguł')
    expect(clean).toHaveClass('rank-best')
    expect(bends).toHaveTextContent('2niedz 20 wrzSECONDARY · za 26673 dni · Dzieli blok dni wolnych.ostrzeżenie')
    expect(bends).not.toHaveClass('rank-best')
    expect(breaks).toHaveTextContent('łamie regułę: Więcej niż 3 dyżury on-call w okresie 7 dni.wymaga potwierdzenia')
    expect(breaks).toBeEnabled()
    expect(blocked).toHaveTextContent('–pon 21 wrzSECONDARY + 11–19 · za 26674 dni · nie można: Obie role on-call jednego dnia.reguła twarda')
    expect(blocked).toBeDisabled()
  })

  it('sends a clean exchange with nothing to acknowledge, where the hand-over alone broke a rule', async () => {
    const impactCall = stubForm()
    vi.spyOn(api, 'swapReturnOptions').mockResolvedValue(RETURNS)
    const create = vi.spyOn(api, 'createSwap').mockResolvedValue(swap({ id: '9', service_date: '2099-09-14' }))
    await pickPiotr()

    // One way: the rule is acknowledged.
    expect(await screen.findByText('Ta zamiana łamie reguły grafiku')).toBeInTheDocument()
    expect(sendButton()).toBeDisabled()

    fireEvent.click(await choice(/śr 16 wrz/))
    expect(await choice(/śr 16 wrz/)).toBeChecked()
    expect(await choice(/Nic, tylko oddaję dyżur/)).not.toBeChecked()
    expect(screen.queryByText('Ta zamiana łamie reguły grafiku')).not.toBeInTheDocument()
    expect(acknowledgement()).not.toBeInTheDocument()
    expect(screen.getByText('Ta wymiana nie łamie żadnej reguły').parentElement).toHaveTextContent('Prośba idzie zwykłą ścieżką, bez potwierdzeń.')
    const exchange = screen.getByText('Wymiana: pon 14 wrz ⇄ śr 16 wrz').parentElement as HTMLElement
    expect(exchange).toHaveTextContent('Jedna akceptacja zastępcy, jedno zatwierdzenie koordynatora. Oba dyżury przechodzą razem albo wcale.')
    expect(steps().map((item) => item.getAttribute('aria-current'))).toEqual([null, null, null, 'step'])
    expect(screen.getByLabelText(/Powód/)).not.toBeRequired()
    await waitFor(() => expect(impactCall).toHaveBeenCalledWith('2099-09-14', 'primary', 'p1', {
      inReturn: RETURNS[0], correction: false,
    }))

    fireEvent.click(sendButton())
    await waitFor(() => expect(create).toHaveBeenCalled())
    expect(create.mock.calls[0][0]).toEqual({
      schedule_id: 'sched-1',
      service_date: '2099-09-14',
      role: 'primary',
      replacement_member_id: 'p1',
      note: '',
      acknowledge_rule_violations: false,
      in_return: { service_date: '2099-09-16', role: 'secondary' },
    })
  })

  it('has an exchange that still breaks a rule acknowledged, and takes the tick back with the choice', async () => {
    stubForm()
    vi.spyOn(api, 'swapPolicy').mockResolvedValue(NO_APPROVAL)
    vi.spyOn(api, 'swapReturnOptions').mockResolvedValue(RETURNS)
    const create = vi.spyOn(api, 'createSwap').mockResolvedValue(swap({ id: '9', service_date: '2099-09-14' }))
    await pickPiotr()

    fireEvent.click(await choice(/pt 18 wrz/))
    // The exchange's own violation replaces the hand-over's.
    const box = (await screen.findByText('Ta zamiana łamie reguły grafiku')).parentElement as HTMLElement
    expect(within(box).getByRole('listitem')).toHaveTextContent('Anna Kowalska: Więcej niż 3 dyżury on-call w okresie 7 dni. (17-09-2099, 18-09-2099)')
    expect(screen.queryByText('Ta wymiana nie łamie żadnej reguły')).not.toBeInTheDocument()
    expect(screen.getByText(/^Wymiana: /).parentElement).toHaveTextContent('Jedna akceptacja zastępcy załatwia całość. Oba dyżury przechodzą razem albo wcale.')
    fireEvent.change(screen.getByLabelText(/Powód/), { target: { value: 'Urlop, nikt inny nie może' } })
    fireEvent.click(acknowledgement() as HTMLElement)
    expect(sendButton()).toBeEnabled()

    // Back to the hand-over: its rule was never acknowledged.
    fireEvent.click(await choice(/Nic, tylko oddaję dyżur/))
    expect(acknowledgement()).not.toBeChecked()
    expect(sendButton()).toBeDisabled()

    fireEvent.click(await choice(/pt 18 wrz/))
    fireEvent.click(acknowledgement() as HTMLElement)
    fireEvent.click(sendButton())
    await waitFor(() => expect(create).toHaveBeenCalled())
    expect(create.mock.calls[0][0]).toMatchObject({
      acknowledge_rule_violations: true,
      in_return: { service_date: '2099-09-18', role: 'secondary' },
    })
  })

  it('lists what an exchange bends, and suggests none when the hand-over breaks nothing', async () => {
    stubForm({ ...piotr, slots: undefined, rule_violations: [] })
    vi.spyOn(api, 'swapReturnOptions').mockResolvedValue(RETURNS)
    await pickPiotr()

    const [nothing, clean] = await within(await returns()).findAllByRole('radio')
    expect(nothing).toHaveTextContent('–Nic, tylko oddaję dyżurbez naruszeń reguł')
    expect(clean).not.toHaveClass('rank-best')
    // The reason moves the form on: the optional step counts as settled.
    fireEvent.change(screen.getByLabelText(/Powód/), { target: { value: 'Wyjazd' } })
    expect(steps().map((item) => item.getAttribute('aria-current'))).toEqual([null, null, null, 'step'])

    fireEvent.click(await choice(/niedz 20 wrz/))
    const warnings = screen.getByText('Wyślesz mimo to - koordynator zobaczy ostrzeżenie').parentElement as HTMLElement
    expect(within(warnings).getByRole('listitem')).toHaveTextContent('Anna Kowalska: Dzieli blok dni wolnych. (20-09-2099)')
    expect(screen.getByText('Wymiana: pon 14 wrz ⇄ niedz 20 wrz')).toBeInTheDocument()
    expect(sendButton()).toBeEnabled()
  })

  it('says so when the replacement has no duty to give back', async () => {
    stubForm()
    await pickPiotr()

    expect(await screen.findByText('Piotr nie ma nadchodzących dyżurów, które można wziąć w zamian.')).toBeInTheDocument()
    expect(within(await returns()).queryByRole('radio')).not.toBeInTheDocument()
  })

  it('shows a failed list of duties and reads it again on retry', async () => {
    stubForm()
    vi.spyOn(api, 'swapReturnOptions')
      .mockRejectedValueOnce(new ApiError('Nie udało się wczytać dyżurów', 500))
      .mockResolvedValue(RETURNS)
    await pickPiotr()

    const group = await returns()
    expect(await within(group).findByText('Nie udało się wczytać dyżurów')).toBeInTheDocument()
    fireEvent.click(within(group).getByRole('button', { name: 'Spróbuj ponownie' }))
    expect(await choice(/śr 16 wrz/)).toBeInTheDocument()
  })

  it('reads the duties again when the request is refused, and sends nothing a hard rule now rules out', async () => {
    stubForm()
    const search = vi.spyOn(api, 'swapReturnOptions')
      .mockResolvedValueOnce(RETURNS)
      .mockResolvedValue([{ ...RETURNS[0], blocking_violations: RETURNS[3].blocking_violations }])
    vi.spyOn(api, 'createSwap').mockRejectedValue(new ApiError('Zamiana złamie reguły twarde grafiku', 409))
    await pickPiotr()
    fireEvent.click(await choice(/śr 16 wrz/))
    fireEvent.click(sendButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('Zamiana złamie reguły twarde grafiku')
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(sendButton()).toBeDisabled())
    expect(await choice(/śr 16 wrz/)).toHaveTextContent('reguła twarda')
  })
})

describe('SwapPanel exchange: the inbox and the sheet', () => {
  const exchange = (over: Partial<SwapRequest> = {}) => swap({
    id: '1',
    replacement_member_id: 'p1',
    slots: [{ service_date: '2026-09-14', role: 'primary' }, { service_date: '2026-09-14', role: 'late_shift' }],
    return_slots: [{ service_date: '2026-09-16', role: 'secondary' }, { service_date: '2026-09-16', role: 'late_shift' }],
    ...over,
  })
  const rowsOf = (sheet: HTMLElement) => [...sheet.querySelectorAll('.role-row')].map((row) => [...row.children].map((cell) => cell.textContent))

  it('shows the replacement both days in the row and what they get and give in the sheet', async () => {
    stub([exchange()])
    // A working day for a working day: nobody's points move.
    const impactCall = vi.spyOn(api, 'swapImpact').mockResolvedValue({
      ...impact, requester: { ...impact.requester, after: impact.requester.before }, replacement: { ...impact.replacement, after: impact.replacement.before },
    })
    const accept = vi.spyOn(api, 'acceptSwap').mockResolvedValue(exchange({ status: 'pending_coordinator' }))
    renderScreen(<SwapPanel displayName="Piotr Zieliński" role="member" hasTeamMember />)

    const row = await screen.findByRole('row', { name: /pon 14 wrz/ })
    expect(within(row).getByRole('rowheader')).toHaveTextContent('pon 14 wrz PRIMARY + 11–19 ⇄ śr 16 wrz SECONDARY + 11–19za 4 dni · wymiana')
    expect(await within(row).findByText('bez zmian')).toBeInTheDocument()
    expect(impactCall).toHaveBeenCalledWith('2026-09-14', 'primary', 'p1', {
      inReturn: { service_date: '2026-09-16', role: 'secondary' }, scope: 'whole', correction: false,
    })

    fireEvent.click(within(row).getByRole('button', { name: 'Zdecyduj: pon 14 wrz PRIMARY ⇄ śr 16 wrz SECONDARY' }))
    const sheet = await screen.findByRole('dialog', { name: 'Wymiana · pon 14 wrz ⇄ śr 16 wrz' })
    expect(rowsOf(sheet)).toEqual([
      ['Dostajesz', 'pon 14 wrzPRIMARY + 11–19od: Anna Kowalska', 'za 4 dni'],
      ['Oddajesz', 'śr 16 wrzSECONDARY + 11–19dla: Anna Kowalska', 'za 6 dni'],
    ])
    // The rows name the duties; the one-way sheet's "Dyżur" line is not repeated.
    expect(within(sheet).queryByText('Dyżur')).not.toBeInTheDocument()
    expect(within(sheet).getByText('Ta wymiana nie łamie żadnej reguły')).toBeInTheDocument()
    expect(await within(sheet).findByText('Wpływ na bilans')).toBeInTheDocument()

    fireEvent.click(within(sheet).getByRole('button', { name: 'Akceptuję' }))
    await waitFor(() => expect(accept).toHaveBeenCalled())
    expect(accept.mock.calls[0][0]).toEqual({ id: '1', acknowledge: false })
  })

  it('shows the requester what they give and get, and who gains when the days differ in worth', async () => {
    stub([exchange()])
    // Anna gives a working day and takes one worth more: the points come to her.
    vi.spyOn(api, 'swapImpact').mockResolvedValue({ ...impact, requester: impact.replacement, replacement: impact.requester })
    renderScreen(<SwapPanel displayName="Anna Kowalska" role="member" hasTeamMember />)

    const row = await screen.findByRole('row', { name: /pon 14 wrz/ })
    expect(await within(row).findByText(/^Piotr \+1/)).toBeInTheDocument()
    fireEvent.click(within(row).getByRole('button', { name: /^Podgląd/ }))
    const sheet = await screen.findByRole('dialog', { name: /^Wymiana ·/ })
    expect(rowsOf(sheet)).toEqual([
      ['Oddajesz', 'pon 14 wrzPRIMARY + 11–19dla: Piotr Zieliński', 'za 4 dni'],
      ['Dostajesz', 'śr 16 wrzSECONDARY + 11–19od: Piotr Zieliński', 'za 6 dni'],
    ])
    expect(within(sheet).getByRole('button', { name: 'Wycofaj' })).toBeInTheDocument()
  })

  it('shows a coordinator both directions and has a broken rule acknowledged before the one approval', async () => {
    stub([exchange({ status: 'pending_coordinator', rule_violations: [{ ...THREE_IN_SEVEN, days: ['2026-09-14', '2026-09-15'] }] })])
    vi.spyOn(api, 'swapImpact').mockResolvedValue(impact)
    const approve = vi.spyOn(api, 'approveSwap').mockResolvedValue(exchange({ status: 'approved' }))
    renderScreen(<SwapPanel displayName="Koordynator" role="coordinator" hasTeamMember={false} />)

    const row = await screen.findByRole('row', { name: /pon 14 wrz/ })
    expect(within(row).getByRole('rowheader')).toHaveTextContent('pon 14 wrz PRIMARY + 11–19 ⇄ śr 16 wrz SECONDARY + 11–19 łamie regułyza 4 dni · wymiana')
    fireEvent.click(within(row).getByRole('button', { name: /^Zdecyduj/ }))
    const sheet = await screen.findByRole('dialog', { name: /^Wymiana ·/ })
    expect(rowsOf(sheet)).toEqual([
      ['Dyżur', 'pon 14 wrzPRIMARY + 11–19Anna Kowalska → Piotr Zieliński', 'za 4 dni'],
      ['W zamian', 'śr 16 wrzSECONDARY + 11–19Piotr Zieliński → Anna Kowalska', 'za 6 dni'],
    ])
    expect(within(sheet).queryByText('Ta wymiana nie łamie żadnej reguły')).not.toBeInTheDocument()
    const approval = within(sheet).getByRole('button', { name: 'Zatwierdź i wpisz do grafiku' })
    expect(approval).toBeDisabled()
    fireEvent.click(within(sheet).getByRole('checkbox', { name: 'Rozumiem i świadomie łamię te reguły' }))
    fireEvent.click(approval)
    await waitFor(() => expect(approve).toHaveBeenCalled())
    expect(approve.mock.calls[0][0]).toEqual({ id: '1', acknowledge: true })
  })

  it.each([
    ['approved', null, 'w grafiku'],
    ['cancelled', 'Dyżur zmienił właściciela przed akceptacją', 'wycofana'],
  ] as const)('keeps both directions on a %s exchange, with no verdict left to give', async (status, note, outcome) => {
    stub([exchange({ status, decision_note: note, return_slots: [{ service_date: '2026-09-16', role: 'secondary' }] })])
    renderScreen(<SwapPanel displayName="Piotr Zieliński" role="member" hasTeamMember />, { route: '/zamiany?skrzynka=zamkniete' })

    const row = await screen.findByRole('row', { name: /pon 14 wrz/ })
    expect(within(row).getByRole('rowheader')).toHaveTextContent('pon 14 wrz PRIMARY + 11–19 ⇄ śr 16 wrz SECONDARYza 4 dni · wymiana')
    fireEvent.click(within(row).getByRole('button', { name: /^Podgląd/ }))
    const sheet = await screen.findByRole('dialog', { name: /^Wymiana ·/ })
    expect(stepsOf(sheet).at(-1)).toBe(outcome)
    expect(rowsOf(sheet)).toHaveLength(2)
    expect(within(sheet).queryByText('Ta wymiana nie łamie żadnej reguły')).not.toBeInTheDocument()
    expect(within(sheet).queryByText('Wpływ na bilans')).not.toBeInTheDocument()
    expect(within(sheet).queryAllByText(`„${note}”`)).toHaveLength(note ? 1 : 0)
  })

  it('closes the decision once either day of an exchange has passed', async () => {
    // The duty given is still ahead; the one that comes back was two days ago.
    stub([exchange({ return_slots: [{ service_date: '2026-09-08', role: 'secondary' }] })])
    renderScreen(<SwapPanel displayName="Piotr Zieliński" role="member" hasTeamMember />, { route: '/zamiany?skrzynka=zamkniete' })

    const row = await screen.findByRole('row', { name: /pon 14 wrz/ })
    expect(within(row).getByRole('rowheader')).toHaveTextContent('za 4 dni · wymiana · termin minął')
    fireEvent.click(within(row).getByRole('button', { name: /^Podgląd/ }))
    const sheet = await screen.findByRole('dialog', { name: 'Wymiana · pon 14 wrz ⇄ wt 8 wrz' })
    expect(within(sheet).getByText('Termin dyżuru minął.')).toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: 'Akceptuję' })).not.toBeInTheDocument()
    // Nothing is left to weigh: no verdict on the rules and no projected balance.
    expect(within(sheet).queryByText('Ta wymiana nie łamie żadnej reguły')).not.toBeInTheDocument()
    expect(within(sheet).queryByText('Wpływ na bilans')).not.toBeInTheDocument()
  })
})

describe('SwapPanel: what is given of a day', () => {
  type Anchor = 'secondary' | 'primary'
  const held = (service_date: string, role: AssignmentRole) => ({ service_date, role, assignee_name: 'Anna Kowalska', is_override: false })
  const label = (role: AssignmentRole) => ({ primary: 'PRIMARY', secondary: 'SECONDARY', late_shift: '11–19' })[role]
  const SPLIT: RuleViolation[] = ['Anna Kowalska', 'Piotr Zieliński'].map((member_name) => ({
    rule: 'late_shift_anchor', message: 'Zmiana 11–19 i rola kotwicząca są u różnych osób.', member_name, days: ['2099-09-14'],
  }))
  /** Monday: the anchor role and 11-19. Tuesday: the other on-call role and 11-19. Saturday: the anchor role. */
  function stubDays(anchor: Anchor) {
    const other: AssignmentRole = anchor === 'secondary' ? 'primary' : 'secondary'
    stub([], { coordinator_approval_required: true, late_shift_anchor: anchor })
    vi.spyOn(api, 'swapReturnOptions').mockResolvedValue([])
    vi.spyOn(api, 'swapImpact').mockRejectedValue(new ApiError('Brak projekcji', 404))
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue({
      generated_at: '2026-09-01T10:00:00Z',
      is_published: true,
      id: 'sched-1',
      version: 3,
      starts_on: '2026-09-01',
      ends_on: '2099-12-31',
      assignments: [
        held('2099-09-14', 'late_shift'), held('2099-09-14', anchor),
        held('2099-09-15', other), held('2099-09-15', 'late_shift'),
        held('2099-09-19', anchor),
      ],
      current: [],
      today_is_day_off: false,
      today_holiday_name: null,
    })
    // The candidate takes what the scope gives; a split the requester chose is one more rule.
    return vi.spyOn(api, 'swapOptions').mockImplementation(async (serviceDate, role, scope) => [{
      member_id: 'p1',
      display_name: 'Piotr Zieliński',
      availability: null,
      on_duty_that_day: false,
      slots: scope === 'single' ? [{ service_date: serviceDate, role }] : [{ service_date: serviceDate, role }, { service_date: serviceDate, role: 'late_shift' }],
      blocking_violations: [],
      rule_violations: scope === 'single' && serviceDate === '2099-09-14' ? SPLIT : [],
      warning_violations: [],
      next_step: null,
    }])
  }
  async function openDay(day: string, route?: string) {
    renderScreen(<SwapPanel displayName="Anna Kowalska" role="member" hasTeamMember />, route ? { route } : undefined)
    if (!route) fireEvent.click(await screen.findByRole('button', { name: 'Nowa zamiana' }))
    const slot = await screen.findByLabelText(/Mój dyżur/)
    await screen.findByRole('option', { name: /^sob 19 wrz/ })
    if (!route) fireEvent.change(slot, { target: { value: day } })
  }
  const scopeGroup = () => screen.getByRole('radiogroup', { name: 'Oddaję' })
  const scopeChoice = (name: string) => within(scopeGroup()).getByRole('radio', { name })

  it.each(['secondary', 'primary'] as const)('gives the pair the %s anchor binds whole, or one role of it knowingly', async (anchor) => {
    const search = stubDays(anchor)
    const create = vi.spyOn(api, 'createSwap').mockResolvedValue(swap({ id: '9', service_date: '2099-09-14' }))
    await openDay('2099-09-14')

    // One entry a day, naming every role of it.
    expect(screen.getAllByRole('option').map((option) => option.textContent?.split(' (')[0])).toEqual([
      'Wybierz dyżur', `pon 14 wrz · ${label(anchor)} + 11–19`, `wt 15 wrz · ${label(anchor === 'secondary' ? 'primary' : 'secondary')} + 11–19`, `sob 19 wrz · ${label(anchor)}`,
    ])
    expect(within(scopeGroup()).getAllByRole('radio').map((radio) => radio.textContent)).toEqual(['Cały dyżur', `Tylko ${label(anchor)}`, 'Tylko 11–19'])
    expect(scopeChoice('Cały dyżur')).toBeChecked()
    expect(scopeGroup()).toHaveAccessibleDescription(`${label(anchor)} + 11–19. Jedna akceptacja zastępcy obejmuje oba.`)
    await waitFor(() => expect(search).toHaveBeenCalledWith('2099-09-14', anchor, 'whole'))
    fireEvent.click(await screen.findByRole('radio', { name: /Piotr Zieliński/ }))
    expect(await screen.findByRole('radiogroup', { name: 'W zamian biorę' })).toBeInTheDocument()

    fireEvent.click(scopeChoice(`Tylko ${label(anchor)}`))
    expect(scopeGroup()).toHaveAccessibleDescription('Zmiana 11–19 tego dnia zostaje u Ciebie. Rozdzielasz parę: prośba może wymagać potwierdzenia - jeśli tak, pojawi się ono niżej.')
    // Another scope is another request: the candidate is picked again.
    expect(screen.queryByRole('radiogroup', { name: 'W zamian biorę' })).not.toBeInTheDocument()

    fireEvent.click(scopeChoice('Tylko 11–19'))
    expect(scopeChoice('Tylko 11–19')).toBeChecked()
    expect(scopeGroup()).toHaveAccessibleDescription(`${label(anchor)} tego dnia zostaje u Ciebie. Rozdzielasz parę: prośba może wymagać potwierdzenia - jeśli tak, pojawi się ono niżej.`)
    await waitFor(() => expect(search).toHaveBeenCalledWith('2099-09-14', 'late_shift', 'single'))
    // The split is the same for every candidate: said once above, not on each.
    const candidate = await screen.findByRole('radio', { name: /Piotr Zieliński/ })
    expect(candidate).not.toHaveTextContent('łamie regułę')
    expect(candidate).not.toHaveTextContent('wymaga potwierdzenia')
    fireEvent.click(candidate)

    const box = (await screen.findByText('Ta zamiana łamie reguły grafiku')).parentElement as HTMLElement
    expect(within(box).getAllByRole('listitem')).toHaveLength(2)
    fireEvent.click(within(box).getByRole('checkbox', { name: 'Rozumiem i świadomie łamię te reguły' }))
    fireEvent.click(screen.getByRole('button', { name: 'Wyślij prośbę' }))
    await waitFor(() => expect(create).toHaveBeenCalled())
    expect(create.mock.calls[0][0]).toEqual({
      schedule_id: 'sched-1',
      service_date: '2099-09-14',
      role: 'late_shift',
      replacement_member_id: 'p1',
      note: '',
      acknowledge_rule_violations: true,
      scope: 'single',
    })
  })

  it('gives two slots nothing binds one at a time, and both when asked', async () => {
    const search = stubDays('secondary')
    await openDay('2099-09-15')

    expect(scopeChoice('Tylko PRIMARY')).toBeChecked()
    expect(scopeGroup()).toHaveAccessibleDescription('Zmiana 11–19 tego dnia zostaje u Ciebie.')
    await waitFor(() => expect(search).toHaveBeenCalledWith('2099-09-15', 'primary', 'single'))

    fireEvent.click(scopeChoice('Cały dyżur'))
    expect(scopeGroup()).toHaveAccessibleDescription('PRIMARY + 11–19. Jedna akceptacja zastępcy obejmuje oba.')
    await waitFor(() => expect(search).toHaveBeenCalledWith('2099-09-15', 'primary', 'whole'))
  })

  it('opens a link on its day, with the slot it names when nothing binds the pair', async () => {
    const search = stubDays('secondary')
    await openDay('2099-09-15', '/zamiany?data=2099-09-15&rola=late_shift')

    expect(screen.getByLabelText(/Mój dyżur/)).toHaveValue('2099-09-15')
    expect(scopeChoice('Tylko 11–19')).toBeChecked()
    await waitFor(() => expect(search).toHaveBeenCalledWith('2099-09-15', 'late_shift', 'single'))
  })

  it('asks nothing of a day with one role', async () => {
    const search = stubDays('primary')
    await openDay('2099-09-19')

    expect(screen.queryByRole('radiogroup', { name: 'Oddaję' })).not.toBeInTheDocument()
    await waitFor(() => expect(search).toHaveBeenCalledWith('2099-09-19', 'primary', undefined))
  })

  it('names on each duty in return what it adds to a split, not the split again', async () => {
    stubDays('secondary')
    const duty = (service_date: string, rule_violations: RuleViolation[]): SwapReturnOption => ({
      service_date, role: 'secondary', slots: [{ service_date, role: 'secondary' }, { service_date, role: 'late_shift' }],
      blocking_violations: [], rule_violations, warning_violations: [],
    })
    const rest: RuleViolation = { rule: 'rest_after_run', message: 'Mniej niż 2 dni przerwy po serii dyżurów on-call.', member_name: 'Anna Kowalska', days: ['2099-09-21'] }
    vi.spyOn(api, 'swapReturnOptions').mockResolvedValue([duty('2099-09-16', SPLIT), duty('2099-09-21', [...SPLIT, rest])])
    await openDay('2099-09-14')
    fireEvent.click(scopeChoice('Tylko 11–19'))
    fireEvent.click(await screen.findByRole('radio', { name: /Piotr Zieliński/ }))

    const [nothing, adds, breaks] = await within(await screen.findByRole('radiogroup', { name: 'W zamian biorę' })).findAllByRole('radio')
    expect(nothing).toHaveTextContent('łamie regułę: Zmiana 11–19 i rola kotwicząca są u różnych osób.wymaga potwierdzenia')
    expect(adds).toHaveTextContent(/^1śr 16 wrzSECONDARY \+ 11–19 · za \d+ dniwymaga potwierdzenia$/)
    expect(breaks).toHaveTextContent('łamie regułę: Mniej niż 2 dni przerwy po serii dyżurów on-call.wymaga potwierdzenia')
  })

  it('says which candidate takes the on-call role of a whole duty alone', async () => {
    stubDays('primary')
    vi.spyOn(api, 'swapOptions').mockResolvedValue([{
      member_id: 'c1',
      display_name: 'Celina Wiśniewska',
      availability: null,
      on_duty_that_day: false,
      slots: [{ service_date: '2099-09-14', role: 'primary' }],
      blocking_violations: [],
      rule_violations: [],
      warning_violations: SPLIT,
      next_step: null,
    }])
    await openDay('2099-09-14')

    const candidate = await screen.findByRole('radio', { name: /Celina Wiśniewska/ })
    expect(candidate).toHaveTextContent('przejmie tylko PRIMARY, nie pełni 11–19')
    // The exception is no block of days off.
    expect(candidate).not.toHaveTextContent('dzieli blok dni wolnych')
  })
})
