import {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  forwardRef,
  useId,
} from 'react'
import { cx } from './cx'

/**
 * A labelled control: mono uppercase label above, the control, and either
 * the hint or the error under it. The error is announced (`role="alert"`)
 * and linked to the control through `aria-describedby`, which the control
 * receives from the `describedBy` render argument.
 */
export function Field({ label, hint, error, children, className, required, id: givenId }: {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  children: (props: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode
  className?: string
  required?: boolean
  id?: string
}) {
  const generated = useId()
  const id = givenId ?? generated
  const messageId = `${id}-msg`
  const hasMessage = Boolean(error || hint)
  return (
    <div className={cx('field', Boolean(error) && 'field-invalid', className)}>
      <label className="field-label" htmlFor={id}>
        {label}
        {required && <span className="field-req" aria-hidden="true"> *</span>}
      </label>
      {children({ id, describedBy: hasMessage ? messageId : undefined, invalid: Boolean(error) })}
      {error ? (
        <p className="field-msg" id={messageId} role="alert">{error}</p>
      ) : hint ? (
        <p className="field-hint" id={messageId}>{hint}</p>
      ) : null}
    </div>
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; mono?: boolean }>(
  function Input({ invalid, mono, className, ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={cx('in', invalid && 'in-err', mono && 'in-mono', className)}
        aria-invalid={invalid || undefined}
        {...rest}
      />
    )
  },
)

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ invalid, className, rows = 3, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        rows={rows}
        className={cx('in', 'in-ta', invalid && 'in-err', className)}
        aria-invalid={invalid || undefined}
        {...rest}
      />
    )
  },
)

/** The native select: it is the one control every platform renders well on a
 *  phone, and the option lists here are short. */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(
  function Select({ invalid, className, children, ...rest }, ref) {
    return (
      <span className={cx('sel-wrap', className)}>
        <select ref={ref} className={cx('in', 'in-sel', invalid && 'in-err')} aria-invalid={invalid || undefined} {...rest}>
          {children}
        </select>
      </span>
    )
  },
)

export function Checkbox({ label, hint, className, ...rest }: {
  label: ReactNode
  hint?: ReactNode
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return (
    <label className={cx('check', className)}>
      <input type="checkbox" {...rest} />
      <span className="check-body">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
    </label>
  )
}

export function Radio({ label, hint, className, ...rest }: {
  label: ReactNode
  hint?: ReactNode
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return (
    <label className={cx('check', 'radio', className)}>
      <input type="radio" {...rest} />
      <span className="check-body">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
    </label>
  )
}

export interface SegmentOption<T extends string> {
  value: T
  label: ReactNode
  disabled?: boolean
  /** Colour of the label, for the availability brush. */
  tone?: 'na' | 'wn' | 'ch'
}

/**
 * A row of mutually exclusive choices: zoom, inbox, lens, theme. Exposed as a
 * radio group so arrow keys move between the options and a screen reader
 * announces the selected one.
 */
export function Segmented<T extends string>({ value, onChange, options, label, size = 'md', className }: {
  value: T
  onChange: (value: T) => void
  options: SegmentOption<T>[]
  /** Accessible name of the group. */
  label: string
  size?: 'md' | 'sm'
  className?: string
}) {
  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const enabled = options.filter((option) => !option.disabled)
    const position = enabled.findIndex((option) => option.value === options[index].value)
    let next = position
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (position + 1) % enabled.length
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (position - 1 + enabled.length) % enabled.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = enabled.length - 1
    else return
    event.preventDefault()
    onChange(enabled[next].value)
    const buttons = (event.currentTarget.parentElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button')
    const target = Array.from(buttons).find((button) => button.dataset.value === enabled[next].value)
    target?.focus()
  }
  return (
    <div className={cx('seg', size === 'sm' && 'seg-sm', className)} role="radiogroup" aria-label={label}>
      {options.map((option, index) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
          data-value={option.value}
          data-tone={option.tone}
          className={cx(option.value === value && 'on')}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** Fields side by side that wrap on a phone. */
export function FieldRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('frow', className)}>{children}</div>
}
