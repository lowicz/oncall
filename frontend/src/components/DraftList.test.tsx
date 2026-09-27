import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { renderScreen } from '../test/render'
import { DraftList } from './DraftList'
import { ApiError, ScheduleSummary, api } from '../api'

const draft = (id: string, over: Partial<ScheduleSummary> = {}): ScheduleSummary => ({
  id,
  name: `Szkic ${id}`,
  starts_on: '2026-10-05',
  ends_on: '2026-11-01',
  status: 'draft',
  version: 1,
  rotation_mode: 'daily',
  solver_status: 'OPTIMAL',
  assignment_count: 76,
  created_at: '2026-09-08T08:00:00Z',
  ...over,
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('DraftList', () => {
  it('lists the drafts, marks the open one, and opens or deletes a row', async () => {
    vi.spyOn(api, 'draftSchedules').mockResolvedValue([
      draft('a'),
      draft('b', { status: 'proposed', rotation_mode: 'weekly', version: 3, created_at: null }),
    ])
    const onOpen = vi.fn()
    const onDelete = vi.fn()
    renderScreen(<DraftList activeId="a" onOpen={onOpen} onDelete={onDelete} />)

    expect(screen.getByRole('status', { name: 'Wczytywanie szkiców' })).toBeInTheDocument()
    const opened = await screen.findByRole('button', { name: 'Otwarty' })
    expect(opened).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('05-10-2026 – 01-11-2026 · Dzienny · v1 · 76 przydziałów · utworzony 08-09-2026')).toBeInTheDocument()
    expect(screen.getByText('05-10-2026 – 01-11-2026 · Tygodniowy · v3 · 76 przydziałów')).toBeInTheDocument()
    expect(screen.getByText('Do akceptacji')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Pokaż/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Otwórz' }))
    expect(onOpen).toHaveBeenCalledWith('b')
    fireEvent.click(screen.getAllByRole('button', { name: 'Usuń szkic 05-10-2026 - 01-11-2026' })[1])
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }))
  })

  it('shows the newest four and the rest on request', async () => {
    vi.spyOn(api, 'draftSchedules').mockResolvedValue([
      draft('1'), draft('2', { status: 'published' }), draft('3', { status: 'superseded' }), draft('4'), draft('5'),
    ])
    renderScreen(<DraftList onOpen={vi.fn()} onDelete={vi.fn()} deleting />)

    await screen.findByText('Szkic 1')
    expect(screen.queryByText('Szkic 5')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Usuń szkic/ })[0]).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Pokaż wszystkie (5)' }))
    expect(screen.getByText('Szkic 5')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Pokaż mniej' }))
    expect(screen.queryByText('Szkic 5')).not.toBeInTheDocument()
  })

  it('says there are no drafts yet', async () => {
    vi.spyOn(api, 'draftSchedules').mockResolvedValue([])
    renderScreen(<DraftList onOpen={vi.fn()} onDelete={vi.fn()} />)
    expect(await screen.findByText('Brak szkiców')).toBeInTheDocument()
    expect(screen.getByText('Utwórz nowy, wybierając zakres dat powyżej.')).toBeInTheDocument()
  })

  it('reports a failed load and tries again on request', async () => {
    const drafts = vi.spyOn(api, 'draftSchedules').mockRejectedValue(new ApiError('Serwer niedostępny', 503))
    renderScreen(<DraftList onOpen={vi.fn()} onDelete={vi.fn()} />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Serwer niedostępny')
    drafts.mockResolvedValue([draft('a')])
    fireEvent.click(within(alert).getByRole('button', { name: 'Spróbuj ponownie' }))
    expect(await screen.findByText('Szkic a')).toBeInTheDocument()
  })
})
