import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderScreen } from '../../test/render'
import { ShareLinksPanel } from './ShareLinks'
import { api } from '../../api'

afterEach(() => vi.restoreAllMocks())

const LINK = {
  id: 'l1', label: 'dyspozytornia', starts_on: '2026-09-14', ends_on: '2026-09-27',
  expires_at: '2099-01-01T00:00:00Z', created_at: '2026-09-01T10:00:00Z', used_at: null, revoked_at: null,
}

const openRevocation = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Odwołaj' }))
  return screen.findByRole('dialog', { name: 'Odwołać link udostępnienia?' })
}

describe('ShareLinksPanel revocation', () => {
  it('keeps the link when the confirmation is cancelled', async () => {
    vi.spyOn(api, 'shareLinks').mockResolvedValue([LINK])
    const revoke = vi.spyOn(api, 'revokeShareLink').mockResolvedValue(undefined)
    renderScreen(<ShareLinksPanel />)

    const confirm = await openRevocation()
    expect(within(confirm).getByText(/Link dla „dyspozytornia” \(14-09-2026 – 27-09-2026\) przestanie działać/)).toBeInTheDocument()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Anuluj' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(revoke).not.toHaveBeenCalled()
  })

  it('revokes the link once confirmed', async () => {
    vi.spyOn(api, 'shareLinks').mockResolvedValue([LINK])
    const revoke = vi.spyOn(api, 'revokeShareLink').mockResolvedValue(undefined)
    renderScreen(<ShareLinksPanel />)

    const confirm = await openRevocation()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Odwołaj link' }))

    await waitFor(() => expect(revoke).toHaveBeenCalled())
    expect(revoke.mock.calls[0][0]).toBe('l1')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

const rowOf = (label: string) => screen.getByText(label).closest('.list-row') as HTMLElement

const USED = { ...LINK, id: 'l2', label: 'kadry', used_at: '2026-09-05T08:00:00Z' }
const EXPIRED = { ...LINK, id: 'l3', label: 'serwis zewnętrzny', expires_at: '2026-09-01T00:00:00Z' }
const REVOKED = { ...LINK, id: 'l4', label: 'stary partner', revoked_at: '2026-09-02T00:00:00Z' }

describe('ShareLinksPanel list', () => {
  it('states each link\'s status and hides revoked ones until asked', async () => {
    vi.spyOn(api, 'shareLinks').mockResolvedValue([LINK, USED, EXPIRED, REVOKED])
    renderScreen(<ShareLinksPanel />)

    const active = (await screen.findByText('dyspozytornia')).closest('.list-row') as HTMLElement
    expect(within(active).getByText('aktywny')).toBeInTheDocument()
    expect(within(active).getByText('14-09-2026 – 27-09-2026 · wygasa 01-01-2099')).toBeInTheDocument()
    const used = rowOf('kadry')
    expect(within(used).getByText('użyty')).toBeInTheDocument()
    expect(within(used).getByText('14-09-2026 – 27-09-2026 · wygasa 01-01-2099 · użyty 05-09-2026')).toBeInTheDocument()
    expect(within(rowOf('serwis zewnętrzny')).getByText('wygasły')).toBeInTheDocument()
    expect(screen.queryByText('stary partner')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Linki' }).nextElementSibling).toHaveTextContent('3')

    fireEvent.click(screen.getByLabelText('Pokaż odwołane'))

    expect(screen.getByRole('heading', { name: 'Linki' }).nextElementSibling).toHaveTextContent('4')
    const revoked = rowOf('stary partner')
    expect(within(revoked).getByText('odwołany')).toBeInTheDocument()
    expect(within(revoked).getByRole('button', { name: 'Kanał ICS' })).toBeDisabled()
    expect(within(revoked).getByRole('button', { name: 'Odwołaj' })).toBeDisabled()
  })

  it('explains what a link is for while there are none', async () => {
    vi.spyOn(api, 'shareLinks').mockResolvedValue([REVOKED])
    renderScreen(<ShareLinksPanel />)

    expect(await screen.findByText('Nie utworzono jeszcze żadnych linków')).toBeInTheDocument()
    expect(screen.getByText(/Link daje osobie spoza zespołu wgląd/)).toBeInTheDocument()
  })

  it('offers a retry when the list fails to load', async () => {
    const list = vi.spyOn(api, 'shareLinks')
      .mockRejectedValueOnce(new Error('Serwer niedostępny'))
      .mockResolvedValue([LINK])
    renderScreen(<ShareLinksPanel />)

    expect(await screen.findByText('Serwer niedostępny')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }))

    expect(await screen.findByText('dyspozytornia')).toBeInTheDocument()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('creates an ICS feed for a link and offers its address to copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    vi.spyOn(api, 'shareLinks').mockResolvedValue([LINK, USED])
    const feed = vi.spyOn(api, 'createShareLinkFeed').mockResolvedValue({ id: 'f1', url: 'https://oncall.example/ics/abc' })
    renderScreen(<ShareLinksPanel />)

    const row = (await screen.findByText('dyspozytornia')).closest('.list-row') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'Kanał ICS' }))

    fireEvent.click(await within(row).findByRole('button', { name: 'Kopiuj ICS' }))
    expect(feed.mock.calls[0][0]).toBe('l1')
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://oncall.example/ics/abc'))
    expect(within(rowOf('kadry')).getByRole('button', { name: 'Kanał ICS' })).toBeEnabled()
  })

  it('shows why a feed could not be created', async () => {
    vi.spyOn(api, 'shareLinks').mockResolvedValue([LINK])
    vi.spyOn(api, 'createShareLinkFeed').mockRejectedValue(new Error('Link został odwołany'))
    renderScreen(<ShareLinksPanel />)

    fireEvent.click(await screen.findByRole('button', { name: 'Kanał ICS' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Link został odwołany')
  })

  it('shows a refused revocation inside the still-open confirmation', async () => {
    vi.spyOn(api, 'shareLinks').mockResolvedValue([LINK])
    vi.spyOn(api, 'revokeShareLink').mockRejectedValue(new Error('Link już odwołano'))
    renderScreen(<ShareLinksPanel />)

    const confirm = await openRevocation()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Odwołaj link' }))

    expect(await within(confirm).findByText('Link już odwołano')).toBeInTheDocument()
  })
})

describe('ShareLinksPanel creation', () => {
  it('creates a link for the chosen range and validity and shows it once', async () => {
    vi.spyOn(api, 'shareLinks').mockResolvedValue([])
    const create = vi.spyOn(api, 'createShareLink').mockResolvedValue({
      id: 'l9', url: 'https://oncall.example/s/xyz', expires_at: '2026-09-24T09:00:00Z',
    })
    renderScreen(<ShareLinksPanel />)
    const form = await screen.findByRole('form', { name: 'Nowy link' })
    expect(within(form).getByLabelText(/Grafik od/)).toHaveValue('2026-09-10')
    expect(within(form).getByLabelText(/Grafik do/)).toHaveValue('2026-09-23')

    fireEvent.change(within(form).getByLabelText(/Odbiorca/), { target: { value: 'dyspozytornia' } })
    fireEvent.change(within(form).getByLabelText(/Grafik od/), { target: { value: '2026-10-01' } })
    fireEvent.change(within(form).getByLabelText(/Grafik do/), { target: { value: '2026-10-31' } })
    fireEvent.change(within(form).getByLabelText('Ważność linku'), { target: { value: '14' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Utwórz link' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Jednorazowy link, ważny do 24-09-2026. Przekaż go odbiorcy; nie pokażemy go ponownie.',
    )
    expect(screen.getByText('https://oncall.example/s/xyz')).toBeInTheDocument()
    expect(create.mock.calls[0][0]).toEqual({
      label: 'dyspozytornia', starts_on: '2026-10-01', ends_on: '2026-10-31', expires_days: 14,
    })
    expect(within(form).getByLabelText(/Odbiorca/)).toHaveValue('')
    expect(within(form).getByLabelText(/Grafik od/)).toHaveValue('2026-10-01')
  })

  it('shows why a link could not be created', async () => {
    vi.spyOn(api, 'shareLinks').mockResolvedValue([])
    vi.spyOn(api, 'createShareLink').mockRejectedValue(new Error('Nieprawidłowy zakres dat'))
    renderScreen(<ShareLinksPanel />)

    fireEvent.submit(await screen.findByRole('form', { name: 'Nowy link' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Nieprawidłowy zakres dat')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
