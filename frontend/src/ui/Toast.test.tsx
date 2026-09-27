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

  it('offers an action that runs its handler', async () => {
    const onClick = vi.fn()
    renderToasts((toast) => toast.success('Usunięto wpis', { action: { label: 'Cofnij', onClick } }))
    const item = await toastNamed('Usunięto wpis')
    fireEvent.click(within(item).getByRole('button', { name: 'Cofnij' }))
    expect(onClick).toHaveBeenCalledOnce()
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
