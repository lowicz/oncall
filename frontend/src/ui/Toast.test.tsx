import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Toast as BaseToast } from '@base-ui/react/toast'
import { messages } from '../i18n'
import { ToastProvider, useToast } from './Toast'

type Api = ReturnType<typeof useToast>
type Show = (toast: Api) => void

/** A screen that raises the toasts a test asks for when its button is pressed. */
function Raise({ show }: { show: Show }) {
  const toast = useToast()
  return <button onClick={() => show(toast)}>raise</button>
}

function RawAdd() {
  const manager = BaseToast.useToastManager()
  return <button onClick={() => manager.add({ title: 'Bez rodzaju' })}>raw</button>
}

function renderToasts(show: Show = () => {}) {
  render(<ToastProvider><Raise show={show} /><RawAdd /></ToastProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'raise' }))
}

const toastNamed = async (title: string) => (await screen.findByText(title)).closest('.toast') as HTMLElement

describe('toasts', () => {
  it.each([
    ['success', 'toast-ok'],
    ['warn', 'toast-warn'],
    ['error', 'toast-bad'],
    ['info', 'toast-info'],
  ] as const)('%s shows its title and description in its tone', async (kind, className) => {
    renderToasts((toast) => toast[kind]('Zapisano', { description: 'Grafik wrzesień' }))
    const item = await toastNamed('Zapisano')
    expect(item).toHaveClass('toast', className)
    expect(within(item).getByText('Grafik wrzesień')).toHaveClass('toast-desc')
  })

  it('offers an action that runs its handler until its deadline', async () => {
    const onClick = vi.fn()
    renderToasts((toast) => toast.success('Usunięto wpis', { action: { label: 'Cofnij', onClick }, until: Date.now() + 10_000 }))
    const item = await toastNamed('Usunięto wpis')
    fireEvent.click(within(item).getByRole('button', { name: 'Cofnij' }))
    expect(onClick).toHaveBeenCalledOnce()
    screen.getByRole('button', { name: 'raise' }).focus()

    await act(() => vi.advanceTimersByTimeAsync(9000))
    expect(screen.getByText('Usunięto wpis')).toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(1100))
    await waitFor(() => expect(screen.queryByText('Usunięto wpis')).not.toBeInTheDocument())
  })

  it.each([
    ['the pointer is over the notifications', (item: HTMLElement) => fireEvent.mouseEnter(item.closest('.toasts') as HTMLElement)],
    ['its action has keyboard focus', (item: HTMLElement) => {
      fireEvent.keyDown(document, { key: 'Tab' })
      within(item).getByRole('button', { name: 'Cofnij' }).focus()
    }],
  ])('closes at its deadline even while %s', async (_, pause) => {
    renderToasts((toast) => toast.success('Zapisano zmianę', { action: { label: 'Cofnij', onClick: vi.fn() }, until: Date.now() + 10_000 }))
    pause(await toastNamed('Zapisano zmianę'))

    await act(() => vi.advanceTimersByTimeAsync(10_100))
    await waitFor(() => expect(screen.queryByText('Zapisano zmianę')).not.toBeInTheDocument())
  })

  it('pauses an action toast while the pointer is over the notifications', async () => {
    renderToasts((toast) => toast.success('Zapisano zmianę', { action: { label: 'Cofnij', onClick: vi.fn() } }))
    await toastNamed('Zapisano zmianę')
    const viewport = screen.getByRole('region', { name: messages().common.notifications })

    fireEvent.mouseEnter(viewport)
    await act(() => vi.advanceTimersByTimeAsync(15_000))
    expect(screen.getByText('Zapisano zmianę')).toBeInTheDocument()

    fireEvent.mouseLeave(viewport)
    await act(() => vi.advanceTimersByTimeAsync(11_000))
    await waitFor(() => expect(screen.queryByText('Zapisano zmianę')).not.toBeInTheDocument())
  })

  it('pauses an action toast while its action has keyboard focus', async () => {
    renderToasts((toast) => toast.success('Zapisano zmianę', { action: { label: 'Cofnij', onClick: vi.fn() } }))
    const item = await toastNamed('Zapisano zmianę')
    const action = within(item).getByRole('button', { name: 'Cofnij' })

    fireEvent.keyDown(document, { key: 'Tab' })
    action.focus()
    await act(() => vi.advanceTimersByTimeAsync(15_000))
    expect(screen.getByText('Zapisano zmianę')).toBeInTheDocument()

    screen.getByRole('button', { name: 'raise' }).focus()
    await act(() => vi.advanceTimersByTimeAsync(11_000))
    await waitFor(() => expect(screen.queryByText('Zapisano zmianę')).not.toBeInTheDocument())
  })

  it('uses a polite live region for notifications', () => {
    renderToasts()
    expect(screen.getByRole('region', { name: messages().common.notifications }))
      .toHaveAttribute('aria-live', 'polite')
  })

  it('closes on its close button', async () => {
    renderToasts((toast) => toast.info('Wysłano do Marka'))
    const item = await toastNamed('Wysłano do Marka')
    // Base UI hides the close button from assistive technology until the
    // toast itself is reached, so the pointer path is what is tested here.
    fireEvent.click(within(item).getByLabelText(messages().common.closeNotification))
    await waitFor(() => expect(screen.queryByText('Wysłano do Marka')).not.toBeInTheDocument())
  })

  it('keeps an error on screen longer than a confirmation', async () => {
    renderToasts((toast) => {
      toast.success('Zapisano')
      toast.error('Nie zapisano')
    })
    await screen.findByText('Nie zapisano')
    await act(() => vi.advanceTimersByTimeAsync(7000))
    await waitFor(() => expect(screen.queryByText('Zapisano')).not.toBeInTheDocument())
    expect(screen.getByText('Nie zapisano')).toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(4000))
    await waitFor(() => expect(screen.queryByText('Nie zapisano')).not.toBeInTheDocument())
  })

  it('shows a toast added without a kind as information', async () => {
    renderToasts()
    expect(screen.getByRole('region', { name: messages().common.notifications })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'raw' }))
    expect(await toastNamed('Bez rodzaju')).toHaveClass('toast-info')
  })
})
