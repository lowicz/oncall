import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Checkbox, Field, Fieldset, Input, Segmented, Select, Textarea } from './Field'
import { expectNoAxeViolations } from '../test/axe'
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
    fireEvent.click(option('Miesiąc'))
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('selects nothing again when an arrow lands on the choice already made', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Segmented label="Jedna" value="a" onChange={onChange} options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B', disabled: true }]} />)
    await user.tab()
    await user.keyboard('{ArrowRight}{End}')
    expect(option('A')).toHaveFocus()
    expect(onChange).not.toHaveBeenCalled()
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
    function Cards({ options, initial = '', onChange }: { options: { value: string; disabled?: boolean }[]; initial?: string; onChange?: (value: string) => void }) {
      const [value, setValue] = useState(initial)
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
              onKeyDown={(event) => navigateRadioGroup(event, item.value, options, (next) => { setValue(next); onChange?.(next) })}
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

    it('selects nothing again when stepping from a blocked card onto the chosen one', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(<Cards options={[{ value: 'a', disabled: true }, { value: 'b' }]} initial="b" onChange={onChange} />)
      act(() => option('a').focus())
      await user.keyboard('{ArrowDown}')
      expect(option('b')).toHaveFocus()
      expect(onChange).not.toHaveBeenCalled()
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
    expect(group).not.toHaveClass('seg-wrap')
  })

  it('lets the options wrap onto further rows when asked', () => {
    render(<Segmented label="Filtry" value="a" onChange={() => {}} options={[{ value: 'a', label: 'A' }]} wrap />)
    expect(screen.getByRole('radiogroup', { name: 'Filtry' })).toHaveClass('seg', 'seg-wrap')
  })
})

describe('Fieldset', () => {
  function Roles({ error }: { error?: string }) {
    const [late, setLate] = useState(false)
    return (
      <Fieldset legend="Role do zmiany" hint="PRIMARY niedostępna: Jan Wiśniewski ma już drugi on-call tego dnia." error={error} className="roles">
        <Checkbox label="PRIMARY" blocked />
        <Checkbox label="SECONDARY" defaultChecked />
        <Checkbox label="11–19" checked={late} onChange={(event) => setLate(event.target.checked)} />
      </Fieldset>
    )
  }

  it('names the group by its legend and describes it with the hint', async () => {
    const { container } = render(<Roles />)
    const group = screen.getByRole('group', { name: 'Role do zmiany' })
    expect(group.tagName).toBe('FIELDSET')
    expect(group).toHaveClass('field', 'fieldset', 'roles')
    expect(group).toHaveAccessibleDescription('PRIMARY niedostępna: Jan Wiśniewski ma już drugi on-call tego dnia.')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await expectNoAxeViolations(container)
  })

  it('keeps a blocked choice in the tab order but never checks it', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<Roles />)
    const primary = screen.getByRole('checkbox', { name: 'PRIMARY' })
    expect(primary).toHaveAttribute('aria-disabled', 'true')
    expect(primary).toBeEnabled()
    expect(primary.closest('label')).toHaveClass('check', 'check-off')
    await user.tab()
    expect(primary).toHaveFocus()
    await user.keyboard(' ')
    await user.click(screen.getByText('PRIMARY'))
    expect(primary).not.toBeChecked()
    await user.tab()
    await user.tab()
    const late = screen.getByRole('checkbox', { name: '11–19' })
    expect(late).toHaveFocus()
    expect(late).not.toHaveAttribute('aria-disabled')
    await user.keyboard(' ')
    expect(late).toBeChecked()
  })

  it('never reports a controlled blocked choice as chosen, whatever the caller passes', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onChange = vi.fn()
    const onClickCapture = vi.fn()
    render(
      <Fieldset legend="Role do zmiany">
        <Checkbox label="PRIMARY" blocked checked={false} onChange={onChange} onClickCapture={onClickCapture} aria-disabled={false} />
      </Fieldset>,
    )
    const primary = screen.getByRole('checkbox', { name: 'PRIMARY' })
    expect(primary).toHaveAttribute('aria-disabled', 'true')
    await user.click(primary)
    await user.keyboard(' ')
    expect(primary).toHaveFocus()
    expect(onChange).not.toHaveBeenCalled()
    expect(onClickCapture).not.toHaveBeenCalled()
  })

  it('announces an error and keeps the blocked reason under the group', async () => {
    const { container } = render(<Roles error="Wybierz co najmniej jedną rolę" />)
    const group = screen.getByRole('group', { name: 'Role do zmiany' })
    expect(group).toHaveClass('field-invalid')
    expect(group).toHaveAccessibleDescription('Wybierz co najmniej jedną rolę PRIMARY niedostępna: Jan Wiśniewski ma już drugi on-call tego dnia.')
    expect(screen.getByRole('alert')).toHaveTextContent('Wybierz co najmniej jedną rolę')
    expect(screen.getByText('PRIMARY niedostępna: Jan Wiśniewski ma już drugi on-call tego dnia.')).toBeVisible()
    await expectNoAxeViolations(container)
  })

  it('describes the group by the error alone when there is no hint', () => {
    render(<Fieldset legend="Role" error="Wybierz co najmniej jedną rolę"><Checkbox label="PRIMARY" /></Fieldset>)
    expect(screen.getByRole('group', { name: 'Role' })).toHaveAccessibleDescription('Wybierz co najmniej jedną rolę')
  })

  it('describes nothing when there is nothing to say', () => {
    render(<Fieldset legend="Role"><Checkbox label="PRIMARY" /></Fieldset>)
    expect(screen.getByRole('group', { name: 'Role' })).not.toHaveAttribute('aria-describedby')
  })
})

describe('Segmented named by a visible label', () => {
  it('takes its name from the label, a single tab stop and the arrows', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    function Duration() {
      const [value, setValue] = useState('2h')
      return (
        <div className="field">
          <span className="field-label" id="dur">Na jak długo</span>
          <Segmented label="Na jak długo" labelId="dur" value={value} onChange={setValue} options={[
            { value: '1h', label: '1 h' },
            { value: '2h', label: '2 h' },
            { value: 'end', label: 'do 09:00 jutro' },
          ]} />
        </div>
      )
    }
    const { container } = render(<><button>Przed</button><Duration /></>)
    const group = screen.getByRole('radiogroup', { name: 'Na jak długo' })
    expect(group).not.toHaveAttribute('aria-label')
    await user.tab()
    await user.tab()
    expect(screen.getByRole('radio', { name: '2 h' })).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'do 09:00 jutro' })).toHaveFocus()
    expect(screen.getByRole('radio', { name: 'do 09:00 jutro' })).toBeChecked()
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Przed' })).toHaveFocus()
    await expectNoAxeViolations(container)
  })
})
