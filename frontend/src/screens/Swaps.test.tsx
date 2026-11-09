import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { focusManager } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { renderScreen } from '../test/render'
import { loadRealStylesheet } from '../test/stylesheet'
import { SwapPanel } from './Swaps'
import { DEFAULT_LANGUAGE, applyLanguage, setLanguage } from '../i18n'
import { api, ApiError } from '../api'
import type { AssignmentRole, RuleViolation, SwapImpact, SwapOption, SwapPolicy, SwapRequest, SwapReturnOption, SwapScope } from '../api'

// The suite clock is 2026-09-10 (src/test/setup.ts).

const Address = () => {
  const { pathname, search } = useLocation()
  return <output aria-label="Adres">{pathname + search}</output>
}

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

/** The list endpoint as the screen asks it: open and closed requests apart, a page of them. */
const serve = (swaps: SwapRequest[]) => async ({ status, limit = 100, offset = 0 }: Parameters<typeof api.swaps>[0] = {}) =>
  swaps.filter((item) => !status || status.includes(item.status)).slice(offset, offset + limit)

const CONFIG = { ldap_enabled: false, app_name: 'On-call', app_subtitle: '', version: 'dev', audit_retention_days: 365, login_audit_retention_days: 90, undo_window_seconds: 10, sso_enabled: false }

function stub(swaps: SwapRequest[], policy: SwapPolicy = APPROVAL_REQUIRED) {
  vi.spyOn(api, 'swaps').mockImplementation(serve(swaps))
  vi.spyOn(api, 'publicConfig').mockResolvedValue(CONFIG)
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

const inbox = (name: RegExp) => screen.getByRole('radio', { name })
const stepsOf = (sheet: HTMLElement) =>
  within(within(sheet).getByRole('list', { name: 'Etap wniosku' })).getAllByRole('listitem').map((item) => item.textContent)

// jsdom has no scrollIntoView; the reason field brings itself into view when it appears.
const scrollIntoView = vi.fn()

beforeEach(() => {
  Element.prototype.scrollIntoView = scrollIntoView
})

afterEach(() => {
  vi.restoreAllMocks()
  scrollIntoView.mockClear()
  focusManager.setFocused(undefined)
  delete (Element.prototype as Partial<Element>).scrollIntoView
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
    renderScreen(<><SwapPanel displayName="Piotr Zieliński" role="member" hasTeamMember /><Address /></>)

    fireEvent.click(await screen.findByRole('button', { name: /Zdecyduj/ }))
    const sheet = await screen.findByRole('dialog', { name: /^Zamiana ·/ })
    await waitFor(() => expect(stepsOf(sheet)).toEqual(['złożona', 'zastępca', 'w grafiku']))
    expect(within(sheet).getByText('Po Twojej akceptacji zamiana trafi do grafiku od razu.')).toBeInTheDocument()

    fireEvent.click(within(sheet).getByRole('button', { name: 'Akceptuję' }))
    await waitFor(() => expect(accept).toHaveBeenCalled())
    expect(accept.mock.calls[0][0]).toEqual({ id: '1', acknowledge: false })
    expect(await screen.findByText('Przyjęto. Zamiana wpisana do grafiku.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Otwórz dzień' }))
    expect(screen.getByLabelText('Adres')).toHaveTextContent('/grafik?dzien=2026-09-14')
  })

  it('names where an accepted swap went by the status the server returns, not the policy the screen loaded', async () => {
    // Approval was switched on while the sheet was open: the swap waits for the coordinator.
    stub([swap({ id: '1' })], NO_APPROVAL)
    vi.spyOn(api, 'acceptSwap').mockResolvedValue(swap({ id: '1', status: 'pending_coordinator' }))
    const { unmount } = renderScreen(<SwapPanel displayName="Piotr Zieliński" role="member" hasTeamMember />)
    fireEvent.click(await screen.findByRole('button', { name: /Zdecyduj/ }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: /^Zamiana ·/ })).getByRole('button', { name: 'Akceptuję' }))
    expect(await screen.findByText('Przyjęto. Czeka na zatwierdzenie koordynatora.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Otwórz dzień' })).not.toBeInTheDocument()
    unmount()

    // Approval was switched off: the swap is already in the schedule.
    stub([swap({ id: '1' })], APPROVAL_REQUIRED)
    vi.spyOn(api, 'acceptSwap').mockResolvedValue(swap({ id: '1', status: 'approved' }))
    renderScreen(<SwapPanel displayName="Piotr Zieliński" role="member" hasTeamMember />)
    fireEvent.click(await screen.findByRole('button', { name: /Zdecyduj/ }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: /^Zamiana ·/ })).getByRole('button', { name: 'Akceptuję' }))
    expect(await screen.findByText('Przyjęto. Zamiana wpisana do grafiku.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Otwórz dzień' })).toBeInTheDocument()
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
    await waitFor(() => expect(screen.getByRole('radio', { name: 'W toku: 1 sprawa' })).toBeInTheDocument())
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
    expect(inbox(/^Do mnie/)).toHaveAttribute('aria-checked', 'true')
    const row = screen.getByRole('row', { name: /pon 14 wrz/ })
    expect(within(row).getByText('czeka na Ciebie')).toBeInTheDocument()

    fireEvent.click(within(row).getByRole('button', { name: /Zdecyduj/ }))
    const sheet = await screen.findByRole('dialog', { name: 'Zamiana · pon 14 wrz PRIMARY' })
    expect(within(sheet).getByRole('button', { name: 'Akceptuję' })).toBeEnabled()
    expect(within(sheet).getByRole('button', { name: 'Odrzuć' })).toBeEnabled()
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
    expect(inbox(/^Do zatwierdzenia/)).toHaveAttribute('aria-checked', 'true')
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
    expect(tab).toHaveAttribute('aria-checked', 'false')
  })

  it('gives "waiting" one tone at every stage and the broken-rules tag the tone of an error', async () => {
    stub([
      swap({ id: '1', replacement_name: 'Ola Wiśniewska', rule_violations: [THREE_IN_SEVEN] }),
      swap({ id: '2', service_date: '2026-09-15', replacement_name: 'Ola Wiśniewska', status: 'pending_coordinator' }),
    ])
    renderScreen(<SwapPanel displayName="Piotr Zieliński" role="member" hasTeamMember />)
    await screen.findByText('Nikt Cię o nic nie prosi')
    fireEvent.click(inbox(/^W toku/))
    expect(await screen.findByText('Oczekuje na zastępcę')).toHaveClass('st', 'st-prop')
    expect(screen.getByText('Oczekuje na koordynatora')).toHaveClass('st', 'st-prop')
    // Salmon is the 11–19 role's colour, so a rule broken by a swap is not drawn in it.
    expect(screen.getByText('łamie reguły')).toHaveClass('tag', 'tag-bad')
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
    expect(screen.getByRole('radio', { name: 'Do mnie: 1 sprawa' })).toHaveTextContent('Do mnie1')
    expect(screen.getByRole('radio', { name: 'Wysłane: 0 spraw' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'W toku: 2 sprawy' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Zamknięte' })).toBeInTheDocument()
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
    // The reason field appears only once Reject is clicked, in the same footer.
    expect(within(sheet).queryByLabelText(/Powód odrzucenia/)).not.toBeInTheDocument()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Odrzuć' }))
    expect(within(sheet).queryByRole('button', { name: 'Odrzuć' })).not.toBeInTheDocument()
    const confirm = within(sheet).getByRole('button', { name: 'Potwierdź odrzucenie' })
    expect(confirm).toBeDisabled()
    expect(within(sheet).getByLabelText(/Powód odrzucenia/)).toHaveFocus()
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })

    fireEvent.change(within(sheet).getByLabelText(/Powód odrzucenia/), { target: { value: 'Jestem na urlopie' } })
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)
    await waitFor(() => expect(reject).toHaveBeenCalled())
    expect(reject.mock.calls[0][0]).toEqual({ id: '1', reason: 'Jestem na urlopie' })
    // The sheet closes; the toast that follows is a dialog of its own.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Zamiana ·/ })).not.toBeInTheDocument())
    expect(await screen.findByText('Odrzucono zamianę')).toBeInTheDocument()
  })

  it('lets the author withdraw their own open request from "Wysłane"', async () => {
    stub([swap({ id: '1', requester_name: 'Anna Kowalska' })])
    const cancel = vi.spyOn(api, 'cancelSwap').mockResolvedValue(swap({ id: '1', status: 'cancelled' }))
    renderScreen(<SwapPanel displayName="Anna Kowalska" role="member" hasTeamMember />)

    fireEvent.click(await screen.findByRole('button', { name: /Podgląd/ }))
    expect(inbox(/^Wysłane/)).toHaveAttribute('aria-checked', 'true')
    const sheet = await screen.findByRole('dialog', { name: /^Zamiana ·/ })
    const withdraw = within(sheet).getByRole('button', { name: 'Wycofaj' })
    expect(withdraw).toBeEnabled()
    fireEvent.change(within(sheet).getByLabelText(/Powód wycofania/), { target: { value: 'Zmiana planów' } })
    fireEvent.click(withdraw)
    await waitFor(() => expect(cancel).toHaveBeenCalled())
    expect(cancel.mock.calls[0][0]).toEqual({ id: '1', reason: 'Zmiana planów' })
    // The request leaves this inbox with the sheet, so focus lands on the inbox heading.
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Skrzynka' })).toHaveFocus())
  })

  it('withdraws without a reason, recording the author as the cause', async () => {
    stub([swap({ id: '1', requester_name: 'Anna Kowalska' })])
    const cancel = vi.spyOn(api, 'cancelSwap').mockResolvedValue(swap({ id: '1', status: 'cancelled' }))
    renderScreen(<SwapPanel displayName="Anna Kowalska" role="member" hasTeamMember />)

    fireEvent.click(await screen.findByRole('button', { name: /Podgląd/ }))
    const sheet = await screen.findByRole('dialog', { name: /^Zamiana ·/ })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Wycofaj' }))
    await waitFor(() => expect(cancel).toHaveBeenCalled())
    expect(cancel.mock.calls[0][0]).toEqual({ id: '1', reason: 'wycofane przez autora' })
  })

  it('opens the inbox named in the address', async () => {
    stub([swap({ id: '1', status: 'approved' }), swap({ id: '2' })])
    renderScreen(<SwapPanel displayName="Piotr Zieliński" role="member" hasTeamMember />, { route: '/zamiany?skrzynka=zamkniete' })
    expect(await screen.findByText('Zatwierdzona')).toBeInTheDocument()
    expect(inbox(/^Zamknięte/)).toHaveAttribute('aria-checked', 'true')
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
    // A card carries the name, the reported preference, one verdict and one
    // number, so candidates compare at a glance; the best one says so in words.
    const option = await screen.findByRole('radio', { name: /Piotr Zieliński/ })
    expect(option).toHaveTextContent('Piotr Zieliński najlepsze dopasowanie')
    expect(option).toHaveTextContent('Chętnie wezmę')
    expect(option).toHaveTextContent('bez naruszeń')
    expect(option).toHaveTextContent('−1 pkt względem udziału')
    expect(screen.queryByText(/poniżej udziału/)).not.toBeInTheDocument()
    fireEvent.click(option)
    // The rest is read under the picked card.
    expect(await screen.findByText('Ma 1 pkt poniżej udziału. Zamiana poprawia bilans.')).toBeInTheDocument()

    await waitFor(() => expect(impactCall).toHaveBeenCalledWith('2099-09-14', 'primary', 'p1', {}))
    // The balance is folded under one line that sums it up.
    const details = screen.getByRole('button', { name: /^Wpływ na bilans/ })
    expect(details).toHaveAttribute('aria-expanded', 'false')
    await waitFor(() => expect(details).toHaveAccessibleName('Wpływ na bilans Ty −1 · Piotr +1'))
    expect(screen.queryByText('punkty 5 → 4 (−1)')).not.toBeInTheDocument()
    fireEvent.click(details)
    expect(await screen.findByText('punkty 5 → 4 (−1)')).toBeInTheDocument()
    expect(await screen.findByText('punkty 2 → 3 (+1)')).toBeInTheDocument()
    // A swap is handed over willingly - „oddaje", not the override's „traci".
    expect(await screen.findByText(/oddaje dyżur/)).toBeInTheDocument()
    expect(screen.queryByText(/traci dyżur/)).not.toBeInTheDocument()
  })

  it('keeps a started request until discarding it is confirmed', async () => {
    stubSchedule()
    vi.spyOn(api, 'swapOptions').mockResolvedValue([])
    renderScreen(<SwapPanel displayName="Anna Kowalska" role="member" hasTeamMember />)
    fireEvent.click(await screen.findByRole('button', { name: 'Nowa zamiana' }))
    const slot = await screen.findByLabelText(/Mój dyżur/)
    await screen.findByRole('option', { name: /PRIMARY/ })
    fireEvent.change(slot, { target: { value: '2099-09-14' } })

    fireEvent.click(screen.getByRole('button', { name: 'Anuluj' }))
    const warning = await screen.findByRole('dialog', { name: 'Odrzucić niezapisane zmiany?' })
    fireEvent.click(within(warning).getByRole('button', { name: 'Anuluj' }))
    expect(screen.getByLabelText(/Mój dyżur/)).toHaveValue('2099-09-14')

    fireEvent.click(screen.getByRole('button', { name: 'Anuluj' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Odrzucić niezapisane zmiany?' })).getByRole('button', { name: 'Odrzuć zmiany' }))
    await waitFor(() => expect(screen.queryByLabelText(/Mój dyżur/)).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Nowa zamiana' }))
    expect(await screen.findByLabelText(/Mój dyżur/)).toHaveValue('')
  })

  it('sends the request, confirms with a toast naming the replacement and moves to "Wysłane"', async () => {
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
    expect(screen.getByRole('button', { name: 'Cofnij' })).toBeInTheDocument()
    // The inbox switch goes through the router's search params and can land
    // a render after the toast.
    await waitFor(() => expect(inbox(/^Wysłane/)).toHaveAttribute('aria-checked', 'true'))
    await waitFor(() => expect(screen.queryByLabelText(/Mój dyżur/)).not.toBeInTheDocument())

    fireEvent.click(inbox(/^Do mnie/))
    await waitFor(() => expect(inbox(/^Do mnie/)).toHaveAttribute('aria-checked', 'true'))
    expect(inbox(/^Wysłane/)).toHaveAttribute('aria-checked', 'false')
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

    // Returning to the tab reloads the candidates, and he is no longer one.
    options.mockResolvedValue([])
    act(() => {
      focusManager.setFocused(false)
      focusManager.setFocused(true)
    })
    await waitFor(() => expect(screen.queryByRole('radio', { name: /Piotr Zieliński/ })).not.toBeInTheDocument())
    fireEvent.submit(screen.getByRole('form', { name: 'Nowa prośba o zamianę' }))
    act(() => finish(swap({ id: '9', service_date: '2099-09-14' })))

    expect(await screen.findByText('Wysłano prośbę o zamianę')).toBeInTheDocument()
  })

  async function sendToPiotr({ undoWindowKnown = true } = {}) {
    stubSchedule()
    if (!undoWindowKnown) vi.mocked(api.publicConfig).mockRejectedValue(new Error('offline'))
    vi.spyOn(api, 'swapOptions').mockResolvedValue([
      { member_id: 'p1', display_name: 'Piotr Zieliński', availability: null, on_duty_that_day: false },
    ])
    vi.spyOn(api, 'swapImpact').mockResolvedValue(impact)
    vi.spyOn(api, 'createSwap').mockResolvedValue(swap({ id: '9', service_date: '2099-09-14' }))
    renderScreen(<SwapPanel displayName="Anna Kowalska" role="member" hasTeamMember />)
    fireEvent.click(await screen.findByRole('button', { name: 'Nowa zamiana' }))
    const slot = await screen.findByLabelText(/Mój dyżur/)
    await screen.findByRole('option', { name: /PRIMARY/ })
    fireEvent.change(slot, { target: { value: '2099-09-14' } })
    fireEvent.click(await screen.findByRole('radio', { name: /Piotr Zieliński/ }))
    fireEvent.submit(screen.getByRole('form', { name: 'Nowa prośba o zamianę' }))
    expect(await screen.findByText('Wysłano do: Piotr Zieliński')).toBeInTheDocument()
  }

  it('withdraws a request sent by mistake from the toast, with the reason it was undone', async () => {
    const cancel = vi.spyOn(api, 'cancelSwap').mockResolvedValue(swap({ id: '9', status: 'cancelled' }))
    await sendToPiotr()
    const listed = vi.mocked(api.swaps).mock.calls.length

    fireEvent.click(screen.getByRole('button', { name: 'Cofnij' }))
    await waitFor(() => expect(cancel).toHaveBeenCalledWith({ id: '9', reason: 'cofnięte zaraz po wysłaniu' }))
    await waitFor(() => expect(screen.queryByText('Wysłano do: Piotr Zieliński')).not.toBeInTheDocument())
    // The inbox reads the request again, now closed.
    await waitFor(() => expect(vi.mocked(api.swaps).mock.calls.length).toBeGreaterThan(listed))
  })

  it('records the Polish reason when the request is undone from the English interface', async () => {
    setLanguage('en')
    try {
      stubSchedule()
      vi.spyOn(api, 'swapOptions').mockResolvedValue([
        { member_id: 'p1', display_name: 'Piotr Zieliński', availability: null, on_duty_that_day: false },
      ])
      vi.spyOn(api, 'swapImpact').mockResolvedValue(impact)
      vi.spyOn(api, 'createSwap').mockResolvedValue(swap({ id: '9', service_date: '2099-09-14' }))
      const cancel = vi.spyOn(api, 'cancelSwap').mockResolvedValue(swap({ id: '9', status: 'cancelled' }))
      renderScreen(<SwapPanel displayName="Anna Kowalska" role="member" hasTeamMember />)
      fireEvent.click(await screen.findByRole('button', { name: 'New swap' }))
      const slot = await screen.findByLabelText(/My duty/)
      await screen.findByRole('option', { name: /PRIMARY/ })
      fireEvent.change(slot, { target: { value: '2099-09-14' } })
      fireEvent.click(await screen.findByRole('radio', { name: /Piotr Zieliński/ }))
      fireEvent.submit(screen.getByRole('form', { name: 'New swap request' }))
      expect(await screen.findByText('Sent to: Piotr Zieliński')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
      await waitFor(() => expect(cancel).toHaveBeenCalledWith({ id: '9', reason: 'cofnięte zaraz po wysłaniu' }))
    } finally {
      window.localStorage.clear()
      applyLanguage(DEFAULT_LANGUAGE)
    }
  })

  it('says when the request could not be undone and keeps "Cofnij" for another try', async () => {
    vi.spyOn(api, 'cancelSwap').mockRejectedValue(new ApiError('Tej prośby nie można już wycofać.', 409))
    await sendToPiotr()

    fireEvent.click(screen.getByRole('button', { name: 'Cofnij' }))
    expect(await screen.findByText('Nie udało się cofnąć prośby')).toBeInTheDocument()
    expect(screen.getByText('Tej prośby nie można już wycofać.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cofnij' })).toBeInTheDocument()
  })

  it('says the e-mail has gone out once the window to undo the request closes', async () => {
    await sendToPiotr()
    // The pointer over the notifications keeps the toast open past the window.
    fireEvent.mouseEnter(screen.getByText('Wysłano do: Piotr Zieliński').closest('.toasts') as HTMLElement)

    await act(() => vi.advanceTimersByTimeAsync(10_100))
    expect(await screen.findByText('E-maile już wyszły')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cofnij' })).not.toBeInTheDocument()
  })

  it('only confirms the request while the length of the Undo window is unknown', async () => {
    await sendToPiotr({ undoWindowKnown: false })
    expect(screen.queryByRole('button', { name: 'Cofnij' })).not.toBeInTheDocument()
  })

  it('says in the footer that there is no published schedule to swap from', async () => {
    stubSchedule()
    // The endpoint answers 200 without an id while nothing is published.
    vi.spyOn(api, 'publishedSchedule').mockResolvedValue({
      generated_at: '2026-09-01T10:00:00Z',
      is_published: false,
      id: null,
      version: null,
      starts_on: null,
      ends_on: null,
      assignments: [],
      current: [],
      today_is_day_off: false,
      today_holiday_name: null,
    })
    renderScreen(<SwapPanel displayName="Anna Kowalska" role="member" hasTeamMember />)
    fireEvent.click(await screen.findByRole('button', { name: 'Nowa zamiana' }))

    const send = screen.getByRole('button', { name: 'Wyślij prośbę' })
    await waitFor(() => expect(send).toHaveAccessibleDescription('Brak opublikowanego grafiku.'))
    expect(send).toBeDisabled()
  })

  it('shows a schedule that could not be read as an error to retry, not as no schedule', async () => {
    stubSchedule()
    const published = vi.mocked(api.publishedSchedule)
    const answer = await published()
    published.mockReset().mockRejectedValueOnce(new ApiError('Serwer nie odpowiada', 503)).mockResolvedValue(answer)
    renderScreen(<SwapPanel displayName="Anna Kowalska" role="member" hasTeamMember />)
    fireEvent.click(await screen.findByRole('button', { name: 'Nowa zamiana' }))

    const form = screen.getByRole('form', { name: 'Nowa prośba o zamianę' })
    const alert = await within(form).findByRole('alert')
    expect(alert).toHaveTextContent('Serwer nie odpowiada')
    const send = screen.getByRole('button', { name: 'Wyślij prośbę' })
    expect(send).toBeDisabled()
    expect(screen.queryByText('Brak opublikowanego grafiku.')).not.toBeInTheDocument()

    fireEvent.click(within(alert).getByRole('button', { name: 'Spróbuj ponownie' }))
    await waitFor(() => expect(within(form).queryByRole('alert')).not.toBeInTheDocument())
    expect(await screen.findByRole('option', { name: /PRIMARY/ })).toBeInTheDocument()
  })

  it('opens the form with the duty a link from "Moje dyżury" names', async () => {
    stubSchedule()
    vi.spyOn(api, 'swapOptions').mockResolvedValue([])
    renderScreen(<SwapPanel displayName="Anna Kowalska" role="member" hasTeamMember />, { route: '/zamiany?data=2099-09-14&rola=primary' })
    expect(await screen.findByLabelText(/Mój dyżur/)).toHaveValue('2099-09-14')
    expect(await screen.findByText('Brak dostępnych zastępców')).toBeInTheDocument()
  })

  it('closes a form the link filled in without asking, as nothing was changed in it', async () => {
    stubSchedule()
    vi.spyOn(api, 'swapOptions').mockResolvedValue([])
    renderScreen(<SwapPanel displayName="Anna Kowalska" role="member" hasTeamMember />, { route: '/zamiany?data=2099-09-14&rola=primary' })
    expect(await screen.findByLabelText(/Mój dyżur/)).toHaveValue('2099-09-14')
    const reload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(reload)
    expect(reload.defaultPrevented).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Anuluj' }))
    await waitFor(() => expect(screen.queryByLabelText(/Mój dyżur/)).not.toBeInTheDocument())
    expect(screen.queryByRole('dialog', { name: 'Odrzucić niezapisane zmiany?' })).not.toBeInTheDocument()
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
    expect(option).toHaveAttribute('aria-disabled', 'true')
    expect(option).not.toBeDisabled()
    // The card says why, once: the reason in place of its detail, and one verdict.
    expect(option).toHaveTextContent('Piotr ZielińskiWięcej niż 3 dyżury on-call w okresie 7 dni.reguła twarda')
  })

  it('uses one tab stop and arrows to select candidates while skipping blocked cards', async () => {
    const user = userEvent.setup()
    stubSchedule()
    vi.spyOn(api, 'swapImpact').mockResolvedValue(impact)
    vi.spyOn(api, 'swapOptions').mockResolvedValue([
      { member_id: 'a1', display_name: 'Adam Aktywny', availability: null, on_duty_that_day: false },
      {
        member_id: 'b1',
        display_name: 'Beata Zablokowana',
        availability: null,
        on_duty_that_day: false,
        blocking_violations: [{
          rule: 'three_in_seven',
          message: 'Nie można wybrać.',
          member_name: 'Beata Zablokowana',
          days: ['2099-09-14'],
        }],
      },
      { member_id: 'c1', display_name: 'Celina Aktywna', availability: null, on_duty_that_day: false },
    ])
    await openForm()

    const group = await screen.findByRole('radiogroup', { name: 'Zastępca' })
    const adam = within(group).getByRole('radio', { name: /Adam Aktywny/ })
    const beata = within(group).getByRole('radio', { name: /Beata Zablokowana/ })
    const celina = within(group).getByRole('radio', { name: /Celina Aktywna/ })
    expect(within(group).getAllByRole('radio').filter((candidate) => candidate.tabIndex === 0)).toEqual([adam])
    expect(beata).toHaveAttribute('aria-disabled', 'true')
    loadRealStylesheet()
    expect(getComputedStyle(beata).cursor).toBe('not-allowed')
    expect(getComputedStyle(adam).cursor).toBe('pointer')

    adam.focus()
    await user.keyboard('{ArrowRight}')
    expect(celina).toHaveFocus()
    expect(celina).toHaveAttribute('aria-checked', 'true')
    await user.keyboard('{ArrowRight}')
    expect(adam).toHaveFocus()
    expect(beata).toHaveAttribute('aria-checked', 'false')
    await user.click(beata)
    expect(beata).toHaveAttribute('aria-checked', 'false')
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
    // One verdict on the card; the rule itself is named once it is picked.
    expect(option).toHaveTextContent('wymaga potwierdzenia')
    expect(option).not.toHaveTextContent('Łamie regułę')
    expect(option).not.toHaveTextContent('reguła twarda')
    expect(option).not.toHaveClass('rank-best')
    expect(sendButton()).toHaveAccessibleDescription('Wybierz zastępcę, żeby wysłać.')
    fireEvent.click(option)
    expect(screen.getByText(
      'Łamie regułę: Więcej niż 3 dyżury on-call w okresie 7 dni. (14-09-2099, 15-09-2099, 18-09-2099, 19-09-2099). Ma już dyżur tego dnia.',
    )).toBeInTheDocument()

    const box = (await screen.findByText('Ta zamiana łamie reguły grafiku')).parentElement as HTMLElement
    expect(within(box).getByRole('listitem')).toHaveTextContent(
      'Piotr Zieliński: Więcej niż 3 dyżury on-call w okresie 7 dni. (14-09-2099, 15-09-2099, 18-09-2099, 19-09-2099)',
    )
    expect(within(box).getByText('Naruszenie zobaczą Piotr i koordynator, który zatwierdza zamianę. Trafi do dziennika audytu.')).toBeInTheDocument()
    expect(within(box).getByRole('link', { name: 'Które reguły można potwierdzić?' })).toHaveAttribute('href', '/docs/uzytkownik/zamiany.html#zamiana-łamiąca-reguły')
    // The tick is the requester's word; a reason is theirs to give or not.
    const reason = screen.getByLabelText(/Powód/)
    expect(reason).not.toBeRequired()
    expect(reason).toHaveAccessibleDescription('Zobaczą zastępca i koordynator.')
    // The footer says what is missing, not just a button that does not work.
    expect(sendButton()).toBeDisabled()
    expect(sendButton()).toHaveAccessibleDescription('Zaznacz potwierdzenie reguł, żeby wysłać.')
    fireEvent.click(within(box).getByRole('checkbox', { name: 'Rozumiem i świadomie łamię te reguły' }))
    expect(sendButton()).toBeEnabled()
    expect(sendButton()).not.toHaveAccessibleDescription()

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

    // The candidate already chosen, chosen again, keeps the tick.
    fireEvent.click(screen.getByRole('radio', { name: /Piotr Zieliński/ }))
    expect(screen.getByRole('checkbox', { name: 'Rozumiem i świadomie łamię te reguły' })).toBeChecked()

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

    const refusal = await screen.findByText('Zamiana złamie reguły twarde grafiku; potwierdź świadome naruszenie')
    // The refusal with its rules is announced and focused like any other submit error.
    expect(refusal.closest('[role="alert"]')).toHaveFocus()
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

    await waitFor(() => expect(screen.getAllByText(/16-09-2099/)).toHaveLength(2))
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
    expect(within(box).getByText(/Twoja akceptacja potwierdza to naruszenie i trafia do dziennika audytu\./)).toBeInTheDocument()
    expect(within(box).getByRole('link', { name: 'Które reguły można potwierdzić?' })).toHaveAttribute('href', '/docs/uzytkownik/zamiany.html#zamiana-łamiąca-reguły')

    expect(within(sheet).getByRole('button', { name: 'Akceptuję' })).toBeDisabled()
    fireEvent.click(acknowledgement(sheet))
    fireEvent.click(within(sheet).getByRole('button', { name: 'Akceptuję' }))
    await waitFor(() => expect(accept).toHaveBeenCalled())
    expect(accept.mock.calls[0][0]).toEqual({ id: '1', acknowledge: true })
    // The request now waits for the coordinator, and the toast says so.
    expect(await screen.findByText('Przyjęto. Czeka na zatwierdzenie koordynatora.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Otwórz dzień' })).not.toBeInTheDocument()
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
    renderScreen(<SwapPanel displayName="Piotr Zieliński" role="member" hasTeamMember />)

    fireEvent.click(await screen.findByRole('button', { name: /Zdecyduj/ }))
    const sheet = await screen.findByRole('dialog', { name: /^Zamiana ·/ })
    fireEvent.click(acknowledgement(sheet))
    fireEvent.click(acknowledgement(sheet))
    expect(within(sheet).getByRole('button', { name: 'Akceptuję' })).toBeDisabled()
    fireEvent.click(acknowledgement(sheet))
    expect(within(sheet).getByRole('button', { name: 'Akceptuję' })).toBeEnabled()
    vi.mocked(api.swaps).mockImplementation(serve([
      swap({ id: '1', rule_violations: [...BROKEN, { ...BROKEN[0], rule: 'rest_after_run', message: 'Brak odpoczynku po serii.' }] }),
    ]))
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

  it('projects the points of an open request for the coordinator who approves it, in the table and in the sheet', async () => {
    stub([swap({ id: '1', replacement_member_id: 'p1', status: 'pending_coordinator' })])
    const impactCall = vi.spyOn(api, 'swapImpact').mockResolvedValue(impact)
    renderScreen(<SwapPanel displayName="Koordynator" role="coordinator" hasTeamMember={false} />)

    const row = await screen.findByRole('row', { name: /pon 14 wrz/ })
    expect(await within(row).findByText(/^Piotr \+1/)).toBeInTheDocument()
    // A request stored with one slot projects that slot alone.
    expect(impactCall).toHaveBeenCalledWith('2026-09-14', 'primary', 'p1', { scope: 'single' })
    // What the column means is a hint beside its header, not a footnote.
    expect(screen.getByRole('columnheader', { name: /Skutek pkt/ })).toContainElement(screen.getByRole('button', { name: 'Co pokazuje skutek' }))

    fireEvent.click(within(row).getByRole('button', { name: /Zdecyduj/ }))
    const sheet = await screen.findByRole('dialog', { name: /^Zamiana ·/ })
    expect(await within(sheet).findByText('Wpływ na bilans')).toBeInTheDocument()
  })

  it.each([
    ['a member', 'member', APPROVAL_REQUIRED],
    ['a coordinator who approves nothing', 'coordinator', NO_APPROVAL],
  ] as const)('leaves the points out of the inbox for %s', async (_who, role, policy) => {
    stub([swap({ id: '1', replacement_member_id: 'p1' })], policy)
    const impactCall = vi.spyOn(api, 'swapImpact').mockResolvedValue(impact)
    renderScreen(<SwapPanel displayName="Koordynator" role={role} hasTeamMember />, { route: '/zamiany?skrzynka=w-toku' })

    await screen.findByRole('row', { name: /pon 14 wrz/ })
    await waitFor(() => expect(api.swapPolicy).toHaveBeenCalled())
    expect(screen.queryByRole('columnheader', { name: /Skutek pkt/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/Etap zamiany zawsze mówi/)).not.toBeInTheDocument()
    expect(impactCall).not.toHaveBeenCalled()
  })

  it('draws and projects nothing of the approval for a coordinator before the policy is read', async () => {
    stub([swap({ id: '1', replacement_member_id: 'p1', status: 'pending_coordinator' })])
    vi.mocked(api.swapPolicy).mockReturnValue(new Promise(() => {}))
    const impactCall = vi.spyOn(api, 'swapImpact').mockResolvedValue(impact)
    renderScreen(<SwapPanel displayName="Koordynator" role="coordinator" hasTeamMember={false} />, { route: '/zamiany?skrzynka=w-toku' })

    await screen.findByRole('row', { name: /pon 14 wrz/ })
    expect(screen.queryByRole('columnheader', { name: /Skutek pkt/ })).not.toBeInTheDocument()
    expect(impactCall).not.toHaveBeenCalled()
    // The inbox keeps the default policy's words meanwhile.
    expect(inbox(/Do zatwierdzenia/)).toBeInTheDocument()
  })

  it('keeps the sheet open with the reason when a decision fails', async () => {
    stub([swap({ id: '1' })])
    vi.spyOn(api, 'acceptSwap').mockRejectedValue(new ApiError('Zamiana została już rozstrzygnięta', 409))
    renderScreen(<SwapPanel displayName="Piotr Zieliński" role="member" hasTeamMember />)

    fireEvent.click(await screen.findByRole('button', { name: /Zdecyduj/ }))
    const sheet = await screen.findByRole('dialog', { name: /^Zamiana ·/ })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Akceptuję' }))
    expect(await within(sheet).findByRole('alert')).toHaveTextContent('Zamiana została już rozstrzygnięta')
    // The refusal means the request moved; the open and the closed list are read again.
    await waitFor(() => expect(api.swaps).toHaveBeenCalledTimes(4))
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
    // Both lists are read again; a request in both is shown once.
    expect(list).toHaveBeenCalledTimes(4)
    expect(screen.getAllByRole('row', { name: /pon 14 wrz/ })).toHaveLength(1)
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
    expect(celina).toHaveTextContent('−2 pkt')
    expect(celina).toHaveTextContent('najlepsze dopasowanie')
    expect(celina).toHaveClass('rank-best')
    expect(dorota).toHaveTextContent('Chętnie wezmę')
    expect(dorota).toHaveTextContent('bez naruszeń+2 pkt')
    expect(dorota).not.toHaveTextContent('najlepsze dopasowanie')
    expect(dorota).not.toHaveClass('rank-best')
    expect(zenon).toHaveAttribute('aria-disabled', 'true')
    expect(zenon).not.toBeDisabled()
    expect(zenon).toHaveTextContent('–Zenon BlokowanyWięcej niż 3 dyżury w 7 dniach.reguła twarda')
    expect(zenon).not.toHaveTextContent('pkt')

    fireEvent.click(celina)
    expect(await screen.findByText('Ma 2 pkt poniżej udziału. Zamiana poprawia bilans.')).toBeInTheDocument()
    fireEvent.click(dorota)
    expect(await screen.findByText(/^Ma już dyżur tego dnia\./)).toHaveTextContent('Ma już dyżur tego dnia. Ma już 2 pkt powyżej udziału.')
    expect(screen.queryByText(/poniżej udziału/)).not.toBeInTheDocument()
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
    expect(candidate).toHaveTextContent('ostrzeżenie')
    fireEvent.click(candidate)
    expect(await screen.findByText('Dzieli blok dni wolnych.')).toHaveClass('rank-detail')
    // The warning waits under the folded line, which counts it.
    const details = screen.getByRole('button', { name: /^Wpływ na bilans i ostrzeżenia/ })
    expect(details).toHaveTextContent('1 ostrzeżenie')
    fireEvent.click(details)
    const warnings = (await screen.findByText('Wyślesz mimo to - koordynator zobaczy ostrzeżenie')).parentElement as HTMLElement
    expect(within(warnings).getByRole('listitem')).toHaveTextContent('Dzieli blok dni wolnych. (12-09-2099)')
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

    fireEvent.click(await screen.findByRole('radio', { name: /Piotr Zieliński/ }))
    fireEvent.click(await screen.findByRole('button', { name: /^Wpływ na bilans i ostrzeżenia/ }))
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
    const user = userEvent.setup()
    stubForm()
    let offer: (value: SwapReturnOption[]) => void = () => {}
    const search = vi.spyOn(api, 'swapReturnOptions').mockReturnValue(new Promise((resolve) => { offer = resolve }))
    await pickPiotr()

    expect(await screen.findByRole('status', { name: 'Szukam dyżurów do wzięcia w zamian…' })).toBeInTheDocument()
    expect(search).toHaveBeenCalledWith('2099-09-14', 'primary', 'p1', undefined)
    // The optional step is settled with the replacement: sending is next.
    expect(steps().map((item) => [item.textContent, item.getAttribute('aria-current')])).toEqual([
      ['1 dyżur', null], ['2 zastępca', null], ['3 w zamian (opcjonalnie)', null], ['4 wysłanie', 'step'],
    ])
    act(() => offer(RETURNS))

    const group = await returns()
    expect(screen.getByText('opcjonalnie · od: Piotr')).toBeInTheDocument()
    const [nothing, clean, bends, breaks, blocked] = await within(group).findAllByRole('radio')
    // Handing the duty over is the choice until another is made, with one verdict each.
    expect(nothing).toBeChecked()
    expect(nothing).toHaveTextContent('–Nic, tylko oddaję dyżurwymaga potwierdzenia')
    expect(clean).toHaveTextContent('1śr 16 wrz najlepsze dopasowanieSECONDARY + 11–19 · za 26669 dnibez naruszeń')
    expect(clean).toHaveClass('rank-best')
    expect(bends).toHaveTextContent('2niedz 20 wrzSECONDARY · za 26673 dniostrzeżenie')
    expect(bends).not.toHaveClass('rank-best')
    expect(breaks).toHaveTextContent('3pt 18 wrzSECONDARY + 11–19 · za 26671 dniwymaga potwierdzenia')
    expect(breaks).toBeEnabled()
    expect(blocked).toHaveTextContent('–pon 21 wrzObie role on-call jednego dnia.reguła twarda')
    expect(blocked).toHaveAttribute('aria-disabled', 'true')
    expect(blocked).not.toBeDisabled()
    loadRealStylesheet()
    expect(getComputedStyle(blocked).cursor).toBe('not-allowed')
    expect(getComputedStyle(clean).cursor).toBe('pointer')

    nothing.focus()
    await user.keyboard('{ArrowLeft}')
    expect(breaks).toHaveFocus()
    expect(breaks).toBeChecked()
    expect(blocked).not.toBeChecked()
    await user.click(blocked)
    expect(breaks).toBeChecked()
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
    // One frame sums the exchange up.
    expect(screen.getByText('Ta wymiana nie łamie żadnej reguły').parentElement).toHaveTextContent(
      'Jedna akceptacja zastępcy, jedno zatwierdzenie koordynatora. Oba dyżury przechodzą razem albo wcale. Prośba idzie zwykłą ścieżką, bez potwierdzeń.',
    )
    expect(steps().map((item) => item.getAttribute('aria-current'))).toEqual([null, null, null, 'step'])
    expect(screen.getByLabelText(/Powód/)).not.toBeRequired()
    await waitFor(() => expect(impactCall).toHaveBeenCalledWith('2099-09-14', 'primary', 'p1', {
      inReturn: RETURNS[0],
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
    expect(box).toHaveTextContent('Jedna akceptacja zastępcy załatwia całość. Oba dyżury przechodzą razem albo wcale.')
    fireEvent.change(screen.getByLabelText(/Powód/), { target: { value: 'Urlop, nikt inny nie może' } })
    fireEvent.click(acknowledgement() as HTMLElement)
    expect(sendButton()).toBeEnabled()

    // The day already chosen, chosen again, keeps the tick.
    fireEvent.click(await choice(/pt 18 wrz/))
    expect(acknowledgement()).toBeChecked()
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
    stubForm({ ...piotr, slots: undefined, rule_violations: undefined })
    vi.spyOn(api, 'swapReturnOptions').mockResolvedValue(RETURNS)
    await pickPiotr()

    const [nothing, clean] = await within(await returns()).findAllByRole('radio')
    expect(nothing).toHaveTextContent('–Nic, tylko oddaję dyżurbez naruszeń')
    expect(clean).not.toHaveClass('rank-best')

    fireEvent.click(await choice(/niedz 20 wrz/))
    fireEvent.click(screen.getByRole('button', { name: /^Wpływ na bilans i ostrzeżenia/ }))
    const warnings = (await screen.findByText('Wyślesz mimo to - koordynator zobaczy ostrzeżenie')).parentElement as HTMLElement
    expect(within(warnings).getByRole('listitem')).toHaveTextContent('Anna Kowalska: Dzieli blok dni wolnych. (20-09-2099)')
    expect(screen.getByText('Ta wymiana nie łamie żadnej reguły')).toBeInTheDocument()
    expect(sendButton()).toBeEnabled()
  })

  it('says so when the replacement has no duty to give back', async () => {
    stubForm()
    await pickPiotr()

    expect(await screen.findByText('Piotr nie ma nadchodzących dyżurów, które można wziąć w zamian.')).toBeInTheDocument()
    expect(screen.queryByRole('radiogroup', { name: 'W zamian biorę' })).not.toBeInTheDocument()
  })

  it('shows a failed list of duties and reads it again on retry', async () => {
    stubForm()
    vi.spyOn(api, 'swapReturnOptions')
      .mockRejectedValueOnce(new ApiError('Nie udało się wczytać dyżurów', 500))
      .mockResolvedValue(RETURNS)
    await pickPiotr()

    expect(await screen.findByText('Nie udało się wczytać dyżurów')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }))
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

    const refusal = await screen.findByRole('alert')
    expect(refusal).toHaveTextContent('Zamiana złamie reguły twarde grafiku')
    expect(refusal).toHaveFocus()
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(sendButton()).toBeDisabled())
    expect(sendButton()).toHaveAccessibleDescription('Ta zamiana łamie regułę twardą; wybierz inną osobę albo inny dyżur w zamian.')
    expect(await choice(/śr 16 wrz/)).toHaveTextContent('reguła twarda')
  })

  it('keeps a hand-over that became blocked out of reach while a day is taken in return', async () => {
    const user = userEvent.setup()
    stubSchedule()
    vi.spyOn(api, 'swapImpact').mockResolvedValue(impact)
    vi.spyOn(api, 'swapOptions')
      .mockResolvedValueOnce([piotr])
      .mockResolvedValue([{ ...piotr, blocking_violations: RETURNS[3].blocking_violations }])
    vi.spyOn(api, 'swapReturnOptions').mockResolvedValue(RETURNS)
    vi.spyOn(api, 'createSwap').mockRejectedValue(new ApiError('Zamiana złamie reguły twarde grafiku', 409))
    await pickPiotr()
    fireEvent.click(await choice(/śr 16 wrz/))
    fireEvent.click(sendButton())

    const [nothing, clean, , breaks] = await within(await returns()).findAllByRole('radio')
    await waitFor(() => expect(nothing).toHaveAttribute('aria-disabled', 'true'))
    clean.focus()
    await user.keyboard('{ArrowUp}')
    expect(breaks).toHaveFocus()
    expect(nothing).not.toBeChecked()
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
    expect(within(row).getByRole('rowheader')).toHaveTextContent('pon 14 wrz PRIMARY + 11–19 ⇄ zamiana z śr 16 wrz SECONDARY + 11–19za 4 dni · wymiana')
    expect(within(row).getByRole('rowheader', { name: /^pon 14 wrz PRIMARY \+ 11–19 zamiana z śr 16 wrz SECONDARY/ })).not.toHaveAccessibleName(/⇄/)

    fireEvent.click(within(row).getByRole('button', { name: 'Zdecyduj: pon 14 wrz PRIMARY zamiana z śr 16 wrz SECONDARY' }))
    const sheet = await screen.findByRole('dialog', { name: 'Wymiana · pon 14 wrz ⇄ śr 16 wrz' })
    await waitFor(() => expect(impactCall).toHaveBeenCalledWith('2026-09-14', 'primary', 'p1', {
      inReturn: { service_date: '2026-09-16', role: 'secondary' }, scope: 'whole', returnScope: 'whole',
    }))
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
    fireEvent.click(within(row).getByRole('button', { name: /^Podgląd/ }))
    const sheet = await screen.findByRole('dialog', { name: /^Wymiana ·/ })
    expect(rowsOf(sheet)).toEqual([
      ['Oddajesz', 'pon 14 wrzPRIMARY + 11–19dla: Piotr Zieliński', 'za 4 dni'],
      ['Dostajesz', 'śr 16 wrzSECONDARY + 11–19od: Piotr Zieliński', 'za 6 dni'],
    ])
    expect(within(sheet).getByRole('button', { name: 'Wycofaj' })).toBeInTheDocument()
  })

  it.each([
    ['nobody, when a working day goes for a working day', { requester: { ...impact.requester, after: impact.requester.before }, replacement: { ...impact.replacement, after: impact.replacement.before } }, 'bez zmian'],
    ['the requester, when the day taken is worth more', { requester: impact.replacement, replacement: impact.requester }, /^Piotr \+1/],
  ])('shows the approving coordinator who gains from an exchange: %s', async (_, sides, effect) => {
    stub([exchange({ status: 'pending_coordinator' })])
    vi.spyOn(api, 'swapImpact').mockResolvedValue({ ...impact, ...sides })
    renderScreen(<SwapPanel displayName="Koordynator" role="coordinator" hasTeamMember={false} />)

    const row = await screen.findByRole('row', { name: /pon 14 wrz/ })
    expect(await within(row).findByText(effect)).toBeInTheDocument()
  })

  it('shows a coordinator both directions and has a broken rule acknowledged before the one approval', async () => {
    stub([exchange({ status: 'pending_coordinator', rule_violations: [{ ...THREE_IN_SEVEN, days: ['2026-09-14', '2026-09-15'] }] })])
    vi.spyOn(api, 'swapImpact').mockResolvedValue(impact)
    const approve = vi.spyOn(api, 'approveSwap').mockResolvedValue(exchange({ status: 'approved' }))
    renderScreen(<SwapPanel displayName="Koordynator" role="coordinator" hasTeamMember={false} />)

    const row = await screen.findByRole('row', { name: /pon 14 wrz/ })
    expect(within(row).getByRole('rowheader')).toHaveTextContent('pon 14 wrz PRIMARY + 11–19 ⇄ zamiana z śr 16 wrz SECONDARY + 11–19 łamie regułyza 4 dni · wymiana')
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
    expect(within(row).getByRole('rowheader')).toHaveTextContent('pon 14 wrz PRIMARY + 11–19 ⇄ zamiana z śr 16 wrz SECONDARYza 4 dni · wymiana')
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
    expect(await screen.findByRole('heading', { name: 'W zamian biorę' })).toBeInTheDocument()

    fireEvent.click(scopeChoice(`Tylko ${label(anchor)}`))
    expect(scopeGroup()).toHaveAccessibleDescription(`Oddajesz tylko ${label(anchor)}, a 11–19 zostaje u Ciebie. To łamie regułę pary; przed wysłaniem zaznaczysz, że wiesz.`)
    // Another scope is another request: the candidate is picked again.
    expect(screen.queryByRole('heading', { name: 'W zamian biorę' })).not.toBeInTheDocument()

    fireEvent.click(scopeChoice('Tylko 11–19'))
    expect(scopeChoice('Tylko 11–19')).toBeChecked()
    expect(scopeGroup()).toHaveAccessibleDescription(`Oddajesz tylko 11–19, a ${label(anchor)} zostaje u Ciebie. To łamie regułę pary; przed wysłaniem zaznaczysz, że wiesz.`)
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

  it('says no acknowledgement is due when the replacement cannot hold the 11-19 kept', async () => {
    stubDays('secondary').mockImplementation(async (serviceDate, role, scope) => [{
      member_id: 'p1',
      display_name: 'Piotr Zieliński',
      availability: null,
      on_duty_that_day: false,
      slots: scope === 'single' ? [{ service_date: serviceDate, role }] : [{ service_date: serviceDate, role }, { service_date: serviceDate, role: 'late_shift' }],
      blocking_violations: [],
      // Piotr cannot hold 11-19: the backend tolerates SECONDARY given alone and only warns.
      rule_violations: [],
      warning_violations: scope === 'single' && role === 'secondary' ? SPLIT : [],
      next_step: null,
    }])
    await openDay('2099-09-14')
    fireEvent.click(scopeChoice('Tylko SECONDARY'))
    fireEvent.click(await screen.findByRole('radio', { name: /Piotr Zieliński/ }))

    expect(scopeGroup()).toHaveAccessibleDescription('Oddajesz tylko SECONDARY, a 11–19 zostaje u Ciebie. Zastępca nie może tego dnia wziąć 11–19, więc to dozwolony wyjątek od reguły pary.')
    expect(screen.queryByText('Ta zamiana łamie reguły grafiku')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Rozumiem i świadomie łamię te reguły' })).not.toBeInTheDocument()
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

  it('leaves what a duty in return adds to a split to the frame, once it is chosen', async () => {
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
    expect(nothing).toHaveTextContent(/^–Nic, tylko oddaję dyżurwymaga potwierdzenia$/)
    expect(adds).toHaveTextContent(/^1śr 16 wrzSECONDARY \+ 11–19 · za \d+ dniwymaga potwierdzenia$/)
    expect(breaks).toHaveTextContent(/^2pon 21 wrzSECONDARY \+ 11–19 · za \d+ dniwymaga potwierdzenia$/)
    fireEvent.click(breaks)
    const frame = (await screen.findByText('Ta zamiana łamie reguły grafiku')).parentElement as HTMLElement
    expect(within(frame).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Anna Kowalska: Zmiana 11–19 i rola kotwicząca są u różnych osób. (14-09-2099)',
      'Piotr Zieliński: Zmiana 11–19 i rola kotwicząca są u różnych osób. (14-09-2099)',
      'Anna Kowalska: Mniej niż 2 dni przerwy po serii dyżurów on-call. (21-09-2099)',
    ])
  })

  /** One way to take Piotr's day: what of it comes back and what the exchange then breaks. */
  const way = (service_date: string, role: AssignmentRole, scope: SwapScope | null, roles: AssignmentRole[], verdict: Partial<SwapReturnOption> = {}): SwapReturnOption => ({
    service_date, role, scope, slots: roles.map((each) => ({ service_date, role: each })),
    blocking_violations: [], rule_violations: [], warning_violations: [], ...verdict,
  })
  /** Both days split: Anna keeps her anchor role on Monday, Piotr his on Wednesday. */
  const BOTH_SPLIT = SPLIT.map((violation) => ({ ...violation, days: ['2099-09-14', '2099-09-16'] }))
  const takeGroup = () => screen.getByRole('radiogroup', { name: 'Biorę' })
  const takeChoice = (name: string) => within(takeGroup()).getByRole('radio', { name })

  it.each(['secondary', 'primary'] as const)('takes the pair of the replacement\'s day the %s anchor binds whole, or one role of it', async (anchor) => {
    stubDays(anchor)
    vi.spyOn(api, 'swapReturnOptions').mockResolvedValue([
      {
        ...way('2099-09-16', anchor, 'whole', [anchor, 'late_shift'], { rule_violations: SPLIT }),
        parts: [
          way('2099-09-16', anchor, 'single', [anchor], { rule_violations: BOTH_SPLIT }),
          way('2099-09-16', 'late_shift', 'single', ['late_shift'], { rule_violations: BOTH_SPLIT }),
        ],
      },
      way('2099-09-20', anchor, null, [anchor], { rule_violations: SPLIT }),
    ])
    const create = vi.spyOn(api, 'createSwap').mockResolvedValue(swap({ id: '9', service_date: '2099-09-14' }))
    await openDay('2099-09-14')
    fireEvent.click(scopeChoice('Tylko 11–19'))
    fireEvent.click(await screen.findByRole('radio', { name: /Piotr Zieliński/ }))
    const returns = await screen.findByRole('radiogroup', { name: 'W zamian biorę' })
    const wednesday = await within(returns).findByRole('radio', { name: /śr 16 wrz/ })

    // A day is one row, offered as it is taken unless asked otherwise.
    expect(wednesday).toHaveTextContent(`${label(anchor)} + 11–19 · za`)
    expect(screen.queryByRole('radiogroup', { name: 'Biorę' })).not.toBeInTheDocument()
    fireEvent.click(wednesday)
    expect(within(takeGroup()).getAllByRole('radio').map((radio) => radio.textContent)).toEqual(['Cały dyżur', `Tylko ${label(anchor)}`, 'Tylko 11–19'])
    expect(takeChoice('Cały dyżur')).toBeChecked()

    // 11-19 for 11-19: the row reads as what comes back, and names the second split.
    fireEvent.click(takeChoice('Tylko 11–19'))
    expect(takeChoice('Tylko 11–19')).toBeChecked()
    expect(wednesday).toBeChecked()
    expect(wednesday).toHaveTextContent(/^1śr 16 wrz11–19 · za \d+ dniwymaga potwierdzenia$/)
    await waitFor(() => expect(api.swapImpact).toHaveBeenLastCalledWith('2099-09-14', 'late_shift', 'p1', expect.objectContaining({
      inReturn: expect.objectContaining({ service_date: '2099-09-16', role: 'late_shift' }), scope: 'single', returnScope: 'single',
    })))
    // Picking the day again keeps the way it is taken.
    fireEvent.click(wednesday)
    expect(takeChoice('Tylko 11–19')).toBeChecked()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Rozumiem i świadomie łamię te reguły' }))
    fireEvent.click(screen.getByRole('button', { name: 'Wyślij prośbę' }))
    await waitFor(() => expect(create).toHaveBeenCalled())
    expect(create.mock.calls[0][0]).toMatchObject({
      role: 'late_shift',
      scope: 'single',
      acknowledge_rule_violations: true,
      in_return: { service_date: '2099-09-16', role: 'late_shift', scope: 'single' },
    })
  })

  it('asks nothing of a day of the replacement with one role', async () => {
    stubDays('secondary')
    vi.spyOn(api, 'swapReturnOptions').mockResolvedValue([way('2099-09-20', 'secondary', null, ['secondary'])])
    const create = vi.spyOn(api, 'createSwap').mockResolvedValue(swap({ id: '9', service_date: '2099-09-14' }))
    await openDay('2099-09-14')
    fireEvent.click(await screen.findByRole('radio', { name: /Piotr Zieliński/ }))
    fireEvent.click(await within(await screen.findByRole('radiogroup', { name: 'W zamian biorę' })).findByRole('radio', { name: /niedz 20 wrz/ }))

    expect(screen.queryByRole('radiogroup', { name: 'Biorę' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Wyślij prośbę' }))
    await waitFor(() => expect(create).toHaveBeenCalled())
    expect(create.mock.calls[0][0].in_return).toEqual({ service_date: '2099-09-20', role: 'secondary' })
  })

  it('offers a day by the way still open, and says why another way of it is not', async () => {
    stubDays('secondary')
    const bothOncall: RuleViolation[] = [{ rule: 'same_day_oncall', message: 'Obie role on-call jednego dnia.', member_name: 'Anna Kowalska', days: ['2099-09-16'] }]
    vi.spyOn(api, 'swapReturnOptions').mockResolvedValue([{
      ...way('2099-09-16', 'late_shift', 'single', ['late_shift'], { rule_violations: BOTH_SPLIT }),
      parts: [
        way('2099-09-16', 'secondary', 'whole', ['secondary', 'late_shift'], { blocking_violations: bothOncall }),
        way('2099-09-16', 'secondary', 'single', ['secondary'], { blocking_violations: bothOncall }),
      ],
    }])
    await openDay('2099-09-14')
    fireEvent.click(await screen.findByRole('radio', { name: /Piotr Zieliński/ }))
    const returns = await screen.findByRole('radiogroup', { name: 'W zamian biorę' })
    const wednesday = await within(returns).findByRole('radio', { name: /śr 16 wrz/ })

    expect(wednesday).toBeEnabled()
    fireEvent.click(wednesday)
    expect(takeChoice('Tylko 11–19')).toBeChecked()
    fireEvent.click(takeChoice('Cały dyżur'))
    expect(wednesday).toHaveTextContent('Obie role on-call jednego dnia.reguła twarda')
    expect(wednesday).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Wyślij prośbę' })).toBeDisabled()

    fireEvent.click(within(returns).getByRole('radio', { name: /Nic, tylko oddaję dyżur/ }))
    expect(screen.queryByRole('radiogroup', { name: 'Biorę' })).not.toBeInTheDocument()
    expect(wednesday).toHaveTextContent('11–19 · za')
    expect(wednesday).not.toBeChecked()
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
    expect(candidate).toHaveTextContent('ostrzeżenie')
    fireEvent.click(candidate)
    expect(await screen.findByText('Przejmie tylko PRIMARY, nie pełni 11–19.')).toBeInTheDocument()
    // The exception is no block of days off.
    expect(screen.queryByText(/Dzieli blok dni wolnych/)).not.toBeInTheDocument()
  })
})

describe('SwapPanel on a phone', () => {
  const narrowScreen = () => vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: query === '(max-width: 900px)',
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }))

  it('lists one request per row with its action in reach instead of the wide table', async () => {
    narrowScreen()
    stub([
      swap({ id: '1', requester_name: 'Marek Nowak', replacement_name: 'Piotr Zieliński' }),
      swap({ id: '2', service_date: '2026-09-21', requester_name: 'Marek Nowak', replacement_name: 'Ola Wiśniewska' }),
    ])
    renderScreen(<SwapPanel displayName="Piotr Zieliński" role="member" hasTeamMember />)

    const decide = await screen.findByRole('button', { name: 'Zdecyduj: pon 14 wrz PRIMARY' })
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    const row = decide.closest('.list-row') as HTMLElement
    expect(row).toHaveTextContent('pon 14 wrz · PRIMARY Oczekuje na zastępcęMarek Nowak → Ty · czeka na Ciebie')
    expect(within(row).getByText('Oczekuje na zastępcę')).toBeInTheDocument()
    expect(row).not.toHaveClass('list-row-hl')

    fireEvent.click(decide)
    await screen.findByRole('dialog', { name: /^Zamiana ·/ })
    expect(row).toHaveClass('list-row-hl')
  })

  it('names both days of an exchange, a broken rule and a lapsed date in the row', async () => {
    narrowScreen()
    stub([
      swap({
        id: '1',
        requester_name: 'Piotr Zieliński',
        replacement_name: 'Ola Wiśniewska',
        return_slots: [{ service_date: '2026-09-16', role: 'secondary' }],
        rule_violations: [{ rule: 'three_in_seven', message: 'Więcej niż 3 dyżury w 7 dniach.', member_name: 'Ola Wiśniewska', days: [] }],
      }),
      swap({ id: '2', service_date: '2026-09-08', requester_name: 'Piotr Zieliński', replacement_name: 'Ola Wiśniewska' }),
    ])
    renderScreen(<SwapPanel displayName="Piotr Zieliński" role="member" hasTeamMember />, { route: '/zamiany?skrzynka=moje' })

    const exchange = (await screen.findByRole('button', { name: /^Podgląd: pon 14 wrz/ })).closest('.list-row') as HTMLElement
    expect(exchange).toHaveTextContent('pon 14 wrz · PRIMARY ⇄ zamiana z śr 16 wrz · SECONDARY Oczekuje na zastępcę łamie regułyTy → Ola Wiśniewska · czeka na: Ola Wiśniewska')
    expect(within(exchange).getByText('łamie reguły')).toHaveClass('tag', 'tag-bad')

    fireEvent.click(inbox(/^Zamknięte/))
    const lapsed = (await screen.findByRole('button', { name: /^Podgląd: wt 8 wrz/ })).closest('.list-row') as HTMLElement
    expect(lapsed).toHaveTextContent('Ty → Ola Wiśniewska · termin minął')
  })
})

describe('SwapPanel closed inbox', () => {
  const closed = (count: number) => Array.from({ length: count }, (_, index) => swap({
    id: `c${index}`,
    status: 'cancelled',
    created_at: `2026-08-${String(31 - (index % 30)).padStart(2, '0')}T10:00:00Z`,
  }))

  it('loads the newest closed requests first and older ones on request', async () => {
    stub(closed(51))
    renderScreen(<SwapPanel displayName="Piotr Zieliński" role="member" hasTeamMember />, { route: '/zamiany?skrzynka=zamkniete' })

    // Only a page is read, so the count is a floor.
    expect(await screen.findByText('0 czeka na Twoją decyzję · 0 czeka na drugą stronę · 50+ zamkniętych')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Podgląd/ })).toHaveLength(50)
    expect(api.swaps).toHaveBeenCalledWith({ status: ['approved', 'rejected', 'cancelled'], limit: 50, offset: 0 })

    fireEvent.click(screen.getByRole('button', { name: 'Pokaż starsze' }))
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^Podgląd/ })).toHaveLength(51))
    expect(api.swaps).toHaveBeenCalledWith({ status: ['approved', 'rejected', 'cancelled'], limit: 50, offset: 50 })
    expect(screen.getByText('0 czeka na Twoją decyzję · 0 czeka na drugą stronę · 51 zamkniętych')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pokaż starsze' })).not.toBeInTheDocument()
  })

  it('offers older requests only in the closed inbox', async () => {
    stub(closed(50))
    renderScreen(<SwapPanel displayName="Piotr Zieliński" role="member" hasTeamMember />)

    await screen.findByText('Nikt Cię o nic nie prosi')
    expect(screen.queryByRole('button', { name: 'Pokaż starsze' })).not.toBeInTheDocument()
  })
})
