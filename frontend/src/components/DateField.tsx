import { Field, Input } from '../ui'

/**
 * A date field: the browser's own picker on a native input. Values are ISO
 * dates in and out, which is also what the API speaks, so no conversion layer
 * sits between the field and the request.
 */
export function DateField({ label, value, onChange, id, required, disabled, minDate, maxDate, hint, error }: {
  label: string
  value: string
  onChange: (value: string) => void
  id: string
  required?: boolean
  disabled?: boolean
  minDate?: string
  maxDate?: string
  hint?: string
  error?: string
}) {
  return (
    <Field label={label} id={id} required={required} hint={hint} error={error}>
      {({ id: fieldId, describedBy, invalid }) => (
        <Input
          id={fieldId}
          name={fieldId}
          type="date"
          mono
          value={value}
          min={minDate}
          max={maxDate}
          required={required}
          disabled={disabled}
          invalid={invalid}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  )
}
