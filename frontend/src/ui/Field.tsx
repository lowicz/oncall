import {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  forwardRef,
  useId,
} from 'react'
import { cx } from './cx'
import { navigateRadioGroup, radioTabIndex } from './radioNavigation'
import type { RadioNavigationOption } from './radioNavigation'

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
  children: (props: { id: string; labelId: string; describedBy: string | undefined; invalid: boolean }) => ReactNode
  className?: string
  required?: boolean
  id?: string
}) {
  const generated = useId()
  const id = givenId ?? generated
  const messageId = `${id}-msg`
  const labelId = `${id}-label`
  const hasMessage = Boolean(error || hint)
  return (
    <div className={cx('field', Boolean(error) && 'field-invalid', className)}>
      <label className="field-label" id={labelId} htmlFor={id}>
        {label}
        {required && <span className="field-req" aria-hidden="true"> *</span>}
      </label>
      {children({ id, labelId, describedBy: hasMessage ? messageId : undefined, invalid: Boolean(error) })}
      <FieldMessage id={messageId} hint={hint} error={error} />
    </div>
  )
}

/** The error (announced) or else the hint under a field or a group. */
function FieldMessage({ id, hint, error }: { id: string; hint?: ReactNode; error?: ReactNode }) {
  if (error) return <p className="field-msg" id={id} role="alert">{error}</p>
  if (hint) return <p className="field-hint" id={id}>{hint}</p>
  return null
}

/**
 * A group of controls under one legend: the roles a correction changes. The
 * hint or error under the group describes the whole group, so the reason a
 * choice is blocked is read together with it.
 */
export function Fieldset({ legend, hint, error, children, className }: {
  legend: ReactNode
  hint?: ReactNode
  error?: ReactNode
  children: ReactNode
  className?: string
}) {
  const messageId = `${useId()}-msg`
  return (
    <fieldset
      className={cx('field', 'fieldset', Boolean(error) && 'field-invalid', className)}
      aria-describedby={error || hint ? messageId : undefined}
    >
      <legend className="field-label">{legend}</legend>
      {children}
      <FieldMessage id={messageId} hint={hint} error={error} />
    </fieldset>
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

export function Checkbox({ label, hint, className, blocked, ...rest }: {
  label: ReactNode
  hint?: ReactNode
  /** Unavailable, but kept in the tab order (`aria-disabled`, not `disabled`)
   *  so the reason, said under the group, is reached with it. */
  blocked?: boolean
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return (
    <label className={cx('check', blocked && 'check-off', className)}>
      <input
        type="checkbox"
        aria-disabled={blocked || undefined}
        onClickCapture={blocked ? (event) => event.preventDefault() : undefined}
        {...rest}
      />
      <span className="check-body">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
    </label>
  )
}


export interface SegmentOption<T extends string> extends RadioNavigationOption<T> {
  label: ReactNode
  /** Colour of the label, for the availability brush. */
  tone?: 'na' | 'wn' | 'ch'
}

/**
 * A row of mutually exclusive choices: zoom, inbox, lens, theme. Exposed as a
 * radio group so arrow keys move between the options and a screen reader
 * announces the selected one.
 */
export function Segmented<T extends string>({ value, onChange, options, label, labelId, describedBy, size = 'md', wrap, className }: {
  value: T
  onChange: (value: T) => void
  options: SegmentOption<T>[]
  /** Accessible name of the group. */
  label: string
  /** The id of the field label when this group is rendered by Field. */
  labelId?: string
  /** The id of the text that says what the choice means. */
  describedBy?: string
  size?: 'md' | 'sm'
  /** Lets the options flow onto further rows on a narrow screen. */
  wrap?: boolean
  className?: string
}) {
  return (
    <div className={cx('seg', size === 'sm' && 'seg-sm', wrap && 'seg-wrap', className)} role="radiogroup" aria-label={labelId ? undefined : label} aria-labelledby={labelId} aria-describedby={describedBy}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={radioTabIndex(value, option.value, options)}
          data-value={option.value}
          data-tone={option.tone}
          className={cx(option.value === value && 'on')}
          disabled={option.disabled}
          onClick={() => { if (option.value !== value) onChange(option.value) }}
          onKeyDown={(event) => navigateRadioGroup(event, option.value, options, onChange)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
