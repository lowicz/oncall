import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderScreen } from '../test/render'
import { SwapPanel } from './Swaps'
import { api } from '../api'
import type { SwapImpact, SwapRequest } from '../api'

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

afterEach(() => vi.restoreAllMocks())

describe('SwapPanel inbox', () => {
  it('puts a request awaiting me under "wymaga Twojej akcji"', async () => {
    stub([swap({ id: '1' })])
    renderScreen(<SwapPanel displayName="Piotr Zieliński" role="member" hasTeamMember />)
    expect(await screen.findByRole('button', { name: 'Akceptuję' })).toBeInTheDocument()
    expect(screen.queryByText('Nic nie czeka na Twoją decyzję')).not.toBeInTheDocument()
  })

  it('keeps a request awaiting someone else out of my action list', async () => {
    stub([swap({ id: '1', replacement_name: 'Ola Wiśniewska' })])
    renderScreen(<SwapPanel displayName="Piotr Zieliński" role="member" hasTeamMember />)
    expect(await screen.findByText('Nic nie czeka na Twoją decyzję')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'W toku' })).toBeInTheDocument()
    expect(screen.getByText('Ola Wiśniewska', { exact: false })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Akceptuję' })).not.toBeInTheDocument()
  })

  it('offers approval to a coordinator once the replacement accepted', async () => {
    stub([swap({ id: '1', status: 'pending_coordinator' })])
    renderScreen(<SwapPanel displayName="Koordynator" role="coordinator" hasTeamMember={false} />)
    expect(await screen.findByRole('button', { name: 'Zatwierdź' })).toBeInTheDocument()
  })

  it('files settled requests under "zakończone" with no actions', async () => {
    stub([swap({ id: '1', status: 'approved' }), swap({ id: '2', status: 'rejected' })])
    renderScreen(<SwapPanel displayName="Piotr Zieliński" role="admin" hasTeamMember />)
    expect(await screen.findByRole('heading', { name: 'Zakończone' })).toBeInTheDocument()
    // Folded away by default; opening it still offers no actions.
    fireEvent.click(screen.getByRole('button', { name: 'Pokaż' }))
    expect(await screen.findByText('Zatwierdzona')).toBeInTheDocument()
    expect(screen.getByText('Odrzucona')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Akceptuję' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Zatwierdź' })).not.toBeInTheDocument()
  })

  it('asks for a reason in a dialog before rejecting, not inline in the row', async () => {
    stub([swap({ id: '1' })])
    const reject = vi.spyOn(api, 'rejectSwap').mockResolvedValue(swap({ id: '1', status: 'rejected' }))
    renderScreen(<SwapPanel displayName="Piotr Zieliński" role="member" hasTeamMember />)

    // No reason field until the action is actually chosen.
    expect(screen.queryByLabelText(/Powód odrzucenia/)).not.toBeInTheDocument()

    fireEvent.click(await screen.findByRole('button', { name: 'Odrzuć' }))
    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: 'Odrzuć' })
    expect(confirm).toBeDisabled()

    fireEvent.change(within(dialog).getByLabelText(/Powód odrzucenia/), {
      target: { value: 'Jestem na urlopie' },
    })
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)
    await waitFor(() => expect(reject).toHaveBeenCalled())
    expect(reject.mock.calls[0][0]).toEqual({ id: '1', reason: 'Jestem na urlopie' })
  })

  it('lets the author withdraw their own open request', async () => {
    stub([swap({ id: '1', requester_name: 'Anna Kowalska' })])
    const cancel = vi.spyOn(api, 'cancelSwap').mockResolvedValue(swap({ id: '1', status: 'cancelled' }))
    renderScreen(<SwapPanel displayName="Anna Kowalska" role="member" hasTeamMember />)

    fireEvent.click(await screen.findByRole('button', { name: 'Wycofaj' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/Powód wycofania/), {
      target: { value: 'Zmiana planów' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Wycofaj' }))
    await waitFor(() => expect(cancel).toHaveBeenCalled())
    expect(cancel.mock.calls[0][0]).toEqual({ id: '1', reason: 'Zmiana planów' })
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

describe('SwapPanel impact preview', () => {
  it('shows the points moving between the two people once both are chosen', async () => {
    stub([])
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue({
      is_published: true,
      generated_at: '2026-09-01T10:00:00Z',
      id: 'sched-1',
      version: 3,
      starts_on: '2026-09-01',
      ends_on: '2099-09-30',
      assignments: [
        { service_date: '2099-09-14', role: 'primary', assignee_name: 'Anna Kowalska', is_override: false },
      ],
      current: [],
      today_is_day_off: false,
      today_holiday_name: null,
    })
    vi.spyOn(api, 'swapOptions').mockResolvedValue([
      {
        member_id: 'p1',
        display_name: 'Piotr Zieliński',
        availability: 'prefer',
        on_duty_that_day: false,
      },
    ])
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
    const impactCall = vi.spyOn(api, 'swapImpact').mockResolvedValue(impact)

    renderScreen(<SwapPanel displayName="Anna Kowalska" role="member" hasTeamMember />)

    // Nothing is requested until a replacement is actually picked.
    expect(impactCall).not.toHaveBeenCalled()

    const slot = await screen.findByLabelText(/Mój dyżur/)
    await screen.findByRole('option', { name: /PRIMARY/ })
    fireEvent.change(slot, { target: { value: '2099-09-14|primary' } })
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
})

describe('SwapPanel candidate rules (BLK6-01)', () => {
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
    vi.spyOn(api, 'swapImpact').mockRejectedValue(new Error('no impact needed'))
  }

  it('shows a blocked candidate with a reason and does not let them be picked', async () => {
    stubSchedule()
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

    renderScreen(<SwapPanel displayName="Anna Kowalska" role="member" hasTeamMember />)
    const slot = await screen.findByLabelText(/Mój dyżur/)
    await screen.findByRole('option', { name: /PRIMARY/ })
    fireEvent.change(slot, { target: { value: '2099-09-14|primary' } })

    const option = await screen.findByRole('radio', { name: /Piotr Zieliński/ })
    expect(option).toBeDisabled()
    expect(option).toHaveTextContent(/nie można/)
  })

  it('warns before sending when the 11-19 anchor couples two slots', async () => {
    stubSchedule()
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

    renderScreen(<SwapPanel displayName="Anna Kowalska" role="member" hasTeamMember />)
    const slot = await screen.findByLabelText(/Mój dyżur/)
    await screen.findByRole('option', { name: /PRIMARY/ })
    fireEvent.change(slot, { target: { value: '2099-09-14|primary' } })
    fireEvent.click(await screen.findByRole('radio', { name: /Piotr Zieliński/ }))

    expect(await screen.findByText(/Prośba obejmie oba sloty tego dnia/)).toBeInTheDocument()
  })
})
