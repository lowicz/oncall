import {
  InputHTMLAttributes,
  MouseEvent,
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
      {error ? (
        <p className="field-msg" id={messageId} role="alert">{error}</p>
      ) : hint ? (
        <p className="field-hint" id={messageId}>{hint}</p>
      ) : null}
    </div>
  )
}

/**
 * A group of controls under one legend: the roles a correction changes. The
 * error and the hint under the group both describe the whole group, so the
 * reason a choice is blocked stays read with it when the group is invalid.
 */
export function Fieldset({ legend, hint, error, children, className }: {
  legend: ReactNode
  hint?: ReactNode
  error?: ReactNode
  children: ReactNode
  className?: string
}) {
  const id = useId()
  const errorId = error ? `${id}-error` : undefined
  const hintId = hint ? `${id}-hint` : undefined
  return (
    <fieldset
      className={cx('field', 'fieldset', Boolean(error) && 'field-invalid', className)}
      aria-describedby={cx(errorId, hintId) || undefined}
    >
      <legend className="field-label">{legend}</legend>
      {children}
      {error && <p className="field-msg" id={errorId} role="alert">{error}</p>}
      {hint && <p className="field-hint" id={hintId}>{hint}</p>}
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
  /** Said under the label and read as the box's description, not its name. */
  hint?: ReactNode
  /** Unavailable, but kept in the tab order (`aria-disabled`, not `disabled`)
   *  so the reason, said under the group, is reached with it. */
  blocked?: boolean
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const id = useId()
  return (
    <label className={cx('check', blocked && 'check-off', className)}>
      <input
        type="checkbox"
        aria-labelledby={hint ? `${id}-label` : undefined}
        aria-describedby={hint ? `${id}-hint` : undefined}
        {...rest}
        {...(blocked ? { 'aria-disabled': true, readOnly: true, onChange: undefined, onClickCapture: preventToggle } : {})}
      />
      <span className="check-body">
        <span id={hint ? `${id}-label` : undefined}>{label}</span>
        {hint && <small id={`${id}-hint`}>{hint}</small>}
      </span>
    </label>
  )
}

function preventToggle(event: MouseEvent) {
  event.preventDefault()
}

export interface SegmentOption<T extends string> extends RadioNavigationOption<T> {
  label: ReactNode
  /** Colour of the label, for the availability brush. */
  tone?: 'na' | 'wn' | 'ch'
  /** The option's name when its label carries more than words, a count badge. */
  ariaLabel?: string
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
          aria-label={option.ariaLabel}
          data-value={option.value}
          data-tone={option.tone}
          className={cx(option.value === value && 'on')}
          // Blocked, not removed: the group's description says why.
          aria-disabled={option.disabled || undefined}
          onClick={() => { if (!option.disabled && option.value !== value) onChange(option.value) }}
          onKeyDown={(event) => navigateRadioGroup(event, option.value, options, onChange)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
