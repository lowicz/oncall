import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tooltip, TooltipProvider } from './Tooltip'

describe('Tooltip', () => {
  it('shows its hint when the trigger gets keyboard focus', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(
      <TooltipProvider>
        <Tooltip text="Otwarty szkic zostaje na liście"><button>Generuj nowy szkic</button></Tooltip>
      </TooltipProvider>,
    )
    await user.tab()
    expect(screen.getByRole('button', { name: 'Generuj nowy szkic' })).toHaveFocus()
    expect(await screen.findByText('Otwarty szkic zostaje na liście')).toHaveClass('tip')
  })
})
