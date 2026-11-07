import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Checkbox, Field, Input, Segmented, Select, Textarea } from './Field'
import { navigateRadioGroup, radioTabIndex } from './radioNavigation'

describe('Field', () => {
  it('labels the control and describes it with the hint', () => {
    render(
      <Field label="Login" hint="Bez spacji" required>
        {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} invalid={invalid} />}
      </Field>,
    )
    const input = screen.getByRole('textbox', { name: /Login/ })
    expect(input).toHaveAccessibleDescription('Bez spacji')
    expect(input).not.toHaveAttribute('aria-invalid')
    expect(screen.getByText('*')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('announces the error in place of the hint and marks the control invalid', () => {
    const { container } = render(
      <Field label="Login" hint="Bez spacji" error="Login jest zajęty" id="login" className="wide">
        {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} invalid={invalid} />}
      </Field>,
    )
    const input = screen.getByRole('textbox', { name: 'Login' })
    expect(input).toHaveAttribute('id', 'login')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveClass('in', 'in-err')
    expect(input).toHaveAccessibleDescription('Login jest zajęty')
    expect(screen.getByRole('alert')).toHaveTextContent('Login jest zajęty')
    expect(screen.queryByText('Bez spacji')).not.toBeInTheDocument()
    expect(container.firstElementChild).toHaveClass('field', 'field-invalid', 'wide')
  })

  it('gives the control no description when there is nothing to say', () => {
    render(
      <Field label="Notatka">
        {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} />}
      </Field>,
    )
    const textarea = screen.getByRole('textbox', { name: 'Notatka' })
    expect(textarea).not.toHaveAttribute('aria-describedby')
    expect(textarea).toHaveAttribute('rows', '3')
    expect(screen.queryByText('*')).not.toBeInTheDocument()
  })
})

describe('the controls', () => {
  it('draw an input in the monospace face on request', () => {
    render(<Input aria-label="Numer" mono className="narrow" />)
    expect(screen.getByRole('textbox', { name: 'Numer' })).toHaveClass('in', 'in-mono', 'narrow')
  })

  it('mark a textarea and a select invalid', () => {
    render(
      <>
        <Textarea aria-label="Powód" invalid rows={5} />
        <Select aria-label="Rola" invalid className="short"><option value="a">A</option></Select>
        <Select aria-label="Tryb"><option value="b">B</option></Select>
      </>,
    )
    const textarea = screen.getByRole('textbox', { name: 'Powód' })
    expect(textarea).toHaveAttribute('aria-invalid', 'true')
    expect(textarea).toHaveAttribute('rows', '5')
    expect(textarea).toHaveClass('in-err')
    const select = screen.getByRole('combobox', { name: 'Rola' })
    expect(select).toHaveAttribute('aria-invalid', 'true')
    expect(select).toHaveClass('in-err')
    expect(select.parentElement).toHaveClass('sel-wrap', 'short')
    expect(screen.getByRole('combobox', { name: 'Tryb' })).not.toHaveAttribute('aria-invalid')
  })

  it('label a checkbox, with a hint when given', () => {
    const onChange = vi.fn()
    render(
      <>
        <Checkbox label="Dołącz logowania" hint="Rutynowe wejścia" onChange={onChange} className="mine" />
        <Checkbox label="Bez podpowiedzi" />
      </>,
    )
    const checkbox = screen.getByRole('checkbox', { name: /Dołącz logowania/ })
    fireEvent.click(checkbox)
    expect(onChange).toHaveBeenCalledOnce()
    expect(checkbox.closest('label')).toHaveClass('check', 'mine')
    expect(screen.getByText('Rutynowe wejścia').tagName).toBe('SMALL')
    expect(screen.getByRole('checkbox', { name: 'Bez podpowiedzi' }).closest('label')!.querySelector('small')).toBeNull()
  })
})

describe('Segmented', () => {
  const OPTIONS = [
    { value: 'day', label: 'Dzień' },
    { value: 'week', label: 'Tydzień', tone: 'ch' as const },
    { value: 'off', label: 'Wyłączone', disabled: true },
    { value: 'month', label: 'Miesiąc' },
  ]

  function Zoom({ onChange }: { onChange?: (value: string) => void }) {
    const [value, setValue] = useState('day')
    return (
      <Segmented
        label="Powiększenie"
        value={value}
        onChange={(next) => { setValue(next); onChange?.(next) }}
        options={OPTIONS}
        size="sm"
      />
    )
  }

  const option = (name: string) => screen.getByRole('radio', { name })

  it('is a radio group with only the chosen option in the tab order', () => {
    render(<Zoom />)
    const group = screen.getByRole('radiogroup', { name: 'Powiększenie' })
    expect(group).toHaveClass('seg', 'seg-sm')
    expect(option('Dzień')).toHaveAttribute('aria-checked', 'true')
    expect(option('Dzień')).toHaveClass('on')
    expect(option('Dzień').tabIndex).toBe(0)
    expect(option('Tydzień').tabIndex).toBe(-1)
    expect(option('Tydzień')).toHaveAttribute('data-tone', 'ch')
    expect(option('Wyłączone')).toBeDisabled()
  })

  it('chooses on click', () => {
    const onChange = vi.fn()
    render(<Zoom onChange={onChange} />)
    fireEvent.click(option('Miesiąc'))
    expect(onChange).toHaveBeenCalledWith('month')
    expect(option('Miesiąc')).toHaveAttribute('aria-checked', 'true')
  })

  it('moves with the arrow keys, skipping a disabled option and wrapping at the ends', async () => {
    const user = userEvent.setup()
    render(<Zoom />)
    await user.tab()
    expect(option('Dzień')).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(option('Tydzień')).toHaveAttribute('aria-checked', 'true')
    expect(option('Tydzień')).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(option('Miesiąc')).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(option('Dzień')).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(option('Miesiąc')).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(option('Tydzień')).toHaveFocus()
    await user.keyboard('{End}')
    expect(option('Miesiąc')).toHaveAttribute('aria-checked', 'true')
    await user.keyboard('{Home}')
    expect(option('Dzień')).toHaveAttribute('aria-checked', 'true')
  })

  describe('radio cards with aria-disabled choices', () => {
    function Cards({ options }: { options: { value: string; disabled?: boolean }[] }) {
      const [value, setValue] = useState('')
      return (
        <div role="radiogroup" aria-label="Cards">
          {options.map((item) => (
            <button
              key={item.value}
              type="button"
              role="radio"
              aria-checked={value === item.value}
              aria-disabled={item.disabled || undefined}
              tabIndex={radioTabIndex(value, item.value, options)}
              data-value={item.value}
              onKeyDown={(event) => navigateRadioGroup(event, item.value, options, setValue)}
            >
              {item.value}
            </button>
          ))}
        </div>
      )
    }

    it('walks every card but selects none when all of them are blocked', async () => {
      const user = userEvent.setup()
      render(<Cards options={[{ value: 'a', disabled: true }, { value: 'b', disabled: true }]} />)
      await user.tab()
      expect(option('a')).toHaveFocus()
      await user.keyboard('{ArrowRight}')
      expect(option('b')).toHaveFocus()
      expect(screen.queryByRole('radio', { checked: true })).not.toBeInTheDocument()
    })

    it('steps from a focused blocked card to the next enabled one', async () => {
      const user = userEvent.setup()
      render(<Cards options={[{ value: 'a', disabled: true }, { value: 'b' }, { value: 'c' }]} />)
      expect(option('b').tabIndex).toBe(0)
      act(() => option('a').focus())
      await user.keyboard('{ArrowDown}')
      expect(option('b')).toHaveFocus()
      expect(option('b')).toHaveAttribute('aria-checked', 'true')
      await user.keyboard('{ArrowUp}')
      expect(option('c')).toHaveFocus()
      expect(option('c')).toHaveAttribute('aria-checked', 'true')
    })
  })

  it('leaves other keys alone', () => {
    const onChange = vi.fn()
    render(<Zoom onChange={onChange} />)
    expect(fireEvent.keyDown(option('Dzień'), { key: 'Tab' })).toBe(true)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('is medium sized by default', () => {
    render(<Segmented label="Motyw" value="a" onChange={() => {}} options={[{ value: 'a', label: 'A' }]} className="x" />)
    const group = screen.getByRole('radiogroup', { name: 'Motyw' })
    expect(group).toHaveClass('seg', 'x')
    expect(group).not.toHaveClass('seg-sm')
  })
})
