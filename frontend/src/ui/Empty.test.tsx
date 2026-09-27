import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ApiError } from '../api'
import { messages } from '../i18n'
import { EmptyState, ErrorState, InlineError, LoadingBlock, Skeleton } from './Empty'

const t = () => messages().common

describe('EmptyState', () => {
  it('says why the list is empty and what to do', () => {
    const { container } = render(
      <EmptyState icon="calendar" title="Brak dyżurów" description="Nic w tym miesiącu" action={<button>Dodaj</button>} className="mine" />,
    )
    expect(screen.getByText('Brak dyżurów')).toHaveClass('empty-title')
    expect(screen.getByText('Nic w tym miesiącu')).toHaveClass('empty-desc')
    expect(screen.getByRole('button', { name: 'Dodaj' }).parentElement).toHaveClass('empty-action')
    expect(container.firstElementChild).toHaveClass('empty', 'mine')
    expect(container.querySelector('svg')).toHaveAttribute('width', '32')
  })

  it('draws a compact form with a smaller icon and nothing optional', () => {
    const { container } = render(<EmptyState title="Pusto" compact />)
    expect(container.firstElementChild).toHaveClass('empty-compact')
    expect(container.querySelector('svg')).toHaveAttribute('width', '22')
    expect(container.querySelector('.empty-desc')).toBeNull()
    expect(container.querySelector('.empty-action')).toBeNull()
  })
})

describe('ErrorState', () => {
  it('shows the API message, the status for a ticket and a retry', () => {
    const onRetry = vi.fn()
    render(<ErrorState error={new ApiError('Serwer niedostępny', 503)} onRetry={onRetry} className="page-error" />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveClass('page-error')
    expect(alert).toHaveTextContent(t().fetchFailed)
    expect(alert).toHaveTextContent('Serwer niedostępny')
    expect(alert).toHaveTextContent('HTTP 503')
    fireEvent.click(screen.getByRole('button', { name: t().retry }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('shows any other failure with its own title and no status or retry', () => {
    render(<ErrorState error="przekroczono czas" title="Nie wczytano grafiku" />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Nie wczytano grafiku')
    expect(alert).toHaveTextContent('przekroczono czas')
    expect(alert).not.toHaveTextContent('HTTP')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows a plain error without a status', () => {
    render(<ErrorState error={new Error('Sieć')} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Sieć')
    expect(screen.getByRole('alert')).not.toHaveTextContent('HTTP')
  })
})

describe('InlineError', () => {
  it('renders nothing without an error', () => {
    const { container } = render(<InlineError error={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('lists the rules a hard-rule refusal names, and the next step', () => {
    const error = new ApiError('Zmiana łamie reguły', 409, [
      { rule: 'rest', message: 'Za krótki odpoczynek', member_name: 'Jan Kowal', days: ['2026-09-14', '2026-09-15'] },
      { rule: 'cap', message: 'Za dużo dyżurów', member_name: '', days: [] },
    ], 'Wybierz inną osobę')
    render(<InlineError error={error} className="under-form" />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveClass('box', 'box-bad', 'under-form')
    expect(alert.querySelector('b')).toHaveTextContent('Zmiana łamie reguły')
    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Za krótki odpoczynek · Jan Kowal · 2026-09-14, 2026-09-15')
    expect(items[1]).toHaveTextContent(/^Za dużo dyżurów$/)
    expect(screen.getByText('Wybierz inną osobę')).toHaveClass('box-next')
  })

  it('shows a plain error and a bare message alone', () => {
    const { rerender } = render(<InlineError error={new Error('Nie zapisano')} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Nie zapisano')
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    rerender(<InlineError error="Odmowa" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Odmowa')
    expect(screen.getByRole('alert').querySelector('.box-next')).toBeNull()
  })
})

describe('loading placeholders', () => {
  it('draw a skeleton at the size of what it stands for', () => {
    const { container } = render(<Skeleton width={120} height="2em" inline className="cell" />)
    const block = container.firstElementChild as HTMLElement
    expect(block).toHaveClass('sk', 'sk-inline', 'cell')
    expect(block).toHaveAttribute('aria-hidden', 'true')
    expect(block.style.width).toBe('120px')
    expect(block.style.height).toBe('2em')
  })

  it('announce a loading screen once, under the default or a given name', () => {
    const { container, rerender } = render(<LoadingBlock />)
    expect(screen.getByRole('status', { name: t().loading })).toBeInTheDocument()
    // The heading bar plus four rows.
    expect(container.querySelectorAll('.sk')).toHaveLength(5)
    rerender(<LoadingBlock label="Wczytywanie grafiku" rows={2} className="tall" />)
    expect(screen.getByRole('status', { name: 'Wczytywanie grafiku' })).toHaveClass('sk-block', 'tall')
    expect(container.querySelectorAll('.sk')).toHaveLength(3)
  })
})
